//! Ce que les vues reçoivent de la boîte de réception.
//!
//! Le frontend n'obtient jamais un message Gmail brut : il reçoit une forme
//! réduite, déjà classée, sans corps de message. Deux raisons.
//!
//! La première est la sécurité : le corps d'un e-mail est du HTML écrit par un
//! inconnu, et l'injecter dans le DOM de l'application donnerait à cet inconnu
//! la surface de l'application. Il faudra une `iframe` en bac à sable pour
//! l'afficher, ce qui n'est pas encore fait — donc il ne traverse pas l'IPC.
//!
//! La seconde est le coût : lire les corps demande `format=full`, donc le
//! téléchargement de chaque message. Les listes n'en ont pas besoin.

use serde::Serialize;

use super::classement::{CategorieMessage, classer};
use super::client::{ClientGmail, SourceJeton, Transport};
use super::libelles;
use super::modele::MessageMetadata;
use crate::error::Resultat;
use crate::rules::{RuleSet, nom_affiche, normaliser_adresse};

/// Nombre de messages remontés à l'ouverture.
///
/// De quoi remplir les vues sans transformer chaque lancement en relevé complet
/// d'une boîte de plusieurs milliers de messages.
pub const PLAFOND_BOITE: usize = 60;

/// Un message tel que les vues l'affichent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageAffiche {
    pub id: String,

    /// Nom affiché par l'expéditeur. Cosmétique — voir [`nom_affiche`].
    pub nom: String,

    /// Adresse normalisée. C'est elle qui sert à créer une règle.
    pub adresse: String,

    pub sujet: String,

    /// Extrait fourni par Gmail. Du texte, jamais du balisage.
    pub extrait: String,

    /// Date de réception selon Gmail, en RFC 3339.
    pub date: Option<String>,

    pub non_lu: bool,
    pub categorie: CategorieMessage,
}

impl MessageAffiche {
    pub fn depuis(m: &MessageMetadata, regles: &RuleSet) -> Self {
        Self {
            id: m.id.clone(),
            nom: nom_affiche(m.from()),
            adresse: normaliser_adresse(m.from()).unwrap_or_default(),
            sujet: m.sujet().to_string(),
            extrait: m.snippet.clone(),
            date: m.date().map(|d| d.to_rfc3339()),
            non_lu: m.label_ids.iter().any(|l| l == libelles::UNREAD),
            categorie: classer(m, regles),
        }
    }
}

