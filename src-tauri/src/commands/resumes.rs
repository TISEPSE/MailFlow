//! Troisième phase du démarrage : les résumés de newsletters.
//!
//! # Pourquoi une phase à part
//!
//! Le relevé rapporte les messages, le préchargement rapporte leurs corps.
//! Résumer vient forcément après : **un résumé a besoin du corps**, que seule
//! la deuxième phase récupère. L'ordre n'est donc pas une préférence de mise en
//! page, c'est une dépendance.
//!
//! Contrairement au préchargement, cette phase **ne bloque rien** : elle tourne
//! pendant que l'utilisateur lit son courrier, change de page ou supprime des
//! messages. Sa barre informe, elle n'attend pas.
//!
//! # Reprenable, et interruptible pour de bon
//!
//! Chaque résumé est écrit sur le disque dès qu'il est produit. Fermer
//! l'application n'en perd aucun, et le lancement suivant ne refait que ce qui
//! manque. Le drapeau d'arrêt est lu **entre deux messages** — pas au début, ce
//! qui n'arrêterait rien.
//!
//! # Ce qui ne part pas
//!
//! Seules les newsletters passent ici : l'appelant ne transmet que des
//! identifiants de cette catégorie, et le nettoyage du texte a lieu dans le
//! fournisseur, où il ne peut pas être oublié. Voir [`crate::llm::gemini`].

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, Resultat};
use crate::gmail::corps;
use crate::llm::gemini::Gemini;
use crate::llm::{LlmProvider, Resume};
use crate::secrets::{CLE_API_LLM, KeyringStore, SecretStore};

use super::Avancement;

/// Nom de l'événement de progression des résumés.
pub const EVENEMENT_RESUMES: &str = "resumes-produits";

/// Drapeau d'arrêt, partagé entre la commande qui produit et celle qui stoppe.
#[derive(Default)]
pub struct EtatResumes {
    arret: AtomicBool,
}

/// Ce que l'interface a besoin de savoir pour dessiner les Paramètres.
///
/// La clé elle-même ne sort jamais du trousseau : seule sa présence est dite.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatLlm {
    pub cle_configuree: bool,
    pub modele: &'static str,
}

/// Lit la clé dans le trousseau, ou `None`.
fn cle_enregistree() -> Option<String> {
    KeyringStore::new()
        .get(CLE_API_LLM)
        .ok()
        .flatten()
        .filter(|c| !c.trim().is_empty())
}

#[tauri::command]
pub async fn llm_etat() -> Resultat<EtatLlm> {
    Ok(EtatLlm {
        cle_configuree: cle_enregistree().is_some(),
        modele: crate::llm::gemini::MODELE,
    })
}

/// Vérifie une clé, puis l'enregistre dans le trousseau.
///
/// L'ordre compte : une clé fausse n'est jamais rangée, si bien que la présence
/// d'une clé vaut promesse qu'elle fonctionnait au moment où on l'a posée. La
/// vérification fait un vrai appel — une clé bien formée mais révoquée
/// passerait n'importe quel contrôle de syntaxe.
#[tauri::command]
pub async fn llm_cle_enregistrer(cle: String) -> Resultat<()> {
    let cle = cle.trim().to_string();

    Gemini::nouveau(cle.clone())?.verifier().await?;

    KeyringStore::new().set(CLE_API_LLM, &cle)?;
    log::info!("clé de résumé enregistrée et vérifiée");
    Ok(())
}

#[tauri::command]
pub async fn llm_cle_effacer() -> Resultat<()> {
    KeyringStore::new().delete(CLE_API_LLM)?;
    log::info!("clé de résumé effacée");
    Ok(())
}

/// Résumés déjà produits, parmi les messages demandés.
///
/// Lus sur le disque, sans aucun appel : c'est ce qui s'affiche à l'ouverture
/// de la page, avant même que la phase ait commencé.
///
/// # La publication d'abord, le numéro ensuite
///
/// Ce que rend cette commande alimente les **cartes**, et une carte parle d'une
/// publication entière : c'est donc le résumé de publication qui prime, rangé
/// sous l'identifiant du numéro le plus récent — celui-là même que la carte
/// affiche.
///
/// La lecture du résumé de numéro reste en repli, pour les résumés produits
/// avant que la page ne passe au regroupement : ils sont sur le disque, ils ont
/// coûté un appel, et rien ne justifie de les jeter.
#[tauri::command]
pub async fn resumes_connus(app: AppHandle, ids: Vec<String>) -> Resultat<HashMap<String, Resume>> {
    let dossier = corps::dossier_cache_dans(&app);

    Ok(ids
        .into_iter()
        .filter_map(|id| {
            corps::lire_resume_de(&dossier, &id, corps::Portee::Publication)
                .or_else(|| corps::lire_resume(&dossier, &id))
                .map(|r| (id, r))
        })
        .collect())
}

