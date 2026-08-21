//! Où se trouvent les choses sur la table des archives.
//!
//! # Ce qui vit ici, et ce qui n'y vit pas
//!
//! La règle de partage est nette, et c'est elle qui commande tout le reste :
//!
//! - **le classement vit chez Gmail.** Un tas de la table *est* un libellé
//!   Gmail. Le nommer crée le libellé, y déposer une tuile pose le libellé sur
//!   le message. Le rangement survit donc à cette machine, se retrouve sur le
//!   téléphone, et reste vrai même si MailFlow disparaît ;
//! - **la disposition vit ici.** Où le tas « Factures » est posé sur la table
//!   ne regarde que MailFlow, et Gmail n'a nulle part où le mettre.
//!
//! Perdre ce fichier fait donc perdre une mise en page, **jamais un
//! classement**. C'est la propriété qui rendait l'idée acceptable : un tableau
//! blanc dont le contenu n'existerait que dans une application est un tableau
//! blanc qu'on perd.
//!
//! # Un fichier par compte
//!
//! Comme les règles, et pour la même raison : les identifiants de libellé d'une
//! boîte ne désignent rien dans une autre.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cache::{cloison, ecrire_prive};
use crate::error::{AppError, Resultat};

/// Nom du fichier, dans le dossier du compte.
pub const NOM_FICHIER: &str = "tableau.json";

/// Position d'un objet sur la table, en pixels de la surface.
///
/// Des nombres flottants parce que le glissement en produit : arrondir à
/// l'entier à chaque dépose ferait sautiller une tuile qu'on repose au même
/// endroit.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// Version du format de disposition.
///
/// Sert à une seule chose : reconnaître un fichier écrit avant que les
/// positions automatiques ne cessent d'y être enregistrées. Voir
/// [`Tableau::migrer`].
pub const VERSION: u32 = 2;

/// Ce que MailFlow retient de la disposition d'un compte.
///
/// # Ce qui doit s'y trouver, et ce qui n'y a rien à faire
///
/// **Uniquement ce que l'utilisateur a placé lui-même.** Les positions
/// attribuées automatiquement se recalculent à chaque affichage, et les écrire
/// ici revient à les faire passer pour des choix.
///
/// Ce n'était pas le cas, et la conséquence se voyait : une tuile fraîchement
/// archivée se rangeait derrière toutes les autres — au milieu de la table —
/// parce que toutes les autres étaient épinglées, y compris celles que personne
/// n'avait jamais touchées.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tableau {
    /// Version du format. Absente des fichiers d'avant la correction.
    #[serde(default)]
    pub version: u32,

    /// Position des tas, par identifiant de libellé Gmail.
    #[serde(default)]
    pub tas: HashMap<String, Position>,

    /// Position des messages laissés seuls sur la table.
    #[serde(default)]
    pub messages: HashMap<String, Position>,
}

impl Tableau {
    /// Remet à plat, une seule fois, les positions qu'on ne sait pas juger.
    ///
    /// # Pourquoi une remise à plat plutôt qu'un tri
    ///
    /// Rien ne distingue, dans un fichier ancien, une tuile déplacée à la main
    /// d'une tuile posée par le calcul : les deux ont été écrites de la même
    /// façon. Il n'y a donc pas de tri possible — seulement un choix entre tout
    /// garder, et ne plus rien épingler d'incertain.
    ///
    /// Les **tas** sont conservés. Faire un tas est un geste délibéré : on
    /// dépose une tuile sur une autre, on nomme le libellé. Le placer l'est
    /// tout autant. Les tuiles isolées, elles, sont le plus souvent là où le
    /// calcul les a mises.
    ///
    /// Une fois et une seule : la version passe à [`VERSION`] et le fichier
    /// n'est plus jamais touché de cette façon.
    pub fn migrer(&mut self) -> bool {
        if self.version >= VERSION {
            return false;
        }

        let oubliees = self.messages.len();
        self.messages.clear();
        self.version = VERSION;

        if oubliees > 0 {
            log::info!(
                "disposition reprise : {oubliees} tuile(s) isolée(s) rendues au placement \
                 automatique, les tas gardent leur place"
            );
        }

        true
    }
    /// Oublie ce qui ne correspond plus à rien.
    ///
    /// Une position de message effacé, ou de libellé supprimé depuis Gmail, ne
    /// sert plus à rien et ferait grossir le fichier indéfiniment. L'élagage a
    /// lieu à l'écriture, quand on connaît justement ce qui existe encore.
    ///
    /// Rend le nombre d'entrées retirées.
    pub fn elaguer(&mut self, messages_vivants: &[String], tas_vivants: &[String]) -> usize {
        let avant = self.tas.len() + self.messages.len();

        self.messages.retain(|id, _| messages_vivants.contains(id));
        self.tas.retain(|id, _| tas_vivants.contains(id));

        avant - (self.tas.len() + self.messages.len())
    }
}

