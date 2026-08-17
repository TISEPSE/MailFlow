//! Surface exposée au frontend.
//!
//! C'est la seule frontière par laquelle le webview peut déclencher quoi que ce
//! soit. Chaque commande ajoutée ici élargit ce que du HTML d'e-mail compromis
//! pourrait atteindre : on n'expose que ce dont une vue a besoin, et jamais un
//! primitif générique (« lire ce fichier », « appeler cette URL »).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use chrono::{Local, Utc};

use crate::auth::flux::ClientOAuth;
use crate::auth::session::SessionAuth;
use crate::auth::{DELAI_AUTORISATION, connecter};
use crate::cache;
use crate::comptes::{self, Annuaire};
use crate::config;
use crate::error::{AppError, Resultat};
use crate::gmail::apercu::{self, Apercu};
use crate::gmail::boite::{MessageAffiche, charger_boite_suivi};
use crate::gmail::client::{ClientGmail, SourceJeton};
use crate::gmail::execution::RapportExecution;
use crate::gmail::synchronisation::synchroniser;
use crate::gmail::transport::TransportHttp;
use crate::rules::{self, Rule, RuleSet, RulesStore};
use crate::secrets::KeyringStore;

pub mod resumes;

/// État d'authentification partagé, géré par Tauri.
///
/// `client` vaut `None` tant que l'identifiant Google n'a pas été configuré :
/// l'application se lance quand même et l'explique, plutôt que de refuser de
/// démarrer sur un fichier `.env` incomplet.
pub struct EtatAuth {
    session: Mutex<SessionAuth<KeyringStore>>,
    client: Option<ClientOAuth>,
}

impl EtatAuth {
    pub fn nouveau() -> Self {
        let client = match (config::client_id_google(), config::client_secret_google()) {
            (Some(id), Some(secret)) => ClientOAuth::nouveau(id, secret)
                .inspect_err(|e| log::error!("client OAuth inutilisable : {e}"))
                .ok(),
            (id, secret) => {
                // Nommer précisément ce qui manque : les deux valeurs viennent du
                // même fichier téléchargé chez Google, et n'en copier qu'une est
                // l'erreur la plus facile à commettre.
                let mut absents = Vec::new();
                if id.is_none() {
                    absents.push(config::VAR_CLIENT_ID);
                }
                if secret.is_none() {
                    absents.push(config::VAR_CLIENT_SECRET);
                }
                log::warn!(
                    "connexion Gmail indisponible, configuration absente : {}",
                    absents.join(", ")
                );
                None
            }
        };

        Self {
            session: Mutex::new(SessionAuth::nouvelle(KeyringStore::new())),
            client,
        }
    }

    fn client(&self) -> Resultat<&ClientOAuth> {
        self.client
            .as_ref()
            .ok_or_else(|| AppError::Config(format!("{} non renseigné", config::VAR_CLIENT_ID)))
    }
}

/// Donne au client Gmail de quoi s'authentifier, sans rien lui apprendre
/// d'OAuth2.
///
/// Le verrou de session n'est pris que le temps d'obtenir un jeton, jamais
/// pendant les appels Gmail : une synchronisation dure plusieurs secondes, et
/// bloquer la session tout ce temps empêcherait toute autre commande.
struct JetonsDeSession<'a> {
    etat: &'a EtatAuth,
}

impl SourceJeton for JetonsDeSession<'_> {
    async fn jeton(&self, forcer: bool) -> Resultat<String> {
        let client = self.etat.client()?;
        let mut session = self.etat.session.lock().await;

        if forcer {
            session.oublier_le_jeton_courant();
        }
        session.access_token(client, Utc::now()).await
    }
}

