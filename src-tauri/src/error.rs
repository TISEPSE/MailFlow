//! Type d'erreur unique du backend et sa traduction vers le frontend.
//!
//! Règle de sécurité centrale : ce qui traverse l'IPC vers le webview ne contient
//! jamais de secret ni d'URL. Le webview affiche du HTML d'e-mail, donc du contenu
//! potentiellement hostile ; tout ce qu'on lui donne doit être considéré comme public.
//! Le détail technique complet reste côté Rust, dans les logs.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("accès au trousseau système impossible : {0}")]
    Keyring(#[from] keyring::Error),

    #[error("erreur d'entrée/sortie sur {chemin} : {source}")]
    Io {
        chemin: String,
        #[source]
        source: std::io::Error,
    },

    #[error("le fichier de règles est illisible : {0}")]
    FormatRegles(String),

    #[error("aucun compte Gmail connecté")]
    NonAuthentifie,

    /// Le flux OAuth2 n'a pas abouti : refus de l'utilisateur, `state` invalide,
    /// redirection malformée, ou refus de Google à l'échange du code.
    ///
    /// Le détail reste interne : il contient des fragments de protocole (`state`,
    /// codes d'autorisation) qui n'ont rien à faire dans le webview.
    #[error("échec de l'autorisation Google : {0}")]
    Auth(String),

    #[error("l'API Gmail a répondu {statut}")]
    ApiGmail { statut: u16 },

    #[error("erreur réseau ({0})")]
    Reseau(String),

    #[error("configuration invalide : {0}")]
    Config(String),

    /// Le modèle de langage n'a pas produit de résumé exploitable : clé
    /// refusée, quota atteint, refus des filtres, ou réponse hors format.
    ///
    /// Une catégorie à part parce que la conduite à tenir l'est aussi : un
    /// résumé manquant n'est pas une panne, c'est une ligne composée
    /// localement à la place. Rien ne doit s'afficher en rouge.
    #[error("résumé indisponible : {0}")]
    Resume(String),
}

impl AppError {
    /// Erreur d'E/S annotée du chemin concerné.
    pub fn io(chemin: impl std::fmt::Display, source: std::io::Error) -> Self {
        Self::Io {
            chemin: chemin.to_string(),
            source,
        }
    }

    /// Code machine stable, destiné au frontend pour brancher son affichage.
    /// Ne change jamais : le frontend s'y accroche.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Keyring(_) => "TROUSSEAU_INDISPONIBLE",
            Self::Io { .. } => "ERREUR_FICHIER",
            Self::FormatRegles(_) => "REGLES_CORROMPUES",
            Self::NonAuthentifie => "NON_AUTHENTIFIE",
            Self::Auth(_) => "ECHEC_CONNEXION",
            Self::ApiGmail { .. } => "ERREUR_GMAIL",
            Self::Reseau(_) => "ERREUR_RESEAU",
            Self::Config(_) => "CONFIG_INVALIDE",
            Self::Resume(_) => "RESUME_INDISPONIBLE",
        }
    }

    /// Message en français clair, destiné à un utilisateur non technique.
    ///
    /// Volontairement sans détail technique : le public visé ne sait pas quoi
    /// faire d'un code HTTP, et un message vague ne fuite rien.
    pub fn message_utilisateur(&self) -> String {
        match self {
            Self::Keyring(_) => "Impossible d'accéder au trousseau de mots de passe du système. \
                 MailFlow ne peut pas conserver votre connexion Gmail en sécurité."
                .into(),
            Self::Io { .. } => {
                "MailFlow n'a pas pu lire ou écrire ses fichiers de configuration.".into()
            }
            Self::FormatRegles(_) => {
                "Le fichier de règles est endommagé. Vos automatisations n'ont pas pu \
                 être chargées."
                    .into()
            }
            Self::NonAuthentifie => "Aucun compte Gmail n'est connecté.".into(),
            Self::Auth(_) => {
                "La connexion à votre compte Gmail n'a pas abouti. Vous pouvez réessayer.".into()
            }
            Self::ApiGmail { .. } => {
                "Gmail n'a pas pu traiter la demande. Réessayez dans quelques instants.".into()
            }
            Self::Reseau(_) => "Connexion impossible. Vérifiez votre accès internet.".into(),
            Self::Config(_) => "La configuration de MailFlow est invalide.".into(),
            Self::Resume(_) => {
                "Le résumé automatique n'a pas abouti. Le message reste lisible tel quel.".into()
            }
        }
    }
}

/// `reqwest::Error` expose l'URL complète via son `Display`, ce qui peut faire
/// fuiter des paramètres de requête dans les logs et vers le frontend. On ne
/// conserve que la nature de la panne.
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        let nature = if e.is_timeout() {
            "délai dépassé"
        } else if e.is_connect() {
            "connexion refusée"
        } else if e.is_decode() {
            "réponse illisible"
        } else if e.is_body() {
            "corps de réponse invalide"
        } else {
            "échec de la requête"
        };
        Self::Reseau(nature.into())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::FormatRegles(e.to_string())
    }
}

/// Serialisation vers le frontend : `{ code, message }` et rien d'autre.
///
/// Le `Display` complet, lui, reste côté Rust : c'est à la commande qui échoue de
/// le journaliser avant de propager l'erreur.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.message_utilisateur())?;
        s.end()
    }
}

pub type Resultat<T> = std::result::Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_serialisation_ne_contient_que_code_et_message() {
        let err = AppError::ApiGmail { statut: 403 };
        let json = serde_json::to_value(&err).unwrap();

        assert_eq!(json["code"], "ERREUR_GMAIL");
        assert!(json["message"].is_string());
        assert_eq!(json.as_object().unwrap().len(), 2);
    }

    #[test]
    fn le_message_utilisateur_ne_divulgue_pas_le_detail_technique() {
        let err = AppError::Config("client_secret=abc123 invalide".into());
        let json = serde_json::to_string(&err).unwrap();

        assert!(!json.contains("abc123"));
        assert!(!json.contains("client_secret"));
    }

    #[test]
    fn une_erreur_d_autorisation_ne_revele_pas_le_detail_du_protocole() {
        let err = AppError::Auth("state=9f3c2a1b ne correspond pas".into());

        assert_eq!(err.code(), "ECHEC_CONNEXION");

        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("9f3c2a1b"));
        assert!(!json.contains("state"));
    }

    #[test]
    fn une_erreur_io_expose_le_chemin_en_interne_mais_pas_au_frontend() {
        let err = AppError::io(
            "/home/quelquun/.config/MailFlow/regles.json",
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "refuse"),
        );

        assert!(err.to_string().contains("/home/quelquun"));

        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("/home/quelquun"));
    }
}
