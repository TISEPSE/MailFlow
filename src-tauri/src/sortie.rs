//! Confier une adresse au navigateur du système.
//!
//! # Pourquoi ce module existe
//!
//! Ouvrir un lien devrait tenir en une ligne, et c'en était une :
//! `tauri_plugin_opener::open_url`. Elle ne fonctionnait pas depuis l'AppImage,
//! et le clic sur un lien de message ne produisait rien du tout.
//!
//! La cause n'est pas dans MailFlow mais dans son emballage. Le lanceur de
//! l'AppImage exporte, avant de démarrer l'application :
//!
//! ```text
//! LD_LIBRARY_PATH=$APPDIR/usr/lib/:$APPDIR/usr/lib/x86_64-linux-gnu/:…
//! GIO_EXTRA_MODULES=$APPDIR/usr/lib/x86_64-linux-gnu/gio/modules
//! GTK_PATH=$APPDIR/usr/lib/x86_64-linux-gnu/gtk-3.0:…
//! GSETTINGS_SCHEMA_DIR=$APPDIR/usr/share/glib-2.0/schemas
//! XDG_DATA_DIRS=$APPDIR/usr/share:/usr/share:…
//! GDK_BACKEND=x11
//! ```
//!
//! C'est indispensable à MailFlow, qui a besoin des bibliothèques qu'il
//! transporte. Mais **tout processus enfant en hérite**, et le processus enfant
//! ici, c'est `xdg-open`, puis `gio`, puis le navigateur. Ceux-là appartiennent
//! au système : on leur fait charger les bibliothèques de MailFlow à la place
//! des leurs. Elles ne concordent pas, le programme meurt au démarrage, et
//! comme personne ne lit sa sortie d'erreur, il ne se passe simplement rien.
//!
//! Le navigateur par défaut de cette machine étant un paquet Snap — dont le
//! lanceur est lui-même un script qui rappelle d'autres programmes du système —
//! il y avait trois occasions d'échouer plutôt qu'une.
//!
//! # Ce que fait ce module
//!
//! Il rend à l'enfant l'environnement qu'il aurait eu si l'utilisateur avait
//! tapé la commande dans un terminal. **Uniquement dans une AppImage** : hors
//! de ce cas, l'environnement est celui du système et il n'y a rien à corriger.
//! Toucher à `LD_LIBRARY_PATH` sur une installation ordinaire ne réparerait
//! rien et pourrait casser une configuration voulue par l'utilisateur.
//!
//! # Ce que ce module ne fait pas
//!
//! Il ne juge pas de l'adresse. C'est [`crate::sortie_autorisee`] qui décide
//! quels schémas peuvent être confiés au système, et il le fait avant qu'on
//! arrive ici.

use std::collections::HashMap;
use std::ffi::OsString;

use crate::error::{AppError, Resultat};

/// Variables que le lanceur de l'AppImage impose, et qui n'ont aucun sens pour
/// un programme du système.
///
/// La liste est celle du script `linuxdeploy-plugin-gtk.sh` et du lanceur
/// `AppRun.wrapped`, augmentée des variables qu'un emballage voisin pourrait
/// poser. En retirer une de trop est sans conséquence — l'enfant retombe sur le
/// réglage du système, qui est justement ce qu'on veut.
const VARIABLES_DE_L_ENVELOPPE: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GTK_PATH",
    "GTK_THEME",
    "GDK_BACKEND",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_EXTRA_MODULES",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "QT_PLUGIN_PATH",
    "QT_QPA_PLATFORM_PLUGIN_PATH",
    "PYTHONHOME",
    "PERLLIB",
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
];

/// Listes de chemins où le lanceur a glissé ses propres dossiers en tête.
///
/// Celles-là ne se retirent pas : elles portent aussi les chemins du système,
/// dont l'enfant a besoin. On en ôte les seules entrées qui pointent dans
/// l'AppImage.
const LISTES_A_ELAGUER: &[&str] = &["XDG_DATA_DIRS", "XDG_CONFIG_DIRS"];

/// Sommes-nous lancés depuis une AppImage ?
///
/// Les deux variables sont posées par le lanceur lui-même et par personne
/// d'autre. Hors de ce cas, aucune correction n'est appliquée.
pub fn dans_une_appimage(env: &HashMap<String, String>) -> bool {
    env.contains_key("APPDIR") && env.contains_key("APPIMAGE")
}

