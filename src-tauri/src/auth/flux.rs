//! Construction des requêtes OAuth2 et interprétation des réponses de Google.
//!
//! La génération PKCE est déléguée au crate `oauth2` : c'est le seul endroit du
//! flux où une erreur de cryptographie serait invisible et fatale (générateur
//! prévisible, encodage base64url erroné). Le reste — URL d'autorisation, échange
//! de jetons, révocation — est du formulaire HTTP, écrit ici pour rester lisible
//! et pour maîtriser exactement ce qui est envoyé.

use oauth2::{CsrfToken, PkceCodeChallenge, PkceCodeVerifier};
use serde::Deserialize;
use url::Url;

use super::jetons::ReponseJeton;
use super::{SCOPE_EMAIL, SCOPE_GMAIL, URL_AUTORISATION, URL_JETON, URL_REVOCATION};
use crate::error::{AppError, Resultat};

/// Erreur renvoyée par les endpoints OAuth2 de Google.
#[derive(Deserialize)]
struct ErreurOAuth {
    error: String,
}

/// Une tentative de connexion en cours.
///
/// Porte le `code_verifier` et le `state` de cette tentative précise. Deux
/// tentatives simultanées ne doivent jamais partager ces valeurs.
pub struct DemandeAutorisation {
    url: Url,
    verifier: PkceCodeVerifier,
    state: CsrfToken,
    redirect_uri: String,
}

/// Le `Debug` dérivé de `PkceCodeVerifier` et `CsrfToken` imprime les valeurs en
/// clair. L'URL, elle, porte le `code_challenge` et le `state` dans ses
/// paramètres : on n'en garde que l'origine.
impl std::fmt::Debug for DemandeAutorisation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DemandeAutorisation")
            .field("origine", &self.url.origin().ascii_serialization())
            .field("redirect_uri", &self.redirect_uri)
            .finish_non_exhaustive()
    }
}

impl DemandeAutorisation {
    /// Prepare une tentative : PKCE, `state`, et l'URL à ouvrir dans le navigateur.
    pub fn nouvelle(client_id: &str, redirect_uri: String) -> Resultat<Self> {
        let client_id = client_id.trim();
        if client_id.is_empty() {
            return Err(AppError::Config(
                "identifiant client Google absent (MAILFLOW_GOOGLE_CLIENT_ID)".into(),
            ));
        }

        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let state = CsrfToken::new_random();
        let url = url_autorisation(client_id, &redirect_uri, challenge.as_str(), state.secret())?;

        Ok(Self {
            url,
            verifier,
            state,
            redirect_uri,
        })
    }

    /// URL à ouvrir dans le navigateur système.
    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn state(&self) -> &str {
        self.state.secret()
    }

    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }
}

/// Construit l'URL d'autorisation.
fn url_autorisation(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> Resultat<Url> {
    let mut url = Url::parse(URL_AUTORISATION)
        .map_err(|e| AppError::Config(format!("URL d'autorisation invalide : {e}")))?;

    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", &format!("{SCOPE_GMAIL} {SCOPE_EMAIL}"))
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        // Sans quoi Google ne délivre pas de `refresh_token` et l'utilisateur
        // devrait se reconnecter à chaque lancement.
        .append_pair("access_type", "offline")
        // Google ne redonne le `refresh_token` qu'à un consentement explicite.
        // Sans cela, une reconnexion après une révocation resterait sans jeton
        // durable, sans le moindre message d'erreur.
        .append_pair("prompt", "consent");

    Ok(url)
}

/// Traduit une réponse de l'endpoint de jetons.
///
/// Le corps d'erreur de Google contient un `error_description` en anglais, souvent
/// bavard. On n'en retient que le code court : le reste ne sert ni à l'utilisateur,
/// ni au diagnostic.
fn interpreter_reponse(statut: u16, corps: &str) -> Resultat<ReponseJeton> {
    if !(200..300).contains(&statut) {
        let motif = serde_json::from_str::<ErreurOAuth>(corps)
            .map(|e| e.error)
            .unwrap_or_else(|_| "réponse sans code d'erreur".into());
        return Err(AppError::Auth(format!(
            "Google a refusé la demande : {motif} (HTTP {statut})"
        )));
    }

    serde_json::from_str(corps).map_err(|e| {
        // Volontairement sans le corps : il contiendrait les jetons en cas de
        // réponse partiellement valide.
        AppError::Auth(format!("réponse de jetons illisible : {e}"))
    })
}

/// Parametres de formulaire pour l'échange du code contre des jetons.
fn corps_echange(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "authorization_code".into()),
        ("client_id", client_id.into()),
        ("code", code.into()),
        ("code_verifier", verifier.into()),
        ("redirect_uri", redirect_uri.into()),
    ]
}

