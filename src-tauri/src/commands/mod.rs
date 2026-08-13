//! Surface exposee au frontend.
//!
//! C'est la seule frontiere par laquelle le webview peut declencher quoi que ce
//! soit. Chaque commande ajoutee ici elargit ce que du HTML d'e-mail compromis
//! pourrait atteindre : on n'expose que ce dont une vue a besoin, et jamais un
//! primitif generique (« lire ce fichier », « appeler cette URL »).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use crate::auth::flux::ClientOAuth;
use crate::auth::session::SessionAuth;
use crate::auth::{DELAI_AUTORISATION, connecter};
use crate::config;
use crate::error::{AppError, Resultat};
use crate::rules::RulesStore;
use crate::secrets::KeyringStore;

/// Etat d'authentification partage, gere par Tauri.
///
/// `client` vaut `None` tant que l'identifiant Google n'a pas ete configure :
/// l'application se lance quand meme et l'explique, plutot que de refuser de
/// demarrer sur un fichier `.env` incomplet.
pub struct EtatAuth {
    session: Mutex<SessionAuth<KeyringStore>>,
    client: Option<ClientOAuth>,
}

impl EtatAuth {
    pub fn nouveau() -> Self {
        let client = config::client_id_google().and_then(|id| {
            ClientOAuth::nouveau(id)
                .inspect_err(|e| log::error!("client OAuth inutilisable : {e}"))
                .ok()
        });

        if client.is_none() {
            log::warn!(
                "aucun identifiant client Google ({}) : la connexion Gmail est indisponible",
                config::VAR_CLIENT_ID
            );
        }

        Self {
            session: Mutex::new(SessionAuth::nouvelle(KeyringStore::new())),
            client,
        }
    }

    fn client(&self) -> Resultat<&ClientOAuth> {
        self.client
            .as_ref()
            .ok_or_else(|| AppError::Config(format!("{} non renseigne", config::VAR_CLIENT_ID)))
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
    /// l'interface doit le dire clairement plutot que d'echouer plus tard.
    pub trousseau_disponible: bool,

    /// Expose volontairement : le mode avance de la vue 5 propose d'ouvrir le
    /// fichier brut. C'est un chemin appartenant a l'utilisateur, dans sa propre
    /// session — pas un secret.
    pub chemin_regles: String,

    /// `None` quand le fichier existe mais n'a pas pu etre lu.
    pub nombre_de_regles: Option<usize>,

    pub compte_connecte: bool,

    /// Faux tant que l'identifiant client Google n'a pas ete renseigne. La vue de
    /// connexion doit alors renvoyer vers `docs/connexion-google.md` au lieu de
    /// proposer un bouton qui ne peut pas fonctionner.
    pub client_google_configure: bool,
}

/// Etat de sante du backend, appele au demarrage par le frontend.
///
/// Sert aussi de tranche verticale de bout en bout : elle touche le trousseau,
/// le systeme de fichiers et les chemins Tauri, donc elle echoue bruyamment si
/// l'un des trois est mal cable.
#[tauri::command]
pub async fn app_health(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<EtatApplication> {
    let dossier = dossier_config(&app)?;
    let store = RulesStore::new(&dossier);

    let nombre_de_regles = match store.charger() {
        Ok(regles) => Some(regles.automations.len()),
        Err(e) => {
            log::warn!("regles illisibles : {e}");
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
/// Rend la main quand l'utilisateur a donne son accord, l'a refuse, ou n'a rien
/// fait dans le delai imparti. Aucun jeton ne remonte au frontend : il apprend le
/// resultat en rappelant `app_health`.
#[tauri::command]
pub async fn google_connecter(etat: State<'_, EtatAuth>) -> Resultat<()> {
    let client = etat.client()?;

    // Le verrou est pris pour toute la duree du parcours : deux connexions
    // simultanees ecraseraient mutuellement leur `refresh_token`.
    let mut session = etat.session.lock().await;

    connecter(
        client,
        &mut session,
        |url| {
            // Navigateur systeme, jamais un webview de l'application : c'est ce
            // qui garantit a l'utilisateur qu'il tape son mot de passe chez
            // Google et non dans une page que MailFlow controle.
            tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
                .map_err(|e| AppError::Auth(format!("ouverture du navigateur impossible : {e}")))
        },
        DELAI_AUTORISATION,
    )
    .await
    .inspect_err(|e| log::warn!("connexion Google interrompue : {e}"))?;

    log::info!("compte Gmail connecte");
    Ok(())
}

/// Deconnecte le compte et revoque l'autorisation chez Google.
#[tauri::command]
pub async fn google_deconnecter(etat: State<'_, EtatAuth>) -> Resultat<()> {
    let a_revoquer = etat.session.lock().await.fermer()?;

    // Le trousseau est deja vide a ce stade : meme si la revocation echoue
    // (machine hors ligne), l'utilisateur est bien deconnecte localement.
    if let (Some(jeton), Ok(client)) = (a_revoquer, etat.client())
        && let Err(e) = client.revoquer(&jeton).await
    {
        log::warn!("revocation cote Google impossible : {e}");
    }

    log::info!("compte Gmail deconnecte");
    Ok(())
}