/// Dossier de configuration applicatif de l'utilisateur.
pub fn dossier_config(app: &AppHandle) -> Resultat<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::Config(format!("dossier de configuration introuvable : {e}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatApplication {
    pub version: String,
    pub plateforme: &'static str,

    /// Faux quand aucun agent de trousseau n'est joignable (session Linux sans
    /// Secret Service, par exemple). La connexion Gmail est alors impossible et
    /// l'interface doit le dire clairement plutôt que d'échouer plus tard.
    pub trousseau_disponible: bool,

    /// Expose volontairement : le mode avancé de la vue 5 propose d'ouvrir le
    /// fichier brut. C'est un chemin appartenant à l'utilisateur, dans sa propre
    /// session — pas un secret.
    ///
    /// Celui du compte actif : chaque compte a désormais ses règles à lui.
    pub chemin_regles: String,

    /// `None` quand le fichier existe mais n'a pas pu être lu.
    ///
    /// Compte les règles du compte actif, pas de tous les comptes.
    pub nombre_de_regles: Option<usize>,

    pub compte_connecte: bool,

    /// Faux tant que l'identifiant client Google n'a pas été renseigné. La vue de
    /// connexion doit alors renvoyer vers `docs/connexion-google.md` au lieu de
    /// proposer un bouton qui ne peut pas fonctionner.
    pub client_google_configure: bool,
}

/// État de santé du backend, appelé au démarrage par le frontend.
///
/// Sert aussi de tranche verticale de bout en bout : elle touche le trousseau,
/// le système de fichiers et les chemins Tauri, donc elle échoue bruyamment si
/// l'un des trois est mal câblé.
#[tauri::command]
pub async fn app_health(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<EtatApplication> {
    let dossier = dossier_config(&app)?;
    let actif = compte_actif(&app);

    // Migration des règles d'avant le cloisonnement, ici parce que c'est le
    // premier appel au démarrage *et* celui que l'interface refait après une
    // connexion : le compte actif vient peut-être seulement d'exister.
    // L'opération est idempotente et ne fait rien dans le cas courant.
    if let Err(e) = rules::migration::cloisonner(&dossier, &actif) {
        // Un échec ne doit pas empêcher l'application de démarrer : l'ancien
        // fichier reste en place et sera retenté au prochain lancement.
        log::warn!("migration des règles impossible : {e}");
    }

    let store = RulesStore::pour_compte(&dossier, &actif);

    let nombre_de_regles = match store.charger() {
        Ok(regles) => Some(regles.automations.len()),
        Err(e) => {
            log::warn!("règles illisibles : {e}");
            None
        }
    };

    let trousseau_disponible = KeyringStore::disponible().is_ok();

    // Sans trousseau joignable, on ne peut rien affirmer sur la connexion.
    let compte_connecte = trousseau_disponible
        && etat
            .session
            .lock()
            .await
            .est_connecte()
            .inspect_err(|e| log::warn!("lecture du trousseau impossible : {e}"))
            .unwrap_or(false);

    let client_google_configure = etat.client.is_some();

    log::info!(
        "diagnostic : trousseau={trousseau_disponible}, client_google={client_google_configure}, \
         compte_connecte={compte_connecte}, regles={nombre_de_regles:?}"
    );

    Ok(EtatApplication {
        version: app.package_info().version.to_string(),
        plateforme: std::env::consts::OS,
        trousseau_disponible,
        chemin_regles: store.chemin().display().to_string(),
        nombre_de_regles,
        compte_connecte,
        client_google_configure,
    })
}

/// Lance le parcours de connexion Google et attend son issue.
///
/// Rend la main quand l'utilisateur a donné son accord, l'a refusé, ou n'a rien
/// fait dans le délai imparti. Aucun jeton ne remonte au frontend : il apprend le
/// résultat en rappelant `app_health`.
#[tauri::command]
pub async fn google_connecter(etat: State<'_, EtatAuth>) -> Resultat<()> {
    let client = etat.client()?;

    // Le verrou est pris pour toute la durée du parcours : deux connexions
    // simultanées écraseraient mutuellement leur `refresh_token`.
    let mut session = etat.session.lock().await;

    connecter(
        client,
        &mut session,
        |url| {
            // Navigateur système, jamais un webview de l'application : c'est ce
            // qui garantit à l'utilisateur qu'il tape son mot de passe chez
            // Google et non dans une page que MailFlow contrôle.
            tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
                .map_err(|e| AppError::Auth(format!("ouverture du navigateur impossible : {e}")))
        },
        DELAI_AUTORISATION,
    )
    .await
    .inspect_err(|e| log::warn!("connexion Google interrompue : {e}"))?;

    log::info!("compte Gmail connecté");
    Ok(())
}

/// Déconnecte le compte et révoque l'autorisation chez Google.
#[tauri::command]
pub async fn google_deconnecter(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<()> {
    let a_revoquer = etat.session.lock().await.fermer()?;

    // Le compte quitte aussi l'annuaire : son autorisation est rendue à Google,
    // le proposer encore dans la liste des comptes serait promettre une bascule
    // qui échouerait.
    if let Ok(dossier) = dossier_config(&app) {
        let mut annuaire = comptes::charger(&dossier);
        if let Some(actif) = annuaire.actif.clone() {
            annuaire.oublier(&actif);
            let _ = comptes::ecrire(&dossier, &annuaire);
        }
    }

    // Le trousseau est déjà vide à ce stade : même si la révocation échoue
    // (machine hors ligne), l'utilisateur est bien déconnecté localement.
    if let (Some(jeton), Ok(client)) = (a_revoquer, etat.client())
        && let Err(e) = client.revoquer(&jeton).await
    {
        log::warn!("révocation côté Google impossible : {e}");
    }

    log::info!("compte Gmail déconnecté");
    Ok(())
}

/// Applique les règles à la boîte Gmail et rend le compte de ce qui a été fait.
///
/// Le parcours entier vit côté Rust : le frontend déclenche et reçoit un
/// décompte, jamais des identifiants de messages ni des jetons.
#[tauri::command]
pub async fn gmail_synchroniser(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<RapportExecution> {
    let dossier = dossier_config(&app)?;
    // Les règles du compte qu'on synchronise, et d'aucun autre : celles d'une
    // autre boîte n'ont rien à dire sur celle-ci.
    let regles = RulesStore::pour_compte(&dossier, &compte_actif(&app)).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    let rapport = synchroniser(&client, &regles, Local::now())
        .await
        .inspect_err(|e| log::warn!("synchronisation interrompue : {e}"))?;

    log::info!(
        "synchronisation terminée : {} archivé(s), {} à la corbeille, {} échec(s)",
        rapport.archives,
        rapport.mis_a_la_corbeille,
        rapport.echecs
    );

    Ok(rapport)
}

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

/// Les règles d'un compte, telles qu'elles partent vers l'interface.
#[derive(Debug, Serialize)]
pub struct ReglesDuCompte {
    pub compte: String,
    pub regles: RuleSet,
}

/// Magasin des règles d'un compte, après vérification que le compte existe.
///
/// Les règles appartiennent à un compte : une commande qui n'en désigne aucun
/// n'a pas de sens, et un compte inconnu laisserait derrière lui un fichier que
/// plus rien ne rattache à une boîte. L'adresse arrive du webview, donc d'un
/// endroit qu'on ne suppose pas intègre — elle est confrontée à l'annuaire
/// plutôt que crue sur parole.
fn magasin_regles(app: &AppHandle, compte: &str) -> Resultat<RulesStore> {
    let dossier = dossier_config(app)?;

    if compte.trim().is_empty() || !comptes::charger(&dossier).est_connu(compte) {
        log::warn!("règles demandées pour un compte inconnu");
        return Err(AppError::NonAuthentifie);
    }

    Ok(RulesStore::pour_compte(&dossier, compte))
}

/// Chaque commande de règle rend le jeu complet du compte plutôt qu'un accusé
/// de réception. L'interface se réaffiche à partir de ce qui est réellement sur
/// le disque, au lieu de maintenir sa propre copie qui finirait par diverger.
#[tauri::command]
pub async fn regles_lister(app: AppHandle, compte: String) -> Resultat<RuleSet> {
    magasin_regles(&app, &compte)?.charger()
}

/// Les règles de tous les comptes connus, pour la vue « Tous les comptes ».
///
/// Un compte dont le fichier est illisible n'interrompt pas la lecture des
/// autres : il apparaît sans règle, et son propre écran dira pourquoi.
#[tauri::command]
pub async fn regles_toutes(app: AppHandle) -> Resultat<Vec<ReglesDuCompte>> {
    let dossier = dossier_config(&app)?;

    Ok(comptes::charger(&dossier)
        .connus
        .iter()
        .map(|c| ReglesDuCompte {
            compte: c.adresse.clone(),
            regles: RulesStore::pour_compte(&dossier, &c.adresse)
                .charger()
                .unwrap_or_else(|e| {
                    log::warn!("règles illisibles pour un compte : {e}");
                    RuleSet::default()
                }),
        })
        .collect())
}

#[tauri::command]
pub async fn regle_ajouter(app: AppHandle, compte: String, regle: Rule) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    regles.ajouter(regle);
    magasin.enregistrer(&regles)?;

    log::info!(
        "règle enregistrée, {} au total pour ce compte",
        regles.automations.len()
    );
    Ok(regles)
}

/// Remplace une règle existante, désignée par son identifiant.
///
/// Une commande à part plutôt qu'un `regle_ajouter` détourné : l'ajout
/// reconnaît une règle à son expéditeur, or c'est justement l'expéditeur qu'on
/// vient souvent corriger.
#[tauri::command]
pub async fn regle_modifier(
    app: AppHandle,
    compte: String,
    id: String,
    regle: Rule,
) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.modifier(&id, regle) {
        magasin.enregistrer(&regles)?;
        log::info!("règle {id} modifiée");
    } else {
        log::warn!("règle {id} introuvable, rien de modifié");
    }

    Ok(regles)
}

#[tauri::command]
pub async fn regle_supprimer(app: AppHandle, compte: String, id: String) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.supprimer(&id) {
        magasin.enregistrer(&regles)?;
        log::info!("règle {id} supprimée");
    }
    Ok(regles)
}

#[tauri::command]
pub async fn regle_basculer(app: AppHandle, compte: String, id: String) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.basculer(&id) {
        magasin.enregistrer(&regles)?;
    }
    Ok(regles)
}

// ---------------------------------------------------------------------------
// Boîte de réception
// ---------------------------------------------------------------------------

/// Nom de l'événement annonçant l'avancement du relevé.
///
/// Le relevé demande un appel par message : c'est la plus longue attente de
/// l'ouverture, et l'écran de chargement n'avait rien à en dire.
pub const EVENEMENT_RELEVE: &str = "messages-releves";

/// Dossier où le cache s'installe, durablement.
///
/// Le dossier de cache de l'application, et non `$XDG_RUNTIME_DIR` comme
/// autrefois : celui-ci survit à l'extinction de la machine, ce qui est tout
/// l'objet de la manœuvre. Voir [`crate::cache`] pour ce que ce choix coûte.
pub fn dossier_cache(app: &AppHandle) -> Resultat<PathBuf> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("boites"))
        .map_err(|e| AppError::Config(format!("dossier de cache introuvable : {e}")))
}

/// Adresse du compte actif, telle que l'annuaire la connaît.
///
/// Prise dans l'annuaire et non demandée à Gmail : c'est une lecture de
/// fichier, là où l'autre coûte un appel réseau, et le cache s'interroge à
/// chaque ouverture.
fn compte_actif(app: &AppHandle) -> String {
    comptes::charger(&dossier_config(app).unwrap_or_default())
        .actif
        .unwrap_or_default()
}

