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

use serde::{Deserialize, Serialize};

use super::classement::{CategorieMessage, classer};
use super::client::{ClientGmail, SourceJeton, Transport};
use super::libelles;
use super::modele::MessageMetadata;
use crate::error::Resultat;
use crate::rules::{RuleSet, decouper_destinataires, nom_affiche, normaliser_adresse};

/// Nombre de messages remontés à l'ouverture.
///
/// De quoi remplir les vues sans transformer chaque lancement en relevé complet
/// d'une boîte de plusieurs milliers de messages.
pub const PLAFOND_BOITE: usize = 60;

/// Une personne désignée par un en-tête d'adresse.
///
/// Le nom est cosmétique et l'adresse fait foi, pour la raison habituelle : le
/// nom affiché est écrit par l'expéditeur.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Contact {
    pub nom: String,
    pub adresse: String,
}

impl Contact {
    /// Lit une entrée d'en-tête de la forme `"Nom" <adresse@x.fr>`.
    ///
    /// Rend `None` quand rien d'exploitable n'en sort : mieux vaut un
    /// destinataire de moins qu'une ligne vide dans l'en-tête de lecture.
    fn depuis(entree: &str) -> Option<Self> {
        Some(Self {
            nom: nom_affiche(entree),
            adresse: normaliser_adresse(entree)?,
        })
    }

    fn liste(entete: &str) -> Vec<Self> {
        decouper_destinataires(entete)
            .iter()
            .filter_map(|e| Self::depuis(e))
            .collect()
    }
}

/// Un message tel que les vues l'affichent.
///
/// `Deserialize` autant que `Serialize` : c'est cette forme-là qui est rangée
/// sur le disque entre deux lancements, voir [`crate::cache`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageAffiche {
    pub id: String,

    /// Nom affiché par l'expéditeur. Cosmétique — voir [`nom_affiche`].
    pub nom: String,

    /// Adresse normalisée. C'est elle qui sert à créer une règle.
    pub adresse: String,

    /// Destinataires visibles, en-tête `To`.
    pub destinataires: Vec<Contact>,

    /// Personnes en copie, en-tête `Cc`. La copie cachée n'y figure pas.
    pub copies: Vec<Contact>,

    pub sujet: String,

    /// Extrait fourni par Gmail. Du texte, jamais du balisage.
    pub extrait: String,

    /// Date de réception selon Gmail, en RFC 3339.
    pub date: Option<String>,

    pub non_lu: bool,
    pub categorie: CategorieMessage,

    /// Adresse du compte qui a reçu ce message.
    ///
    /// Sans intérêt tant qu'on regarde une boîte à la fois ; indispensable dès
    /// que la vue les mélange, où rien d'autre ne dit d'où vient un message.
    pub compte: String,

    /// Libellés posés par l'utilisateur, sans ceux du système.
    ///
    /// C'est ce qui fait les tas de la table des archives : un tas **est** un
    /// libellé Gmail, et non un rangement propre à MailFlow. Le classement
    /// survit ainsi à la machine, se retrouve sur le téléphone, et reste vrai
    /// même si MailFlow disparaît.
    ///
    /// `default` parce que le champ est arrivé après coup : un cache écrit par
    /// une version antérieure doit continuer à se relire, sinon la première
    /// ouverture après mise à jour montre une boîte vide.
    #[serde(default)]
    pub libelles: Vec<String>,
}

/// Les libellés que l'utilisateur a posés lui-même, parmi tous ceux du message.
///
/// Gmail mêle dans la même liste ses propres marques — `INBOX`, `UNREAD`,
/// `CATEGORY_PROMOTIONS`, `IMPORTANT` — et les libellés créés à la main. Les
/// siens portent un identifiant en toutes lettres ; ceux de l'utilisateur un
/// identifiant de la forme `Label_17`. C'est la seule distinction que l'API
/// offre, et elle est stable.
pub fn libelles_de_l_utilisateur(tous: &[String]) -> Vec<String> {
    tous.iter()
        .filter(|l| l.starts_with("Label_"))
        .cloned()
        .collect()
}

