//! Client de l'API Gmail.
//!
//! Gmail est l'unique source de verite : aucune base de donnees locale ne double
//! l'etat des messages. Toute action (archiver, supprimer, marquer lu) est un
//! appel d'API, et l'interface reflete ce que Gmail renvoie.
//!
//! # Points d'attention pour l'implementation
//!
//! - **Quotas.** L'API compte en « unites de quota » par utilisateur et par
//!   seconde, pas en nombre de requetes : `messages.list` coute peu, `messages.get`
//!   coute a chaque message. Recuperer une boite de plusieurs centaines de mails
//!   impose de passer par `users.messages.batchModify` pour les actions de masse,
//!   et de limiter la concurrence des lectures.
//! - **Format `metadata`.** Le tri (vue 1 contre vue 2) ne depend que des en-tetes
//!   `From`, `Subject`, `List-Unsubscribe` et des libelles. `format=metadata` avec
//!   `metadataHeaders` evite de telecharger le corps de chaque message, donc du
//!   quota et de la latence.
//! - **Reessais.** Les reponses `429` et `5xx` doivent etre rejouees avec un recul
//!   exponentiel et une part d'aleatoire. Les `4xx` autres que `429` ne doivent
//!   jamais l'etre : elles ne passeront pas davantage a la seconde tentative.
//! - **Suppression.** Le cahier des charges parle de « supprimer » : c'est
//!   `users.messages.trash`, pas `delete`. La corbeille est reversible pendant
//!   30 jours ; `delete` est definitif et n'a pas sa place dans une action
//!   automatique declenchee par une regle.
//! - **Corps HTML.** Le contenu d'un message est du HTML hostile par construction.
//!   Il ne doit jamais etre injecte dans le DOM de l'application : la vue 1 devra
//!   l'afficher dans une `iframe` en bac a sable, sans acces au contexte parent.

pub const BASE_API: &str = "https://gmail.googleapis.com/gmail/v1";

/// En-tetes suffisants au tri, pour eviter de charger les corps de messages.
pub const ENTETES_TRI: &[&str] = &["From", "Subject", "Date", "List-Unsubscribe"];

/// Libelles systeme Gmail utilises par les regles.
pub mod libelles {
    pub const INBOX: &str = "INBOX";
    pub const UNREAD: &str = "UNREAD";
    pub const CATEGORIE_PROMOTIONS: &str = "CATEGORY_PROMOTIONS";
    pub const CATEGORIE_SOCIAL: &str = "CATEGORY_SOCIAL";
    pub const CATEGORIE_UPDATES: &str = "CATEGORY_UPDATES";
}
