//! Migration unique des règles d'avant le cloisonnement par compte.
//!
//! # Le défaut que ce module corrige
//!
//! Les premières versions rangeaient toutes les règles dans un `regles.json`
//! unique, à la racine du dossier de configuration. Le cloisonnement par compte
//! a d'abord été rattrapé par une lecture de repli : un compte sans fichier
//! propre retombait sur l'ancien fichier global.
//!
//! Ce repli produisait un doublon visible. Avec trois comptes et un seul ancien
//! fichier, les deux comptes n'ayant jamais écrit les leurs lisaient tous deux
//! le même contenu — et la vue « Tous les comptes » affichait la même règle
//! deux fois, au nom de deux boîtes différentes. Une règle vise un compte ; en
//! voir une par compte n'était pas ce que l'utilisateur avait demandé.
//!
//! # Ce qu'on fait à la place
//!
//! Une migration franche, une fois pour toutes : les anciennes règles sont
//! versées dans le fichier du **compte actif**, et lui seul. Le compte actif
//! parce que ces règles ont été posées à l'époque où l'application n'en
//! connaissait qu'un — les verser dans les trois recréerait exactement le
//! triplement qu'on cherche à faire disparaître.
//!
//! L'ancien fichier est ensuite **renommé, pas supprimé**. Si ce partage se
//! révèle mauvais, tout est encore sur le disque.
//!
//! Le repli disparaît alors de [`RulesStore`](crate::rules::RulesStore) : tant
//! qu'il existe, le doublon peut revenir.

use std::fs;
use std::path::Path;

use crate::error::{AppError, Resultat};
use crate::rules::RulesStore;
use crate::rules::store::NOM_FICHIER;

/// Nom sous lequel l'ancien fichier global est mis de côté.
///
/// L'extension `.json` disparaît volontairement : le fichier ne doit plus
/// jamais être pris pour un jeu de règles vivant, ni par le code, ni par un
/// utilisateur qui fouille son dossier de configuration.
pub const NOM_ARCHIVE: &str = "regles.json.avant-cloisonnement";

