//! Type d'erreur unique du backend et sa traduction vers le frontend.
//!
//! Regle de securite centrale : ce qui traverse l'IPC vers le webview ne contient
//! jamais de secret ni d'URL. Le webview affiche du HTML d'e-mail, donc du contenu
//! potentiellement hostile ; tout ce qu'on lui donne doit etre considere comme public.
//! Le detail technique complet reste cote Rust, dans les logs.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("acces au trousseau systeme impossible : {0}")]
    Keyring(#[from] keyring::Error),

    #[error("erreur d'entree/sortie sur {chemin} : {source}")]
    Io {
        chemin: String,
        #[source]
        source: std::io::Error,
    },

    #[error("le fichier de regles est illisible : {0}")]
    FormatRegles(String),

    #[error("aucun compte Gmail connecte")]
    NonAuthentifie,

    #[error("l'API Gmail a repondu {statut}")]
    ApiGmail { statut: u16 },

    #[error("erreur reseau ({0})")]
    Reseau(String),

    #[error("configuration invalide : {0}")]
    Config(String),
}

impl AppError {
    /// Erreur d'E/S annotee du chemin concerne.
    pub fn io(chemin: impl std::fmt::Display, source: std::io::Error) -> Self {
        Self::Io {
            chemin: chemin.to_string(),
            source,
        }
    }

    /// Code machine stable, destine au frontend pour brancher son affichage.
    /// Ne change jamais : le frontend s'y accroche.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Keyring(_) => "TROUSSEAU_INDISPONIBLE",
            Self::Io { .. } => "ERREUR_FICHIER",
            Self::FormatRegles(_) => "REGLES_CORROMPUES",
            Self::NonAuthentifie => "NON_AUTHENTIFIE",
            Self::ApiGmail { .. } => "ERREUR_GMAIL",
            Self::Reseau(_) => "ERREUR_RESEAU",
            Self::Config(_) => "CONFIG_INVALIDE",
        }
    }

    /// Message en francais clair, destine a un utilisateur non technique.
    ///
    /// Volontairement sans detail technique : le public vise ne sait pas quoi
    /// faire d'un code HTTP, et un message vague ne fuite rien.
    pub fn message_utilisateur(&self) -> String {
        match self {
            Self::Keyring(_) => "Impossible d'acceder au trousseau de mots de passe du systeme. \
                 MailFlow ne peut pas conserver votre connexion Gmail en securite."
                .into(),
            Self::Io { .. } => {
                "MailFlow n'a pas pu lire ou ecrire ses fichiers de configuration.".into()
            }
            Self::FormatRegles(_) => {
                "Le fichier de regles est endommage. Vos automatisations n'ont pas pu \
                 etre chargees."
                    .into()
            }
            Self::NonAuthentifie => "Aucun compte Gmail n'est connecte.".into(),
            Self::ApiGmail { .. } => {
                "Gmail n'a pas pu traiter la demande. Reessayez dans quelques instants.".into()
            }
            Self::Reseau(_) => "Connexion impossible. Verifiez votre acces internet.".into(),
            Self::Config(_) => "La configuration de MailFlow est invalide.".into(),
        }
    }
}

/// `reqwest::Error` expose l'URL complete via son `Display`, ce qui peut faire
/// fuiter des parametres de requete dans les logs et vers le frontend. On ne
/// conserve que la nature de la panne.
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        let nature = if e.is_timeout() {
            "delai depasse"
        } else if e.is_connect() {
            "connexion refusee"
        } else if e.is_decode() {
            "reponse illisible"
        } else if e.is_body() {
            "corps de reponse invalide"
        } else {
            "echec de la requete"
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
/// Le `Display` complet, lui, reste cote Rust : c'est a la commande qui echoue de
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
