//! Surface exposee au frontend.
//!
//! C'est la seule frontiere par laquelle le webview peut declencher quoi que ce
//! soit. Chaque commande ajoutee ici elargit ce que du HTML d'e-mail compromis
//! pourrait atteindre : on n'expose que ce dont une vue a besoin, et jamais un
//! primitif generique (« lire ce fichier », « appeler cette URL »).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Resultat};
use crate::rules::RulesStore;
use crate::secrets::{CLE_REFRESH_TOKEN_GOOGLE, KeyringStore, SecretStore};

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
}

/// Etat de sante du backend, appele au demarrage par le frontend.
///
/// Sert aussi de tranche verticale de bout en bout : elle touche le trousseau,
/// le systeme de fichiers et les chemins Tauri, donc elle echoue bruyamment si
/// l'un des trois est mal cable.
#[tauri::command]
pub async fn app_health(app: AppHandle) -> Resultat<EtatApplication> {
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
        && KeyringStore::new()
            .get(CLE_REFRESH_TOKEN_GOOGLE)
            .inspect_err(|e| log::warn!("lecture du trousseau impossible : {e}"))
            .unwrap_or(None)
            .is_some();

    log::info!(
        "diagnostic : trousseau={trousseau_disponible}, compte_connecte={compte_connecte}, \
         regles={nombre_de_regles:?}"
    );

    Ok(EtatApplication {
        version: app.package_info().version.to_string(),
        plateforme: std::env::consts::OS,
        trousseau_disponible,
        chemin_regles: store.chemin().display().to_string(),
        nombre_de_regles,
        compte_connecte,
    })
}
