//! MailFlow — backend.
//!
//! Toute la logique sensible vit ici plutot que dans le webview : jetons OAuth,
//! appels a l'API Gmail, moteur de regles, acces disque. Le frontend ne dispose
//! que des commandes declarees dans [`commands`], et ne detient jamais de secret.
//!
//! C'est la raison d'etre du choix de Tauri sur ce projet : l'application affiche
//! du HTML d'e-mail, c'est-a-dire du contenu fourni par des tiers inconnus. Une
//! faille d'injection dans le rendu ne doit pas donner acces a la boite mail.

pub mod auth;
pub mod commands;
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app_health])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