/// Relève la boîte et classe les messages par vue.
///
/// Ne rend ni corps de message ni identifiant de fil : le HTML d'un e-mail est
/// écrit par un inconnu et ne traversera l'IPC que le jour où une `iframe` en
/// bac à sable saura l'afficher sans risque.
///
/// Le relevé est rangé au passage : c'est lui qui s'affichera à la prochaine
/// ouverture, sans attendre le réseau.
#[tauri::command]
pub async fn boite_lister(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<MessageAffiche>> {
    use tauri::Emitter;

    let compte = compte_actif(&app);
    let regles = RulesStore::pour_compte(&dossier_config(&app)?, &compte).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let boite = charger_boite_suivi(&client, &regles, &compte, |faits, total| {
        let _ = app.emit(EVENEMENT_RELEVE, Avancement { faits, total });
    })
    .await
    .inspect_err(|e| log::warn!("relevé de la boîte interrompu : {e}"))?;

    if let Ok(racine) = dossier_cache(&app) {
        cache::ranger_boite(&racine, &compte, &boite);
    }

    log::info!("{} message(s) relevé(s)", boite.len());
    Ok(boite)
}

/// Rend le dernier relevé connu du compte actif, sans toucher au réseau.
///
/// C'est ce qui s'affiche à l'ouverture, le temps que le relevé aboutisse. Rend
/// une liste vide plutôt qu'une erreur quand rien n'a encore été rangé : une
/// première ouverture n'est pas une panne.
#[tauri::command]
pub async fn boite_en_cache(app: AppHandle) -> Resultat<Vec<MessageAffiche>> {
    let racine = dossier_cache(&app)?;
    let compte = compte_actif(&app);
    let mut boite = cache::lire_boite(&racine, &compte).unwrap_or_default();

    // Les règles sont rejouées à la lecture : sans cela, une règle créée depuis
    // le dernier relevé resterait sans effet jusqu'au suivant.
    let regles = RulesStore::pour_compte(&dossier_config(&app)?, &compte).charger()?;
    cache::reclasser(&mut boite, &regles);

    log::info!("{} message(s) relus du cache", boite.len());
    Ok(boite)
}

/// Rend les relevés de tous les comptes connus, mélangés et triés par date.
///
/// C'est le compte fictif « Tous les comptes » : une vue, pas une boîte. Tout
/// vient du disque — aucun appel réseau, donc aucune attente. Les comptes qui
/// n'ont jamais été relevés n'y figurent simplement pas encore.
#[tauri::command]
pub async fn boite_melangee(app: AppHandle) -> Resultat<Vec<MessageAffiche>> {
    let dossier = dossier_config(&app)?;
    let racine = dossier_cache(&app)?;

    // Chaque boîte est reclassée avec les règles de son propre compte avant
    // d'être versée au tas commun. C'est tout l'intérêt du cloisonnement : la
    // vue mélange les messages, pas les décisions qui les concernent.
    let mut tout: Vec<MessageAffiche> = Vec::new();

    for compte in comptes::charger(&dossier).connus {
        let Some(mut boite) = cache::lire_boite(&racine, &compte.adresse) else {
            continue;
        };

        let regles = RulesStore::pour_compte(&dossier, &compte.adresse)
            .charger()
            .unwrap_or_else(|e| {
                log::warn!("règles illisibles, boîte laissée telle quelle : {e}");
                RuleSet::default()
            });

        cache::reclasser(&mut boite, &regles);
        tout.extend(boite);
    }

    // Décroissant : le plus récent en tête, comme dans chaque boîte prise
    // séparément. Une date absente part en fin de liste plutôt que de prendre
    // la première place.
    tout.sort_by(|a, b| b.date.cmp(&a.date));

    log::info!("{} message(s) dans la vue mélangée", tout.len());
    Ok(tout)
}

/// Efface tout le cache, tous comptes confondus.
#[tauri::command]
pub async fn cache_vider(app: AppHandle) -> Resultat<()> {
    let racine = dossier_cache(&app)?;
    cache::vider(&racine)?;
    // Les corps aussi : les garder après avoir effacé les relevés laisserait
    // sur le disque exactement ce que l'utilisateur voulait voir partir.
    let _ = std::fs::remove_dir_all(crate::gmail::corps::dossier_cache_dans(&app));

    log::info!("cache effacé à la demande");
    Ok(())
}

/// Taille du cache sur le disque, en octets.
#[tauri::command]
pub async fn cache_taille(app: AppHandle) -> Resultat<u64> {
    let racine = dossier_cache(&app)?;
    Ok(cache::taille(&racine) + cache::taille(&crate::gmail::corps::dossier_cache_dans(&app)))
}

/// Corps d'un message, prêt à être affiché en bac à sable.
///
/// Le HTML est désinfecté ici, mais ce n'est pas ce qui protège : il est
/// destiné à une `iframe` déclarée `sandbox`, où le navigateur refuse
/// d'exécuter le moindre script. Voir [`crate::gmail::corps`].
///
/// N'est demandé que pour le message ouvert : `format=full` rapatrie le HTML
/// entier, quand le tri se contente de quelques en-têtes.
#[tauri::command]
pub async fn message_corps(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
) -> Resultat<crate::gmail::corps::CorpsMessage> {
    use crate::gmail::corps;

    // Déjà rangé : ni appel Gmail, ni images à retélécharger. Le dossier
    // survit au redémarrage de la machine — voir `crate::cache`.
    let dossier = corps::dossier_cache_dans(&app);
    if let Some(connu) = corps::lire(&dossier, &id) {
        return Ok(connu);
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    lire_le_corps(&client, &dossier, &id).await
}

/// Va chercher un corps chez Gmail, l'assainit, rapatrie ses images, le range.
///
/// Séparé de la commande pour que le préchargement puisse réutiliser un seul
/// client sur toute la boîte : `TransportHttp::nouveau` construit un client
/// HTTP, donc une réserve de connexions. En construire un par message faisait
/// repayer la poignée de main TLS soixante fois.
async fn lire_le_corps<T, J>(
    client: &ClientGmail<T, J>,
    dossier: &std::path::Path,
    id: &str,
) -> Resultat<crate::gmail::corps::CorpsMessage>
where
    T: crate::gmail::client::Transport,
    J: SourceJeton,
{
    use crate::gmail::corps;

    let message = client.message_complet(id).await?;

    let mut trouve = message
        .payload
        .as_ref()
        .map(corps::extraire)
        .unwrap_or_default();

    trouve.html = trouve.html.as_deref().map(corps::assainir);

    if let Some(html) = trouve.html.as_deref() {
        let pieces = message
            .payload
            .as_ref()
            .map(corps::pieces_par_cid)
            .unwrap_or_default();

        let table = rapatrier_les_images(client, id, html, &pieces).await;
        trouve.html = Some(corps::substituer_images(html, &table));

        // Une image intégrée au document est une pièce jointe pour Gmail, mais
        // pas pour le lecteur : elle est déjà sous ses yeux. La proposer au
        // téléchargement reviendrait à offrir d'enregistrer ce qu'il regarde.
        let integrees: std::collections::HashSet<&str> = table
            .keys()
            .filter_map(|source| pieces.get(source).map(String::as_str))
            .collect();

        trouve.pieces.retain(|p| !integrees.contains(p.id.as_str()));
    }

    log::info!(
        "corps lu : {}",
        match (&trouve.html, &trouve.texte) {
            (Some(_), _) => "html",
            (None, Some(_)) => "texte seul",
            _ => "aucun",
        }
    );
    corps::ranger(dossier, id, &trouve);
    Ok(trouve)
}

/// Enregistre une pièce jointe dans le dossier de téléchargement.
///
/// Elle est **enregistrée, jamais ouverte**. Ouvrir un fichier venu d'un e-mail
/// reviendrait à laisser un expéditeur choisir quel programme démarre sur la
/// machine — c'est précisément ce que la liste blanche de schémas interdit par
/// ailleurs. L'utilisateur ouvre lui-même ce qu'il a décidé d'enregistrer.
///
/// Le nom vient de l'expéditeur : il est assaini avant de toucher au disque.
/// `../../.bashrc` doit devenir un nom de fichier, pas un chemin.
#[tauri::command]
pub async fn piece_jointe_enregistrer(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
    nom: String,
) -> Resultat<String> {
    let dossier = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| AppError::Config(format!("dossier de téléchargement introuvable : {e}")))?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let octets = client.piece_jointe(&message, &piece).await?;

    std::fs::create_dir_all(&dossier)
        .map_err(|e| AppError::Config(format!("dossier de téléchargement inutilisable : {e}")))?;

    let chemin = chemin_libre(&dossier, &nom_de_fichier_sur(&nom));

    std::fs::write(&chemin, &octets)
        .map_err(|e| AppError::Config(format!("enregistrement impossible : {e}")))?;

    log::info!("pièce jointe enregistrée, {} octets", octets.len());
    Ok(chemin.display().to_string())
}

/// Prépare l'aperçu d'une pièce jointe, sans rien écrire sur le disque.
///
/// Le fichier est demandé à Gmail puis **reconstruit** avant de partir vers
/// l'interface : une image est décodée et ré-encodée, un texte est validé, et
/// tout le reste est refusé. Voir [`crate::gmail::apercu`] pour ce que chaque
/// famille de fichiers subit au passage, et pourquoi.
///
/// Rien n'est mis en cache : l'aperçu vit le temps qu'on le regarde. C'est ce
/// qui distingue « consulter » de « garder », et l'enregistrement reste un geste
/// délibéré.
#[tauri::command]
pub async fn piece_jointe_apercu(
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
) -> Resultat<Apercu> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let octets = client.piece_jointe(&message, &piece).await?;

    let apercu = apercu::preparer(&octets);

    log::info!(
        "aperçu préparé pour {} octets reçus : {}",
        octets.len(),
        match &apercu {
            Apercu::Image { .. } => "image ré-encodée",
            Apercu::Pdf { .. } => "pdf",
            Apercu::Texte { .. } => "texte",
            Apercu::Impossible { .. } => "aucun",
        }
    );

    Ok(apercu)
}

