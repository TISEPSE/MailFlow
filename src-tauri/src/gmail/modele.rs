//! Ce que l'API Gmail renvoie, et ce qu'on en retient.
//!
//! Tout ce qui vient d'ici est écrit par des tiers inconnus : en-têtes, sujets,
//! extraits. Rien n'est interprété comme du balisage, et la comparaison
//! d'expéditeurs passe par [`crate::rules::normaliser_adresse`], jamais par la
//! chaîne brute.
//!
//! Les structures sont tolérantes par construction : Gmail omet les champs vides
//! plutôt que de les rendre nuls. Une boîte sans résultat ne renvoie pas
//! `"messages": []` mais rien du tout, et un `payload` peut manquer selon le
//! format demandé. Chaque champ optionnel ici correspond à un cas réel.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::rules::MessageResume;

/// Reponse de `users.messages.list`.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReponseListe {
    /// Absent — et non vide — quand la recherche ne ramène rien.
    #[serde(default)]
    pub messages: Vec<RefMessage>,

    /// Présent tant qu'il reste des pages à demander.
    pub next_page_token: Option<String>,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefMessage {
    pub id: String,
    pub thread_id: String,
}

/// Reponse de `users.messages.get` en `format=metadata`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageMetadata {
    pub id: String,
    pub thread_id: String,

    #[serde(default)]
    pub label_ids: Vec<String>,

    /// Extrait fourni par Gmail. Contient des entités HTML (`&#39;`) : c'est du
    /// texte, à afficher comme tel, jamais à injecter comme du balisage.
    #[serde(default)]
    pub snippet: String,

    /// Millisecondes depuis l'époque Unix, en chaîne. Fait autorité sur l'en-tête
    /// `Date`, que l'expéditeur choisit librement et falsifie sans effort.
    pub internal_date: Option<String>,

    pub payload: Option<Charge>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Charge {
    #[serde(default)]
    pub headers: Vec<Entete>,

    /// Absents en `format=metadata`, présents en `format=full`. Le tri n'en a
    /// pas besoin ; l'affichage du corps, si.
    #[serde(default)]
    pub mime_type: Option<String>,

    /// Non vide pour une pièce jointe. C'est ce qui la distingue du corps.
    #[serde(default)]
    pub filename: Option<String>,

    #[serde(default)]
    pub body: Option<CorpsPartie>,

    #[serde(default)]
    pub parts: Vec<Charge>,
}

/// Contenu d'une partie MIME, encodé en `base64url`.
///
/// Gmail met les petites parties en ligne dans `data` et les grosses derrière
/// un `attachmentId`, à récupérer par un appel séparé. Les images intégrées à
/// un message sont presque toujours dans le second cas.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpsPartie {
    #[serde(default)]
    pub data: Option<String>,

    #[serde(default)]
    pub attachment_id: Option<String>,
}

/// Réponse de `users.labels.list`.
#[derive(Debug, Default, Deserialize)]
pub struct ReponseLibelles {
    #[serde(default)]
    pub labels: Vec<LibelleGmail>,
}

/// Un libellé Gmail.
///
/// `type` vaut `user` pour ceux que l'utilisateur a créés et `system` pour ceux
/// que Gmail impose — `INBOX`, `SPAM`, `CATEGORY_PROMOTIONS`… Ranger un message
/// dans l'un de ces derniers n'aurait pas de sens : ce sont des états, pas des
/// dossiers.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibelleGmail {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default)]
    pub genre: String,
}