/// Parametres de formulaire pour le renouvellement de l'`access_token`.
fn corps_renouvellement(client_id: &str, refresh_token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "refresh_token".into()),
        ("client_id", client_id.into()),
        ("refresh_token", refresh_token.into()),
    ]
}

/// Client HTTP dédié aux endpoints OAuth2 de Google.
pub struct ClientOAuth {
    http: reqwest::Client,
    client_id: String,
}

impl ClientOAuth {
    pub fn nouveau(client_id: String) -> Resultat<Self> {
        let client_id = client_id.trim().to_string();
        if client_id.is_empty() {
            return Err(AppError::Config(
                "identifiant client Google absent (MAILFLOW_GOOGLE_CLIENT_ID)".into(),
            ));
        }

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            // Les endpoints OAuth2 de Google sont en HTTPS ; une redirection vers
            // du clair transporterait le code d'autorisation en clair.
            .https_only(true)
            .build()
            .map_err(|e| AppError::Config(format!("client HTTP inutilisable : {e}")))?;

        Ok(Self { http, client_id })
    }

    /// Ouvre une tentative de connexion pour l'URI de redirection donnée.
    pub fn demarrer(&self, redirect_uri: String) -> Resultat<DemandeAutorisation> {
        DemandeAutorisation::nouvelle(&self.client_id, redirect_uri)
    }

    /// Echange le code d'autorisation contre des jetons.
    pub async fn echanger_le_code(
        &self,
        demande: &DemandeAutorisation,
        code: &str,
    ) -> Resultat<ReponseJeton> {
        let corps = corps_echange(
            &self.client_id,
            code,
            demande.verifier.secret(),
            &demande.redirect_uri,
        );
        self.poster(URL_JETON, &corps).await
    }

    /// Renouvelle l'`access_token` à partir du `refresh_token` durable.
    pub async fn renouveler(&self, refresh_token: &str) -> Resultat<ReponseJeton> {
        let corps = corps_renouvellement(&self.client_id, refresh_token);
        self.poster(URL_JETON, &corps).await
    }

    /// Révoque l'autorisation côté Google.
    ///
    /// Se déconnecter sans révoquer laisserait l'autorisation active dans le compte
    /// de l'utilisateur : le bouton « déconnecter » doit couper réellement l'accès,
    /// pas seulement oublier le jeton.
    pub async fn revoquer(&self, jeton: &str) -> Resultat<()> {
        let reponse = self
            .http
            .post(URL_REVOCATION)
            .form(&[("token", jeton)])
            .send()
            .await?;

        if reponse.status().is_success() {
            Ok(())
        } else {
            Err(AppError::Auth(format!(
                "révocation refusée (HTTP {})",
                reponse.status().as_u16()
            )))
        }
    }