/// Vignette d'une pièce jointe, ou `None` quand ce n'en est pas une image.
///
/// Sert la bande de miniatures sous l'en-tête du message. Comme l'aperçu, elle
/// est décodée puis ré-encodée ici : ce qui atteint l'interface n'est jamais le
/// fichier reçu.
///
/// Rangée sur le disque, contrairement à l'aperçu. La différence n'est pas de
/// principe mais de fait : la vignette est demandée à chaque ouverture du
/// message, et une photo jointe pèse plusieurs mégaoctets qu'on ne
/// retéléchargera pas pour montrer trois centimètres carrés. Elle disparaît
/// avec le corps du message, quand celui-ci quitte la boîte.
#[tauri::command]
pub async fn piece_jointe_vignette(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
) -> Resultat<Option<String>> {
    use crate::gmail::corps;

    let dossier = corps::dossier_cache_dans(&app);

    if let Some(deja) = corps::lire_vignette(&dossier, &message, &piece) {
        return Ok(Some(deja));
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let octets = client.piece_jointe(&message, &piece).await?;

    let Some(png) = apercu::vignette(&octets) else {
        return Ok(None);
    };

    corps::ranger_vignette(&dossier, &message, &piece, &png);
    Ok(Some(png))
}

/// Réduit un nom fourni par un tiers à un nom de fichier inoffensif.
///
/// Seul le dernier segment est retenu, et les caractères qui ont un sens pour un
/// système de fichiers sont remplacés. Un nom qui ne laisserait rien devient
/// `piece-jointe`, plutôt qu'un fichier caché ou sans nom.
pub fn nom_de_fichier_sur(brut: &str) -> String {
    let dernier = brut.rsplit(['/', '\\']).next().unwrap_or(brut);

    let nettoye: String = dernier
        .chars()
        .map(|c| match c {
            // Les caractères de contrôle et ceux que Windows refuse.
            c if c.is_control() => '_',
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();

    let nettoye = nettoye.trim().trim_matches('.').trim();

    if nettoye.is_empty() {
        "piece-jointe".to_string()
    } else {
        // Les systèmes de fichiers courants s'arrêtent à 255 octets.
        nettoye.chars().take(120).collect()
    }
}

/// Un chemin qui n'écrase rien : `facture.pdf`, puis `facture (2).pdf`.
pub fn chemin_libre(dossier: &std::path::Path, nom: &str) -> PathBuf {
    let direct = dossier.join(nom);
    if !direct.exists() {
        return direct;
    }

    let (base, extension) = match nom.rsplit_once('.') {
        Some((b, e)) if !b.is_empty() => (b, format!(".{e}")),
        _ => (nom, String::new()),
    };

    // Borné : au-delà, on écrase plutôt que de boucler sans fin sur un dossier
    // qui contiendrait déjà mille homonymes.
    for n in 2..1000 {
        let essai = dossier.join(format!("{base} ({n}){extension}"));
        if !essai.exists() {
            return essai;
        }
    }
    direct
}

/// Avancement du préchargement, envoyé à l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Avancement {
    pub faits: usize,
    pub total: usize,
}

/// Nom de l'événement écouté par l'interface.
pub const EVENEMENT_PRECHARGEMENT: &str = "corps-precharges";

/// Charge d'avance le corps de tous les messages de la boîte.
///
/// L'attente est ainsi groupée au démarrage, avec une barre de progression, au
/// lieu d'être subie message par message. Les corps déjà rangés sont comptés
/// sans appel : relancer l'application ne recommence rien.
///
/// Un message qui échoue n'interrompt pas les autres : il sera simplement
/// rechargé à l'ouverture.
#[tauri::command]
pub async fn corps_precharger(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    ids: Vec<String>,
) -> Resultat<usize> {
    use crate::gmail::corps;
    use tauri::Emitter;

    use futures_util::StreamExt;

    let dossier = corps::dossier_cache_dans(&app);
    let total = ids.len();

    // Un seul client pour toute la boîte, et non un par message : voir
    // [`lire_le_corps`].
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    // Même parallélisme que le relevé, pour la même raison : c'est la latence
    // qui domine, pas le débit. Chaque corps entraîne en outre le rapatriement
    // de ses images, qui a déjà son propre plafond dans `gmail::logos`.
    //
    // Les corps déjà rangés sont écartés ici, sur la seule présence du fichier :
    // les lire pour savoir qu'ils existent reviendrait à décoder soixante
    // documents pour rien.
    let (a_lire, deja): (Vec<String>, Vec<String>) = ids
        .into_iter()
        .partition(|id| !corps::chemin_cache(&dossier, id).exists());

    let mut lectures = futures_util::stream::iter(a_lire)
        .map(|id| {
            let dossier = &dossier;
            let client = &client;
            async move {
                // Un corps illisible n'arrête pas les autres : il sera
                // simplement rechargé à l'ouverture du message.
                if let Err(e) = lire_le_corps(client, dossier, &id).await {
                    log::info!("corps de {id} non préchargé : {e}");
                }
            }
        })
        .buffered(crate::gmail::boite::PARALLELISME);

    // Les corps déjà rangés sont comptés sans appel : relancer l'application ne
    // recommence rien, mais la barre doit tout de même partir d'où il faut.
    let mut faits = deja.len();
    let _ = app.emit(EVENEMENT_PRECHARGEMENT, Avancement { faits, total });

    while lectures.next().await.is_some() {
        faits += 1;
        let _ = app.emit(EVENEMENT_PRECHARGEMENT, Avancement { faits, total });
    }

    // Le dossier des corps ne se vidait jamais de lui-même. C'est le moment de
    // le faire : la boîte vient d'être relevée, on sait donc exactement quels
    // messages existent encore.
    oublier_les_corps_sans_message(&app, &dossier);

    log::info!("{faits} corps de message prêts");
    Ok(faits)
}

/// Efface les corps dont plus aucune boîte ne parle.
///
/// La liste des messages vivants est prise sur **tous** les comptes connus, et
/// non sur le seul compte courant : autrement, chaque bascule de compte
/// effacerait le cache de l'autre, et la bascule redeviendrait l'attente qu'on
/// cherche justement à supprimer.
///
/// Purement opportuniste : si l'annuaire ou un relevé sont illisibles, on ne
/// supprime rien. Garder un fichier de trop est sans conséquence ; en effacer un
/// qui servait encore se paierait en attente.
fn oublier_les_corps_sans_message(app: &AppHandle, dossier_corps: &std::path::Path) {
    let (Ok(config), Ok(racine)) = (dossier_config(app), dossier_cache(app)) else {
        return;
    };

    let mut vivants = std::collections::HashSet::new();
    for compte in comptes::charger(&config).connus {
        let Some(boite) = cache::lire_boite(&racine, &compte.adresse) else {
            // Un compte dont le relevé n'est pas en cache a peut-être des corps
            // rangés : on renonce au nettoyage plutôt que de les prendre pour
            // des orphelins.
            return;
        };
        vivants.extend(boite.into_iter().map(|m| m.id));
    }

    crate::gmail::corps::oublier_les_absents(dossier_corps, &vivants);
}

/// Rapatrie les images d'un message et les rend indexées par leur `src`.
///
/// Tout passe par Rust, jamais par le webview. Deux raisons : la politique de
/// sécurité du cadre d'affichage lui interdit toute requête sortante, et une
/// requête émise depuis le webview emporterait cookies et empreinte de
/// navigateur — le serveur d'en face en apprendrait bien plus que l'ouverture
/// du message.
///
/// Ce que ça coûte reste réel : l'expéditeur apprend l'adresse IP et l'heure de
/// lecture. C'est le comportement d'un client mail ordinaire, choisi
/// explicitement.
///
/// Une image qu'on ne sait pas rapatrier n'entre pas dans la table : son texte
/// de remplacement s'affichera, ce qui vaut mieux qu'un cadre vide.
async fn rapatrier_les_images<T, J>(
    client: &ClientGmail<T, J>,
    message: &str,
    html: &str,
    pieces: &std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String>
where
    T: crate::gmail::client::Transport,
    J: SourceJeton,
{
    use crate::gmail::logos::{TAILLE_MAX_IMAGE, en_data_uri, image_distante};

    let sources = crate::gmail::corps::sources_d_images(html);
    if sources.is_empty() {
        return std::collections::HashMap::new();
    }

    let mut table = std::collections::HashMap::new();
    let mut distantes = Vec::new();

    for source in sources {
        match pieces.get(&source) {
            // Jointe au message : rien de tiers n'est contacté.
            Some(piece) => {
                if let Ok(octets) = client.piece_jointe(message, piece).await
                    && let Some(uri) = en_data_uri(&octets, TAILLE_MAX_IMAGE)
                {
                    table.insert(source, uri);
                }
            }
            None if source.starts_with("https://") => distantes.push(source),
            // `http://` en clair et `cid:` sans pièce : rien à aller chercher.
            None => {}
        }
    }

    // Un client HTTP indisponible n'est pas une raison de perdre les images
    // déjà intégrées : on rend ce qu'on a.
    if let (false, Ok(http)) = (distantes.is_empty(), client_http()) {
        for paquet in distantes.chunks(IMAGES_DE_FRONT) {
            let mut travaux = tokio::task::JoinSet::new();
            for url in paquet {
                let (http, url) = (http.clone(), url.clone());
                travaux.spawn(async move {
                    let uri = image_distante(&http, &url, TAILLE_MAX_IMAGE).await;
                    (url, uri)
                });
            }
            while let Some(Ok((url, Some(uri)))) = travaux.join_next().await {
                table.insert(url, uri);
            }
        }
    }

    log::info!("{} image(s) intégrée(s) au message", table.len());
    table
}

/// Images distantes demandées de front. Bornées : ce sont des serveurs tiers.
const IMAGES_DE_FRONT: usize = 6;

/// Un libellé Gmail, tel que l'interface le propose.
#[derive(Debug, Serialize)]
pub struct LibelleAffiche {
    pub id: String,
    pub nom: String,
}

/// Libellés créés par l'utilisateur, par ordre alphabétique.
#[tauri::command]
pub async fn libelles_lister(etat: State<'_, EtatAuth>) -> Resultat<Vec<LibelleAffiche>> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    Ok(client
        .libelles()
        .await?
        .into_iter()
        .map(|l| LibelleAffiche {
            id: l.id,
            nom: l.name,
        })
        .collect())
}

/// Crée un libellé Gmail et rend la liste complète, à jour.
///
/// Rendre la liste plutôt qu'un accusé : l'interface se réaffiche à partir de
/// ce que Gmail connaît réellement, au lieu d'entretenir sa propre copie qui
/// finirait par diverger.
#[tauri::command]
pub async fn libelle_creer(
    etat: State<'_, EtatAuth>,
    nom: String,
) -> Resultat<Vec<LibelleAffiche>> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let cree = client.creer_libelle(&nom).await?;

    log::info!("libellé créé");
    Ok(client
        .libelles()
        .await
        .unwrap_or_else(|_| vec![cree])
        .into_iter()
        .map(|l| LibelleAffiche {
            id: l.id,
            nom: l.name,
        })
        .collect())
}

/// Range un message sous un libellé, ou l'archive simplement.
#[tauri::command]
pub async fn message_ranger(
    etat: State<'_, EtatAuth>,
    id: String,
    libelle: Option<String>,
) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.ranger(&[id], libelle.as_deref()).await?;

    log::info!("message rangé hors de la boîte de réception");
    Ok(())
}

