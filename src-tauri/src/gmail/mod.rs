//! Client de l'API Gmail.
//!
//! Gmail est l'unique source de vérité : aucune base de données locale ne double
//! l'état des messages. Toute action (archiver, supprimer, marquer lu) est un
//! appel d'API, et l'interface reflète ce que Gmail renvoie.
//!
//! # Points d'attention pour l'implémentation
//!
//! - **Quotas.** L'API compte en « unités de quota » par utilisateur et par
//!   seconde, pas en nombre de requêtes : `messages.list` coûte peu, `messages.get`
//!   coûte à chaque message. Récupérer une boîte de plusieurs centaines de mails
//!   impose de passer par `users.messages.batchModify` pour les actions de masse,
//!   et de limiter la concurrence des lectures.
//! - **Format `metadata`.** Le tri (vue 1 contre vue 2) ne dépend que des en-têtes
//!   `From`, `Subject`, `List-Unsubscribe` et des libellés. `format=metadata` avec
//!   `metadataHeaders` évite de télécharger le corps de chaque message, donc du
//!   quota et de la latence.
//! - **Réessais.** Les réponses `429` et `5xx` doivent être rejouées avec un recul
//!   exponentiel et une part d'aléatoire. Les `4xx` autres que `429` ne doivent
//!   jamais l'être : elles ne passeront pas davantage à la seconde tentative.
//! - **Suppression.** Le cahier des charges parle de « supprimer » : c'est
//!   `users.messages.trash`, pas `delete`. La corbeille est réversible pendant
//!   30 jours ; `delete` est définitif et n'a pas sa place dans une action
//!   automatique déclenchée par une règle.
//! - **Corps HTML.** Le contenu d'un message est du HTML hostile par construction.
//!   Il ne doit jamais être injecté dans le DOM de l'application : la vue 1 devra
//!   l'afficher dans une `iframe` en bac à sable, sans accès au contexte parent.

pub mod apercu;
pub mod boite;
pub mod classement;
pub mod client;
pub mod corps;
pub mod execution;
pub mod logos;
pub mod modele;
pub mod reessai;
pub mod synchronisation;
pub mod transport;

pub const BASE_API: &str = "https://gmail.googleapis.com/gmail/v1";

/// En-têtes suffisants au tri, pour éviter de charger les corps de messages.
pub const ENTETES_TRI: &[&str] = &["From", "To", "Cc", "Subject", "Date", "List-Unsubscribe"];

/// Libelles système Gmail utilises par les règles.
pub mod libelles {
    pub const INBOX: &str = "INBOX";
    pub const TRASH: &str = "TRASH";
    pub const SPAM: &str = "SPAM";
    pub const UNREAD: &str = "UNREAD";
    pub const CATEGORIE_PROMOTIONS: &str = "CATEGORY_PROMOTIONS";
    pub const CATEGORIE_SOCIAL: &str = "CATEGORY_SOCIAL";
    pub const CATEGORIE_UPDATES: &str = "CATEGORY_UPDATES";
}