/// Réponse de `users.messages.attachments.get`.
#[derive(Debug, Deserialize)]
pub struct PieceJointe {
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct Entete {
    pub name: String,
    pub value: String,
}

/// Corps d'erreur des API Google.
///
/// Le motif importe pour décider d'un réessai : Gmail répond `403` aussi bien
/// pour un dépassement de quota — passager, à rejouer — que pour un refus de
/// permission — définitif. Seul le `reason` les distingue.
#[derive(Debug, Deserialize)]
pub struct ReponseErreur {
    pub error: DetailErreur,
}

#[derive(Debug, Deserialize)]
pub struct DetailErreur {
    pub code: u16,
    pub message: String,
    #[serde(default)]
    pub errors: Vec<CauseErreur>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CauseErreur {
    pub reason: Option<String>,
    pub domain: Option<String>,
}

impl ReponseErreur {
    /// Motif machine (`userRateLimitExceeded`, `insufficientPermissions`, ...).
    pub fn motif(&self) -> Option<&str> {
        self.error
            .errors
            .iter()
            .find_map(|c| c.reason.as_deref())
            .or(self.error.status.as_deref())
    }
}

impl MessageMetadata {
    /// Valeur d'un en-tête, insensible à la casse.
    ///
    /// La RFC 5322 rend les noms d'en-tête insensibles à la casse. Gmail renvoie
    /// habituellement `From`, mais s'appuyer sur cette habitude ferait dépendre
    /// le tri d'un détail que la norme n'impose pas.
    pub fn entete(&self, nom: &str) -> Option<&str> {
        self.payload
            .as_ref()?
            .headers
            .iter()
            .find(|e| e.name.eq_ignore_ascii_case(nom))
            .map(|e| e.value.as_str())
    }

    /// En-tête `From` brut, ou chaîne vide s'il manque.
    pub fn from(&self) -> &str {
        self.entete("From").unwrap_or_default()
    }

    pub fn sujet(&self) -> &str {
        self.entete("Subject").unwrap_or_default()
    }

    /// Date de réception selon Gmail.
    pub fn date(&self) -> Option<DateTime<Utc>> {
        let millisecondes: i64 = self.internal_date.as_ref()?.parse().ok()?;
        DateTime::from_timestamp_millis(millisecondes)
    }

    /// Vrai quand le message porte un en-tête de désabonnement.
    ///
    /// Signal utile au classement : une newsletter en a un, une personne qui
    /// écrit n'en a pas.
    pub fn est_diffusion(&self) -> bool {
        self.entete("List-Unsubscribe").is_some()
    }

