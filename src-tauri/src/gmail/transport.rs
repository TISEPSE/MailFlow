//! Émission HTTP réelle vers l'API Gmail.
//!
//! Volontairement mince : tout ce qui relève d'une décision — quand rejouer,
//! comment paginer, que compter — vit ailleurs et se teste sans réseau. Ici, on
//! ne fait que parler à Google et rapporter ce qu'il répond.

use std::time::Duration;

use super::client::{Methode, ReponseBrute, Transport};
use crate::error::{AppError, Resultat};

/// Au-delà, on considère que Google ne répondra pas.
const DELAI_REQUETE: Duration = Duration::from_secs(30);

/// Interprète l'en-tête `Retry-After`.
///
/// La RFC 9110 en autorise deux formes : un nombre de secondes, ou une date
/// HTTP. Google envoie la première. La seconde est ignorée plutôt que mal
/// devinée — le recul calculé prendra le relais.
fn analyser_retry_after(valeur: &str) -> Option<Duration> {
    valeur.trim().parse::<u64>().ok().map(Duration::from_secs)
}

pub struct TransportHttp {
    http: reqwest::Client,
}

impl TransportHttp {
    pub fn nouveau() -> Resultat<Self> {
        let http = reqwest::Client::builder()
            .timeout(DELAI_REQUETE)
            // L'API Gmail est en HTTPS ; une redirection vers du clair
            // transporterait le jeton d'accès en clair.
            .https_only(true)
            .build()
            .map_err(|e| AppError::Config(format!("client HTTP inutilisable : {e}")))?;

        Ok(Self { http })
    }
}

impl Transport for TransportHttp {
    async fn envoyer(
        &self,
        methode: Methode,
        url: &str,
        corps: Option<String>,
        jeton: &str,
    ) -> Resultat<ReponseBrute> {
        let mut requete = match methode {
            Methode::Get => self.http.get(url),
            Methode::Post => self.http.post(url),
            Methode::Delete => self.http.delete(url),
        }
        .bearer_auth(jeton);

        if let Some(corps) = corps {
            requete = requete
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(corps);
        }

        let reponse = requete.send().await?;

        let statut = reponse.status().as_u16();
        let retry_after = reponse
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(analyser_retry_after);

        // Le corps est lu même en erreur : il porte le motif qui décide du
        // réessai (quota contre permission).
        let corps = reponse.text().await?;

        Ok(ReponseBrute {
            statut,
            corps,
            retry_after,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_retry_after_en_secondes_est_compris() {
        assert_eq!(analyser_retry_after("12"), Some(Duration::from_secs(12)));
        assert_eq!(analyser_retry_after("  3 "), Some(Duration::from_secs(3)));
        assert_eq!(analyser_retry_after("0"), Some(Duration::ZERO));
    }

    #[test]
    fn une_date_http_est_ignoree_plutot_que_mal_devinee() {
        // Le recul calculé prend alors le relais, ce qui vaut mieux qu'une
        // interprétation approximative.
        assert_eq!(analyser_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
    }

    #[test]
    fn une_valeur_absurde_est_ignoree() {
        assert_eq!(analyser_retry_after(""), None);
        assert_eq!(analyser_retry_after("bientot"), None);
        assert_eq!(analyser_retry_after("-5"), None);
    }

    #[test]
    fn le_client_http_se_construit() {
        assert!(TransportHttp::nouveau().is_ok());
    }
}
