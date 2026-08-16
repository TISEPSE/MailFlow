//! Persistance des règles, un fichier par compte.
//!
//! Les fichiers vivent dans le dossier de configuration applicatif de
//! l'utilisateur (`~/Library/Application Support/fr.mailflow.desktop` sur macOS,
//! `~/.config/fr.mailflow.desktop` sur Linux). Ils sont « invisibles » au sens du
//! cahier des charges : l'utilisateur lambda n'a jamais à les trouver.
//!
//! # Pourquoi un fichier par compte
//!
//! Une même adresse peut écrire à deux comptes sans qu'on veuille le même sort
//! pour ses messages : la newsletter qu'on archive dans sa boîte personnelle,
//! on la lit dans sa boîte professionnelle. Des règles communes forceraient une
//! décision unique là où l'utilisateur en a deux.
//!
//! Chaque compte a donc son fichier, sous `regles/<cloison>.json`, où `cloison`
//! est le nom de dossier sûr déjà utilisé par le cache — l'adresse vient de
//! Google et ne sert jamais telle quelle comme nom de fichier.
//!
//! # L'ancien fichier global
//!
//! Les versions précédentes rangeaient tout dans un `regles.json` unique, à la
//! racine. Il reste lu **tant qu'un compte n'a pas écrit les siennes** : les
//! règles déjà posées valaient pour tous les comptes, et elles continuent donc
//! de valoir pour chacun. Dès la première modification, le compte prend son
//! indépendance et n'y revient plus. Personne ne perd de règle en mettant à
//! jour, et personne n'a à les ressaisir.
//!
//! Deux exigences guident ce module :
//!
//! 1. **Écriture atomique.** Le fichier est réécrit à chaque modification de règle.
//!    Une coupure au mauvais moment laisserait un JSON tronqué, donc toutes les
//!    automatisations perdues. On écrit dans un fichier temporaire voisin, puis on
//!    le renomme — `rename` est atomique au sein d'un même système de fichiers.
//!
//! 2. **Permissions restreintes.** Le fichier liste les correspondants de
//!    l'utilisateur : qui lui écrit, quels services il utilise. C'est une donnée
//!    personnelle. Sur Unix il est créé en `0600`, lisible par son seul propriétaire.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Resultat};
use crate::rules::model::RuleSet;

/// Ancien fichier unique, à la racine du dossier de configuration.
pub const NOM_FICHIER: &str = "regles.json";

/// Sous-dossier des règles cloisonnées par compte.
pub const DOSSIER_COMPTES: &str = "regles";

/// Fichier de règles d'un compte donné.
///
/// L'adresse est ramenée à sa forme canonique — celle sous laquelle l'annuaire
/// la range — avant d'être réduite à un nom de fichier. Sans quoi
/// `Moi@Gmail.com` et `moi@gmail.com` désigneraient deux jeux de règles pour une
/// seule boîte.
pub fn fichier_du_compte(dossier: &Path, compte: &str) -> PathBuf {
    let canonique = compte.trim().to_lowercase();
    dossier
        .join(DOSSIER_COMPTES)
        .join(format!("{}.json", crate::cache::cloison(&canonique)))
}

pub struct RulesStore {
    chemin: PathBuf,

    /// Ancien fichier global, consulté tant que `chemin` n'existe pas.
    ///
    /// `None` pour un magasin qui ne désigne aucun compte particulier — il n'y
    /// a alors rien dont hériter.
    herite: Option<PathBuf>,
}

impl RulesStore {
    /// Magasin des règles d'un compte.
    ///
    /// `dossier` est le dossier de configuration applicatif ; il est créé au
    /// besoin. L'adresse du compte n'a pas à être valide : elle est réduite à un
    /// nom de fichier sûr avant tout usage.
    pub fn pour_compte(dossier: impl AsRef<Path>, compte: &str) -> Self {
        let dossier = dossier.as_ref();
        Self {
            chemin: fichier_du_compte(dossier, compte),
            herite: Some(dossier.join(NOM_FICHIER)),
        }
    }

