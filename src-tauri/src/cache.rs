//! Ce que MailFlow garde sur le disque entre deux lancements.
//!
//! # Pourquoi le disque, alors que le corps des messages n'y allait pas
//!
//! Le relevé demande un appel par message : soixante allers-retours, une
//! vingtaine de secondes. Le refaire à chaque ouverture, et à chaque bascule de
//! compte, revenait à payer cette attente sans rien en retirer — les messages
//! n'ont pas changé depuis dix secondes.
//!
//! Les corps vivaient jusqu'ici dans `$XDG_RUNTIME_DIR`, que le système efface
//! au démarrage de la machine. C'était un choix de confidentialité assumé, et
//! il est ici renversé sciemment : éteindre l'ordinateur recommençait tout.
//!
//! Ce que ce renversement coûte, et comment on le limite :
//!
//! - les fichiers sont écrits en `0600`, lisibles du seul propriétaire, comme
//!   le fichier de règles ;
//! - rien n'est chiffré : le trousseau protège les jetons, pas ceci. Qui a
//!   accès à la session a accès au courrier, ce qui est déjà vrai du client de
//!   messagerie du système ;
//! - les Paramètres offrent un bouton qui efface tout d'un coup.
//!
//! # Cloisonnement par compte
//!
//! Chaque compte a son sous-dossier. Deux raisons : les identifiants de message
//! d'une boîte ne désignent rien dans une autre, et surtout, rendre le courrier
//! d'un compte sous l'adresse d'un autre serait la pire des confusions.

use std::path::{Path, PathBuf};

use crate::error::Resultat;
use crate::gmail::boite::MessageAffiche;
use crate::rules::RuleSet;

/// Nom de dossier sûr pour une adresse de compte.
///
/// L'adresse vient de Google, mais elle ne sert jamais telle quelle comme nom
/// de fichier : un `..` ou une barre oblique y écrirait ailleurs que prévu.
pub fn cloison(compte: &str) -> String {
    compte
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Dossier de cache d'un compte.
pub fn dossier_du_compte(racine: &Path, compte: &str) -> PathBuf {
    racine.join(cloison(compte))
}

/// Fichier du relevé, dans le dossier d'un compte.
fn fichier_releve(racine: &Path, compte: &str) -> PathBuf {
    dossier_du_compte(racine, compte).join("boite.json")
}

/// Écrit un fichier lisible du seul propriétaire.
///
/// Les droits sont posés à la création et non après coup : entre un fichier
/// créé en `0644` et un `chmod` qui suit, il existe un instant où le contenu
/// est lisible par tous.
fn ecrire_prive(chemin: &Path, contenu: &str) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options.open(chemin)?.write_all(contenu.as_bytes())
}

/// Range le relevé d'un compte.
///
/// Un échec d'écriture n'est pas une panne : le cache est une commodité, et
/// l'application doit fonctionner sur un disque plein comme sur un disque en
/// lecture seule. On le journalise et on continue.
pub fn ranger_boite(racine: &Path, compte: &str, boite: &[MessageAffiche]) {
    let dossier = dossier_du_compte(racine, compte);
    if let Err(e) = std::fs::create_dir_all(&dossier) {
        log::info!("cache indisponible pour {compte} : {e}");
        return;
    }

    match serde_json::to_string(boite) {
        Ok(texte) => {
            if let Err(e) = ecrire_prive(&fichier_releve(racine, compte), &texte) {
                log::info!("relevé non mis en cache : {e}");
            }
        }
        Err(e) => log::info!("relevé non sérialisable : {e}"),
    }
}

/// Relit le relevé d'un compte, ou `None`.
///
/// Un fichier illisible — tronqué par une coupure, écrit par une version
/// antérieure — rend `None` plutôt qu'une erreur : on relèvera, c'est tout.
pub fn lire_boite(racine: &Path, compte: &str) -> Option<Vec<MessageAffiche>> {
    let texte = std::fs::read_to_string(fichier_releve(racine, compte)).ok()?;
    serde_json::from_str(&texte).ok()
}

