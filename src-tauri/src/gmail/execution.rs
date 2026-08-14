//! Du plan de règles aux appels d'API.
//!
//! Étape purement arithmétique, séparée du transport pour la même raison que le
//! moteur de règles : elle décide combien d'appels partiront chez Google, donc
//! combien de quota sera consommé, et ça se vérifie sans réseau.
//!
//! Deux formes d'appel, imposées par l'API :
//!
//! - **Archivage** — `users.messages.batchModify` accepte jusqu'à mille
//!   identifiants par requête. Deux cents archivages coûtent un appel, pas deux
//!   cents.
//! - **Mise à la corbeille** — `users.messages.trash` ne traite qu'un message à
//!   la fois. Il existe bien un `batchDelete`, mais il supprime définitivement :
//!   il n'a pas sa place derrière une action déclenchée automatiquement par une
//!   règle. La corbeille reste réversible trente jours.

use serde::Serialize;

use super::libelles;
use crate::rules::{ActionPlanifiee, EntreePlan};

/// Nombre maximal d'identifiants accepté par `batchModify`.
pub const LOT_MAX: usize = 1000;

/// Un appel d'API à émettre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationGmail {
    /// `users.messages.batchModify`.
    ModifierLibelles {
        ids: Vec<String>,
        ajouter: Vec<String>,
        retirer: Vec<String>,
    },

    /// `users.messages.trash`, un message à la fois.
    MettreALaCorbeille { id: String },
}

impl OperationGmail {
    /// Nombre de messages concernés, pour le décompte du rapport.
    pub fn nombre_de_messages(&self) -> usize {
        match self {
            Self::ModifierLibelles { ids, .. } => ids.len(),
            Self::MettreALaCorbeille { .. } => 1,
        }
    }
}

/// Ce que la synchronisation a réellement fait, destiné au frontend.
#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RapportExecution {
    pub archives: usize,
    pub mis_a_la_corbeille: usize,

    /// Appels qui ont échoué après épuisement des réessais. Le reste du plan est
    /// quand même appliqué : un message intraitable ne doit pas bloquer les
    /// autres.
    pub echecs: usize,
}