/// Ce que **Gmail** a posé sur un message, par opposition à l'utilisateur.
///
/// Sert au journal, et à une question précise : d'où viennent les messages
/// qu'on trouve sur la table des archives sans se souvenir de les y avoir mis.
/// La réponse est dans ces marques — `CATEGORY_PROMOTIONS` trahit un tri
/// automatique de Gmail, `IMPORTANT` un classement par son modèle, et aucune
/// marque du tout signifie que quelqu'un a archivé le message à la main, un
/// jour, depuis n'importe quel client.
fn marques_du_systeme(tous: &[String]) -> Vec<String> {
    tous.iter()
        .filter(|l| !l.starts_with("Label_") && *l != "UNREAD")
        .cloned()
        .collect()
}

/// Compte les marques de Gmail sur un relevé, pour le journal.
///
/// Rend « CATEGORY_PROMOTIONS×5, IMPORTANT×2, sans marque×6 » : de quoi
/// répondre à « d'où sortent ces messages » sans rien journaliser du contenu,
/// ni un sujet, ni une adresse.
pub fn compter_les_marques(messages: &[(String, Vec<String>)]) -> String {
    use std::collections::BTreeMap;

    let mut comptes: BTreeMap<String, usize> = BTreeMap::new();
    for (_, labels) in messages {
        let marques = marques_du_systeme(labels);
        if marques.is_empty() {
            *comptes.entry("sans marque".into()).or_default() += 1;
        }
        for m in marques {
            *comptes.entry(m).or_default() += 1;
        }
    }

    comptes
        .into_iter()
        .map(|(nom, n)| format!("{nom}×{n}"))
        .collect::<Vec<_>>()
        .join(", ")
}

impl MessageAffiche {
    pub fn depuis(m: &MessageMetadata, regles: &RuleSet, compte: &str) -> Self {
        Self {
            id: m.id.clone(),
            nom: nom_affiche(m.from()),
            adresse: normaliser_adresse(m.from()).unwrap_or_default(),
            destinataires: Contact::liste(m.to()),
            copies: Contact::liste(m.cc()),
            sujet: m.sujet().to_string(),
            // Gmail échappe son `snippet` pour une page web : affiché tel
            // quel, il montrait « Quelqu&#39;un de Ministère des Armées »,
            // que personne n'a jamais écrit.
            extrait: crate::html::desechapper(&m.snippet),
            date: m.date().map(|d| d.to_rfc3339()),
            non_lu: m.label_ids.iter().any(|l| l == libelles::UNREAD),
            categorie: classer(m, regles),
            compte: compte.to_string(),
            libelles: libelles_de_l_utilisateur(&m.label_ids),
        }
    }
}

/// Requête Gmail de la boîte de réception.
const BOITE_DE_RECEPTION: &str = "in:inbox";

/// Requête Gmail de la table des archives.
///
/// # Ce qui encombrait la table, et ce n'était pas ce que je croyais
///
/// La table s'ouvrait sur cent cinquante-trois tuiles, dont l'écrasante
/// majorité portait le nom de l'utilisateur lui-même : **son propre courrier
/// envoyé**. Gmail le range hors de la boîte de réception, il satisfaisait donc
/// la requête au même titre qu'une facture classée. `-in:sent` est la clause qui
/// manquait, et c'est elle qui règle « il y a beaucoup trop d'archives ».
///
/// J'ai d'abord cru qu'il fallait ne garder que les messages portant un libellé
/// (`has:userlabels`). Le journal a dit non, sans appel : **zéro message relevé**.
/// Ce compte n'a aucun message étiqueté, et la page devenait un cul-de-sac —
/// puisqu'on crée un libellé en posant une tuile sur une autre, une table vide
/// ne permet plus jamais d'en créer un.
///
/// # La définition retenue
///
/// Est une archive ce qui a été **rangé** : sorti de la boîte de réception sans
/// être jeté, et qu'on n'a pas écrit soi-même.
///
/// - `-in:inbox` : ce qui est encore dans la boîte se lit dans les autres pages ;
/// - `-in:sent` : son propre courrier n'est pas un rangement ;
/// - `-in:chats` : les discussions ne sont pas du courrier ;
/// - `-in:trash` : ce qui est jeté n'est pas rangé ;
/// - `-in:spam` : l'utilisateur ne l'a pas choisi ;
/// - `-in:draft` : un brouillon n'appartient qu'à celui qui l'écrit.
///
/// Les libellés gardent tout leur rôle : ceux qui en portent forment les tas.
/// Ils ne décident simplement plus de ce qui a le droit d'être sur la table.
pub const ARCHIVES: &str = "-in:inbox -in:sent -in:chats -in:trash -in:spam -in:draft";