    /// Magasin de l'ancien fichier global, sans héritage.
    ///
    /// Ne sert qu'à le lire ou l'effacer : plus rien ne s'y écrit.
    pub fn heritage(dossier: impl AsRef<Path>) -> Self {
        Self {
            chemin: dossier.as_ref().join(NOM_FICHIER),
            herite: None,
        }
    }

    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    pub fn existe(&self) -> bool {
        self.chemin.exists()
    }

    /// Charge le jeu de règles.
    ///
    /// Un fichier absent rend un [`RuleSet`] vide : c'est l'état normal au premier
    /// lancement, pas une erreur. Un fichier présent mais illisible, en revanche,
    /// remonte une erreur — on ne repart pas silencieusement de zéro, ce qui
    /// effacerait sans préavis toutes les automatisations de l'utilisateur.
    ///
    /// Tant que le compte n'a jamais écrit ses propres règles, l'ancien fichier
    /// global tient lieu de réponse : voir l'en-tête du module.
    pub fn charger(&self) -> Resultat<RuleSet> {
        let source = match (&self.chemin, &self.herite) {
            (chemin, _) if chemin.exists() => chemin,
            (_, Some(herite)) if herite.exists() => herite,
            _ => return Ok(RuleSet::default()),
        };

        let texte = fs::read_to_string(source).map_err(|e| AppError::io(source.display(), e))?;

        serde_json::from_str(&texte).map_err(|e| {
            AppError::FormatRegles(format!(
                "{} ligne {} : {}",
                source
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| NOM_FICHIER.into()),
                e.line(),
                e
            ))
        })
    }

    /// Efface le fichier du compte. Un fichier déjà absent n'est pas une erreur.
    ///
    /// Appelé quand un compte est retiré de l'application : ses règles ne
    /// concernent plus personne, et les garder ferait ressurgir de vieilles
    /// automatisations le jour où la même adresse serait rebranchée.
    pub fn effacer(&self) -> Resultat<()> {
        match fs::remove_file(&self.chemin) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::io(self.chemin.display(), e)),
        }
    }

    /// Écrit le jeu de règles de façon atomique.
    pub fn enregistrer(&self, regles: &RuleSet) -> Resultat<()> {
        let dossier = self
            .chemin
            .parent()
            .ok_or_else(|| AppError::Config("chemin de règles sans dossier parent".into()))?;

        fs::create_dir_all(dossier).map_err(|e| AppError::io(dossier.display(), e))?;

        let json = serde_json::to_string_pretty(regles)
            .map_err(|e| AppError::FormatRegles(e.to_string()))?;

        let temporaire = self.chemin.with_extension("json.tmp");

        // Bloc dédié : le fichier doit être fermé avant le renommage.
        {
            let mut f = fichier_prive(&temporaire)?;
            f.write_all(json.as_bytes())
                .map_err(|e| AppError::io(temporaire.display(), e))?;
            // Force l'écriture sur le disque avant le renommage, sinon un
            // arrêt brutal peut laisser un fichier renommé mais vide.
            f.sync_all()
                .map_err(|e| AppError::io(temporaire.display(), e))?;
        }

        fs::rename(&temporaire, &self.chemin)
            .map_err(|e| AppError::io(self.chemin.display(), e))?;

        Ok(())
    }
}