/// Réapplique les règles à un relevé sorti du cache.
///
/// La catégorie d'un message est calculée au moment du relevé, et rangée avec
/// lui. Une règle ajoutée après coup ne s'y appliquait donc pas : on créait une
/// règle « Formation » et la page restait vide jusqu'au prochain relevé
/// complet — au mieux, car l'affichage repart du cache. Le geste central du
/// produit paraissait sans effet.
///
/// Seules les règles sont rejouées, et c'est suffisant : dans `classer`, elles
/// passent avant tout le reste. Ce qu'on ne peut pas rejouer ici — les libellés
/// Gmail, l'en-tête de désabonnement — n'entre en compte que si aucune règle ne
/// vise l'expéditeur, auquel cas la catégorie rangée est déjà la bonne.
pub fn reclasser(boite: &mut [MessageAffiche], regles: &RuleSet) {
    for message in boite {
        if let Some(regle) = regles.regles_pour(&message.adresse).first() {
            message.categorie = regle.categorie.into();
        }
    }
}

/// Efface tout le cache, tous comptes confondus.
pub fn vider(racine: &Path) -> Resultat<()> {
    if racine.exists() {
        std::fs::remove_dir_all(racine).map_err(|source| crate::error::AppError::Io {
            chemin: racine.display().to_string(),
            source,
        })?;
    }
    Ok(())
}