/// Relève la boîte de réception et classe ce qu'elle contient.
pub async fn charger_boite<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    compte: &str,
) -> Resultat<Vec<MessageAffiche>> {
    charger_boite_suivi(client, regles, compte, |_, _| {}).await
}

/// Nombre d'appels menés de front lors du relevé.
///
/// Gmail ne donne pas les en-têtes avec la liste : chaque message demande son
/// propre appel. Soixante messages en file indienne, c'est soixante fois la
/// latence du réseau — une vingtaine de secondes, l'attente la plus longue de
/// l'ouverture.
///
/// Six de front, comme pour les logos ([`crate::gmail::logos`]) : assez pour
/// que le temps total soit gouverné par le débit et non par la latence, assez
/// peu pour rester loin du quota par utilisateur de Gmail. Un dépassement
/// resterait d'ailleurs rattrapé par [`crate::gmail::reessai`], mais mieux vaut
/// ne pas avoir à s'en servir.
pub const PARALLELISME: usize = 6;

/// Relève les messages archivés, les plus récents d'abord.
///
/// Ne classe rien : sur la table des archives, ce qui compte est le libellé
/// posé par l'utilisateur, pas la catégorie devinée à l'arrivée. Les règles
/// sont tout de même passées pour que la tuile porte la même couleur qu'ailleurs
/// — un même message ne doit pas changer d'apparence selon la page.
pub async fn charger_archives<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    compte: &str,
    avance: impl FnMut(usize, usize),
) -> Resultat<Vec<MessageAffiche>> {
    relever(client, regles, compte, ARCHIVES, PLAFOND_ARCHIVES, avance).await
}

/// Combien d'archives on rapporte.
///
/// Plus large que la boîte de réception, et pour une raison de fond : une boîte
/// de réception qu'on tient à jour reste courte, alors que les archives sont
/// faites pour s'accumuler. Mais la table doit rester une table — au-delà de
/// deux cents tuiles, on ne cherche plus, on fouille, et c'est la recherche
/// qu'il faut alors, pas un tableau.
pub const PLAFOND_ARCHIVES: usize = 200;

/// Même relevé, en rendant compte de son avancement.
///
/// `avance` est appelée une première fois avec le total, puis après chaque
/// message.
///
/// Les appels partent par paquets, mais les résultats sont rendus dans l'ordre
/// de départ : `buffered` s'en charge, là où `buffer_unordered` livrerait les
/// messages dans l'ordre d'arrivée du réseau. La boîte serait alors mélangée
/// différemment à chaque relevé, ce qui est exactement ce qu'on ne veut pas.
pub async fn charger_boite_suivi<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    compte: &str,
    avance: impl FnMut(usize, usize),
) -> Resultat<Vec<MessageAffiche>> {
    relever(
        client,
        regles,
        compte,
        BOITE_DE_RECEPTION,
        PLAFOND_BOITE,
        avance,
    )
    .await
}

/// Relève une requête Gmail quelconque et en fait des messages affichables.
///
/// Commun à la boîte de réception et aux archives : seules la requête et la
/// quantité changent, et rien d'autre ne devrait diverger entre les deux. Deux
/// copies de cette boucle auraient fini par se répondre différemment sur un
/// message illisible ou sur l'ordre du résultat.
/// Relève une requête Gmail quelconque, sans compte rendu d'avancement.
///
/// Ouvert au reste du programme parce que la table des archives en a besoin :
/// elle relit ce que l'utilisateur a classé depuis Gmail, ce qui n'est ni la
/// boîte de réception ni un relevé complet.
pub async fn relever_requete<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    compte: &str,
    requete: &str,
    plafond: usize,
) -> Resultat<Vec<MessageAffiche>> {
    relever(client, regles, compte, requete, plafond, |_, _| {}).await
}