    async fn poster(&self, url: &str, corps: &[(&str, String)]) -> Resultat<ReponseJeton> {
        let reponse = self.http.post(url).form(corps).send().await?;
        let statut = reponse.status().as_u16();
        let texte = reponse.text().await?;

        interpreter_reponse(statut, &texte)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENT_ID: &str = "123456789012-abcdef.apps.googleusercontent.com";
    const REDIRECT: &str = "http://127.0.0.1:41234";

    fn demande() -> DemandeAutorisation {
        DemandeAutorisation::nouvelle(CLIENT_ID, REDIRECT.into()).unwrap()
    }

    fn params(url: &Url) -> std::collections::HashMap<String, String> {
        url.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    #[test]
    fn l_url_d_autorisation_pointe_vers_google() {
        let url = demande().url().clone();

        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("accounts.google.com"));
    }

    #[test]
    fn l_url_d_autorisation_porte_le_defi_pkce() {
        let p = params(demande().url());

        assert_eq!(p["response_type"], "code");
        assert_eq!(p["code_challenge_method"], "S256");
        assert!(!p["code_challenge"].is_empty());
        assert_eq!(p["client_id"], CLIENT_ID);
        assert_eq!(p["redirect_uri"], REDIRECT);
    }

    #[test]
    fn l_url_d_autorisation_demande_un_acces_hors_ligne() {
        // Sans `access_type=offline`, Google ne délivre pas de `refresh_token` et
        // l'utilisateur devrait se reconnecter à chaque lancement.
        let p = params(demande().url());

        assert_eq!(p["access_type"], "offline");
        assert_eq!(p["prompt"], "consent");
    }

    #[test]
    fn l_url_d_autorisation_ne_demande_pas_le_droit_d_envoyer_du_courrier() {
        let p = params(demande().url());

        assert!(p["scope"].contains(SCOPE_GMAIL));
        assert!(p["scope"].contains(SCOPE_EMAIL));
        assert!(!p["scope"].contains("gmail.send"));
        assert!(!p["scope"].contains("gmail.compose"));
    }

    #[test]
    fn deux_tentatives_ne_partagent_ni_state_ni_verifier() {
        let (a, b) = (demande(), demande());

        assert_ne!(a.state(), b.state());
        assert_ne!(a.verifier.secret(), b.verifier.secret());
        assert_ne!(
            params(a.url())["code_challenge"],
            params(b.url())["code_challenge"]
        );
    }

    #[test]
    fn le_debug_d_une_demande_ne_revele_ni_le_verifier_ni_le_state() {
        let d = demande();

        let trace = format!("{d:?}");
        assert!(!trace.contains(d.verifier.secret()));
        assert!(!trace.contains(d.state()));
    }

    #[test]
    fn un_client_id_vide_est_une_erreur_de_configuration() {
        // Cas réel : `.env` copié mais jamais rempli.
        let e = DemandeAutorisation::nouvelle("  ", REDIRECT.into()).unwrap_err();

        assert_eq!(e.code(), "CONFIG_INVALIDE");
    }

    #[test]
    fn une_reponse_valide_donne_des_jetons() {
        let corps = r#"{"access_token":"ya29.abc","expires_in":3599,"refresh_token":"1//0g"}"#;

        let r = interpreter_reponse(200, corps).unwrap();

        assert_eq!(r.access_token, "ya29.abc");
        assert_eq!(r.refresh_token.as_deref(), Some("1//0g"));
    }

    #[test]
    fn un_refus_de_google_ne_fait_pas_fuiter_sa_description() {
        let corps = r#"{"error":"invalid_grant",
            "error_description":"Token has been expired or revoked, sub=1029384756"}"#;

        let e = interpreter_reponse(400, corps).unwrap_err();

        // Utile dans les logs.
        assert!(e.to_string().contains("invalid_grant"));
        // Mais ni l'identifiant du compte, ni la prose de Google.
        assert!(!e.to_string().contains("1029384756"));
        assert!(!serde_json::to_string(&e).unwrap().contains("invalid_grant"));
    }

    #[test]
    fn une_reponse_illisible_est_une_erreur() {
        assert!(interpreter_reponse(200, "<html>maintenance</html>").is_err());
        assert!(interpreter_reponse(500, "").is_err());
    }

    #[test]
    fn l_echange_du_code_envoie_le_verifier_et_jamais_de_secret_client() {
        let c = corps_echange(CLIENT_ID, "4/0AX4", "le-verifier", REDIRECT);
        let p: std::collections::HashMap<_, _> = c.into_iter().collect();

        assert_eq!(p["grant_type"], "authorization_code");
        assert_eq!(p["code"], "4/0AX4");
        assert_eq!(p["code_verifier"], "le-verifier");
        assert_eq!(p["redirect_uri"], REDIRECT);
        // Une application de bureau n'a pas de secret : en envoyer un serait
        // prétendre le contraire.
        assert!(!p.contains_key("client_secret"));
    }

    #[test]
    fn le_renouvellement_envoie_le_refresh_token() {
        let c = corps_renouvellement(CLIENT_ID, "1//0g-durable");
        let p: std::collections::HashMap<_, _> = c.into_iter().collect();

        assert_eq!(p["grant_type"], "refresh_token");
        assert_eq!(p["refresh_token"], "1//0g-durable");
        assert!(!p.contains_key("client_secret"));
    }
}