/// Ce qu'il faut changer à l'environnement avant de démarrer un programme du
/// système. `None` veut dire « retirer cette variable ».
///
/// Fonction pure, pour que la partie où une erreur se voit — quoi retirer,
/// quoi garder — se teste sans démarrer le moindre processus.
pub fn correctifs(env: &HashMap<String, String>) -> Vec<(String, Option<String>)> {
    if !dans_une_appimage(env) {
        return Vec::new();
    }

    let Some(racine) = env
        .get("APPDIR")
        .map(String::as_str)
        .filter(|r| !r.is_empty())
    else {
        return Vec::new();
    };

    let mut correctifs: Vec<(String, Option<String>)> = VARIABLES_DE_L_ENVELOPPE
        .iter()
        .filter(|nom| env.contains_key(**nom))
        .map(|nom| ((*nom).to_string(), None))
        .collect();

    for nom in LISTES_A_ELAGUER {
        let Some(valeur) = env.get(*nom) else {
            continue;
        };

        let garde: Vec<&str> = valeur
            .split(':')
            .filter(|chemin| !chemin.is_empty() && !chemin.starts_with(racine))
            .collect();

        // Rien ne subsiste : mieux vaut retirer la variable que la laisser
        // vide, ce que GLib lit comme « aucun dossier » au lieu de « les
        // dossiers par défaut ».
        correctifs.push((
            (*nom).to_string(),
            if garde.is_empty() {
                None
            } else {
                Some(garde.join(":"))
            },
        ));
    }

    correctifs
}

/// L'environnement du processus courant, sous une forme lisible.
fn environnement_courant() -> HashMap<String, String> {
    std::env::vars().collect()
}

/// Ouvre une adresse dans le navigateur du système.
///
/// L'adresse est supposée déjà contrôlée par [`crate::sortie_autorisee`] :
/// c'est l'appelant qui décide, pas ce module.
pub fn ouvrir(url: &str) -> Resultat<()> {
    ouvrir_sur_la_plateforme(url)
}

#[cfg(not(target_os = "linux"))]
fn ouvrir_sur_la_plateforme(url: &str) -> Resultat<()> {
    // macOS et Windows n'ont pas d'enveloppe de ce genre : `open` et
    // `ShellExecute` reçoivent l'environnement normal de la session.
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::Config(format!("navigateur injoignable : {e}")))
}

/// Les deux manières d'ouvrir une adresse sous Linux, dans l'ordre où on les
/// essaie.
///
/// `xdg-open` est la voie normale et respecte le choix de l'utilisateur.
/// `gio open` est ce que `xdg-open` appelle lui-même sous GNOME, mais il
/// existe aussi là où `xdg-open` est absent — d'où le second essai, qui ne
/// coûte rien tant que le premier réussit.
#[cfg(target_os = "linux")]
const LANCEURS: &[&[&str]] = &[&["xdg-open"], &["gio", "open"]];

