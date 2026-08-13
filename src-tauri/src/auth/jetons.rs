//! Jetons d'acces Google : duree de vie et confinement.
//!
//! L'`access_token` vit environ une heure et reste **en memoire uniquement**. Le
//! `refresh_token`, lui, est durable et part dans le trousseau systeme.
//!
//! Ces deux valeurs sont des identifiants porteurs : quiconque les detient parle a
//! Gmail au nom de l'utilisateur. Elles ne doivent apparaitre ni dans les logs, ni
//! dans un message d'erreur, ni dans un `Debug`.

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

use super::MARGE_RENOUVELLEMENT_SECS;

/// Reponse de l'endpoint de jetons de Google.
///
/// `refresh_token` est absent des reponses de renouvellement : Google ne le
/// redonne qu'a la premiere autorisation.
#[derive(Deserialize)]
pub struct ReponseJeton {
    pub access_token: String,
    pub expires_in: i64,
    /// `Option` sans plus : serde traite deja un champ optionnel comme absent
    /// par defaut. Google ne le renvoie qu'a la premiere autorisation.
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

/// Ecrit a la main : le `Debug` derive imprimerait les jetons en clair, et cette
/// structure est precisement celle qu'on est tente de journaliser quand l'echange
/// echoue.
impl std::fmt::Debug for ReponseJeton {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReponseJeton")
            .field("access_token", &"<masque>")
            .field("expires_in", &self.expires_in)
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "<masque>"),
            )
            .field("scope", &self.scope)
            .finish()
    }
}

/// Jetons courants d'une session connectee.
#[derive(Clone)]
pub struct Jetons {
    access_token: String,
    expire_le: DateTime<Utc>,
    refresh_token: Option<String>,
}

impl std::fmt::Debug for Jetons {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Jetons")
            .field("expire_le", &self.expire_le)
            .field("refresh_token_present", &self.refresh_token.is_some())
            .finish_non_exhaustive()
    }
}

impl Jetons {
    /// Convertit une reponse de Google en jetons dates.
    ///
    /// `maintenant` est injecte plutot que lu depuis l'horloge : l'expiration est
    /// de la logique, et de la logique qui lit l'heure n'est pas testable.
    pub fn depuis(reponse: ReponseJeton, maintenant: DateTime<Utc>) -> Self {
        Self {
            access_token: reponse.access_token,
            expire_le: maintenant + Duration::seconds(reponse.expires_in),
            refresh_token: reponse.refresh_token,
        }
    }

    /// Vrai tant que le jeton peut servir a un appel Gmail.
    ///
    /// Faux des qu'on entre dans la marge de renouvellement : un jeton valable
    /// encore dix secondes ne l'est plus quand la requete arrive chez Google.
    pub fn utilisable(&self, maintenant: DateTime<Utc>) -> bool {
        self.expire_le - maintenant > Duration::seconds(MARGE_RENOUVELLEMENT_SECS)
    }

    pub fn access_token(&self) -> &str {
        &self.access_token
    }

    pub fn refresh_token(&self) -> Option<&str> {
        self.refresh_token.as_deref()
    }

    /// Applique une reponse de renouvellement en conservant le `refresh_token`
    /// existant quand Google n'en redonne pas.
    pub fn renouveler(&mut self, reponse: ReponseJeton, maintenant: DateTime<Utc>) {
        self.access_token = reponse.access_token;
        self.expire_le = maintenant + Duration::seconds(reponse.expires_in);
        if reponse.refresh_token.is_some() {
            self.refresh_token = reponse.refresh_token;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCESS: &str = "ya29.secret-acces";
    const REFRESH: &str = "1//0g-secret-renouvellement";

    fn reponse(expires_in: i64, refresh: Option<&str>) -> ReponseJeton {
        ReponseJeton {
            access_token: ACCESS.into(),
            expires_in,
            refresh_token: refresh.map(str::to_string),
            scope: None,
        }
    }

    fn t0() -> DateTime<Utc> {
        "2026-08-13T10:00:00Z".parse().unwrap()
    }

    #[test]
    fn un_jeton_frais_est_utilisable() {
        let jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        assert!(jetons.utilisable(t0()));
        assert!(jetons.utilisable(t0() + Duration::minutes(30)));
    }

    #[test]
    fn un_jeton_expire_n_est_pas_utilisable() {
        let jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        assert!(!jetons.utilisable(t0() + Duration::hours(2)));
    }

    #[test]
    fn un_jeton_qui_expire_dans_la_marge_n_est_pas_utilisable() {
        let jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        // Une seconde avant la marge : encore bon.
        let juste_avant = t0() + Duration::seconds(3600 - MARGE_RENOUVELLEMENT_SECS - 1);
        assert!(jetons.utilisable(juste_avant));

        // Dans la marge : on renouvelle, meme si Google l'accepterait encore.
        let dans_la_marge = t0() + Duration::seconds(3600 - MARGE_RENOUVELLEMENT_SECS + 1);
        assert!(!jetons.utilisable(dans_la_marge));
    }

    #[test]
    fn le_debug_ne_revele_aucun_jeton() {
        let jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        let trace = format!("{jetons:?}");
        assert!(!trace.contains(ACCESS));
        assert!(!trace.contains(REFRESH));
        assert!(!trace.contains("ya29"));
    }

    #[test]
    fn le_debug_de_la_reponse_de_google_ne_revele_aucun_jeton() {
        // Cette reponse traverse la couche reseau : c'est le `Debug` le plus
        // susceptible de finir dans un log au moment d'un echec.
        let trace = format!("{:?}", reponse(3600, Some(REFRESH)));

        assert!(!trace.contains(ACCESS));
        assert!(!trace.contains(REFRESH));
    }

    #[test]
    fn la_reponse_de_google_est_deserialisee() {
        let brut = r#"{
            "access_token": "ya29.abc",
            "expires_in": 3599,
            "refresh_token": "1//0gxyz",
            "scope": "https://www.googleapis.com/auth/gmail.modify",
            "token_type": "Bearer"
        }"#;

        let r: ReponseJeton = serde_json::from_str(brut).unwrap();

        assert_eq!(r.access_token, "ya29.abc");
        assert_eq!(r.expires_in, 3599);
        assert_eq!(r.refresh_token.as_deref(), Some("1//0gxyz"));
    }

    #[test]
    fn une_reponse_de_renouvellement_sans_refresh_token_est_acceptee() {
        // Google ne redonne le `refresh_token` qu'a la premiere autorisation.
        let brut = r#"{"access_token":"ya29.abc","expires_in":3599,"token_type":"Bearer"}"#;

        let r: ReponseJeton = serde_json::from_str(brut).unwrap();

        assert!(r.refresh_token.is_none());
    }

    #[test]
    fn le_renouvellement_conserve_le_refresh_token_existant() {
        let mut jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        jetons.renouveler(reponse(3600, None), t0() + Duration::hours(1));

        assert_eq!(jetons.refresh_token(), Some(REFRESH));
        assert!(jetons.utilisable(t0() + Duration::hours(1)));
    }

    #[test]
    fn le_renouvellement_adopte_un_nouveau_refresh_token_si_google_en_fournit_un() {
        let mut jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        jetons.renouveler(
            reponse(3600, Some("1//0g-nouveau")),
            t0() + Duration::hours(1),
        );

        assert_eq!(jetons.refresh_token(), Some("1//0g-nouveau"));
    }

    #[test]
    fn l_access_token_reste_lisible_pour_les_appels_gmail() {
        let jetons = Jetons::depuis(reponse(3600, Some(REFRESH)), t0());

        assert_eq!(jetons.access_token(), ACCESS);
    }
}