/// Crée le fichier en écriture, en `0600` sur Unix.
///
/// Les permissions sont posées à la création plutôt qu'après coup : entre un
/// `create` en `0644` et un `set_permissions`, le contenu serait brièvement
/// lisible par les autres comptes de la machine.
fn fichier_prive(chemin: &Path) -> Resultat<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options
        .open(chemin)
        .map_err(|e| AppError::io(chemin.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::{Action, Categorie, Rule};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn jeu_exemple() -> RuleSet {
        RuleSet {
            automations: vec![Rule {
                id: "rule_01".into(),
                expediteur: "promo@offres-tech.fr".into(),
                nom_affichage: "Offres Tech Flash".into(),
                categorie: Categorie::Publicite,
                action: Action::SupprimerToujours,
                active: true,
                date_ajout: NaiveDate::from_ymd_opt(2026, 8, 13).unwrap(),
                libelle: None,
                frequence: None,
                heure_execution: None,
            }],
            ..Default::default()
        }
    }

    fn jeu(expediteur: &str) -> RuleSet {
        let mut jeu = jeu_exemple();
        jeu.automations[0].expediteur = expediteur.into();
        jeu
    }

    #[test]
    fn un_fichier_absent_rend_un_jeu_vide() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");

        assert!(store.charger().unwrap().automations.is_empty());
    }

    #[test]
    fn enregistrer_puis_charger_preserve_les_regles() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");
        let attendu = jeu_exemple();

        store.enregistrer(&attendu).unwrap();

        assert_eq!(store.charger().unwrap(), attendu);
    }

    #[test]
    fn le_dossier_est_cree_s_il_manque() {
        let racine = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(
            racine.path().join("pas").join("encore").join("la"),
            "moi@gmail.com",
        );

        store.enregistrer(&jeu_exemple()).unwrap();

        assert!(store.existe());
    }

    #[test]
    fn un_json_corrompu_remonte_une_erreur_sans_ecraser_le_fichier() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");
        fs::create_dir_all(store.chemin().parent().unwrap()).unwrap();
        fs::write(store.chemin(), "{ ceci n'est pas du json").unwrap();

        let err = store.charger().unwrap_err();

        assert_eq!(err.code(), "REGLES_CORROMPUES");
        assert!(store.existe(), "le fichier ne doit pas avoir été supprimé");
    }

    #[test]
    fn aucun_fichier_temporaire_ne_subsiste_apres_ecriture() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");

        store.enregistrer(&jeu_exemple()).unwrap();

        let restants: Vec<_> = fs::read_dir(store.chemin().parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .filter(|n| n.to_string_lossy().ends_with(".tmp"))
            .collect();

        assert!(
            restants.is_empty(),
            "fichiers temporaires restants : {restants:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn le_fichier_n_est_lisible_que_par_son_proprietaire() {
        use std::os::unix::fs::PermissionsExt;

        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");
        store.enregistrer(&jeu_exemple()).unwrap();

        let mode = fs::metadata(store.chemin()).unwrap().permissions().mode();

        assert_eq!(mode & 0o777, 0o600, "mode obtenu : {:o}", mode & 0o777);
    }

    #[test]
    fn une_reecriture_remplace_integralement_l_ancien_contenu() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "moi@gmail.com");

        store.enregistrer(&jeu_exemple()).unwrap();
        store.enregistrer(&RuleSet::default()).unwrap();

        assert!(store.charger().unwrap().automations.is_empty());
    }

    // -----------------------------------------------------------------------
    // Cloisonnement par compte
    // -----------------------------------------------------------------------

    #[test]
    fn deux_comptes_ne_partagent_pas_leurs_regles() {
        // Le cœur de la demande : une même adresse peut mériter deux sorts
        // différents selon la boîte qui la reçoit.
        let dossier = TempDir::new().unwrap();
        let perso = RulesStore::pour_compte(dossier.path(), "perso@gmail.com");
        let pro = RulesStore::pour_compte(dossier.path(), "pro@gmail.com");

        perso.enregistrer(&jeu("info@lemonde.fr")).unwrap();

        assert!(
            pro.charger().unwrap().automations.is_empty(),
            "la règle du compte personnel ne doit pas atteindre le compte professionnel"
        );
    }

    #[test]
    fn une_regle_modifiee_dans_un_compte_ne_touche_pas_l_autre() {
        let dossier = TempDir::new().unwrap();
        let perso = RulesStore::pour_compte(dossier.path(), "perso@gmail.com");
        let pro = RulesStore::pour_compte(dossier.path(), "pro@gmail.com");

        perso.enregistrer(&jeu("info@lemonde.fr")).unwrap();
        pro.enregistrer(&jeu("info@lemonde.fr")).unwrap();
        perso.enregistrer(&RuleSet::default()).unwrap();

        assert_eq!(
            pro.charger().unwrap().automations.len(),
            1,
            "vider les règles d'un compte ne doit rien retirer à l'autre"
        );
    }

    #[test]
    fn une_adresse_hostile_n_ecrit_pas_ailleurs() {
        // L'adresse vient de Google, mais rien n'oblige à la croire : elle ne
        // doit pas pouvoir désigner un fichier hors du dossier des règles.
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::pour_compte(dossier.path(), "../../.ssh/authorized_keys");

        store.enregistrer(&jeu_exemple()).unwrap();

        assert_eq!(
            store.chemin().parent().unwrap(),
            dossier.path().join(DOSSIER_COMPTES),
            "le fichier doit rester dans le dossier des règles"
        );
    }

    // -----------------------------------------------------------------------
    // Héritage de l'ancien fichier global
    // -----------------------------------------------------------------------

    #[test]
    fn les_regles_d_avant_le_cloisonnement_valent_pour_chaque_compte() {
        // Elles s'appliquaient à tous les comptes ; la mise à jour ne doit
        // dépouiller personne.
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu("info@lemonde.fr"))
            .unwrap();

        for compte in ["perso@gmail.com", "pro@gmail.com"] {
            let lues = RulesStore::pour_compte(dossier.path(), compte)
                .charger()
                .unwrap();
            assert_eq!(lues.automations.len(), 1, "compte {compte}");
        }
    }

    #[test]
    fn un_compte_qui_a_ecrit_ses_regles_ne_revient_pas_a_l_ancien_fichier() {
        // Y compris quand il n'en garde aucune : avoir tout supprimé est une
        // décision, pas une absence de décision.
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu("info@lemonde.fr"))
            .unwrap();

        let perso = RulesStore::pour_compte(dossier.path(), "perso@gmail.com");
        perso.enregistrer(&RuleSet::default()).unwrap();

        assert!(
            perso.charger().unwrap().automations.is_empty(),
            "les anciennes règles ne doivent pas ressusciter"
        );
    }

    #[test]
    fn l_heritage_ne_reecrit_jamais_l_ancien_fichier() {
        // Il sert encore aux comptes qui n'ont pas pris leur indépendance.
        let dossier = TempDir::new().unwrap();
        let global = RulesStore::heritage(dossier.path());
        global.enregistrer(&jeu("info@lemonde.fr")).unwrap();

        RulesStore::pour_compte(dossier.path(), "perso@gmail.com")
            .enregistrer(&RuleSet::default())
            .unwrap();

        assert_eq!(global.charger().unwrap().automations.len(), 1);
    }

    #[test]
    fn effacer_retire_les_regles_du_compte_et_de_lui_seul() {
        let dossier = TempDir::new().unwrap();
        let perso = RulesStore::pour_compte(dossier.path(), "perso@gmail.com");
        let pro = RulesStore::pour_compte(dossier.path(), "pro@gmail.com");
        perso.enregistrer(&jeu_exemple()).unwrap();
        pro.enregistrer(&jeu_exemple()).unwrap();

        perso.effacer().unwrap();

        assert!(!perso.existe());
        assert_eq!(pro.charger().unwrap().automations.len(), 1);
    }

    #[test]
    fn la_casse_de_l_adresse_ne_cree_pas_deux_jeux_de_regles() {
        let dossier = TempDir::new().unwrap();

        RulesStore::pour_compte(dossier.path(), "Moi@Gmail.com")
            .enregistrer(&jeu_exemple())
            .unwrap();

        assert_eq!(
            RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
                .charger()
                .unwrap()
                .automations
                .len(),
            1
        );
    }

    #[test]
    fn effacer_un_fichier_absent_reussit() {
        let dossier = TempDir::new().unwrap();

        RulesStore::pour_compte(dossier.path(), "jamais@vu.fr")
            .effacer()
            .unwrap();
    }
}