async fn relever<T: Transport, J: SourceJeton>(
    client: &ClientGmail<T, J>,
    regles: &RuleSet,
    compte: &str,
    requete: &str,
    plafond: usize,
    mut avance: impl FnMut(usize, usize),
) -> Resultat<Vec<MessageAffiche>> {
    use futures_util::StreamExt;

    let refs = client.lister(requete, plafond).await?;
    let total = refs.len();
    avance(0, total);

    // Le flux porte les identifiants eux-mêmes, et non des emprunts sur la
    // liste : un emprunt obligerait le compilateur à relier la durée de vie de
    // chaque appel à celle de la liste, ce qu'il refuse à travers un flux.
    let identifiants = refs.into_iter().map(|r| r.id);

    let mut lectures = futures_util::stream::iter(identifiants)
        .map(|id| async move {
            let lu = client.metadonnees(&id).await;
            (id, lu)
        })
        .buffered(PARALLELISME);

    let mut boite = Vec::with_capacity(total);
    let mut marques: Vec<(String, Vec<String>)> = Vec::with_capacity(total);
    let mut faits = 0;

    while let Some((id, lu)) = lectures.next().await {
        match lu {
            Ok(m) => {
                marques.push((m.id.clone(), m.label_ids.clone()));
                boite.push(MessageAffiche::depuis(&m, regles, compte));
            }

            // Le message a bougé entre la liste et la lecture : cas courant sur
            // une boîte vivante. Il manquera à l'affichage, ce n'est pas une
            // raison de ne rien montrer.
            Err(e) => log::info!("message {id} illisible, ignoré : {e}"),
        }
        // Compté même en cas d'échec : c'est un message traité de moins à
        // attendre, et la barre ne doit pas rester en arrière.
        faits += 1;
        avance(faits, total);
    }

    // Ce que Gmail a posé sur ces messages, et rien de leur contenu. C'est la
    // seule trace qui réponde à « d'où sortent ces messages » : un tri
    // automatique de Gmail, un classement par son modèle, ou une main qui a
    // archivé un jour depuis n'importe quel client.
    if !boite.is_empty() {
        log::info!(
            "marques Gmail du relevé : {}",
            compter_les_marques(&marques)
        );
    }

    Ok(boite)
}

#[cfg(test)]
mod tests_archives {
    use super::*;

    #[test]
    fn le_courrier_envoye_ne_monte_pas_sur_la_table() {
        // La clause qui règle « il y a beaucoup trop d'archives » : sans elle,
        // la table s'ouvrait sur cent cinquante-trois tuiles dont la plupart
        // étaient les messages que l'utilisateur avait écrits lui-même.
        assert!(
            ARCHIVES.contains("-in:sent"),
            "sans « -in:sent », la table se remplit de son propre courrier"
        );
    }

    #[test]
    fn la_table_n_exige_pas_de_libelle() {
        // Éprouvé une fois, et c'est assez : exiger `has:userlabels` a rendu la
        // page vide sur un compte sans libellé, et donc définitivement vide —
        // on crée un libellé en posant une tuile sur une autre, ce qu'une table
        // sans tuile ne permet plus jamais.
        assert!(
            !ARCHIVES.contains("has:userlabels"),
            "une table vide ne permet plus de créer le moindre tas"
        );
    }

    #[test]
    fn la_requete_des_archives_exclut_ce_qui_n_est_pas_range() {
        // Chaque exclusion manquante ferait apparaître sur la table quelque
        // chose que l'utilisateur n'y a jamais posé — son propre courrier
        // envoyé au premier chef, qu'un libellé de fil suffit à marquer.
        for exclusion in [
            "-in:inbox",
            "-in:sent",
            "-in:chats",
            "-in:trash",
            "-in:spam",
            "-in:draft",
        ] {
            assert!(ARCHIVES.contains(exclusion), "il manque « {exclusion} »");
        }
    }

    #[test]
    fn les_marques_de_gmail_ne_font_pas_des_tas() {
        // `INBOX`, `UNREAD`, `CATEGORY_*` sont posées par Gmail lui-même. Les
        // prendre pour des tas couvrirait la table de piles que personne n'a
        // faites, et « Non lus » n'est pas un rangement.
        let tous = vec![
            "INBOX".to_string(),
            "UNREAD".to_string(),
            "CATEGORY_PROMOTIONS".to_string(),
            "IMPORTANT".to_string(),
            "Label_17".to_string(),
            "Label_3".to_string(),
        ];

        assert_eq!(
            libelles_de_l_utilisateur(&tous),
            vec!["Label_17".to_string(), "Label_3".to_string()]
        );
    }