/// Ouvre un brouillon de réponse dans le client de courrier du système.
///
/// MailFlow n'a pas — et ne demande pas — le droit d'envoyer du courrier en
/// votre nom : la portée `gmail.send` est écartée depuis le début. La réponse
/// s'écrit donc là où l'utilisateur écrit déjà son courrier, et part de son
/// compte, pas du nôtre.
#[tauri::command]
pub async fn repondre_au_message(
    destinataire: String,
    sujet: String,
    // Renseignée par « Répondre à tous », vide par « Répondre ». Le frontend a
    // seul de quoi la calculer : il sait quelle adresse est celle du compte, et
    // ne doit pas se répondre à lui-même.
    copies: Option<Vec<String>>,
) -> Resultat<()> {
    let url = url_mailto(&destinataire, &sujet, &copies.unwrap_or_default())?;

    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| AppError::Config(format!("aucun client de courrier joignable : {e}")))?;

    log::info!("brouillon de réponse ouvert dans le client du système");
    Ok(())
}

/// Vrai quand la chaîne peut servir d'adresse dans un `mailto:`.
///
/// Les chevrons sont refusés parce qu'ils marquent la frontière entre nom
/// affiché et adresse : les laisser passer permettrait de glisser une seconde
/// adresse dans un champ qui n'en attend qu'une.
fn adresse_utilisable(adresse: &str) -> bool {
    !adresse.is_empty() && adresse.contains('@') && !adresse.contains(['<', '>'])
}