/// Le fichier de disposition d'un compte.
///
/// L'adresse passe par [`cloison`] : elle vient de Google, mais un `..` ou une
/// barre oblique y écrirait ailleurs que prévu.
pub fn chemin(racine: &Path, compte: &str) -> PathBuf {
    racine.join(cloison(compte)).join(NOM_FICHIER)
}

/// Lit la disposition d'un compte, ou en rend une vide.
///
/// Un fichier absent est le cas normal — c'est la première ouverture de la
/// page. Un fichier illisible se traite pareil : perdre une mise en page ne
/// justifie pas de refuser d'afficher la table.
pub fn charger(racine: &Path, compte: &str) -> Tableau {
    let mut tableau: Tableau = std::fs::read_to_string(chemin(racine, compte))
        .ok()
        .and_then(|texte| serde_json::from_str(&texte).ok())
        .unwrap_or_default();

    // La reprise a lieu à la lecture, et l'écriture qui suivra la rendra
    // définitive. La refaire à chaque lecture est sans effet : la version
    // consignée l'arrête d'elle-même.
    tableau.migrer();
    tableau
}

/// Écrit la disposition d'un compte.
pub fn enregistrer(racine: &Path, compte: &str, tableau: &Tableau) -> Resultat<()> {
    let fichier = chemin(racine, compte);
    // Le frontend renvoie la disposition sans se soucier de la version : elle
    // est posée ici, sinon le fichier se ferait reprendre à chaque lecture et
    // l'utilisateur verrait sa table se défaire à chaque ouverture.
    let tableau = &Tableau {
        version: VERSION,
        ..tableau.clone()
    };

    if let Some(dossier) = fichier.parent() {
        std::fs::create_dir_all(dossier).map_err(|e| AppError::io(dossier.display(), e))?;
    }

    let texte = serde_json::to_string_pretty(tableau)
        .map_err(|e| AppError::Config(format!("disposition non sérialisable : {e}")))?;

    ecrire_prive(&fichier, &texte).map_err(|e| AppError::io(fichier.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un fichier écrit avant la correction : pas de version, des positions
    /// pour tout.
    fn ancien_format() -> Tableau {
        let mut t = Tableau::default();
        t.version = 0;
        t.tas.insert("Label_factures".into(), position(500.0, 300.0));
        t.messages.insert("m1".into(), position(700.0, 400.0));
        t.messages.insert("m2".into(), position(900.0, 400.0));
        t
    }

    #[test]
    fn un_ancien_fichier_rend_ses_tuiles_au_placement_automatique() {
        // Rien n'y distingue une tuile déplacée à la main d'une tuile posée par
        // le calcul : il n'y a pas de tri possible, seulement un choix.
        let mut t = ancien_format();

        assert!(t.migrer());
        assert!(t.messages.is_empty());
        assert_eq!(t.version, VERSION);
    }

    #[test]
    fn les_tas_survivent_a_la_reprise() {
        // Faire un tas et le placer sont deux gestes délibérés.
        let mut t = ancien_format();
        t.migrer();

        assert_eq!(t.tas.get("Label_factures"), Some(&position(500.0, 300.0)));
    }

    #[test]
    fn la_reprise_n_a_lieu_qu_une_fois() {
        // Sans ce garde-fou, la table se déferait à chaque ouverture.
        let mut t = ancien_format();
        t.migrer();
        t.messages.insert("place_a_la_main".into(), position(24.0, 24.0));

        assert!(!t.migrer());
        assert_eq!(t.messages.len(), 1);
    }

    fn position(x: f64, y: f64) -> Position {
        Position { x, y }
    }

    fn tableau_type() -> Tableau {
        // Au format courant : ce qui est relu porte toujours la version, que
        // l'écriture y pose. Un `Tableau::default()` nu vaut, lui, un fichier
        // d'avant la correction.
        let mut tableau = Tableau {
            version: VERSION,
            ..Default::default()
        };
        tableau.tas.insert("Label_1".into(), position(40.0, 80.0));
        tableau.messages.insert("m1".into(), position(10.0, 20.0));
        tableau
    }

    /// Ce qu'une lecture rend quand il n'y a rien à lire.
    fn table_vide() -> Tableau {
        Tableau {
            version: VERSION,
            ..Default::default()
        }
    }

    #[test]
    fn une_premiere_ouverture_n_est_pas_une_panne() {
        let dossier = tempfile::tempdir().unwrap();

        assert_eq!(charger(dossier.path(), "moi@gmail.com"), table_vide());
    }

    #[test]
    fn ce_qui_est_pose_se_retrouve_au_lancement_suivant() {
        let dossier = tempfile::tempdir().unwrap();
        let tableau = tableau_type();

        enregistrer(dossier.path(), "moi@gmail.com", &tableau).unwrap();

        assert_eq!(charger(dossier.path(), "moi@gmail.com"), tableau);
    }

    #[test]
    fn deux_comptes_ne_partagent_pas_leur_table() {
        // Les identifiants de libellé d'une boîte ne désignent rien dans une
        // autre : mêler les deux poserait des tas au hasard.
        let dossier = tempfile::tempdir().unwrap();

        enregistrer(dossier.path(), "moi@gmail.com", &tableau_type()).unwrap();

        assert_eq!(charger(dossier.path(), "boulot@exemple.fr"), table_vide());
    }

    #[test]
    fn un_fichier_abime_rend_une_table_vide_plutot_qu_une_erreur() {
        let dossier = tempfile::tempdir().unwrap();
        let fichier = chemin(dossier.path(), "moi@gmail.com");
        std::fs::create_dir_all(fichier.parent().unwrap()).unwrap();
        std::fs::write(&fichier, "{ ceci n'est pas du json").unwrap();

        assert_eq!(charger(dossier.path(), "moi@gmail.com"), table_vide());
    }

    #[test]
    fn ce_qui_n_existe_plus_est_oublie() {
        let mut tableau = tableau_type();
        tableau.messages.insert("efface".into(), position(1.0, 1.0));
        tableau
            .tas
            .insert("Label_supprime".into(), position(2.0, 2.0));

        let retires = tableau.elaguer(&["m1".to_string()], &["Label_1".to_string()]);

        assert_eq!(retires, 2);
        assert!(tableau.messages.contains_key("m1"));
        assert!(tableau.tas.contains_key("Label_1"));
        assert!(!tableau.messages.contains_key("efface"));
        assert!(!tableau.tas.contains_key("Label_supprime"));
    }

    #[test]
    fn une_adresse_hostile_n_ecrit_pas_ailleurs() {
        // Même garde que pour les règles : l'adresse vient de Google, mais elle
        // ne sert jamais telle quelle comme nom de dossier.
        let dossier = tempfile::tempdir().unwrap();

        let chemin = chemin(dossier.path(), "../../../etc/passwd");

        assert!(chemin.starts_with(dossier.path()));
        assert!(!chemin.to_string_lossy().contains(".."));
    }

    #[test]
    fn le_fichier_n_est_lisible_que_de_son_proprietaire() {
        // Il ne porte pas de courrier, mais il porte des identifiants de
        // libellé, donc les intitulés que l'utilisateur a choisis.
        let dossier = tempfile::tempdir().unwrap();
        enregistrer(dossier.path(), "moi@gmail.com", &tableau_type()).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let fichier = chemin(dossier.path(), "moi@gmail.com");
            let mode = std::fs::metadata(&fichier).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }
}