/// Taille du cache, en octets. Sert à ce que le bouton d'effacement dise ce
/// qu'il va libérer.
pub fn taille(racine: &Path) -> u64 {
    fn parcourir(chemin: &Path) -> u64 {
        let Ok(entrees) = std::fs::read_dir(chemin) else {
            return 0;
        };
        entrees
            .filter_map(|e| e.ok())
            .map(|e| match e.metadata() {
                Ok(m) if m.is_dir() => parcourir(&e.path()),
                Ok(m) => m.len(),
                Err(_) => 0,
            })
            .sum()
    }
    parcourir(racine)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::classement::CategorieMessage;

    fn message(id: &str) -> MessageAffiche {
        MessageAffiche {
            id: id.into(),
            nom: "Karim".into(),
            adresse: "karim@atelier.fr".into(),
            destinataires: Vec::new(),
            copies: Vec::new(),
            sujet: "Devis".into(),
            extrait: "Bonjour".into(),
            date: None,
            non_lu: true,
            categorie: CategorieMessage::Humain,
            compte: "moi@gmail.com".into(),
        }
    }

    fn racine() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn ranger_puis_relire_rend_la_meme_boite() {
        let d = racine();
        let boite = vec![message("m1"), message("m2")];

        ranger_boite(d.path(), "moi@gmail.com", &boite);

        assert_eq!(lire_boite(d.path(), "moi@gmail.com"), Some(boite));
    }

    #[test]
    fn un_compte_jamais_releve_rend_none() {
        let d = racine();
        assert_eq!(lire_boite(d.path(), "inconnu@gmail.com"), None);
    }

    #[test]
    fn deux_comptes_ne_se_melangent_pas() {
        // Le cœur du cloisonnement : rendre le courrier d'un compte sous
        // l'adresse d'un autre serait pire qu'un rechargement.
        let d = racine();
        ranger_boite(d.path(), "un@gmail.com", &[message("m1")]);
        ranger_boite(d.path(), "deux@gmail.com", &[message("m2"), message("m3")]);

        assert_eq!(lire_boite(d.path(), "un@gmail.com").unwrap().len(), 1);
        assert_eq!(lire_boite(d.path(), "deux@gmail.com").unwrap().len(), 2);
    }

    #[test]
    fn une_adresse_hostile_n_ecrit_pas_ailleurs() {
        // L'adresse vient de Google, mais rien n'oblige à la croire : elle ne
        // doit pas pouvoir désigner un dossier parent.
        assert_eq!(cloison("../../etc/passwd"), "______etc_passwd");
        // La propriété, plus que la chaîne exacte : rien qui puisse désigner
        // un autre dossier ne survit.
        for hostile in ["../../etc/passwd", "a/b", "..", "~/.ssh/id_rsa"] {
            let sur = cloison(hostile);
            assert!(!sur.contains('/'), "{sur}");
            assert!(!sur.contains(".."), "{sur}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn le_releve_n_est_lisible_que_par_son_proprietaire() {
        use std::os::unix::fs::PermissionsExt;

        let d = racine();
        ranger_boite(d.path(), "moi@gmail.com", &[message("m1")]);

        let chemin = dossier_du_compte(d.path(), "moi@gmail.com").join("boite.json");
        let mode = std::fs::metadata(&chemin).unwrap().permissions().mode();

        assert_eq!(mode & 0o077, 0, "mode {mode:o} : lisible par d'autres");
    }

    #[test]
    fn un_fichier_corrompu_rend_none_plutot_qu_une_erreur() {
        // Coupure en cours d'écriture, ou format d'une version antérieure : on
        // relèvera, c'est tout.
        let d = racine();
        let dossier = dossier_du_compte(d.path(), "moi@gmail.com");
        std::fs::create_dir_all(&dossier).unwrap();
        std::fs::write(dossier.join("boite.json"), "{ pas du json").unwrap();

        assert_eq!(lire_boite(d.path(), "moi@gmail.com"), None);
    }

    #[test]
    fn vider_efface_tous_les_comptes() {
        let d = racine();
        ranger_boite(d.path(), "un@gmail.com", &[message("m1")]);
        ranger_boite(d.path(), "deux@gmail.com", &[message("m2")]);
        assert!(taille(d.path()) > 0);

        vider(d.path()).unwrap();

        assert_eq!(lire_boite(d.path(), "un@gmail.com"), None);
        assert_eq!(lire_boite(d.path(), "deux@gmail.com"), None);
        assert_eq!(taille(d.path()), 0);
    }

    fn regle_formation(active: bool) -> RuleSet {
        use crate::rules::{Action, Categorie, Rule};

        let mut regles = RuleSet::default();
        regles.automations.push(Rule {
            id: "r1".into(),
            expediteur: "karim@atelier.fr".into(),
            nom_affichage: "Karim".into(),
            categorie: Categorie::Formation,
            action: Action::ClasserSeulement,
            active,
            date_ajout: chrono::NaiveDate::from_ymd_opt(2026, 8, 15).unwrap(),
            libelle: None,
            frequence: None,
            heure_execution: None,
        });
        regles
    }

    #[test]
    fn une_regle_ajoutee_apres_le_releve_reclasse_le_cache() {
        // Le bug qu'on corrige : on crée une règle « Formation », et la page
        // reste vide parce que le cache garde la catégorie d'avant.
        let mut boite = vec![message("m1")];
        assert_eq!(boite[0].categorie, CategorieMessage::Humain);

        reclasser(&mut boite, &regle_formation(true));

        assert_eq!(boite[0].categorie, CategorieMessage::Formation);
    }

    #[test]
    fn une_regle_desactivee_ne_reclasse_rien() {
        let mut boite = vec![message("m1")];

        reclasser(&mut boite, &regle_formation(false));

        assert_eq!(boite[0].categorie, CategorieMessage::Humain);
    }

    #[test]
    fn un_message_sans_regle_garde_sa_categorie() {
        // Le classement automatique — publicité, newsletter — ne se rejoue pas
        // ici, et n'a pas à l'être : il ne dépend pas des règles.
        let mut boite = vec![message("m1")];
        boite[0].categorie = CategorieMessage::Publicite;

        reclasser(&mut boite, &RuleSet::default());

        assert_eq!(boite[0].categorie, CategorieMessage::Publicite);
    }

    #[test]
    fn vider_un_cache_absent_reussit() {
        let d = racine();
        assert!(vider(&d.path().join("jamais-cree")).is_ok());
    }
}

#[cfg(test)]
mod scenarios {
    //! Les trois cas d'usage, joués de bout en bout sur le disque.
    //!
    //! Ils ne testent pas une fonction mais une promesse : ce que
    //! l'utilisateur doit constater en fermant et rouvrant l'application, et en
    //! éteignant sa machine.

    use super::*;
    use crate::gmail::classement::CategorieMessage;

    fn message(id: &str, compte: &str, date: &str) -> MessageAffiche {
        MessageAffiche {
            id: id.into(),
            nom: "Karim".into(),
            adresse: "karim@atelier.fr".into(),
            destinataires: Vec::new(),
            copies: Vec::new(),
            sujet: format!("Sujet {id}"),
            extrait: String::new(),
            date: Some(date.into()),
            non_lu: true,
            categorie: CategorieMessage::Humain,
            compte: compte.into(),
        }
    }

    #[test]
    fn fermer_et_rouvrir_l_application_retrouve_la_boite() {
        let d = tempfile::tempdir().unwrap();
        let racine = d.path();

        // Session 1 : un relevé aboutit, il est rangé.
        ranger_boite(
            racine,
            "moi@gmail.com",
            &[
                message("m1", "moi@gmail.com", "2026-08-15T10:00:00Z"),
                message("m2", "moi@gmail.com", "2026-08-15T09:00:00Z"),
            ],
        );

        // Session 2 : rien en mémoire, tout sur le disque.
        let retrouvee = lire_boite(racine, "moi@gmail.com").unwrap();

        assert_eq!(retrouvee.len(), 2);
        assert_eq!(retrouvee[0].id, "m1");
    }

    #[test]
    fn eteindre_la_machine_ne_perd_rien() {
        // Le cache ne vit plus dans un dossier volatil : le seul moyen de le
        // perdre est de l'effacer. C'est ce que ce test vérifie — il échouerait
        // si quelqu'un remettait le cache dans `$XDG_RUNTIME_DIR`, où le
        // système l'efface au démarrage.
        let d = tempfile::tempdir().unwrap();
        ranger_boite(
            d.path(),
            "moi@gmail.com",
            &[message("m1", "moi@gmail.com", "x")],
        );

        let chemin = dossier_du_compte(d.path(), "moi@gmail.com").join("boite.json");

        assert!(chemin.exists());
        assert!(
            !chemin.starts_with("/run") && !chemin.starts_with("/tmp/systemd"),
            "le cache ne doit pas vivre dans un dossier effacé au démarrage : {}",
            chemin.display()
        );
    }

    #[test]
    fn un_nouveau_releve_remplace_l_ancien_sans_le_doubler() {
        // Des messages arrivent entre deux ouvertures : le relevé suivant fait
        // foi, et n'ajoute pas les nouveaux aux anciens.
        let d = tempfile::tempdir().unwrap();
        let racine = d.path();

        ranger_boite(
            racine,
            "moi@gmail.com",
            &[message("ancien", "moi@gmail.com", "1")],
        );
        ranger_boite(
            racine,
            "moi@gmail.com",
            &[
                message("nouveau", "moi@gmail.com", "2"),
                message("ancien", "moi@gmail.com", "1"),
            ],
        );

        let boite = lire_boite(racine, "moi@gmail.com").unwrap();

        assert_eq!(boite.len(), 2, "le relevé remplace, il ne s'ajoute pas");
        assert_eq!(boite[0].id, "nouveau");
    }

    #[test]
    fn la_vue_melangee_reunit_les_comptes_du_plus_recent_au_plus_ancien() {
        let d = tempfile::tempdir().unwrap();
        let racine = d.path();

        ranger_boite(
            racine,
            "un@gmail.com",
            &[message("a", "un@gmail.com", "2026-08-15T08:00:00Z")],
        );
        ranger_boite(
            racine,
            "deux@gmail.com",
            &[message("b", "deux@gmail.com", "2026-08-15T12:00:00Z")],
        );

        let mut tout: Vec<MessageAffiche> = ["un@gmail.com", "deux@gmail.com"]
            .iter()
            .filter_map(|c| lire_boite(racine, c))
            .flatten()
            .collect();
        tout.sort_by(|x, y| y.date.cmp(&x.date));

        assert_eq!(tout.len(), 2);
        assert_eq!(tout[0].id, "b", "le plus récent en tête");
        assert_eq!(tout[0].compte, "deux@gmail.com");
        assert_eq!(tout[1].compte, "un@gmail.com");
    }
}