/// Construit un `mailto:` à partir d'une adresse, d'un sujet et des copies.
///
/// Le sujet vient d'un tiers : il passe par l'encodage de requête, sans quoi un
/// `&` ou un saut de ligne y ajouterait des champs — `bcc`, `body` — que
/// l'utilisateur n'a pas voulus. Les adresses en copie viennent du même endroit
/// et subissent le même traitement.
fn url_mailto(destinataire: &str, sujet: &str, copies: &[String]) -> Resultat<String> {
    let destinataire = destinataire.trim();
    if !adresse_utilisable(destinataire) {
        return Err(AppError::Config("adresse de réponse inutilisable".into()));
    }

    let encoder = |v: &str| url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>();
    let sujet = sujet.trim();
    let prefixe = if sujet.to_lowercase().starts_with("re:") || sujet.is_empty() {
        String::new()
    } else {
        "Re: ".to_string()
    };

    let mut url = format!(
        "mailto:{}?subject={}",
        encoder(destinataire),
        encoder(&format!("{prefixe}{sujet}"))
    );

    // Une adresse illisible est écartée plutôt que de faire échouer la réponse
    // entière : mieux vaut un destinataire en copie de moins qu'un bouton qui
    // ne fait rien.
    let copies: Vec<&str> = copies
        .iter()
        .map(|c| c.trim())
        .filter(|c| adresse_utilisable(c) && !c.eq_ignore_ascii_case(destinataire))
        .collect();

    if !copies.is_empty() {
        url.push_str("&cc=");
        url.push_str(&encoder(&copies.join(",")));
    }

    Ok(url)
}

/// Demande à GitHub s'il existe une version plus récente.
///
/// Rien n'est téléchargé ni installé : la commande rend un constat, et c'est
/// l'utilisateur qui décide d'aller voir. La mise à jour silencieuse
/// supposerait une paire de clés de signature — voir [`crate::maj`].
#[tauri::command]
pub async fn maj_verifier(app: AppHandle) -> Resultat<crate::maj::Verification> {
    let verification = crate::maj::verifier(&app.package_info().version.to_string()).await?;

    log::info!(
        "mise à jour : publiée={:?}, disponible={}",
        verification.version_publiee,
        verification.disponible
    );
    Ok(verification)
}

/// Ouvre dans le navigateur du système un lien cliqué dans un message.
///
/// # Pourquoi cette commande existe
///
/// Le corps d'un message s'affiche dans un cadre en bac à sable, sans
/// `allow-scripts` ni `allow-popups`. Un clic sur un lien n'y produisait donc
/// rien du tout : la fenêtre surgissante est refusée par le moteur, et le
/// garde-fou de navigation de l'application ne voit pas les navigations de
/// sous-cadre. L'interception se fait maintenant côté application — voir
/// `CadreIsole` — et aboutit ici.
///
/// # Ce qui est vérifié
///
/// L'adresse vient d'un e-mail, c'est-à-dire de n'importe qui, et elle a
/// traversé l'IPC. Elle est donc soumise à la même liste blanche de schémas que
/// tout ce qui sort vers le système : `http`, `https`, `mailto`. Sans quoi un
/// expéditeur choisirait quel programme démarre sur la machine — `file://` sur
/// un dossier local, un schéma déposé par une application installée, ou pire.
///
/// Une adresse relative n'a pas de sens hors de son site d'origine : elle ne
/// s'analyse pas et se voit refusée, plutôt que d'être devinée.
#[tauri::command]
pub async fn lien_ouvrir(url: String) -> Resultat<()> {
    let sortie = tauri::Url::parse(&url)
        .ok()
        .filter(crate::sortie_autorisee)
        .ok_or_else(|| {
            log::warn!("lien de message refusé : schéma non autorisé ou adresse relative");
            AppError::Config("Ce lien ne peut pas être ouvert.".into())
        })?;

    // Le journal ne porte que le schéma et l'hôte : une adresse complète de
    // newsletter contient couramment un identifiant de suivi, et parfois
    // l'adresse de l'utilisateur en clair.
    log::info!(
        "lien de message ouvert : {}://{}",
        sortie.scheme(),
        sortie.host_str().unwrap_or("-")
    );

    tauri_plugin_opener::open_url(sortie.as_str(), None::<&str>)
        .map_err(|e| AppError::Config(format!("navigateur injoignable : {e}")))?;
    Ok(())
}

/// Ouvre la page d'une publication dans le navigateur du système.
///
/// L'adresse n'est pas reçue du frontend mais redemandée à GitHub : une adresse
/// qui traverserait l'IPC pourrait être remplacée en chemin, et ce bouton
/// ouvrirait alors une page choisie par quelqu'un d'autre.
#[tauri::command]
pub async fn maj_ouvrir(app: AppHandle) -> Resultat<()> {
    let verification = crate::maj::verifier(&app.package_info().version.to_string()).await?;

    let Some(adresse) = verification.adresse else {
        return Err(AppError::Reseau("aucune version publiée".into()));
    };

    // L'adresse vient de la réponse de GitHub. Elle est donc extérieure, et
    // passe par la même garde que les liens d'e-mail : la confiance accordée à
    // une source ne dispense pas de vérifier ce qu'elle envoie.
    let sortie = tauri::Url::parse(&adresse)
        .ok()
        .filter(crate::sortie_autorisee)
        .ok_or_else(|| AppError::Reseau("adresse de publication inattendue".into()))?;

    tauri_plugin_opener::open_url(sortie.as_str(), None::<&str>)
        .map_err(|e| AppError::Config(format!("navigateur injoignable : {e}")))?;
    Ok(())
}

/// Met un message à la corbeille.
///
/// Le geste du bouton Supprimer de Gmail : le message quitte la boîte et reste
/// récupérable trente jours. Rien n'est détruit — la suppression définitive
/// demanderait une autorisation Google bien plus large, pour un geste sur
/// lequel on ne peut pas revenir.
#[tauri::command]
pub async fn message_corbeille(etat: State<'_, EtatAuth>, id: String) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.mettre_a_la_corbeille(&id).await?;

    log::info!("message mis à la corbeille");
    Ok(())
}

/// Marque un message comme lu chez Gmail.
///
/// C'est la seule commande qui modifie la boîte sans passer par une règle. Le
/// geste est celui de l'utilisateur — il vient d'ouvrir le message — et Gmail
/// sait remettre un message en non-lu.
///
/// À noter : MailFlow n'affiche que l'extrait fourni par Gmail, jamais le corps.
/// Ouvrir un message ici en dit donc moins que l'ouvrir dans Gmail, mais le
/// marque tout autant comme lu.
#[tauri::command]
pub async fn message_marquer_lu(etat: State<'_, EtatAuth>, id: String) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.marquer_lu(&[id]).await
}