/// Relève la boîte de réception et classe ce qu'elle contient.
pub async fn charger_boite<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
) -> Resultat<Vec<MessageAffiche>> {
    let refs = client.lister("in:inbox", PLAFOND_BOITE).await?;

    let mut boite = Vec::with_capacity(refs.len());
    for reference in &refs {
        match client.metadonnees(&reference.id).await {
            Ok(m) => boite.push(MessageAffiche::depuis(&m, regles)),

            // Le message a bougé entre la liste et la lecture : cas courant sur
            // une boîte vivante. Il manquera à l'affichage, ce n'est pas une
            // raison de ne rien montrer.
            Err(e) => log::info!("message {} illisible, ignoré : {e}", reference.id),
        }
    }

    Ok(boite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::client::tests_support::{ClientDeTest, ok};

    fn metadonnees(json: serde_json::Value) -> MessageMetadata {
        serde_json::from_value(json).unwrap()
    }

    fn message_complet() -> MessageMetadata {
        metadonnees(serde_json::json!({
            "id": "m1",
            "threadId": "t1",
            "labelIds": ["INBOX", "UNREAD"],
            "snippet": "Je t'envoie la version corrigée du devis.",
            "internalDate": "1699999999000",
            "payload": {"headers": [
                {"name": "From", "value": "\"Karim Belhadj\" <Karim.Belhadj@Atelier-Nord.fr>"},
                {"name": "Subject", "value": "Devis atelier"}
            ]}
        }))
    }

    #[test]
    fn le_message_affiche_separe_le_nom_de_l_adresse() {
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default());

        assert_eq!(a.nom, "Karim Belhadj");
        // Normalisée : c'est elle qui servira à créer une règle.
        assert_eq!(a.adresse, "karim.belhadj@atelier-nord.fr");
        assert_eq!(a.sujet, "Devis atelier");
        assert_eq!(a.extrait, "Je t'envoie la version corrigée du devis.");
    }

    #[test]
    fn le_libelle_unread_devient_l_etat_non_lu() {
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default());
        assert!(a.non_lu);

        let lu = metadonnees(serde_json::json!({
            "id": "m2", "threadId": "t1", "labelIds": ["INBOX"]
        }));
        assert!(!MessageAffiche::depuis(&lu, &RuleSet::default()).non_lu);
    }

    #[test]
    fn la_date_est_rendue_en_rfc_3339() {
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default());

        assert!(a.date.as_deref().unwrap().starts_with("2023-11-14T"));
    }

    #[test]
    fn un_message_sans_entete_reste_affichable() {
        // Message tronqué ou format inattendu : la vue doit pouvoir le montrer
        // plutôt que de faire échouer tout le chargement.
        let nu = metadonnees(serde_json::json!({"id": "m3", "threadId": "t1"}));

        let a = MessageAffiche::depuis(&nu, &RuleSet::default());

        assert_eq!(a.adresse, "");
        assert_eq!(a.sujet, "");
        assert!(a.date.is_none());
    }

    #[test]
    fn aucun_corps_de_message_ne_traverse_l_ipc() {
        // Le corps est du HTML écrit par un inconnu. Tant qu'il n'y a pas
        // d'iframe en bac à sable pour l'afficher, il ne sort pas du backend.
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default());

        let json = serde_json::to_string(&a).unwrap();
        assert!(!json.contains("payload"));
        assert!(!json.contains("body"));
        assert!(!json.contains("corps"));
    }

    #[tokio::test(start_paused = true)]
    async fn une_boite_vide_ne_remonte_aucun_message() {
        let c = ClientDeTest::avec(vec![ok(r#"{"resultSizeEstimate":0}"#)]);

        let boite = charger_boite(&c.client, &RuleSet::default()).await.unwrap();

        assert!(boite.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn la_boite_est_relevee_puis_classee() {
        let c = ClientDeTest::avec(vec![
            ok(&serde_json::json!({
                "messages": [{"id": "m1", "threadId": "t1"}, {"id": "m2", "threadId": "t2"}]
            })
            .to_string()),
            ok(&serde_json::json!({
                "id": "m1", "threadId": "t1", "labelIds": ["INBOX", "CATEGORY_PROMOTIONS"],
                "payload": {"headers": [{"name": "From", "value": "promo@offres.fr"}]}
            })
            .to_string()),
            ok(&serde_json::json!({
                "id": "m2", "threadId": "t2", "labelIds": ["INBOX"],
                "payload": {"headers": [{"name": "From", "value": "karim@atelier.fr"}]}
            })
            .to_string()),
        ]);

        let boite = charger_boite(&c.client, &RuleSet::default()).await.unwrap();

        assert_eq!(boite.len(), 2);
        assert_eq!(boite[0].categorie, CategorieMessage::Publicite);
        assert_eq!(boite[1].categorie, CategorieMessage::Humain);
        assert!(c.urls()[0].contains("in%3Ainbox"), "url : {}", c.urls()[0]);
    }

    #[tokio::test(start_paused = true)]
    async fn un_message_illisible_est_saute_sans_faire_echouer_le_reste() {
        let c = ClientDeTest::avec(vec![
            ok(&serde_json::json!({
                "messages": [{"id": "disparu", "threadId": "t1"}, {"id": "m2", "threadId": "t2"}]
            })
            .to_string()),
            crate::gmail::client::tests_support::echec(
                404,
                r#"{"error":{"code":404,"message":"Not Found"}}"#,
            ),
            ok(&serde_json::json!({
                "id": "m2", "threadId": "t2", "labelIds": ["INBOX"],
                "payload": {"headers": [{"name": "From", "value": "karim@atelier.fr"}]}
            })
            .to_string()),
        ]);

        let boite = charger_boite(&c.client, &RuleSet::default()).await.unwrap();

        assert_eq!(boite.len(), 1);
        assert_eq!(boite[0].id, "m2");
    }
}