/// Demande l'arrêt de la production en cours.
///
/// Ne coupe pas l'appel en vol : le message déjà parti va au bout et son résumé
/// est rangé. Interrompre au milieu gaspillerait le quota déjà consommé.
#[tauri::command]
pub async fn resumes_arreter(etat: State<'_, EtatResumes>) -> Resultat<()> {
    etat.arret.store(true, Ordering::Relaxed);
    log::info!("arrêt des résumés demandé");
    Ok(())
}

/// Une publication et ses numéros, du plus récent au plus ancien.
///
/// Le regroupement par émetteur est fait par l'interface (`lib/newsletters.ts`),
/// où il est déjà éprouvé. Le refaire ici donnerait deux règles de regroupement
/// qui divergeraient au premier cas tordu — et c'est l'interface qui perdrait,
/// puisque c'est elle qui dessine les cartes.
#[derive(Debug, Deserialize)]
pub struct GroupeAResumer {
    /// Identité de l'émetteur. Sert au journal, jamais de clé de rangement.
    pub cle: String,
    pub ids: Vec<String>,
}

/// Ce qu'un passage de résumés a réellement produit.
///
/// Un simple nombre ne suffisait pas : l'interface le comparait à celui d'avant
/// pour deviner ce qui s'était passé, et concluait « aucun résumé n'a pu être
/// produit » devant vingt-huit résumés en place et deux publications muettes.
/// Un compte rendu qui distingue « rien à envoyer » d'un refus du moteur permet
/// de ne montrer du rouge que lorsqu'il y a une panne.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RapportResumes {
    /// Résumés en main à la fin, ceux d'avant compris.
    pub disponibles: usize,
    pub total: usize,
    /// Produits pendant ce passage.
    pub produits: usize,
    /// Publications dont aucun numéro n'avait de texte à envoyer.
    pub sans_texte: usize,
    /// Publications que le moteur a réellement refusées.
    pub echecs: usize,
}