/// Adresse du compte relié, ou `None` si aucun ne l'est.
///
/// Séparée de `app_health` : celle-ci s'appelle à chaque rafraîchissement, y
/// compris hors connexion, et n'a pas à consommer du quota Gmail pour ça.
#[tauri::command]
pub async fn compte_adresse(etat: State<'_, EtatAuth>) -> Resultat<Option<String>> {
    if !etat.session.lock().await.est_connecte()? {
        return Ok(None);
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.adresse_du_compte().await.map(Some)
}

/// Un compte connu de l'annuaire, tel que l'interface le liste.
#[derive(Debug, Serialize)]
pub struct CompteConnu {
    pub adresse: String,
    pub nom: Option<String>,
    /// URI de données, jamais une adresse distante.
    pub photo: Option<String>,
    pub actif: bool,
}

/// Comptes déjà autorisés, le premier étant l'actif.
///
/// Ne consomme aucun quota et ne touche pas au réseau : la liste vient du
/// fichier d'annuaire, les jetons restent dans le trousseau.
#[tauri::command]
pub async fn comptes_lister(app: AppHandle) -> Resultat<Vec<CompteConnu>> {
    let annuaire = comptes::charger(&dossier_config(&app)?);
    Ok(en_liste(&annuaire))
}

fn en_liste(annuaire: &Annuaire) -> Vec<CompteConnu> {
    let mut liste: Vec<CompteConnu> = annuaire
        .connus
        .iter()
        .map(|c| CompteConnu {
            adresse: c.adresse.clone(),
            nom: c.nom.clone(),
            photo: c.photo.clone(),
            actif: annuaire.actif.as_deref() == Some(c.adresse.as_str()),
        })
        .collect();

    // L'actif d'abord : c'est celui dont l'interface parle au présent.
    liste.sort_by_key(|c| !c.actif);
    liste
}

/// Bascule sur un compte déjà autorisé, sans repasser par Google.
///
/// C'est tout l'intérêt de garder les jetons : l'utilisateur retrouve son autre
/// boîte immédiatement, sans navigateur ni mot de passe.
#[tauri::command]
pub async fn compte_basculer(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    adresse: String,
) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);
    identifier_l_actif(&etat, &mut annuaire).await;

    let mut session = etat.session.lock().await;
    session.basculer(|secrets| comptes::basculer(secrets, &mut annuaire, &adresse))?;
    comptes::ecrire(&dossier, &annuaire)?;

    log::info!("compte actif changé");
    Ok(())
}

/// Complète l'annuaire quand il ignore à qui appartient le jeton en place.
///
/// L'annuaire peut perdre ce renseignement — un ajout de compte interrompu, une
/// installation antérieure à son existence. Sans lui, déplacer le jeton actif
/// reviendrait à le détruire. Gmail, lui, sait toujours répondre : une unité de
/// quota vaut mieux qu'un compte perdu.
async fn identifier_l_actif(etat: &State<'_, EtatAuth>, annuaire: &mut Annuaire) {
    if annuaire.actif.is_some() {
        return;
    }
    let Ok(true) = etat.session.lock().await.est_connecte() else {
        return;
    };

    let client = match TransportHttp::nouveau() {
        Ok(t) => ClientGmail::nouveau(t, JetonsDeSession { etat }),
        Err(_) => return,
    };

    if let Ok(adresse) = client.adresse_du_compte().await {
        log::info!("compte actif identifié auprès de Gmail");
        annuaire.retenir(&adresse, None, None);
    }
}

/// Met le compte actif de côté et lance l'autorisation d'un autre.
///
/// Le jeton du compte courant n'est pas révoqué : on veut pouvoir y revenir
/// d'un clic. C'est la différence avec `google_deconnecter`, qui, lui, rend
/// l'autorisation à Google.
#[tauri::command]
pub async fn compte_ajouter(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);
    identifier_l_actif(&etat, &mut annuaire).await;

    {
        let mut session = etat.session.lock().await;
        session.basculer(|secrets| comptes::mettre_de_cote(secrets, &mut annuaire))?;
    }
    comptes::ecrire(&dossier, &annuaire)?;

    // Si l'autorisation échoue ou est refusée, l'application se retrouve sans
    // compte actif — mais l'ancien est en réserve, et la liste le propose
    // toujours. Rien n'est perdu.
    google_connecter(etat).await
}

/// Retire un compte de la liste et efface son autorisation.
///
/// Refuse le compte actif : le déconnecter passe par `google_deconnecter`, qui
/// rend aussi l'autorisation à Google.
#[tauri::command]
pub async fn compte_oublier(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    adresse: String,
) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);

    if annuaire.actif.as_deref() == Some(adresse.trim().to_lowercase().as_str()) {
        return Err(AppError::Auth(
            "ce compte est le compte actif : déconnectez-le d'abord".into(),
        ));
    }

    let cle = comptes::cle_compte(&adresse);
    let jeton = etat.session.lock().await.secret(&cle)?;

    // Effacé localement quoi qu'il arrive : laisser l'entrée derrière soi
    // signifierait qu'un compte « oublié » garde une autorisation vivante.
    etat.session.lock().await.effacer_secret(&cle)?;
    annuaire.oublier(&adresse);
    comptes::ecrire(&dossier, &annuaire)?;

    // Les règles suivent le compte : les garder ferait ressurgir de vieilles
    // automatisations le jour où la même adresse serait rebranchée, sans que
    // personne ne se souvienne les avoir posées. Un échec ici ne remet pas en
    // cause le retrait du compte, qui est déjà fait.
    if let Err(e) = RulesStore::pour_compte(&dossier, &adresse).effacer() {
        log::warn!("règles du compte retiré non effacées : {e}");
    }

    if let (Some(jeton), Ok(client)) = (jeton, etat.client())
        && let Err(e) = client.revoquer(&jeton).await
    {
        log::warn!("révocation côté Google impossible : {e}");
    }

    log::info!("compte retiré de la liste");
    Ok(())
}

/// Qui est relié : adresse, nom affiché, photo.
#[derive(Debug, Default, serde::Serialize)]
pub struct ProfilCompte {
    pub adresse: String,
    pub nom: Option<String>,
    /// URI de données, jamais une adresse distante : la politique de sécurité
    /// de l'interface interdit les origines externes dans une balise `<img>`.
    pub photo: Option<String>,
}

