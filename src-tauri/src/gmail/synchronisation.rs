//! Le parcours complet : interroger Gmail, planifier, appliquer.
//!
//! # La requête Gmail restreint, elle ne décide pas
//!
//! On pourrait lister toute la boîte de réception et lire les métadonnées de
//! chaque message pour savoir qui l'envoie. Sur une boîte chargée, ça fait des
//! centaines de lectures à chaque lancement, pour n'agir que sur quelques
//! messages.
//!
//! MailFlow demande donc à Gmail de restreindre en amont, une requête par règle
//! active : `in:inbox from:<adresse>`. Seuls les messages ainsi retenus sont lus.
//!
//! **Mais la recherche de Gmail ne fait pas foi.** Son opérateur `from:` est
//! large : il inspecte aussi le nom affiché, que l'expéditeur choisit librement.
//! S'y fier laisserait un tiers déclencher la règle d'un autre en imitant son
//! adresse dans son nom affiché — exactement l'usurpation contre laquelle
//! [`crate::rules::normaliser_adresse`] a été écrite.
//!
//! La requête ne sert donc qu'à réduire le volume. La décision revient toujours
//! au moteur, qui compare l'adresse réelle extraite de l'en-tête `From`. Un
//! message que Gmail a remonté à tort ne déclenche rien.

use std::collections::BTreeSet;

use chrono::{DateTime, Local};

use super::client::{ClientGmail, SourceJeton, Transport};
use super::execution::{RapportExecution, operations};
use crate::error::Resultat;
use crate::rules::{RuleSet, planifier};

/// Nombre maximal de messages retenus par règle et par passe.
///
/// Une règle posée sur un expéditeur très bavard ne doit pas transformer une
/// synchronisation en téléchargement de toute la boîte. Le reliquat sera traité
/// au lancement suivant.
pub const PLAFOND_PAR_REGLE: usize = 200;

/// Construit la requête de restriction pour une adresse.
fn requete_pour(adresse: &str) -> String {
    // Les guillemets empêchent qu'une adresse contenant une espace ou un
    // deux-points soit relue comme plusieurs opérateurs de recherche.
    format!("in:inbox from:\"{}\"", adresse.replace('"', ""))
}

