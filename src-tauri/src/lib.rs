//! MailFlow — backend.
//!
//! Toute la logique sensible vit ici plutôt que dans le webview : jetons OAuth,
//! appels à l'API Gmail, moteur de règles, accès disque. Le frontend ne dispose
//! que des commandes déclarées dans [`commands`], et ne détient jamais de secret.
//!
//! C'est la raison d'être du choix de Tauri sur ce projet : l'application affiche
//! du HTML d'e-mail, c'est-à-dire du contenu fourni par des tiers inconnus. Une
//! faille d'injection dans le rendu ne doit pas donner accès à la boîte mail.

use tauri::Manager;

pub mod auth;
pub mod commands;
pub mod config;
pub mod error;
pub mod gmail;
pub mod llm;
pub mod rules;
pub mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Construit après l'initialisation des logs, pour que l'absence
            // d'identifiant client soit visible dans la console.
            app.manage(commands::EtatAuth::nouveau());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_health,
            commands::google_connecter,
            commands::google_deconnecter,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