/// Profil du compte relié, ou `None` si aucun ne l'est.
///
/// Le nom et la photo ne sont pas indispensables : s'ils manquent — compte sans
/// photo, autorisation accordée avant l'ajout de la portée `profile`, réseau
/// capricieux — l'adresse est rendue seule et l'interface retombe sur le logo
/// Google. Échouer ici priverait l'utilisateur de l'information principale pour
/// une décoration.
#[tauri::command]
pub async fn compte_profil(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Option<ProfilCompte>> {
    if !etat.session.lock().await.est_connecte()? {
        return Ok(None);
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let adresse = client.adresse_du_compte().await?;

    let Ok(infos) = client.renseignements_du_compte().await else {
        log::info!("renseignements du compte indisponibles, adresse seule");
        retenir_le_compte(&app, &adresse, None, None);
        return Ok(Some(ProfilCompte {
            adresse,
            ..Default::default()
        }));
    };

    // C'est le seul endroit où l'adresse du compte relié est connue : c'est
    // donc ici que l'annuaire apprend qu'il existe, sans quoi la bascule ne
    let photo = match infos.picture.as_deref() {
        Some(url) => {
            let http = client_http()?;
            crate::gmail::logos::image_distante(&http, url, crate::gmail::logos::TAILLE_MAX_IMAGE)
                .await
        }
        None => None,
    };

    // C'est le seul endroit où l'on connaît à la fois l'adresse, le nom et la
    // photo du compte relié : c'est donc ici que l'annuaire les apprend, sans
    // quoi la liste des comptes n'aurait jamais rien à montrer.
    retenir_le_compte(&app, &adresse, infos.name.clone(), photo.clone());

    log::info!(
        "profil du compte lu, photo {}",
        if photo.is_some() {
            "comprise"
        } else {
            "absente"
        }
    );
    Ok(Some(ProfilCompte {
        adresse,
        nom: infos.name,
        photo,
    }))
}

/// Note le compte actif dans l'annuaire.
///
/// Sans conséquence en cas d'échec : l'annuaire est un confort, pas une
/// condition d'accès à la boîte. Faire échouer l'affichage du profil parce que
/// le disque est plein serait disproportionné.
fn retenir_le_compte(app: &AppHandle, adresse: &str, nom: Option<String>, photo: Option<String>) {
    let Ok(dossier) = dossier_config(app) else {
        return;
    };

    let mut annuaire = comptes::charger(&dossier);
    let deja_a_jour = annuaire.actif.as_deref() == Some(adresse)
        && annuaire.est_connu(adresse)
        && nom.is_none()
        && photo.is_none();
    if deja_a_jour {
        return;
    }

    annuaire.retenir(adresse, nom, photo);
    if let Err(e) = comptes::ecrire(&dossier, &annuaire) {
        log::warn!("annuaire des comptes non enregistré : {e}");
    }
}

/// Client HTTP pour les images : hors API, sans jeton, HTTPS obligatoire.
fn client_http() -> Resultat<reqwest::Client> {
    reqwest::Client::builder()
        .https_only(true)
        .build()
        .map_err(|e| AppError::Config(format!("client HTTP inutilisable : {e}")))
}

/// Logos des expéditeurs, un par domaine.
///
/// Chaque logo est demandé au domaine de l'expéditeur, jamais à un service
/// tiers : un agrégateur d'icônes apprendrait la liste complète des
/// correspondants de l'utilisateur. Voir [`crate::gmail::logos`].
#[tauri::command]
pub async fn logos_expediteurs(
    app: AppHandle,
    adresses: Vec<String>,
) -> Resultat<std::collections::HashMap<String, String>> {
    let domaines: std::collections::BTreeSet<String> = adresses
        .iter()
        .filter_map(|a| crate::gmail::logos::domaine(a))
        .map(str::to_string)
        .collect();

    let dossier = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Config(format!("dossier de cache introuvable : {e}")))?
        .join("logos");

    let http = client_http()?;

    let trouves =
        crate::gmail::logos::logos(&http, &dossier, &domaines.into_iter().collect::<Vec<_>>())
            .await?;

    log::info!("{} logo(s) d'expéditeur disponibles", trouves.len());
    Ok(trouves)
}

#[cfg(test)]
mod tests {
    use super::url_mailto;

    /// Réponse simple : sans personne en copie.
    fn mailto(destinataire: &str, sujet: &str) -> crate::error::Resultat<String> {
        url_mailto(destinataire, sujet, &[])
    }

    fn copies(liste: &[&str]) -> Vec<String> {
        liste.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn le_sujet_est_prefixe_une_seule_fois() {
        let url = mailto("a@b.fr", "Disponibilités").unwrap();

        assert!(url.contains("subject=Re%3A+Disponibilit"), "{url}");
        assert!(
            !mailto("a@b.fr", "Re: déjà")
                .unwrap()
                .contains("Re%3A+Re%3A")
        );
    }

    #[test]
    fn un_sujet_hostile_n_ajoute_pas_de_champs() {
        // Sans encodage, ce sujet glisserait une copie cachée dans le brouillon
        // que l'utilisateur s'apprête à envoyer.
        let url = mailto("a@b.fr", "Bonjour&bcc=espion@ailleurs.fr").unwrap();

        assert!(!url.contains("&bcc="), "{url}");
    }

    #[test]
    fn une_adresse_inutilisable_est_refusee() {
        // Mieux vaut le dire que d'ouvrir un client de courrier sur un vide.
        assert!(mailto("", "x").is_err());
        assert!(mailto("sans-arobase", "x").is_err());
        assert!(mailto("Nom <a@b.fr>", "x").is_err());
    }

    #[test]
    fn repondre_a_tous_place_les_autres_en_copie() {
        let url = url_mailto("a@b.fr", "Réunion", &copies(&["c@d.fr", "e@f.fr"])).unwrap();

        assert!(url.starts_with("mailto:a%40b.fr?"), "{url}");
        assert!(url.contains("&cc=c%40d.fr%2Ce%40f.fr"), "{url}");
    }

    #[test]
    fn le_destinataire_principal_ne_se_retrouve_pas_aussi_en_copie() {
        // Il est souvent dans le `To` d'origine : l'y laisser lui enverrait deux
        // fois la même réponse.
        let url = url_mailto("a@b.fr", "x", &copies(&["A@B.fr", "c@d.fr"])).unwrap();

        assert_eq!(url.matches("a%40b.fr").count(), 1, "{url}");
        assert!(url.contains("&cc=c%40d.fr"), "{url}");
    }

    #[test]
    fn une_copie_illisible_est_ecartee_sans_faire_echouer_la_reponse() {
        let url = url_mailto("a@b.fr", "x", &copies(&["Nom <c@d.fr>", "e@f.fr"])).unwrap();

        assert!(url.contains("&cc=e%40f.fr"), "{url}");
        assert!(!url.contains("Nom"), "{url}");
    }

    #[test]
    fn sans_copie_valable_aucun_champ_cc_n_est_ajoute() {
        let url = url_mailto("a@b.fr", "x", &copies(&["a@b.fr"])).unwrap();

        assert!(!url.contains("&cc="), "{url}");
    }
}

#[cfg(test)]
mod tests_pieces_jointes {
    use super::{chemin_libre, nom_de_fichier_sur};

    #[test]
    fn un_nom_ordinaire_est_conserve() {
        assert_eq!(
            nom_de_fichier_sur("Facture été 2026.pdf"),
            "Facture été 2026.pdf"
        );
    }

    #[test]
    fn un_nom_ne_peut_pas_sortir_du_dossier() {
        // Le nom vient de l'expéditeur : c'est la seule chaîne de ce module qui
        // désigne un fichier sans que l'utilisateur l'ait tapée.
        for hostile in [
            "../../.bashrc",
            "../../../etc/passwd",
            "..\\..\\Windows\\System32\\cmd.exe",
            "/etc/shadow",
        ] {
            let sur = nom_de_fichier_sur(hostile);
            assert!(
                !sur.contains('/') && !sur.contains('\\') && !sur.starts_with('.'),
                "« {hostile} » a donné « {sur} »"
            );
        }
    }

    #[test]
    fn un_nom_qui_ne_laisse_rien_reste_nommable() {
        // Sans repli, on écrirait un fichier sans nom, ou pire un fichier caché.
        for vide in ["", "   ", "...", "/", "../"] {
            assert_eq!(nom_de_fichier_sur(vide), "piece-jointe", "pour « {vide} »");
        }
    }

    #[test]
    fn un_nom_demesure_est_ramene_a_ce_qu_un_disque_accepte() {
        let long = "a".repeat(500) + ".pdf";
        assert!(nom_de_fichier_sur(&long).chars().count() <= 120);
    }

    #[test]
    fn deux_pieces_du_meme_nom_ne_s_ecrasent_pas() {
        let dossier = tempfile::tempdir().unwrap();
        let premier = chemin_libre(dossier.path(), "facture.pdf");
        std::fs::write(&premier, b"un").unwrap();

        let second = chemin_libre(dossier.path(), "facture.pdf");
        assert_ne!(premier, second);
        assert_eq!(second.file_name().unwrap(), "facture (2).pdf");
    }
}
