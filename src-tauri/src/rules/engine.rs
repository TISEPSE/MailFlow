//! Moteur d'application des règles.

use chrono::{DateTime, Datelike, Local, Weekday};

use crate::gmail::libelles;
use crate::rules::model::{Action, Frequence, Rule, RuleSet};

/// Le strict nécessaire au tri : le moteur n'a jamais besoin du corps d'un
/// message, ce qui évite de le télécharger et de le faire transiter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageResume {
    pub id: String,
    /// En-tête `From` brut, tel que renvoyé par Gmail.
    pub from: String,
    /// `labelIds` Gmail du message.
    pub labels: Vec<String>,
}

impl MessageResume {
    fn a_le_libelle(&self, libelle: &str) -> bool {
        self.labels.iter().any(|l| l == libelle)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionPlanifiee {
    MettreALaCorbeille,
    RetirerDeLaBoiteDeReception,
    ResumerPuisArchiver,
}

impl ActionPlanifiee {
    fn depuis(action: Action) -> Self {
        match action {
            Action::SupprimerToujours => Self::MettreALaCorbeille,
            Action::ArchiverAutomatique => Self::RetirerDeLaBoiteDeReception,
            Action::GenererResumeEtArchiver => Self::ResumerPuisArchiver,
        }
    }

    /// Departage les règles qui visent un même message.
    ///
    /// La suppression l'emporte sur tout : l'utilisateur a demandé explicitement
    /// que cet expéditeur disparaisse, et archiver un message qu'on s'apprête à
    /// jeter serait un appel d'API pour rien. Le résumé l'emporte sur l'archivage
    /// simple parce qu'il archive aussi, en faisant davantage.
    fn priorite(self) -> u8 {
        match self {
            Self::MettreALaCorbeille => 2,
            Self::ResumerPuisArchiver => 1,
            Self::RetirerDeLaBoiteDeReception => 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntreePlan {
    pub message_id: String,
    pub action: ActionPlanifiee,
    pub regle_id: String,

    /// Libellé de destination, quand la règle en désigne un.
    pub libelle: Option<String>,
}

/// Une règle récurrente n'agit que dans sa fenêtre d'exécution.
///
/// Pour `tous_les_vendredis` à 18 h, la fenêtre couvre le vendredi de 18 h à
/// minuit : l'utilisateur qui ouvre l'application à 21 h doit voir ses e-mails
/// archivés, conformément au « ou à la réouverture de l'application » du cahier
/// des charges.
///
/// Limite connue : une semaine où l'application n'est pas ouverte le vendredi
/// soir est simplement sautée. Rattraper demanderait de mémoriser la date de
/// dernière exécution, ce qui n'est pas encore fait.
fn fenetre_ouverte(regle: &Rule, maintenant: DateTime<Local>) -> bool {
    let Some(frequence) = regle.frequence else {
        return true;
    };

    match frequence {
        Frequence::TousLesVendredis => {
            if maintenant.weekday() != Weekday::Fri {
                return false;
            }
            match regle.heure_execution {
                Some(heure) => maintenant.time() >= heure,
                None => true,
            }
        }
    }
}

/// Vrai quand l'action changerait réellement l'état du message côté Gmail.
///
/// Chaque entrée du plan devient un appel d'API compte dans le quota. Replanifier
/// un archivage sur un message déjà hors de la boîte, ou une suppression sur un
/// message déjà à la corbeille, ne ferait que consommer ce quota.
fn action_utile(action: ActionPlanifiee, message: &MessageResume) -> bool {
    if message.a_le_libelle(libelles::TRASH) {
        return false;
    }

    match action {
        ActionPlanifiee::MettreALaCorbeille => true,
        ActionPlanifiee::RetirerDeLaBoiteDeReception | ActionPlanifiee::ResumerPuisArchiver => {
            message.a_le_libelle(libelles::INBOX)
        }
    }
}

/// Construit le plan d'actions à appliquer à Gmail.
///
/// Fonction pure : aucun appel réseau, aucune écriture. Le plan peut donc être
/// calculé, affiché à l'utilisateur, puis exécuté — ou pas.
///
/// `maintenant` est passé en paramètre plutôt que lu depuis l'horloge : les
/// règles récurrentes dépendent du jour et de l'heure, et un moteur qui consulte
/// `Local::now()` en interne n'est pas testable.
///
/// Un message ne reçoit **qu'une seule** action, même si plusieurs règles le
/// visent : la plus englobante gagne (voir [`ActionPlanifiee::priorite`]).
pub fn planifier(
    regles: &RuleSet,
    messages: &[MessageResume],
    maintenant: DateTime<Local>,
) -> Vec<EntreePlan> {
    let mut plan = Vec::new();

    for message in messages {
        let retenue = regles
            .regles_pour(&message.from)
            .into_iter()
            .filter(|regle| fenetre_ouverte(regle, maintenant))
            .map(|regle| (ActionPlanifiee::depuis(regle.action), regle))
            .filter(|(action, _)| action_utile(*action, message))
            // `reduce` plutôt que `max_by_key` : ce dernier retient le *dernier*
            // maximum en cas d'égalité, alors qu'on veut la première règle du
            // fichier, pour que le plan ne dépende pas de l'ordre d'insertion.
            .reduce(|retenue, candidate| {
                if candidate.0.priorite() > retenue.0.priorite() {
                    candidate
                } else {
                    retenue
                }
            });

        if let Some((action, regle)) = retenue {
            plan.push(EntreePlan {
                message_id: message.id.clone(),
                action,
                regle_id: regle.id.clone(),
                libelle: regle.libelle.clone(),
            });
        }
    }

    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::model::{Action, Categorie, Frequence, Rule, RuleSet};
    use chrono::{NaiveDate, NaiveTime, TimeZone};

    fn regle(id: &str, expediteur: &str, action: Action) -> Rule {
        Rule {
            id: id.into(),
            expediteur: expediteur.into(),
            nom_affichage: "Test".into(),
            categorie: Categorie::Publicite,
            action,
            active: true,
            date_ajout: NaiveDate::from_ymd_opt(2026, 8, 13).unwrap(),
            libelle: None,
            frequence: None,
            heure_execution: None,
        }
    }

    fn message(id: &str, from: &str) -> MessageResume {
        MessageResume {
            id: id.into(),
            from: from.into(),
            labels: vec!["INBOX".into()],
        }
    }

    #[test]
    fn une_regle_supprimer_toujours_planifie_une_mise_a_la_corbeille() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_01",
                "promo@offres-tech.fr",
                Action::SupprimerToujours,
            )],
            ..Default::default()
        };
        let messages = vec![message("msg_1", "Offres Tech <promo@offres-tech.fr>")];

        let plan = planifier(&regles, &messages, un_lundi());

        assert_eq!(
            plan,
            vec![EntreePlan {
                message_id: "msg_1".into(),
                action: ActionPlanifiee::MettreALaCorbeille,
                regle_id: "rule_01".into(),
                libelle: None,
            }]
        );
    }

    #[test]
    fn une_regle_archiver_automatique_sans_frequence_planifie_un_retrait_de_la_boite() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_02",
                "info@service.fr",
                Action::ArchiverAutomatique,
            )],
            ..Default::default()
        };
        let messages = vec![message("msg_1", "info@service.fr")];

        let plan = planifier(&regles, &messages, un_lundi());

        assert_eq!(
            plan,
            vec![EntreePlan {
                message_id: "msg_1".into(),
                action: ActionPlanifiee::RetirerDeLaBoiteDeReception,
                regle_id: "rule_02".into(),
                libelle: None,
            }]
        );
    }

    #[test]
    fn une_regle_de_newsletter_planifie_un_resume_puis_un_archivage() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_03",
                "dan@tldr.tech",
                Action::GenererResumeEtArchiver,
            )],
            ..Default::default()
        };
        let messages = vec![message("msg_1", "TLDR AI <dan@tldr.tech>")];

        let plan = planifier(&regles, &messages, un_lundi());

        assert_eq!(plan[0].action, ActionPlanifiee::ResumerPuisArchiver);
    }

    #[test]
    fn une_regle_du_vendredi_ne_planifie_rien_un_autre_jour() {
        let plan = planifier(
            &regles_du_vendredi(),
            &[message("msg_1", "f@ocr.com")],
            un_lundi(),
        );

        assert!(plan.is_empty());
    }

    #[test]
    fn une_regle_du_vendredi_ne_planifie_rien_avant_l_heure_prevue() {
        let plan = planifier(
            &regles_du_vendredi(),
            &[message("msg_1", "f@ocr.com")],
            vendredi_a(17, 59),
        );

        assert!(plan.is_empty());
    }

    #[test]
    fn une_regle_du_vendredi_planifie_a_l_heure_prevue() {
        let plan = planifier(
            &regles_du_vendredi(),
            &[message("msg_1", "f@ocr.com")],
            vendredi_a(18, 0),
        );

        assert_eq!(plan[0].action, ActionPlanifiee::RetirerDeLaBoiteDeReception);
    }

    #[test]
    fn une_regle_du_vendredi_planifie_encore_plus_tard_dans_la_soiree() {
        // L'utilisateur peut n'ouvrir l'application qu'après 18 h : la fenêtre
        // reste ouverte jusqu'à la fin du vendredi.
        let plan = planifier(
            &regles_du_vendredi(),
            &[message("msg_1", "f@ocr.com")],
            vendredi_a(23, 30),
        );

        assert_eq!(plan.len(), 1);
    }

    #[test]
    fn deux_regles_sur_le_meme_expediteur_ne_produisent_qu_une_action() {
        let regles = RuleSet {
            automations: vec![
                regle(
                    "rule_a",
                    "promo@offres-tech.fr",
                    Action::ArchiverAutomatique,
                ),
                regle(
                    "rule_b",
                    "promo@offres-tech.fr",
                    Action::ArchiverAutomatique,
                ),
            ],
            ..Default::default()
        };

        let plan = planifier(
            &regles,
            &[message("msg_1", "promo@offres-tech.fr")],
            un_lundi(),
        );

        assert_eq!(plan.len(), 1, "un message ne reçoit qu'une action");
    }

    #[test]
    fn la_suppression_l_emporte_sur_l_archivage() {
        // L'utilisateur a demandé explicitement la suppression de cet expéditeur :
        // archiver puis supprimer gaspillerait un appel d'API pour rien.
        let regles = RuleSet {
            automations: vec![
                regle(
                    "rule_archive",
                    "promo@offres-tech.fr",
                    Action::ArchiverAutomatique,
                ),
                regle(
                    "rule_corbeille",
                    "promo@offres-tech.fr",
                    Action::SupprimerToujours,
                ),
            ],
            ..Default::default()
        };

        let plan = planifier(
            &regles,
            &[message("msg_1", "promo@offres-tech.fr")],
            un_lundi(),
        );

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].action, ActionPlanifiee::MettreALaCorbeille);
        assert_eq!(plan[0].regle_id, "rule_corbeille");
    }

    #[test]
    fn le_resume_l_emporte_sur_l_archivage_simple() {
        // Les deux archivent, mais l'une produit en plus un résumé : la retenir
        // fait le travail des deux.
        let regles = RuleSet {
            automations: vec![
                regle("rule_archive", "dan@tldr.tech", Action::ArchiverAutomatique),
                regle(
                    "rule_resume",
                    "dan@tldr.tech",
                    Action::GenererResumeEtArchiver,
                ),
            ],
            ..Default::default()
        };

        let plan = planifier(&regles, &[message("msg_1", "dan@tldr.tech")], un_lundi());

        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].action, ActionPlanifiee::ResumerPuisArchiver);
    }

    #[test]
    fn un_message_deja_hors_de_la_boite_n_est_pas_archive_a_nouveau() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_02",
                "info@service.fr",
                Action::ArchiverAutomatique,
            )],
            ..Default::default()
        };
        let deja_archive = message_avec_labels("msg_1", "info@service.fr", &[]);

        let plan = planifier(&regles, &[deja_archive], un_lundi());

        assert!(plan.is_empty());
    }

    #[test]
    fn un_message_deja_a_la_corbeille_n_y_est_pas_renvoye() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_01",
                "promo@offres-tech.fr",
                Action::SupprimerToujours,
            )],
            ..Default::default()
        };
        let deja_supprime = message_avec_labels("msg_1", "promo@offres-tech.fr", &["TRASH"]);

        let plan = planifier(&regles, &[deja_supprime], un_lundi());

        assert!(plan.is_empty());
    }

    #[test]
    fn un_message_archive_reste_supprimable() {
        // Une règle de suppression s'applique même hors de la boîte de réception :
        // seule la présence dans la corbeille arrête l'action.
        let regles = RuleSet {
            automations: vec![regle(
                "rule_01",
                "promo@offres-tech.fr",
                Action::SupprimerToujours,
            )],
            ..Default::default()
        };
        let archive = message_avec_labels("msg_1", "promo@offres-tech.fr", &[]);

        let plan = planifier(&regles, &[archive], un_lundi());

        assert_eq!(plan[0].action, ActionPlanifiee::MettreALaCorbeille);
    }

    #[test]
    fn un_message_sans_regle_correspondante_ne_produit_rien() {
        let regles = RuleSet {
            automations: vec![regle(
                "rule_01",
                "promo@offres-tech.fr",
                Action::SupprimerToujours,
            )],
            ..Default::default()
        };

        let plan = planifier(
            &regles,
            &[message("msg_1", "collegue@entreprise.fr")],
            un_lundi(),
        );

        assert!(plan.is_empty());
    }

    fn message_avec_labels(id: &str, from: &str, labels: &[&str]) -> MessageResume {
        MessageResume {
            id: id.into(),
            from: from.into(),
            labels: labels.iter().map(|l| (*l).to_string()).collect(),
        }
    }

    fn regles_du_vendredi() -> RuleSet {
        let mut r = regle("rule_ocr", "f@ocr.com", Action::ArchiverAutomatique);
        r.frequence = Some(Frequence::TousLesVendredis);
        r.heure_execution = NaiveTime::from_hms_opt(18, 0, 0);

        RuleSet {
            automations: vec![r],
            ..Default::default()
        }
    }

    fn un_lundi() -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 8, 10, 9, 0, 0)
            .single()
            .expect("horodatage de test valide")
    }

    fn vendredi_a(heure: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 8, 14, heure, minute, 0)
            .single()
            .expect("horodatage de test valide")
    }
}
