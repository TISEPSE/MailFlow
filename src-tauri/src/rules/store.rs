//! Persistance de `regles.json`.
//!
//! Le fichier vit dans le dossier de configuration applicatif de l'utilisateur
//! (`~/Library/Application Support/fr.mailflow.desktop` sur macOS,
//! `~/.config/fr.mailflow.desktop` sur Linux). Il est « invisible » au sens du
//! cahier des charges : l'utilisateur lambda n'a jamais à le trouver.
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

pub const NOM_FICHIER: &str = "regles.json";

pub struct RulesStore {
    chemin: PathBuf,
}

impl RulesStore {
    /// `dossier` est le dossier de configuration applicatif ; il est créé au besoin.
    pub fn new(dossier: impl AsRef<Path>) -> Self {
        Self {
            chemin: dossier.as_ref().join(NOM_FICHIER),
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
    pub fn charger(&self) -> Resultat<RuleSet> {
        if !self.existe() {
            return Ok(RuleSet::default());
        }

        let texte =
            fs::read_to_string(&self.chemin).map_err(|e| AppError::io(self.chemin.display(), e))?;

        serde_json::from_str(&texte).map_err(|e| {
            AppError::FormatRegles(format!("{} ligne {} : {}", NOM_FICHIER, e.line(), e))
        })
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

    #[test]
    fn un_fichier_absent_rend_un_jeu_vide() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::new(dossier.path());

        assert!(store.charger().unwrap().automations.is_empty());
    }

    #[test]
    fn enregistrer_puis_charger_preserve_les_regles() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::new(dossier.path());
        let attendu = jeu_exemple();

        store.enregistrer(&attendu).unwrap();

        assert_eq!(store.charger().unwrap(), attendu);
    }

    #[test]
    fn le_dossier_est_cree_s_il_manque() {
        let racine = TempDir::new().unwrap();
        let store = RulesStore::new(racine.path().join("pas").join("encore").join("la"));

        store.enregistrer(&jeu_exemple()).unwrap();

        assert!(store.existe());
    }

    #[test]
    fn un_json_corrompu_remonte_une_erreur_sans_ecraser_le_fichier() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::new(dossier.path());
        fs::write(store.chemin(), "{ ceci n'est pas du json").unwrap();

        let err = store.charger().unwrap_err();

        assert_eq!(err.code(), "REGLES_CORROMPUES");
        assert!(store.existe(), "le fichier ne doit pas avoir été supprimé");
    }

    #[test]
    fn aucun_fichier_temporaire_ne_subsiste_apres_ecriture() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::new(dossier.path());

        store.enregistrer(&jeu_exemple()).unwrap();

        let restants: Vec<_> = fs::read_dir(dossier.path())
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
        let store = RulesStore::new(dossier.path());
        store.enregistrer(&jeu_exemple()).unwrap();

        let mode = fs::metadata(store.chemin()).unwrap().permissions().mode();

        assert_eq!(mode & 0o777, 0o600, "mode obtenu : {:o}", mode & 0o777);
    }

    #[test]
    fn une_reecriture_remplace_integralement_l_ancien_contenu() {
        let dossier = TempDir::new().unwrap();
        let store = RulesStore::new(dossier.path());

        store.enregistrer(&jeu_exemple()).unwrap();
        store.enregistrer(&RuleSet::default()).unwrap();

        assert!(store.charger().unwrap().automations.is_empty());
    }
}