/// Produit les résumés manquants, **une publication à la fois**.
///
/// # Un appel par publication, pas par numéro
///
/// C'est le point qui décide du coût. Trente newsletters faisaient trente
/// appels, et le palier gratuit s'épuisait avant la fin de la page — le journal
/// finissait en « quota atteint, reprise dans 59 s ». Or la question qu'on se
/// pose devant cette page n'est pas « que dit ce numéro » mais « est-ce que je
/// lis cette publication » : une réponse par émetteur suffit, et elle coûte
/// huit appels au lieu de trente.
///
/// Le volume ne compense pas le gain : l'assemblage d'une publication tient
/// dans le même plafond de caractères qu'un message seul. Voir
/// [`crate::llm::gemini::assembler`].
///
/// Sans clé configurée, la commande ne fait rien et le dit par un rapport vide :
/// ce n'est pas une panne, c'est le cas de tout utilisateur qui n'a pas voulu
/// de l'IA. Aucune erreur ne remonte, aucune notification ne s'affiche.
#[tauri::command]
pub async fn resumes_produire(
    app: AppHandle,
    etat: State<'_, EtatResumes>,
    groupes: Vec<GroupeAResumer>,
) -> Resultat<RapportResumes> {
    let total = groupes.len();

    let Some(cle) = cle_enregistree() else {
        return Ok(RapportResumes {
            total,
            ..Default::default()
        });
    };

    // Une nouvelle production efface l'ordre d'arrêt de la précédente.
    etat.arret.store(false, Ordering::Relaxed);

    let dossier = corps::dossier_cache_dans(&app);
    let adresse_utilisateur = super::compte_actif(&app);

    // Ce qui manque, et lui seul : relancer l'application ne refait rien.
    let (a_faire, deja): (Vec<GroupeAResumer>, Vec<GroupeAResumer>) = groupes
        .into_iter()
        .filter(|g| !g.ids.is_empty())
        .partition(|g| resume_du_groupe(&dossier, g).is_none());

    let mut rapport = RapportResumes {
        disponibles: deja.len(),
        total,
        ..Default::default()
    };

    let _ = app.emit(
        EVENEMENT_RESUMES,
        Avancement {
            faits: rapport.disponibles,
            total,
        },
    );

    if a_faire.is_empty() {
        return Ok(rapport);
    }

    let fournisseur = Gemini::nouveau(cle)?;

    for groupe in a_faire {
        // Lu entre deux publications : c'est le seul endroit où l'arrêt peut
        // être à la fois honoré vite et sans rien gaspiller.
        if etat.arret.load(Ordering::Relaxed) {
            log::info!(
                "résumés arrêtés à la demande, {} sur {total}",
                rapport.disponibles
            );
            break;
        }

        // Les corps déjà préchargés, dans l'ordre reçu — du plus récent au plus
        // ancien. Un numéro sans corps est sauté sans faire échouer les autres.
        let numeros: Vec<String> = groupe
            .ids
            .iter()
            .filter_map(|id| corps::lire(&dossier, id))
            .map(|c| corps::texte_lisible(&c))
            .collect();

        match fournisseur
            .resumer_groupe(&numeros, &adresse_utilisateur)
            .await
        {
            Ok(resume) => {
                if let Some(recent) = groupe.ids.first() {
                    corps::ranger_resume_de(&dossier, recent, corps::Portee::Publication, &resume);
                }
                rapport.produits += 1;
                rapport.disponibles += 1;
            }

            // Aucun numéro n'avait de texte : ce n'est pas une panne, et cela
            // ne doit pas s'afficher en rouge. La carte garde sa ligne composée
            // localement, qui dit déjà l'essentiel.
            Err(AppError::Resume(motif)) if motif == crate::llm::gemini::MOTIF_SANS_TEXTE => {
                rapport.sans_texte += 1;
                log::info!("publication sans texte à résumer : {}", groupe.cle);
            }

            Err(e) => {
                rapport.echecs += 1;
                log::info!("résumé non produit : {e}");
            }
        }

        let _ = app.emit(
            EVENEMENT_RESUMES,
            Avancement {
                faits: rapport.disponibles,
                total,
            },
        );
    }

    log::info!(
        "{} résumé(s) disponibles sur {total} publication(s) — {} produit(s), {} sans texte, {} échec(s)",
        rapport.disponibles,
        rapport.produits,
        rapport.sans_texte,
        rapport.echecs
    );
    Ok(rapport)
}

// ---------------------------------------------------------------------------
// La synthèse du jour
// ---------------------------------------------------------------------------

/// Une publication, telle que la page la présente à la synthèse.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationASynthetiser {
    /// Identité de l'émetteur. C'est elle que l'interface recevra en retour,
    /// pour retrouver la carte et sa pastille.
    pub cle: String,
    pub nom: String,
    /// Le numéro le plus récent : c'est sous lui qu'est rangé le résumé de la
    /// publication, et c'est lui qui périme la synthèse quand il change.
    pub id_recent: String,
}

/// Un point de la synthèse, tel que l'interface l'affiche.
#[derive(Debug, Serialize)]
pub struct PointAffiche {
    pub texte: String,
    /// Clés des publications d'où vient ce point. Des **clés**, et non des
    /// rangs : la traduction a eu lieu ici, à partir de la liste réellement
    /// envoyée, et l'interface n'a donc rien à vérifier.
    pub sources: Vec<String>,
}

/// La synthèse telle qu'elle part vers l'interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntheseAffichee {
    pub points: Vec<PointAffiche>,
    pub hashtags: Vec<String>,
    /// Date et heure de production, au format RFC 3339. L'interface n'en montre
    /// que l'heure — « lues à 07:10 » — mais la date lui permet de se taire
    /// quand la synthèse est celle de la veille.
    pub produite_le: String,
    /// Combien de publications l'ont nourrie.
    pub publications: usize,
}

/// Ce qu'on range sur le disque : la synthèse brute et l'heure de sa production.
///
/// La synthèse est gardée avec ses **rangs**, pas ses clés, parce que c'est
/// ainsi que le modèle l'a rendue. L'empreinte du fichier garantit que la liste
/// des publications n'a pas bougé, donc que les rangs désignent toujours les
/// mêmes.
#[derive(Debug, Serialize, Deserialize)]
struct SyntheseEnCache {
    synthese: crate::llm::Synthese,
    produite_le: String,
}