/// Interroge Gmail, calcule le plan, l'applique, et rend le compte.
pub async fn synchroniser<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    maintenant: DateTime<Local>,
) -> Resultat<RapportExecution> {
    // Une adresse par règle active, dédoublonnée : deux règles sur le même
    // expéditeur ne justifient pas deux interrogations.
    let adresses: BTreeSet<String> = regles
        .automations
        .iter()
        .filter(|r| r.active)
        .filter_map(|r| r.cible_normalisee())
        .collect();

    if adresses.is_empty() {
        return Ok(RapportExecution::default());
    }

    let mut candidats: BTreeSet<String> = BTreeSet::new();
    for adresse in &adresses {
        let trouves = client
            .lister(&requete_pour(adresse), PLAFOND_PAR_REGLE)
            .await?;
        candidats.extend(trouves.into_iter().map(|m| m.id));
    }

    let mut messages = Vec::with_capacity(candidats.len());
    for id in &candidats {
        match client.metadonnees(id).await {
            Ok(m) => messages.push(m.en_resume()),

            // Cas courant sur une boîte active : le message a été déplacé ou
            // supprimé entre la liste et la lecture. Ce n'est pas une panne.
            Err(e) => log::info!("message {id} illisible, ignoré : {e}"),
        }
    }

    // C'est ici que la décision se prend, sur l'adresse réelle — la recherche
    // Gmail n'a fait que restreindre le volume.
    let plan = planifier(regles, &messages, maintenant);
    if plan.is_empty() {
        return Ok(RapportExecution::default());
    }

    log::info!(
        "{} action(s) planifiée(s) sur {} message(s)",
        plan.len(),
        messages.len()
    );
    Ok(client.appliquer(&operations(&plan)).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::client::tests_support::{ClientDeTest, echec, ok};
    use crate::rules::{Action, Categorie, Rule};
    use chrono::{NaiveDate, TimeZone};

    fn regle(id: &str, expediteur: &str, action: Action, active: bool) -> Rule {
        Rule {
            id: id.into(),
            expediteur: expediteur.into(),
            nom_affichage: "Peu importe".into(),
            categorie: Categorie::Publicite,
            action,
            active,
            date_ajout: NaiveDate::from_ymd_opt(2026, 8, 14).unwrap(),
            libelle: None,
            frequence: None,
            heure_execution: None,
        }
    }

    fn jeu(regles: Vec<Rule>) -> RuleSet {
        RuleSet {
            automations: regles,
            ..Default::default()
        }
    }

    fn maintenant() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 8, 14, 10, 0, 0).unwrap()
    }

    /// Reponse de `messages.list` pour un seul message.
    fn liste(id: &str) -> String {
        serde_json::json!({"messages": [{"id": id, "threadId": "t1"}]}).to_string()
    }

    /// Reponse de `messages.get` en `format=metadata`.
    fn message(id: &str, from: &str) -> String {
        serde_json::json!({
            "id": id,
            "threadId": "t1",
            "labelIds": ["INBOX"],
            "payload": {"headers": [{"name": "From", "value": from}]}
        })
        .to_string()
    }

    #[tokio::test(start_paused = true)]
    async fn sans_regle_active_aucun_appel_n_est_emis() {
        // Le quota Gmail se consomme aussi en lectures : une boîte sans
        // automatisation ne doit rien coûter.
        let c = ClientDeTest::avec(vec![]);

        let rapport = synchroniser(&c.client, &jeu(vec![]), maintenant())
            .await
            .unwrap();

        assert_eq!(c.appels(), 0);
        assert_eq!(rapport, RapportExecution::default());
    }

    #[tokio::test(start_paused = true)]
    async fn les_regles_inactives_ne_sont_pas_interrogees() {
        let c = ClientDeTest::avec(vec![]);
        let regles = jeu(vec![regle(
            "r1",
            "promo@offres-tech.fr",
            Action::SupprimerToujours,
            false,
        )]);

        synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        assert_eq!(c.appels(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn une_regle_restreint_la_recherche_a_son_expediteur() {
        let c = ClientDeTest::avec(vec![ok(r#"{"resultSizeEstimate":0}"#)]);
        let regles = jeu(vec![regle(
            "r1",
            "promo@offres-tech.fr",
            Action::ArchiverAutomatique,
            true,
        )]);

        synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        let url = &c.urls()[0];
        assert!(url.contains("in%3Ainbox"), "url : {url}");
        assert!(url.contains("promo%40offres-tech.fr"), "url : {url}");
    }

    #[tokio::test(start_paused = true)]
    async fn un_message_correspondant_est_archive() {
        let c = ClientDeTest::avec(vec![
            ok(&liste("m1")),
            ok(&message("m1", "\"Offres\" <promo@offres-tech.fr>")),
            ok(""),
        ]);
        let regles = jeu(vec![regle(
            "r1",
            "promo@offres-tech.fr",
            Action::ArchiverAutomatique,
            true,
        )]);

        let rapport = synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        assert_eq!(rapport.archives, 1);
        assert!(c.urls().last().unwrap().ends_with("batchModify"));
    }

    #[tokio::test(start_paused = true)]
    async fn l_adresse_reelle_prime_sur_ce_que_gmail_a_remonte() {
        // Gmail remonte ce message parce que le nom affiché imite l'adresse
        // visée. L'adresse réelle est autre : aucune action ne doit être prise.
        let c = ClientDeTest::avec(vec![
            ok(&liste("m1")),
            ok(&message(
                "m1",
                r#""promo@offres-tech.fr" <pirate@ailleurs.net>"#,
            )),
        ]);
        let regles = jeu(vec![regle(
            "r1",
            "promo@offres-tech.fr",
            Action::SupprimerToujours,
            true,
        )]);

        let rapport = synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        assert_eq!(rapport, RapportExecution::default());
        assert_eq!(c.appels(), 2, "aucune action ne doit partir");
    }

    #[tokio::test(start_paused = true)]
    async fn deux_regles_sur_la_meme_adresse_ne_font_qu_une_interrogation() {
        // Les deux ne diffèrent que par la casse : après normalisation, c'est le
        // même expéditeur. Interroger Gmail deux fois serait du quota jeté.
        let c = ClientDeTest::avec(vec![
            ok(&liste("m1")),
            ok(&message("m1", "promo@offres-tech.fr")),
            ok("{}"),
        ]);
        let regles = jeu(vec![
            regle(
                "r1",
                "promo@offres-tech.fr",
                Action::ArchiverAutomatique,
                true,
            ),
            regle(
                "r2",
                "PROMO@offres-tech.FR",
                Action::SupprimerToujours,
                true,
            ),
        ]);

        let rapport = synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        // Une liste, une lecture, une action.
        assert_eq!(c.appels(), 3);
        // Et une seule action : la suppression l'emporte sur l'archivage.
        assert_eq!(rapport.mis_a_la_corbeille, 1);
        assert_eq!(rapport.archives, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn deux_expediteurs_distincts_donnent_deux_interrogations() {
        let c = ClientDeTest::avec(vec![
            ok(&liste("m1")),
            ok(&liste("m2")),
            ok(&message("m1", "promo@offres-tech.fr")),
            ok(&message("m2", "news@ailleurs.fr")),
            ok(""),
        ]);
        let regles = jeu(vec![
            regle(
                "r1",
                "promo@offres-tech.fr",
                Action::ArchiverAutomatique,
                true,
            ),
            regle("r2", "news@ailleurs.fr", Action::ArchiverAutomatique, true),
        ]);

        let rapport = synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        // Deux listes, deux lectures, puis un seul lot d'archivage.
        assert_eq!(c.appels(), 5);
        assert_eq!(rapport.archives, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn un_message_illisible_n_interrompt_pas_la_passe() {
        let c = ClientDeTest::avec(vec![
            ok(&liste("m1")),
            echec(404, r#"{"error":{"code":404,"message":"Not Found"}}"#),
        ]);
        let regles = jeu(vec![regle(
            "r1",
            "promo@offres-tech.fr",
            Action::ArchiverAutomatique,
            true,
        )]);

        // Le message a disparu entre la liste et la lecture : cas courant sur une
        // boîte active. La synchronisation aboutit quand même.
        let rapport = synchroniser(&c.client, &regles, maintenant())
            .await
            .unwrap();

        assert_eq!(rapport, RapportExecution::default());
    }
}