    /// Reduit le message à ce dont le moteur de règles a besoin.
    pub fn en_resume(&self) -> MessageResume {
        MessageResume {
            id: self.id.clone(),
            from: self.from().to_string(),
            labels: self.label_ids.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reponse réelle de `messages.get?format=metadata`, réduite aux champs
    /// que MailFlow lit.
    const MESSAGE: &str = r#"{
        "id": "18c5f0a1b2c3d4e5",
        "threadId": "18c5f0a1b2c3d4e5",
        "labelIds": ["UNREAD", "CATEGORY_PROMOTIONS", "INBOX"],
        "snippet": "Profitez de -20 % jusqu&#39;a dimanche",
        "internalDate": "1699999999000",
        "payload": {
            "headers": [
                {"name": "Delivered-To", "value": "moi@gmail.com"},
                {"name": "From", "value": "\"Offres Tech\" <promo@offres-tech.fr>"},
                {"name": "Subject", "value": "Soldes d'hiver"},
                {"name": "List-Unsubscribe", "value": "<https://offres-tech.fr/d?u=moi>"}
            ]
        }
    }"#;

    fn message() -> MessageMetadata {
        serde_json::from_str(MESSAGE).unwrap()
    }

    #[test]
    fn une_recherche_sans_resultat_ne_contient_aucun_message() {
        // Gmail omet `messages` au lieu de renvoyer un tableau vide. Un champ
        // non optionnel ici ferait échouer la synchronisation d'une boîte propre.
        let r: ReponseListe = serde_json::from_str(r#"{"resultSizeEstimate": 0}"#).unwrap();

        assert!(r.messages.is_empty());
        assert!(r.next_page_token.is_none());
    }

    #[test]
    fn une_liste_expose_ses_references_et_le_jeton_de_page_suivante() {
        let brut = r#"{
            "messages": [
                {"id": "a1", "threadId": "t1"},
                {"id": "a2", "threadId": "t1"}
            ],
            "nextPageToken": "07123",
            "resultSizeEstimate": 201
        }"#;

        let r: ReponseListe = serde_json::from_str(brut).unwrap();

        assert_eq!(r.messages.len(), 2);
        assert_eq!(r.messages[0].id, "a1");
        assert_eq!(r.next_page_token.as_deref(), Some("07123"));
    }

    #[test]
    fn les_metadonnees_exposent_libelles_et_entetes() {
        let m = message();

        assert_eq!(m.id, "18c5f0a1b2c3d4e5");
        assert_eq!(m.label_ids, ["UNREAD", "CATEGORY_PROMOTIONS", "INBOX"]);
        assert_eq!(m.from(), "\"Offres Tech\" <promo@offres-tech.fr>");
        assert_eq!(m.sujet(), "Soldes d'hiver");
    }

    #[test]
    fn la_recherche_d_entete_ignore_la_casse() {
        // La RFC 5322 l'impose ; Gmail ne garantit pas la casse qu'il renvoie.
        let m = message();

        assert_eq!(m.entete("from"), m.entete("From"));
        assert_eq!(m.entete("LIST-UNSUBSCRIBE"), m.entete("List-Unsubscribe"));
    }

    #[test]
    fn un_entete_absent_rend_une_chaine_vide_plutot_qu_une_panique() {
        let brut = r#"{"id": "a1", "threadId": "t1", "payload": {"headers": []}}"#;
        let m: MessageMetadata = serde_json::from_str(brut).unwrap();

        assert_eq!(m.from(), "");
        assert_eq!(m.sujet(), "");
    }

    #[test]
    fn un_message_sans_payload_reste_exploitable() {
        // `format=minimal` n'en renvoie pas ; un message peut aussi arriver
        // tronqué. Le moteur doit pouvoir continuer.
        let brut = r#"{"id": "a1", "threadId": "t1", "labelIds": ["INBOX"]}"#;
        let m: MessageMetadata = serde_json::from_str(brut).unwrap();

        assert_eq!(m.from(), "");
        assert_eq!(m.en_resume().labels, ["INBOX"]);
    }

    #[test]
    fn la_date_de_reception_vient_de_gmail_et_non_de_l_expediteur() {
        let m = message();

        let d = m.date().expect("date attendue");
        assert_eq!(d.timestamp(), 1_699_999_999);
    }

    #[test]
    fn une_date_interne_absente_ou_illisible_rend_none() {
        let brut = r#"{"id": "a1", "threadId": "t1", "internalDate": "pas-un-nombre"}"#;
        let m: MessageMetadata = serde_json::from_str(brut).unwrap();
        assert!(m.date().is_none());

        let brut = r#"{"id": "a1", "threadId": "t1"}"#;
        let m: MessageMetadata = serde_json::from_str(brut).unwrap();
        assert!(m.date().is_none());
    }

    #[test]
    fn un_en_tete_de_desabonnement_signale_une_diffusion() {
        assert!(message().est_diffusion());

        let brut = r#"{"id": "a1", "threadId": "t1", "payload": {"headers": [
            {"name": "From", "value": "collegue@entreprise.fr"}
        ]}}"#;
        let m: MessageMetadata = serde_json::from_str(brut).unwrap();
        assert!(!m.est_diffusion());
    }

    #[test]
    fn le_motif_d_erreur_distingue_le_quota_de_la_permission() {
        let quota = r#"{"error": {"code": 403, "message": "User Rate Limit Exceeded",
            "errors": [{"message": "x", "domain": "usageLimits",
                        "reason": "userRateLimitExceeded"}],
            "status": "PERMISSION_DENIED"}}"#;
        let e: ReponseErreur = serde_json::from_str(quota).unwrap();
        assert_eq!(e.motif(), Some("userRateLimitExceeded"));
        assert_eq!(e.error.code, 403);

        // Format récent : plus de tableau `errors`, seulement `status`.
        let permission = r#"{"error": {"code": 403, "message": "Insufficient Permission",
            "status": "PERMISSION_DENIED"}}"#;
        let e: ReponseErreur = serde_json::from_str(permission).unwrap();
        assert_eq!(e.motif(), Some("PERMISSION_DENIED"));
    }

    #[test]
    fn le_resume_ne_retient_que_ce_dont_le_moteur_a_besoin() {
        let m = message();

        let r = m.en_resume();
        assert_eq!(r.id, "18c5f0a1b2c3d4e5");
        assert_eq!(r.from, "\"Offres Tech\" <promo@offres-tech.fr>");
        assert_eq!(r.labels, ["UNREAD", "CATEGORY_PROMOTIONS", "INBOX"]);
    }
}
