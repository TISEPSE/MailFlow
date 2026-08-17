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

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::Resultat;
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
#[tauri::command]
pub async fn resumes_connus(app: AppHandle, ids: Vec<String>) -> Resultat<HashMap<String, Resume>> {
    let dossier = corps::dossier_cache_dans(&app);

    Ok(ids
        .into_iter()
        .filter_map(|id| corps::lire_resume(&dossier, &id).map(|r| (id, r)))
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

/// Produit les résumés manquants, un par un, en signalant l'avancement.
///
/// Rend le nombre de résumés désormais disponibles — ceux d'avant compris,
/// pour que la barre parte d'où il faut plutôt que de zéro.
///
/// Sans clé configurée, la commande ne fait rien et le dit par un zéro : ce
/// n'est pas une panne, c'est le cas de tout utilisateur qui n'a pas voulu de
/// l'IA. Aucune erreur ne remonte, aucune notification ne s'affiche.
#[tauri::command]
pub async fn resumes_produire(
    app: AppHandle,
    etat: State<'_, EtatResumes>,
    ids: Vec<String>,
) -> Resultat<usize> {
    let Some(cle) = cle_enregistree() else {
        return Ok(0);
    };

    // Une nouvelle production efface l'ordre d'arrêt de la précédente.
    etat.arret.store(false, Ordering::Relaxed);

    let dossier = corps::dossier_cache_dans(&app);
    let adresse_utilisateur = super::compte_actif(&app);
    let total = ids.len();

    // Ce qui manque, et lui seul : relancer l'application ne refait rien.
    let (a_faire, deja): (Vec<String>, Vec<String>) = ids
        .into_iter()
        .partition(|id| corps::lire_resume(&dossier, id).is_none());

    let mut faits = deja.len();
    let _ = app.emit(EVENEMENT_RESUMES, Avancement { faits, total });

    if a_faire.is_empty() {
        return Ok(faits);
    }

    let fournisseur = Gemini::nouveau(cle)?;

    for id in a_faire {
        // Lu entre deux messages : c'est le seul endroit où l'arrêt peut être
        // à la fois honoré vite et sans rien gaspiller.
        if etat.arret.load(Ordering::Relaxed) {
            log::info!("résumés arrêtés à la demande, {faits} sur {total}");
            break;
        }

        let Some(corps_message) = corps::lire(&dossier, &id) else {
            // Le corps n'a pas été préchargé : le message sera résumé au
            // prochain relevé, quand il le sera.
            continue;
        };

        let texte = corps::texte_lisible(&corps_message);

        match fournisseur
            .resumer_newsletter(&texte, &adresse_utilisateur)
            .await
        {
            Ok(resume) => {
                corps::ranger_resume(&dossier, &id, &resume);
                faits += 1;
            }
            Err(e) => {
                // Un résumé manquant n'est pas une panne : la carte garde sa
                // ligne composée localement. On note et on passe au suivant.
                log::info!("résumé non produit : {e}");
            }
        }

        let _ = app.emit(EVENEMENT_RESUMES, Avancement { faits, total });
    }

    log::info!("{faits} résumé(s) disponibles sur {total} newsletter(s)");
    Ok(faits)
}
