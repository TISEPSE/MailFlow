//! À quelle vue appartient un message.
//!
//! Le cahier des charges sépare quatre familles : le courrier écrit par une
//! personne, les publicités, les newsletters, les rappels de formation. Gmail ne
//! donne pas cette information — il faut la déduire.
//!
//! # Les règles de l'utilisateur passent avant les heuristiques
//!
//! Si une règle vise déjà l'expéditeur, sa catégorie fait foi. C'est le seul
//! signal dont on soit certain : l'utilisateur l'a posé lui-même. Une heuristique
//! qui contredirait son classement serait vécue comme une erreur, pas comme une
//! aide.
//!
//! Ce n'est qu'en l'absence de règle qu'on devine, et l'ordre compte :
//!
//! 1. Gmail a rangé le message dans `CATEGORY_PROMOTIONS` — c'est son propre
//!    classement commercial, plus fiable que tout ce qu'on pourrait recalculer.
//! 2. Le message porte un en-tête `List-Unsubscribe` — c'est un envoi de masse.
//!    Une personne qui écrit n'en met pas.
//! 3. Sinon, c'est du courrier humain.
//!
//! La formation n'est jamais devinée : rien dans un en-tête ne distingue un
//! rappel de cours d'une autre notification. Elle n'apparaît que si une règle le
//! dit — c'est-à-dire si l'utilisateur l'a rangée là.

use serde::Serialize;

use super::libelles;
use super::modele::MessageMetadata;
use crate::rules::{Categorie, RuleSet};

/// Famille d'affichage d'un message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CategorieMessage {
    Humain,
    Publicite,
    Newsletter,
    Formation,
}

impl From<Categorie> for CategorieMessage {
    fn from(c: Categorie) -> Self {
        match c {
            Categorie::Publicite => Self::Publicite,
            Categorie::Newsletter => Self::Newsletter,
            Categorie::Formation => Self::Formation,
        }
    }
}

/// Range un message dans la vue qui lui revient.
pub fn classer(message: &MessageMetadata, regles: &RuleSet) -> CategorieMessage {
    // `regles_pour` normalise l'adresse et ignore les règles inactives : un nom
    // affiché usurpateur ne déclenche donc pas la règle de quelqu'un d'autre.
    if let Some(regle) = regles.regles_pour(message.from()).first() {
        return regle.categorie.into();
    }

    if message
        .label_ids
        .iter()
        .any(|l| l == libelles::CATEGORIE_PROMOTIONS)
    {
        return CategorieMessage::Publicite;
    }

    if message.est_diffusion() {
        return CategorieMessage::Newsletter;
    }

    CategorieMessage::Humain
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::{Action, Rule};
    use chrono::NaiveDate;

    fn message(from: &str, libelles: &[&str], desabonnement: bool) -> MessageMetadata {
        let mut entetes = vec![serde_json::json!({"name": "From", "value": from})];
        if desabonnement {
            entetes.push(serde_json::json!({
                "name": "List-Unsubscribe", "value": "<https://x.fr/d>"
            }));
        }
        serde_json::from_value(serde_json::json!({
            "id": "m1",
            "threadId": "t1",
            "labelIds": libelles,
            "payload": {"headers": entetes}
        }))
        .unwrap()
    }

    fn jeu(expediteur: &str, categorie: Categorie) -> RuleSet {
        RuleSet {
            automations: vec![Rule {
                id: "r1".into(),
                expediteur: expediteur.into(),
                nom_affichage: "Peu importe".into(),
                categorie,
                action: Action::ArchiverAutomatique,
                active: true,
                date_ajout: NaiveDate::from_ymd_opt(2026, 8, 14).unwrap(),
                libelle: None,
                frequence: None,
                heure_execution: None,
            }],
            ..Default::default()
        }
    }

    #[test]
    fn sans_signal_particulier_c_est_du_courrier_humain() {
        let m = message("Karim <karim@atelier.fr>", &["INBOX"], false);

        assert_eq!(classer(&m, &RuleSet::default()), CategorieMessage::Humain);
    }

    #[test]
    fn le_classement_commercial_de_gmail_est_repris() {
        let m = message(
            "promo@offres.fr",
            &["INBOX", libelles::CATEGORIE_PROMOTIONS],
            false,
        );

        assert_eq!(
            classer(&m, &RuleSet::default()),
            CategorieMessage::Publicite
        );
    }

    #[test]
    fn un_lien_de_desabonnement_designe_une_newsletter() {
        // Une personne qui écrit n'en met pas.
        let m = message("dan@tldr.tech", &["INBOX"], true);

        assert_eq!(
            classer(&m, &RuleSet::default()),
            CategorieMessage::Newsletter
        );
    }

    #[test]
    fn le_classement_de_gmail_prime_sur_le_desabonnement() {
        // Une publicité porte presque toujours les deux signaux.
        let m = message(
            "promo@offres.fr",
            &["INBOX", libelles::CATEGORIE_PROMOTIONS],
            true,
        );

        assert_eq!(
            classer(&m, &RuleSet::default()),
            CategorieMessage::Publicite
        );
    }

    #[test]
    fn une_regle_de_l_utilisateur_prime_sur_toute_heuristique() {
        // Il a rangé cette adresse en formation ; Gmail la voit comme une
        // promotion. C'est lui qui a raison.
        let m = message(
            "notification@openclassrooms.com",
            &["INBOX", libelles::CATEGORIE_PROMOTIONS],
            true,
        );
        let regles = jeu("notification@openclassrooms.com", Categorie::Formation);

        assert_eq!(classer(&m, &regles), CategorieMessage::Formation);
    }

    #[test]
    fn une_regle_desactivee_ne_classe_plus() {
        // Suspendre une règle doit rendre le message à son classement naturel,
        // sans quoi « désactiver » ne voudrait rien dire dans l'interface.
        let mut regles = jeu("promo@offres.fr", Categorie::Formation);
        regles.automations[0].active = false;
        let m = message("promo@offres.fr", &["INBOX"], true);

        assert_eq!(classer(&m, &regles), CategorieMessage::Newsletter);
    }

    #[test]
    fn la_regle_est_reconnue_malgre_un_nom_affiche() {
        let m = message("\"Offres Tech\" <promo@offres.fr>", &["INBOX"], false);
        let regles = jeu("PROMO@OFFRES.FR", Categorie::Publicite);

        assert_eq!(classer(&m, &regles), CategorieMessage::Publicite);
    }

    #[test]
    fn un_nom_affiche_usurpateur_ne_declenche_pas_la_regle_d_autrui() {
        // Le nom imite l'adresse visée par la règle ; l'adresse réelle est autre.
        let m = message(
            "\"notification@openclassrooms.com\" <pirate@ailleurs.net>",
            &["INBOX"],
            false,
        );
        let regles = jeu("notification@openclassrooms.com", Categorie::Formation);

        assert_eq!(classer(&m, &regles), CategorieMessage::Humain);
    }

    #[test]
    fn la_formation_n_est_jamais_devinee() {
        // Aucun en-tête ne distingue un rappel de cours d'une autre
        // notification : sans règle, ce message ne peut pas y atterrir.
        let m = message("notification@openclassrooms.com", &["INBOX"], true);

        assert_ne!(
            classer(&m, &RuleSet::default()),
            CategorieMessage::Formation
        );
    }
}