/// Empreinte de la liste des publications qui nourrissent une synthèse.
///
/// # Pourquoi une empreinte plutôt qu'une durée
///
/// Une synthèse « du jour » périmée à minuit serait refaite alors que rien n'a
/// changé, et resterait fausse tout l'après-midi où trois numéros sont arrivés.
/// Ce qui la périme, c'est le contenu : dès qu'une publication entre, sort ou
/// reçoit un numéro plus récent, l'empreinte change et la synthèse est refaite —
/// une fois, puis plus jamais.
///
/// FNV-1a, écrit ici en cinq lignes : il ne s'agit pas de résister à un
/// adversaire mais de nommer un fichier de cache, et un algorithme dont la
/// valeur dépendrait de la version du compilateur ferait repayer un appel à
/// chaque mise à jour.
fn empreinte(publications: &[&PublicationASynthetiser]) -> String {
    let mut valeur: u64 = 0xcbf2_9ce4_8422_2325;
    for p in publications {
        for octet in p
            .cle
            .as_bytes()
            .iter()
            .chain(b"\0")
            .chain(p.id_recent.as_bytes())
        {
            valeur ^= u64::from(*octet);
            valeur = valeur.wrapping_mul(0x100_0000_01b3);
        }
    }
    format!("{valeur:016x}")
}

/// Réunit en trois points ce que les publications du jour ont apporté.
///
/// # Ce que cet appel coûte, et ce qu'il ne coûte pas
///
/// **Un appel, et seulement quand la liste des publications a changé.** Il ne
/// relit aucun mail : il part des résumés de publication déjà produits et déjà
/// rangés sur le disque — ceux qui font vivre les cartes. Une publication non
/// encore résumée n'est simplement pas de la partie ; elle le sera au passage
/// suivant, sans que rien d'autre soit refait.
///
/// Il n'y a donc rien de neuf à expurger : ces textes sont les nôtres, écrits à
/// partir de contenus déjà nettoyés de leurs liens et de l'adresse de
/// l'utilisateur ([`crate::llm::gemini::expurger`]).
///
/// Rend `None` — et non une erreur — sans clé configurée ou sans aucun résumé en
/// main : le bandeau garde alors ce qu'il affiche déjà, et la page ne bouge pas
/// d'un pixel selon que l'IA est là ou non.
#[tauri::command]
pub async fn synthese_produire(
    app: AppHandle,
    publications: Vec<PublicationASynthetiser>,
) -> Resultat<Option<SyntheseAffichee>> {
    let dossier = corps::dossier_cache_dans(&app);

    // Seules celles qui ont déjà un résumé, dans l'ordre de la page. L'ordre
    // compte : c'est lui qui fixe les rangs, et donc le sens des sources que le
    // modèle rendra.
    let nourries: Vec<(&PublicationASynthetiser, Resume)> = publications
        .iter()
        .filter_map(|p| resume_de_la_publication(&dossier, &p.id_recent).map(|r| (p, r)))
        .take(crate::llm::gemini::PUBLICATIONS_PAR_SYNTHESE)
        .collect();

    if nourries.is_empty() {
        return Ok(None);
    }

    let retenues: Vec<&PublicationASynthetiser> = nourries.iter().map(|(p, _)| *p).collect();
    let empreinte = empreinte(&retenues);
    let chemin = corps::chemin_resume_de(&dossier, &empreinte, corps::Portee::Synthese);

    if let Some(cache) = lire_la_synthese_en_cache(&chemin) {
        log::info!("synthèse du jour reprise du cache, aucun appel");
        return Ok(Some(afficher(cache.synthese, &retenues, cache.produite_le)));
    }

    let Some(cle) = cle_enregistree() else {
        return Ok(None);
    };

    let entrees: Vec<(String, String)> = nourries
        .iter()
        .map(|(p, r)| (p.nom.clone(), r.texte.clone()))
        .collect();

    let synthese = match Gemini::nouveau(cle)?.synthetiser(&entrees).await {
        Ok(s) => s,
        Err(e) => {
            // Une synthèse manquante n'est pas une panne : le bandeau garde son
            // décompte, et les cartes leurs résumés.
            log::info!("synthèse du jour non produite : {e}");
            return Ok(None);
        }
    };

    let produite_le = chrono::Local::now().to_rfc3339();
    ranger_la_synthese(&dossier, &chemin, &synthese, &produite_le);

    log::info!(
        "synthèse du jour produite en {} point(s) sur {} publication(s)",
        synthese.points.len(),
        retenues.len()
    );
    Ok(Some(afficher(synthese, &retenues, produite_le)))
}