#[cfg(target_os = "linux")]
fn ouvrir_sur_la_plateforme(url: &str) -> Resultat<()> {
    use std::process::{Command, Stdio};

    let env = environnement_courant();
    let correctifs = correctifs(&env);

    if !correctifs.is_empty() {
        log::info!(
            "environnement d'AppImage neutralisé pour l'enfant ({} variable(s))",
            correctifs.len()
        );
    }

    let mut derniere: Option<String> = None;

    for lanceur in LANCEURS {
        let Some((programme, arguments)) = lanceur.split_first() else {
            continue;
        };

        let mut commande = Command::new(programme);
        commande.args(arguments).arg(url);

        for (nom, valeur) in &correctifs {
            match valeur {
                Some(v) => commande.env(nom, OsString::from(v)),
                None => commande.env_remove(nom),
            };
        }

        // Détaché : le navigateur survit à la fermeture de MailFlow, et sa
        // sortie n'encombre pas la nôtre.
        commande
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match commande.spawn() {
            Ok(mut enfant) => {
                // On n'attend pas la fin — `xdg-open` rend la main aussitôt,
                // mais rien ne l'y oblige. On récolte l'enfant plus tard pour
                // ne pas laisser de zombie.
                std::thread::spawn(move || {
                    let _ = enfant.wait();
                });
                log::info!("lien confié à « {programme} »");
                return Ok(());
            }
            Err(e) => {
                log::warn!("« {programme} » indisponible : {e}");
                derniere = Some(e.to_string());
            }
        }
    }

    Err(AppError::Config(format!(
        "navigateur injoignable : {}",
        derniere.unwrap_or_else(|| "aucun lanceur disponible".into())
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(paires: &[(&str, &str)]) -> HashMap<String, String> {
        paires
            .iter()
            .map(|(c, v)| ((*c).to_string(), (*v).to_string()))
            .collect()
    }

    fn enveloppe_type() -> HashMap<String, String> {
        env(&[
            ("APPDIR", "/tmp/.mount_MailFl"),
            ("APPIMAGE", "/home/moi/MailFlow.AppImage"),
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_MailFl/usr/lib/:/tmp/.mount_MailFl/usr/lib64/",
            ),
            (
                "GIO_EXTRA_MODULES",
                "/tmp/.mount_MailFl/usr/lib/x86_64-linux-gnu/gio/modules",
            ),
            ("GDK_BACKEND", "x11"),
            (
                "XDG_DATA_DIRS",
                "/tmp/.mount_MailFl/usr/share:/usr/share:/usr/local/share",
            ),
            ("HOME", "/home/moi"),
            ("PATH", "/usr/bin:/bin"),
        ])
    }

    #[test]
    fn hors_appimage_rien_n_est_touche() {
        // Sur une installation ordinaire, l'environnement est celui du système.
        // Y toucher ne réparerait rien et casserait ce que l'utilisateur a
        // voulu.
        let ordinaire = env(&[
            ("HOME", "/home/moi"),
            ("LD_LIBRARY_PATH", "/opt/a-moi/lib"),
            ("XDG_DATA_DIRS", "/usr/share"),
        ]);

        assert!(correctifs(&ordinaire).is_empty());
        assert!(!dans_une_appimage(&ordinaire));
    }

    #[test]
    fn les_bibliotheques_de_l_appimage_ne_sont_pas_imposees_a_l_enfant() {
        // C'est le défaut d'origine : `xdg-open`, puis le navigateur,
        // chargeaient les bibliothèques de MailFlow au lieu des leurs et
        // mouraient sans un mot.
        let correctifs = correctifs(&enveloppe_type());

        assert!(correctifs.contains(&("LD_LIBRARY_PATH".to_string(), None)));
        assert!(correctifs.contains(&("GIO_EXTRA_MODULES".to_string(), None)));
        assert!(correctifs.contains(&("GDK_BACKEND".to_string(), None)));
    }

    #[test]
    fn les_dossiers_du_systeme_survivent_a_l_elagage() {
        // `XDG_DATA_DIRS` ne se retire pas : l'enfant a besoin des dossiers du
        // système, qui y figurent aussi. Seules les entrées de l'AppImage s'en
        // vont.
        let correctifs = correctifs(&enveloppe_type());

        let dirs = correctifs
            .iter()
            .find(|(nom, _)| nom == "XDG_DATA_DIRS")
            .map(|(_, v)| v.clone())
            .expect("XDG_DATA_DIRS doit être corrigé, pas ignoré");

        assert_eq!(dirs.as_deref(), Some("/usr/share:/usr/local/share"));
    }

    #[test]
    fn une_liste_entierement_dans_l_appimage_est_retiree_et_non_videe() {
        // GLib lit une variable vide comme « aucun dossier », alors qu'une
        // variable absente lui fait reprendre ses valeurs par défaut.
        let mut env = enveloppe_type();
        env.insert(
            "XDG_DATA_DIRS".to_string(),
            "/tmp/.mount_MailFl/usr/share".to_string(),
        );

        let correctifs = correctifs(&env);

        assert!(correctifs.contains(&("XDG_DATA_DIRS".to_string(), None)));
    }

    #[test]
    fn ce_qui_appartient_a_l_utilisateur_est_laisse_en_place() {
        let correctifs = correctifs(&enveloppe_type());
        let touchees: Vec<&str> = correctifs.iter().map(|(n, _)| n.as_str()).collect();

        assert!(!touchees.contains(&"HOME"));
        assert!(!touchees.contains(&"PATH"));
    }

    #[test]
    fn une_variable_absente_n_est_pas_inventee() {
        // Poser `env_remove` sur une variable qui n'existe pas est sans effet,
        // mais allonge la liste et le message du journal pour rien.
        let minimal = env(&[
            ("APPDIR", "/tmp/.mount_x"),
            ("APPIMAGE", "/home/moi/x.AppImage"),
            ("LD_LIBRARY_PATH", "/tmp/.mount_x/usr/lib"),
        ]);

        let touchees: Vec<String> = correctifs(&minimal).into_iter().map(|(n, _)| n).collect();

        assert!(touchees.contains(&"LD_LIBRARY_PATH".to_string()));
        assert!(!touchees.contains(&"GTK_PATH".to_string()));
        assert!(!touchees.contains(&"XDG_DATA_DIRS".to_string()));
    }
}