/// Traduit un plan en appels d'API.
///
/// Repose sur une garantie du moteur : un message n'apparaît qu'une fois dans le
/// plan (voir [`crate::rules::planifier`]). Sans elle, un même message pourrait
/// être archivé et jeté dans la même passe.
pub fn operations(plan: &[EntreePlan]) -> Vec<OperationGmail> {
    // Les archivages sont groupés par destination : un même appel ne peut poser
    // qu'un jeu de libellés, et mélanger les destinations rangerait les messages
    // n'importe où. `BTreeMap` pour que l'ordre des appels soit reproductible,
    // donc testable.
    let mut a_archiver: std::collections::BTreeMap<Option<String>, Vec<String>> =
        std::collections::BTreeMap::new();
    let mut a_jeter: Vec<OperationGmail> = Vec::new();

    for entree in plan {
        match entree.action {
            // Les deux mènent au même appel : côté Gmail, « résumer puis
            // archiver » n'est qu'un archivage. Le résumé se fait ailleurs.
            ActionPlanifiee::RetirerDeLaBoiteDeReception | ActionPlanifiee::ResumerPuisArchiver => {
                a_archiver
                    .entry(entree.libelle.clone())
                    .or_default()
                    .push(entree.message_id.clone());
            }
            ActionPlanifiee::MettreALaCorbeille => {
                a_jeter.push(OperationGmail::MettreALaCorbeille {
                    id: entree.message_id.clone(),
                });
            }
        }
    }

    let mut ops: Vec<OperationGmail> = a_archiver
        .into_iter()
        .flat_map(|(destination, ids)| {
            let ajouter: Vec<String> = destination.into_iter().collect();
            ids.chunks(LOT_MAX)
                .map(|lot| OperationGmail::ModifierLibelles {
                    ids: lot.to_vec(),
                    ajouter: ajouter.clone(),
                    retirer: vec![libelles::INBOX.to_string()],
                })
                .collect::<Vec<_>>()
        })
        .collect();

    ops.extend(a_jeter);
    ops
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entree(id: &str, action: ActionPlanifiee) -> EntreePlan {
        EntreePlan {
            message_id: id.into(),
            action,
            regle_id: "rule_01".into(),
            libelle: None,
        }
    }

    fn ids_archives(ops: &[OperationGmail]) -> Vec<Vec<String>> {
        ops.iter()
            .filter_map(|o| match o {
                OperationGmail::ModifierLibelles { ids, .. } => Some(ids.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn les_archivages_sont_groupes_par_destination() {
        // Un même appel ne peut poser qu'un jeu de libellés : mélanger les
        // destinations rangerait les messages n'importe où.
        let plan = vec![
            EntreePlan {
                message_id: "m1".into(),
                action: ActionPlanifiee::RetirerDeLaBoiteDeReception,
                regle_id: "r1".into(),
                libelle: Some("L1".into()),
            },
            EntreePlan {
                message_id: "m2".into(),
                action: ActionPlanifiee::RetirerDeLaBoiteDeReception,
                regle_id: "r2".into(),
                libelle: None,
            },
            EntreePlan {
                message_id: "m3".into(),
                action: ActionPlanifiee::RetirerDeLaBoiteDeReception,
                regle_id: "r3".into(),
                libelle: Some("L1".into()),
            },
        ];

        let ops = operations(&plan);

        assert_eq!(ops.len(), 2, "une destination, un appel");
        assert!(ops.contains(&OperationGmail::ModifierLibelles {
            ids: vec!["m1".into(), "m3".into()],
            ajouter: vec!["L1".into()],
            retirer: vec![libelles::INBOX.to_string()],
        }));
        assert!(ops.contains(&OperationGmail::ModifierLibelles {
            ids: vec!["m2".into()],
            ajouter: Vec::new(),
            retirer: vec![libelles::INBOX.to_string()],
        }));
    }

    #[test]
    fn un_plan_vide_ne_produit_aucun_appel() {
        assert!(operations(&[]).is_empty());
    }

    #[test]
    fn les_archivages_sont_regroupes_en_un_seul_appel() {
        // C'est tout l'intérêt de `batchModify` : deux cents messages archivés
        // coûtent un appel, pas deux cents.
        let plan: Vec<_> = (0..200)
            .map(|n| {
                entree(
                    &format!("m{n}"),
                    ActionPlanifiee::RetirerDeLaBoiteDeReception,
                )
            })
            .collect();

        let ops = operations(&plan);

        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].nombre_de_messages(), 200);
    }

    #[test]
    fn l_archivage_retire_la_boite_de_reception_et_rien_d_autre() {
        let ops = operations(&[entree("m1", ActionPlanifiee::RetirerDeLaBoiteDeReception)]);

        assert_eq!(
            ops,
            [OperationGmail::ModifierLibelles {
                ids: vec!["m1".into()],
                ajouter: Vec::new(),
                retirer: vec![libelles::INBOX.into()],
            }]
        );
    }

    #[test]
    fn le_resume_puis_archivage_partage_le_lot_d_archivage() {
        // Côté Gmail, les deux actions sont le même appel : le résumé est produit
        // ailleurs. Les séparer doublerait le coût sans rien changer.
        let plan = vec![
            entree("m1", ActionPlanifiee::RetirerDeLaBoiteDeReception),
            entree("m2", ActionPlanifiee::ResumerPuisArchiver),
        ];

        let ops = operations(&plan);

        assert_eq!(ops.len(), 1);
        assert_eq!(ids_archives(&ops), [vec!["m1", "m2"]]);
    }

    #[test]
    fn chaque_mise_a_la_corbeille_est_un_appel_distinct() {
        // `trash` ne traite qu'un message ; `batchDelete` existe mais supprime
        // définitivement.
        let plan = vec![
            entree("m1", ActionPlanifiee::MettreALaCorbeille),
            entree("m2", ActionPlanifiee::MettreALaCorbeille),
        ];

        let ops = operations(&plan);

        assert_eq!(
            ops,
            [
                OperationGmail::MettreALaCorbeille { id: "m1".into() },
                OperationGmail::MettreALaCorbeille { id: "m2".into() },
            ]
        );
    }

    #[test]
    fn un_lot_depassant_la_limite_de_l_api_est_decoupe() {
        let plan: Vec<_> = (0..LOT_MAX + 5)
            .map(|n| {
                entree(
                    &format!("m{n}"),
                    ActionPlanifiee::RetirerDeLaBoiteDeReception,
                )
            })
            .collect();

        let lots = ids_archives(&operations(&plan));

        assert_eq!(lots.len(), 2);
        assert_eq!(lots[0].len(), LOT_MAX);
        assert_eq!(lots[1].len(), 5);
    }

    #[test]
    fn les_deux_familles_d_actions_coexistent_dans_un_meme_plan() {
        let plan = vec![
            entree("a1", ActionPlanifiee::RetirerDeLaBoiteDeReception),
            entree("s1", ActionPlanifiee::MettreALaCorbeille),
            entree("a2", ActionPlanifiee::ResumerPuisArchiver),
        ];

        let ops = operations(&plan);

        assert_eq!(ids_archives(&ops), [vec!["a1", "a2"]]);
        assert!(ops.contains(&OperationGmail::MettreALaCorbeille { id: "s1".into() }));
        assert_eq!(ops.len(), 2);
    }

    #[test]
    fn l_ordre_des_appels_est_deterministe() {
        // Deux exécutions du même plan doivent produire la même séquence : sans
        // ça, un échec partiel est irreproductible et indebogable.
        let plan = vec![
            entree("s1", ActionPlanifiee::MettreALaCorbeille),
            entree("a1", ActionPlanifiee::RetirerDeLaBoiteDeReception),
            entree("s2", ActionPlanifiee::MettreALaCorbeille),
        ];

        assert_eq!(operations(&plan), operations(&plan));
    }

    #[test]
    fn le_plan_conserve_l_ordre_des_messages_dans_un_lot() {
        let plan: Vec<_> = ["z", "a", "m"]
            .iter()
            .map(|id| entree(id, ActionPlanifiee::RetirerDeLaBoiteDeReception))
            .collect();

        assert_eq!(ids_archives(&operations(&plan)), [vec!["z", "a", "m"]]);
    }
}