    #[test]
    fn un_message_sans_libelle_de_l_utilisateur_reste_seul_sur_la_table() {
        assert!(libelles_de_l_utilisateur(&["INBOX".to_string()]).is_empty());
        assert!(libelles_de_l_utilisateur(&[]).is_empty());
    }
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
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default(), "moi@gmail.com");

        assert_eq!(a.nom, "Karim Belhadj");
        // Normalisée : c'est elle qui servira à créer une règle.
        assert_eq!(a.adresse, "karim.belhadj@atelier-nord.fr");
        assert_eq!(a.sujet, "Devis atelier");
        assert_eq!(a.extrait, "Je t'envoie la version corrigée du devis.");
    }

    #[test]
    fn le_libelle_unread_devient_l_etat_non_lu() {
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default(), "moi@gmail.com");
        assert!(a.non_lu);

        let lu = metadonnees(serde_json::json!({
            "id": "m2", "threadId": "t1", "labelIds": ["INBOX"]
        }));
        assert!(!MessageAffiche::depuis(&lu, &RuleSet::default(), "moi@gmail.com").non_lu);
    }

    #[test]
    fn les_destinataires_et_les_copies_sont_rendus_separement() {
        let m = metadonnees(serde_json::json!({
            "id": "m1", "threadId": "t1",
            "payload": {"headers": [
                {"name": "From", "value": "karim@atelier.fr"},
                {"name": "To", "value": "\"Dupont, Marie\" <marie@ecole.fr>, paul@ecole.fr"},
                {"name": "Cc", "value": "Direction <direction@ecole.fr>"}
            ]}
        }));

        let a = MessageAffiche::depuis(&m, &RuleSet::default(), "moi@gmail.com");

        assert_eq!(a.destinataires.len(), 2);
        assert_eq!(a.destinataires[0].nom, "Dupont, Marie");
        assert_eq!(a.destinataires[0].adresse, "marie@ecole.fr");
        assert_eq!(a.destinataires[1].adresse, "paul@ecole.fr");
        assert_eq!(a.copies.len(), 1);
        assert_eq!(a.copies[0].adresse, "direction@ecole.fr");
    }

    #[test]
    fn un_message_sans_destinataire_lisible_rend_des_listes_vides() {
        // Une liste de diffusion masque souvent ses destinataires. La vue doit
        // afficher le message sans prétendre qu'il n'a pas été adressé.
        let m = metadonnees(serde_json::json!({
            "id": "m1", "threadId": "t1",
            "payload": {"headers": [
                {"name": "From", "value": "info@lettre.fr"},
                {"name": "To", "value": "undisclosed-recipients:;"}
            ]}
        }));

        let a = MessageAffiche::depuis(&m, &RuleSet::default(), "moi@gmail.com");

        assert!(a.destinataires.is_empty());
        assert!(a.copies.is_empty());
    }

    #[test]
    fn la_date_est_rendue_en_rfc_3339() {
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default(), "moi@gmail.com");

        assert!(a.date.as_deref().unwrap().starts_with("2023-11-14T"));
    }

    #[test]
    fn un_message_sans_entete_reste_affichable() {
        // Message tronqué ou format inattendu : la vue doit pouvoir le montrer
        // plutôt que de faire échouer tout le chargement.
        let nu = metadonnees(serde_json::json!({"id": "m3", "threadId": "t1"}));

        let a = MessageAffiche::depuis(&nu, &RuleSet::default(), "moi@gmail.com");

        assert_eq!(a.adresse, "");
        assert_eq!(a.sujet, "");
        assert!(a.date.is_none());
    }

    #[test]
    fn aucun_corps_de_message_ne_traverse_l_ipc() {
        // Le corps est du HTML écrit par un inconnu. Tant qu'il n'y a pas
        // d'iframe en bac à sable pour l'afficher, il ne sort pas du backend.
        let a = MessageAffiche::depuis(&message_complet(), &RuleSet::default(), "moi@gmail.com");

        let json = serde_json::to_string(&a).unwrap();
        assert!(!json.contains("payload"));
        assert!(!json.contains("body"));
        assert!(!json.contains("corps"));
    }

    #[tokio::test(start_paused = true)]
    async fn une_boite_vide_ne_remonte_aucun_message() {
        let c = ClientDeTest::avec(vec![ok(r#"{"resultSizeEstimate":0}"#)]);

        let boite = charger_boite(&c.client, &RuleSet::default(), "moi@gmail.com")
            .await
            .unwrap();

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

        let boite = charger_boite(&c.client, &RuleSet::default(), "moi@gmail.com")
            .await
            .unwrap();

        assert_eq!(boite.len(), 2);
        assert_eq!(boite[0].categorie, CategorieMessage::Publicite);
        assert_eq!(boite[1].categorie, CategorieMessage::Humain);
        assert!(c.urls()[0].contains("in%3Ainbox"), "url : {}", c.urls()[0]);
    }

    #[tokio::test(start_paused = true)]
    async fn l_avancement_est_annonce_message_par_message() {
        let c = ClientDeTest::avec(vec![
            ok(&serde_json::json!({
                "messages": [{"id": "m1", "threadId": "t1"}, {"id": "m2", "threadId": "t2"}]
            })
            .to_string()),
            ok(
                &serde_json::json!({"id": "m1", "threadId": "t1", "labelIds": ["INBOX"]})
                    .to_string(),
            ),
            ok(
                &serde_json::json!({"id": "m2", "threadId": "t2", "labelIds": ["INBOX"]})
                    .to_string(),
            ),
        ]);

        let mut etapes = Vec::new();
        charger_boite_suivi(
            &c.client,
            &RuleSet::default(),
            "moi@gmail.com",
            |faits, total| etapes.push((faits, total)),
        )
        .await
        .unwrap();

        // Le total d'abord, pour que la barre existe avant le premier message.
        assert_eq!(etapes, vec![(0, 2), (1, 2), (2, 2)]);
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

        let boite = charger_boite(&c.client, &RuleSet::default(), "moi@gmail.com")
            .await
            .unwrap();

        assert_eq!(boite.len(), 1);
        assert_eq!(boite[0].id, "m2");
    }

    #[tokio::test(start_paused = true)]
    async fn le_reseau_repond_a_l_envers_la_boite_reste_dans_l_ordre() {
        // Les appels partent maintenant à plusieurs de front. C'est le risque
        // propre à ce changement : rien ne garantit que le réseau réponde dans
        // l'ordre où on l'a interrogé, et une boîte qui se réordonne à chaque
        // relevé serait pire que lente.
        //
        // Ici les délais sont décroissants : le dernier message demandé répond
        // le premier, le premier répond le dernier. Un code qui se contenterait
        // de l'ordre d'arrivée rendrait la boîte exactement à l'envers.
        let ids = ["m1", "m2", "m3", "m4", "m5", "m6"];

        let mut reponses = vec![ok(&serde_json::json!({
            "messages": ids.iter().map(|i| serde_json::json!({"id": i, "threadId": "t"}))
                .collect::<Vec<_>>()
        })
        .to_string())];

        for id in ids {
            reponses.push(ok(&serde_json::json!({
                "id": id, "threadId": "t", "labelIds": ["INBOX"],
                "payload": {"headers": [{"name": "From", "value": "karim@atelier.fr"}]}
            })
            .to_string()));
        }

        // Le premier délai est celui de `lister`, qui n'attend pas.
        let delais = vec![0, 600, 500, 400, 300, 200, 100];

        let c = ClientDeTest::avec_delais(reponses, delais);
        let boite = charger_boite(&c.client, &RuleSet::default(), "moi@gmail.com")
            .await
            .unwrap();

        assert_eq!(
            boite.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ids,
            "la boîte doit suivre l'ordre de Gmail, pas celui du réseau"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn les_messages_sont_demandes_de_front_et_non_a_la_queue_leu_leu() {
        // Six messages qui prennent chacun une seconde. En file indienne, le
        // relevé prendrait six secondes ; menés de front, une seule. Le temps
        // est simulé — la mesure est exacte, pas approchée.
        let ids = ["m1", "m2", "m3", "m4", "m5", "m6"];

        let mut reponses = vec![ok(&serde_json::json!({
            "messages": ids.iter().map(|i| serde_json::json!({"id": i, "threadId": "t"}))
                .collect::<Vec<_>>()
        })
        .to_string())];

        for id in ids {
            reponses.push(ok(&serde_json::json!({
                "id": id, "threadId": "t", "labelIds": ["INBOX"],
                "payload": {"headers": [{"name": "From", "value": "karim@atelier.fr"}]}
            })
            .to_string()));
        }

        let delais = vec![0, 1000, 1000, 1000, 1000, 1000, 1000];

        let c = ClientDeTest::avec_delais(reponses, delais);
        let debut = tokio::time::Instant::now();
        let boite = charger_boite(&c.client, &RuleSet::default(), "moi@gmail.com")
            .await
            .unwrap();
        let ecoule = debut.elapsed();

        assert_eq!(boite.len(), 6);
        assert!(
            ecoule < std::time::Duration::from_millis(1500),
            "six messages d'une seconde ont pris {ecoule:?} : ils sont encore en file indienne"
        );
    }
}
