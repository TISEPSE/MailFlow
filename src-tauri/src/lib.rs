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
pub mod cache;
pub mod commands;
pub mod comptes;
pub mod config;
pub mod error;
pub mod gmail;
pub mod html;
pub mod llm;
pub mod maj;
pub mod rules;
pub mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(liens_vers_le_navigateur())
        .setup(|app| {
            if cfg!(debug_assertions) {
                // Deux destinations. La sortie standard passe par la chaîne
                // npm → cargo → tauri, qui la bufferise : quand le parcours
                // OAuth échoue, la ligne qui l'explique peut ne jamais sortir du
                // tuyau. Le fichier, lui, est écrit par le processus lui-même.
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Stdout,
                        ))
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::LogDir {
                                file_name: Some("mailflow".into()),
                            },
                        ))
                        .build(),
                )?;

                if let Ok(dossier) = app.path().app_log_dir() {
                    log::info!("journal écrit dans {}", dossier.display());
                }
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
            commands::gmail_synchroniser,
            commands::regles_lister,
            commands::regles_toutes,
            commands::regle_ajouter,
            commands::regle_modifier,
            commands::regle_supprimer,
            commands::regle_basculer,
            commands::boite_lister,
            commands::boite_en_cache,
            commands::boite_melangee,
            commands::cache_vider,
            commands::cache_taille,
            commands::message_corps,
            commands::corps_precharger,
            commands::piece_jointe_enregistrer,
            commands::piece_jointe_apercu,
            commands::piece_jointe_vignette,
            commands::message_ranger,
            commands::libelles_lister,
            commands::libelle_creer,
            commands::repondre_au_message,
            commands::message_corbeille,
            commands::message_marquer_lu,
            commands::compte_adresse,
            commands::compte_profil,
            commands::comptes_lister,
            commands::compte_basculer,
            commands::compte_ajouter,
            commands::compte_oublier,
            commands::logos_expediteurs,
            commands::maj_verifier,
            commands::maj_ouvrir,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}

/// Renvoie vers le navigateur du système tout lien qui sortirait de
/// l'application.
///
/// Le corps des messages est affiché dans un cadre isolé, dont les liens
/// portent `target="_blank"`. Sans ce garde-fou, le clic remplacerait
/// l'application par le site — ou ouvrirait une fenêtre de l'application sur du
/// contenu de tiers. Le lien part donc dans le navigateur, où l'utilisateur
/// voit l'adresse et où le site n'a accès à rien de MailFlow.
///
/// La navigation interne — l'interface elle-même — reste autorisée : elle seule
/// emploie les schémas locaux du webview.
fn liens_vers_le_navigateur<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("liens")
        .on_navigation(|_fenetre, url| {
            if est_l_application(url) {
                return true;
            }

            // Le lien vient d'un e-mail, donc de n'importe qui. Confier une
            // adresse au système sans regarder son schéma revient à laisser un
            // expéditeur choisir quel programme s'ouvre sur la machine.
            if !sortie_autorisee(url) {
                log::warn!("lien ignoré : schéma « {} » non autorisé", url.scheme());
                return false;
            }

            log::info!("lien ouvert dans le navigateur du système");
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);

            // `false` annule la navigation : l'application reste où elle est.
            false
        })
        .build()
}