/// Verse l'ancien fichier global dans le compte actif, puis l'archive.
///
/// Rend le nombre de règles reprises, ou `None` quand il n'y avait rien à
/// migrer — c'est le cas de toute installation neuve, et de tout lancement
/// après le premier.
///
/// L'opération est **idempotente et sûre à rejouer** : si l'écriture réussit
/// mais que le renommage échoue, le passage suivant retrouve les mêmes règles
/// déjà présentes, n'en reprend aucune, et retente le renommage.
pub fn cloisonner(dossier: &Path, compte_actif: &str) -> Resultat<Option<usize>> {
    let ancien = dossier.join(NOM_FICHIER);
    if !ancien.exists() {
        return Ok(None);
    }

    // Sans compte actif, on ne saurait pas à qui donner ces règles. L'ancien
    // fichier reste en place et la migration se fera au prochain démarrage,
    // une fois un compte relié — plutôt que d'inventer un destinataire.
    let compte_actif = compte_actif.trim();
    if compte_actif.is_empty() {
        log::info!("anciennes règles trouvées, migration différée : aucun compte actif");
        return Ok(None);
    }

    let heritees = RulesStore::heritage(dossier).charger()?;

    let magasin = RulesStore::pour_compte(dossier, compte_actif);
    let mut siennes = magasin.charger()?;

    // Les règles déjà propres au compte l'emportent : elles sont postérieures,
    // et l'utilisateur les a posées en sachant ce qu'il faisait. Une ancienne
    // règle visant le même expéditeur est donc écartée, pas fusionnée — sans
    // quoi la migration défaîrait une décision récente.
    let mut reprises = 0usize;
    for regle in heritees.automations {
        let cible = regle.cible_normalisee();
        let deja_visee = cible.is_some()
            && siennes
                .automations
                .iter()
                .any(|r| r.cible_normalisee() == cible);

        if deja_visee {
            continue;
        }

        siennes.automations.push(regle);
        reprises += 1;
    }

    if reprises > 0 {
        magasin.enregistrer(&siennes)?;
    }

    let archive = dossier.join(NOM_ARCHIVE);
    fs::rename(&ancien, &archive).map_err(|e| AppError::io(archive.display(), e))?;

    log::info!("règles d'avant le cloisonnement migrées : {reprises} reprise(s)");
    Ok(Some(reprises))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::{Action, Categorie, Rule, RuleSet};
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn regle(expediteur: &str) -> Rule {
        Rule {
            id: format!("rule_{}", expediteur.replace(['@', '.', '-'], "_")),
            expediteur: expediteur.into(),
            nom_affichage: expediteur.into(),
            categorie: Categorie::Formation,
            action: Action::ClasserSeulement,
            active: true,
            date_ajout: NaiveDate::from_ymd_opt(2026, 8, 14).unwrap(),
            libelle: None,
            frequence: None,
            heure_execution: None,
        }
    }

    fn jeu(expediteurs: &[&str]) -> RuleSet {
        RuleSet {
            automations: expediteurs.iter().map(|e| regle(e)).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn sans_ancien_fichier_il_n_y_a_rien_a_faire() {
        let dossier = TempDir::new().unwrap();

        assert_eq!(
            cloisonner(dossier.path(), "moi@gmail.com").unwrap(),
            None,
            "une installation neuve ne doit rien migrer"
        );
    }

    #[test]
    fn les_anciennes_regles_vont_au_compte_actif_et_a_lui_seul() {
        // Le cœur du défaut signalé : trois comptes, un ancien fichier, et la
        // même règle qui s'affichait une fois par compte.
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu(&["messages-noreply@linkedin.com"]))
            .unwrap();

        cloisonner(dossier.path(), "actif@gmail.com").unwrap();

        assert_eq!(
            RulesStore::pour_compte(dossier.path(), "actif@gmail.com")
                .charger()
                .unwrap()
                .automations
                .len(),
            1
        );
        for autre in ["autre@gmail.com", "troisieme@gmail.com"] {
            assert!(
                RulesStore::pour_compte(dossier.path(), autre)
                    .charger()
                    .unwrap()
                    .automations
                    .is_empty(),
                "le compte {autre} ne doit hériter de rien"
            );
        }
    }

    #[test]
    fn l_ancien_fichier_est_archive_et_non_detruit() {
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu(&["info@lemonde.fr"]))
            .unwrap();

        cloisonner(dossier.path(), "moi@gmail.com").unwrap();

        assert!(!dossier.path().join(NOM_FICHIER).exists());
        assert!(
            dossier.path().join(NOM_ARCHIVE).exists(),
            "l'ancien fichier doit rester récupérable"
        );
    }

    #[test]
    fn les_regles_deja_propres_au_compte_survivent() {
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu(&["ancienne@exemple.fr"]))
            .unwrap();
        RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
            .enregistrer(&jeu(&["recente@exemple.fr"]))
            .unwrap();

        assert_eq!(
            cloisonner(dossier.path(), "moi@gmail.com").unwrap(),
            Some(1)
        );

        let apres = RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
            .charger()
            .unwrap();
        let cibles: Vec<_> = apres
            .automations
            .iter()
            .map(|r| r.expediteur.as_str())
            .collect();
        assert!(cibles.contains(&"recente@exemple.fr"));
        assert!(cibles.contains(&"ancienne@exemple.fr"));
    }

    #[test]
    fn une_decision_recente_n_est_pas_defaite_par_une_ancienne_regle() {
        // Même expéditeur des deux côtés : c'est la règle du compte qui gagne,
        // sans quoi la migration ressusciterait un réglage abandonné.
        let dossier = TempDir::new().unwrap();

        let mut ancienne = jeu(&["info@lemonde.fr"]);
        ancienne.automations[0].categorie = Categorie::Publicite;
        RulesStore::heritage(dossier.path())
            .enregistrer(&ancienne)
            .unwrap();

        let mut recente = jeu(&["info@lemonde.fr"]);
        recente.automations[0].categorie = Categorie::Newsletter;
        RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
            .enregistrer(&recente)
            .unwrap();

        assert_eq!(
            cloisonner(dossier.path(), "moi@gmail.com").unwrap(),
            Some(0)
        );

        let apres = RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
            .charger()
            .unwrap();
        assert_eq!(apres.automations.len(), 1);
        assert_eq!(apres.automations[0].categorie, Categorie::Newsletter);
    }

    #[test]
    fn rejouer_la_migration_ne_duplique_rien() {
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu(&["info@lemonde.fr"]))
            .unwrap();

        cloisonner(dossier.path(), "moi@gmail.com").unwrap();
        // Le second passage ne trouve plus d'ancien fichier.
        assert_eq!(cloisonner(dossier.path(), "moi@gmail.com").unwrap(), None);

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
    fn sans_compte_actif_l_ancien_fichier_est_laisse_en_place() {
        // Migrer vers un destinataire inventé perdrait les règles pour de bon.
        let dossier = TempDir::new().unwrap();
        RulesStore::heritage(dossier.path())
            .enregistrer(&jeu(&["info@lemonde.fr"]))
            .unwrap();

        assert_eq!(cloisonner(dossier.path(), "   ").unwrap(), None);

        assert!(
            dossier.path().join(NOM_FICHIER).exists(),
            "l'ancien fichier doit attendre qu'un compte soit relié"
        );
    }

    #[test]
    fn un_ancien_fichier_corrompu_ne_detruit_rien() {
        // Il remonte une erreur, mais laisse le fichier du compte intact et
        // l'ancien en place : on ne repart pas silencieusement de zéro.
        let dossier = TempDir::new().unwrap();
        fs::write(dossier.path().join(NOM_FICHIER), "{ pas du json").unwrap();
        RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
            .enregistrer(&jeu(&["recente@exemple.fr"]))
            .unwrap();

        assert!(cloisonner(dossier.path(), "moi@gmail.com").is_err());

        assert!(dossier.path().join(NOM_FICHIER).exists());
        assert_eq!(
            RulesStore::pour_compte(dossier.path(), "moi@gmail.com")
                .charger()
                .unwrap()
                .automations
                .len(),
            1
        );
    }
}
