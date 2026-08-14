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
use crate::config;
use crate::error::{AppError, Resultat};
use crate::gmail::boite::{MessageAffiche, charger_boite};
use crate::gmail::client::{ClientGmail, SourceJeton};
use crate::gmail::execution::RapportExecution;
use crate::gmail::synchronisation::synchroniser;
use crate::gmail::transport::TransportHttp;
use crate::rules::{Rule, RuleSet, RulesStore};
use crate::secrets::KeyringStore;

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
    pub chemin_regles: String,

    /// `None` quand le fichier existe mais n'a pas pu être lu.
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
    let store = RulesStore::new(&dossier);

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
pub async fn google_deconnecter(etat: State<'_, EtatAuth>) -> Resultat<()> {
    let a_revoquer = etat.session.lock().await.fermer()?;

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
    let regles = RulesStore::new(&dossier).charger()?;

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

/// Chaque commande de règle rend le jeu complet plutôt qu'un accusé de
/// réception. L'interface se réaffiche à partir de ce qui est réellement sur le
/// disque, au lieu de maintenir sa propre copie qui finirait par diverger.
fn ecrire_regles(app: &AppHandle, regles: &RuleSet) -> Resultat<()> {
    RulesStore::new(&dossier_config(app)?).enregistrer(regles)
}

#[tauri::command]
pub async fn regles_lister(app: AppHandle) -> Resultat<RuleSet> {
    RulesStore::new(&dossier_config(&app)?).charger()
}

#[tauri::command]
pub async fn regle_ajouter(app: AppHandle, regle: Rule) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    regles.ajouter(regle);
    ecrire_regles(&app, &regles)?;

    log::info!("règle enregistrée, {} au total", regles.automations.len());
    Ok(regles)
}

#[tauri::command]
pub async fn regle_supprimer(app: AppHandle, id: String) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    if regles.supprimer(&id) {
        ecrire_regles(&app, &regles)?;
        log::info!("règle {id} supprimée");
    }
    Ok(regles)
}

#[tauri::command]
pub async fn regle_basculer(app: AppHandle, id: String) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    if regles.basculer(&id) {
        ecrire_regles(&app, &regles)?;
    }
    Ok(regles)
}

// ---------------------------------------------------------------------------
// Boîte de réception
// ---------------------------------------------------------------------------

/// Relève la boîte et classe les messages par vue.
///
/// Ne rend ni corps de message ni identifiant de fil : le HTML d'un e-mail est
/// écrit par un inconnu et ne traversera l'IPC que le jour où une `iframe` en
/// bac à sable saura l'afficher sans risque.
#[tauri::command]
pub async fn boite_lister(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<MessageAffiche>> {
    let regles = RulesStore::new(&dossier_config(&app)?).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let boite = charger_boite(&client, &regles)
        .await
        .inspect_err(|e| log::warn!("relevé de la boîte interrompu : {e}"))?;

    log::info!("{} message(s) relevé(s)", boite.len());
    Ok(boite)
}