/// Cette adresse peut-elle être confiée au système d'exploitation ?
///
/// Liste blanche, et non liste noire : le jour où une plateforme inventera un
/// schéma dangereux de plus, une liste noire l'aura laissé passer.
///
/// Trois schémas suffisent à un client de courrier. `http` et `https` mènent au
/// navigateur, où l'utilisateur voit l'adresse avant d'agir. `mailto` mène à son
/// client de messagerie. Tout le reste — `file://` qui ouvre un dossier local,
/// les schémas propres à telle ou telle application installée, `javascript:` —
/// n'a aucune raison de figurer dans un e-mail légitime, et beaucoup d'en
/// figurer dans un e-mail hostile : un seul clic suffirait alors à faire
/// démarrer un programme choisi par l'expéditeur.
///
/// Le bac à sable du cadre d'affichage empêche déjà tout script de s'exécuter.
/// Il n'empêche pas un lien de s'afficher, ni l'utilisateur de cliquer dessus :
/// c'est ce dernier pas que cette fonction ferme.
pub fn sortie_autorisee(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// L'URL désigne-t-elle l'interface de MailFlow plutôt qu'un site tiers ?
///
/// La liste est explicite parce qu'une erreur ici ne se rattrape pas : trop
/// large, un site de tiers remplacerait l'application ; trop étroite, c'est
/// l'interface elle-même qui refuserait de se charger. C'est précisément ce qui
/// s'est produit à la première version, qui ignorait que le serveur de
/// développement sert l'application sur `http://localhost`.
fn est_l_application(url: &tauri::Url) -> bool {
    match url.scheme() {
        // Schémas propres au webview, jamais employés par un lien d'e-mail.
        "tauri" | "asset" | "ipc" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost" | "localhost" | "127.0.0.1")
        ),
        _ => false,
    }
}

#[cfg(test)]
mod tests_navigation {
    use super::{est_l_application, sortie_autorisee};
    use tauri::Url;

    fn url(brut: &str) -> Url {
        Url::parse(brut).unwrap()
    }

    #[test]
    fn l_interface_se_charge_en_developpement_comme_en_production() {
        // La première version renvoyait le serveur de développement au
        // navigateur : l'application s'ouvrait sur une fenêtre vide.
        assert!(est_l_application(&url("http://localhost:1420/")));
        assert!(est_l_application(&url("http://tauri.localhost/index.html")));
        assert!(est_l_application(&url("tauri://localhost/")));
    }

    #[test]
    fn un_lien_d_e_mail_part_au_navigateur() {
        assert!(!est_l_application(&url("https://exemple.fr/suivi")));
        assert!(!est_l_application(&url("http://exemple.fr/")));
    }

    #[test]
    fn un_schema_inattendu_n_est_pas_pris_pour_l_interface() {
        // `mailto:` et consorts sont rendus au système, qui sait quoi en faire.
        assert!(!est_l_application(&url("mailto:a@b.fr")));
        assert!(!est_l_application(&url("file:///etc/passwd")));
    }

    #[test]
    fn les_liens_ordinaires_atteignent_le_systeme() {
        assert!(sortie_autorisee(&url("https://exemple.fr/facture")));
        assert!(sortie_autorisee(&url("http://exemple.fr/")));
        assert!(sortie_autorisee(&url(
            "mailto:contact@exemple.fr?subject=Bonjour"
        )));
    }

    #[test]
    fn un_expediteur_ne_choisit_pas_le_programme_qui_s_ouvre() {
        // Le scénario : un e-mail hostile pose un lien d'apparence anodine, et
        // le clic confie l'adresse au gestionnaire du système. Sans liste
        // blanche, chacune de ces adresses ouvrait quelque chose.
        for hostile in [
            // Un dossier local, ou un fichier que l'utilisateur n'a pas demandé.
            "file:///etc/passwd",
            // Un partage réseau : sous Windows, la seule ouverture d'un chemin
            // SMB distant fuite une empreinte d'authentification.
            "smb://attaquant.example/partage",
            // Les schémas déposés par les applications installées : ils
            // acceptent souvent des paramètres, et donc des instructions.
            "vscode://file/home/baptiste/.ssh/id_rsa",
            "ms-msdt:/id%20PCWDiagnostic",
            // Inerte dans le cadre isolé, mais rien ne dit ce qu'en ferait le
            // gestionnaire du système.
            "javascript:alert(1)",
            // Ni les schémas internes du webview : ils ne sortent jamais.
            "data:text/html,<h1>x</h1>",
        ] {
            assert!(
                !sortie_autorisee(&url(hostile)),
                "« {hostile} » ne doit pas atteindre le système"
            );
        }
    }
}