/// Le résumé d'une publication : celui du groupe, à défaut celui du numéro.
///
/// Le même ordre de préférence que [`resumes_connus`], et pour la même raison :
/// un résumé de publication parle de tout ce qu'elle a envoyé, celui d'un numéro
/// d'un seul.
fn resume_de_la_publication(dossier: &std::path::Path, id_recent: &str) -> Option<Resume> {
    corps::lire_resume_de(dossier, id_recent, corps::Portee::Publication)
        .or_else(|| corps::lire_resume(dossier, id_recent))
        .filter(|r| !r.texte.trim().is_empty())
}

/// Traduit les rangs en clés de publication, et jette ce qui ne correspond à rien.
///
/// La lecture de la réponse a déjà écarté les rangs hors bornes
/// ([`crate::llm::gemini`]) ; cette seconde vérification ne coûte rien et rend
/// la fonction juste toute seule, sans dépendre de ce qui s'est passé avant.
fn afficher(
    synthese: crate::llm::Synthese,
    retenues: &[&PublicationASynthetiser],
    produite_le: String,
) -> SyntheseAffichee {
    SyntheseAffichee {
        points: synthese
            .points
            .into_iter()
            .map(|p| PointAffiche {
                texte: p.texte,
                sources: p
                    .sources
                    .into_iter()
                    .filter_map(|rang| retenues.get(rang.checked_sub(1)?))
                    .map(|p| p.cle.clone())
                    .collect(),
            })
            .filter(|p| !p.sources.is_empty())
            .collect(),
        hashtags: synthese.hashtags,
        produite_le,
        publications: retenues.len(),
    }
}

/// Relit une synthèse rangée, ou `None` si elle est illisible ou périmée.
fn lire_la_synthese_en_cache(chemin: &std::path::Path) -> Option<SyntheseEnCache> {
    let texte = std::fs::read_to_string(chemin).ok()?;
    let cache: SyntheseEnCache = serde_json::from_str(&texte).ok()?;
    (cache.synthese.generation == crate::llm::GENERATION_SYNTHESE).then_some(cache)
}

/// Range la synthèse, et efface celles qui ne valent plus.
///
/// Une seule survit à la fois : leur nom est une empreinte, et une empreinte
/// périmée ne sera plus jamais demandée. Les laisser s'accumuler ferait grossir
/// le dossier d'un fichier par jour, sans que rien ne les relise.
fn ranger_la_synthese(
    dossier: &std::path::Path,
    chemin: &std::path::Path,
    synthese: &crate::llm::Synthese,
    produite_le: &str,
) {
    let _ = std::fs::create_dir_all(dossier);

    let cache = SyntheseEnCache {
        synthese: synthese.clone(),
        produite_le: produite_le.to_string(),
    };

    let Ok(json) = serde_json::to_string(&cache) else {
        return;
    };
    if let Err(e) = crate::cache::ecrire_prive(chemin, &json) {
        log::info!("synthèse non mise en cache : {e}");
        return;
    }

    if let Ok(entrees) = std::fs::read_dir(dossier) {
        for entree in entrees.flatten() {
            let autre = entree.path();
            if autre != chemin && autre.extension().and_then(|e| e.to_str()) == Some("synthese") {
                let _ = std::fs::remove_file(autre);
            }
        }
    }
}

/// Le résumé d'une publication, s'il existe déjà.
///
/// Rangé sous l'identifiant du numéro le plus récent : c'est ce qui lui donne
/// sa date de péremption sans qu'on ait à en inventer une. Un numéro plus
/// récent arrive, la clé change, le résumé est refait — et il le doit, puisque
/// désormais il devrait couvrir ce numéro-là aussi.
fn resume_du_groupe(dossier: &std::path::Path, groupe: &GroupeAResumer) -> Option<Resume> {
    let recent = groupe.ids.first()?;
    corps::lire_resume_de(dossier, recent, corps::Portee::Publication)
}
