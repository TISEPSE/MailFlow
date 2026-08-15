//! Vérification des mises à jour, auprès des publications GitHub.
//!
//! # Ce que ceci fait, et ce que ceci ne fait pas
//!
//! On demande à GitHub quelle est la dernière version publiée, on la compare à
//! celle du binaire en cours, et on rend l'adresse de la page. **Rien n'est
//! téléchargé ni installé.** L'utilisateur clique, son navigateur s'ouvre, il
//! décide.
//!
//! La mise à jour silencieuse existe chez Tauri, mais elle suppose une paire de
//! clés de signature : l'application accepterait alors d'exécuter un binaire
//! reçu du réseau, sur la seule foi d'une signature. Tant que ces clés ne sont
//! pas en place et gardées correctement, ce serait le chemin le plus court pour
//! transformer une mise à jour en installation d'autre chose.
//!
//! # Confidentialité
//!
//! L'appel ne porte ni jeton, ni identifiant, ni adresse e-mail : c'est une
//! requête publique, la même que pour n'importe quel visiteur du dépôt.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Resultat};

/// Dépôt interrogé. Les publications y sont visibles sans authentification.
const DEPOT: &str = "TISEPSE/MailFlow";

/// Ce que l'interface reçoit d'une vérification.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// Version du binaire en cours.
    pub version_actuelle: String,

    /// Dernière version publiée, ou `None` si le dépôt n'en a aucune.
    pub version_publiee: Option<String>,

    /// Vrai quand la version publiée est postérieure à celle qui tourne.
    pub disponible: bool,

    /// Page de la publication, à ouvrir dans le navigateur.
    pub adresse: Option<String>,
}

/// Ce que GitHub rend, réduit à ce qui nous sert.
#[derive(Debug, Deserialize)]
struct Publication {
    tag_name: String,
    html_url: String,
}

/// Compare deux versions `x.y.z`.
///
/// Écrite plutôt qu'empruntée : la seule règle utile ici est que 0.10.0 vient
/// après 0.9.0, ce qu'une comparaison de chaînes rend faux. Les suffixes de
/// préversion sont ignorés — une préversion ne se propose pas.
pub fn est_posterieure(publiee: &str, actuelle: &str) -> bool {
    fn nombres(v: &str) -> Vec<u32> {
        v.trim_start_matches('v')
            // Coupe au premier tiret : `1.2.0-beta.1` se compare comme 1.2.0.
            .split('-')
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|n| n.parse().unwrap_or(0))
            .collect()
    }

    let (p, a) = (nombres(publiee), nombres(actuelle));
    for rang in 0..p.len().max(a.len()) {
        let (x, y) = (
            p.get(rang).copied().unwrap_or(0),
            a.get(rang).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    false
}

/// Interroge GitHub et compare à la version fournie.
pub async fn verifier(actuelle: &str) -> Resultat<Verification> {
    let url = format!("https://api.github.com/repos/{DEPOT}/releases/latest");

    let reponse = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Reseau(format!("client HTTP indisponible : {e}")))?
        .get(&url)
        // GitHub refuse les requêtes sans identification de l'agent.
        .header(reqwest::header::USER_AGENT, format!("MailFlow/{actuelle}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Reseau(format!("GitHub injoignable : {e}")))?;

    let sans_publication = Verification {
        version_actuelle: actuelle.to_string(),
        version_publiee: None,
        disponible: false,
        adresse: None,
    };

    // 404 : le dépôt n'a encore aucune publication définitive — les brouillons
    // et les préversions n'apparaissent pas ici. Ce n'est pas une panne, c'est
    // une réponse : il n'y a rien de plus récent.
    if reponse.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(sans_publication);
    }
    if !reponse.status().is_success() {
        return Err(AppError::Reseau(format!(
            "GitHub a répondu {}",
            reponse.status()
        )));
    }

    let publication: Publication = reponse
        .json()
        .await
        .map_err(|e| AppError::Reseau(format!("réponse de GitHub illisible : {e}")))?;

    let version = publication.tag_name.trim_start_matches('v').to_string();

    Ok(Verification {
        disponible: est_posterieure(&version, actuelle),
        version_publiee: Some(version),
        adresse: Some(publication.html_url),
        version_actuelle: actuelle.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::est_posterieure;

    #[test]
    fn une_version_plus_haute_est_proposee() {
        assert!(est_posterieure("0.2.0", "0.1.0"));
        assert!(est_posterieure("1.0.0", "0.9.9"));
        assert!(est_posterieure("0.1.1", "0.1.0"));
    }

    #[test]
    fn la_meme_version_ne_se_propose_pas() {
        assert!(!est_posterieure("0.1.0", "0.1.0"));
        assert!(!est_posterieure("v0.1.0", "0.1.0"));
    }

    #[test]
    fn une_version_plus_ancienne_ne_se_propose_pas() {
        // Arrive après une installation manuelle d'une version de
        // développement : proposer un retour en arrière serait un piège.
        assert!(!est_posterieure("0.1.0", "0.2.0"));
    }

    #[test]
    fn dix_vient_bien_apres_neuf() {
        // Le piège de la comparaison de chaînes : "0.10.0" < "0.9.0".
        assert!(est_posterieure("0.10.0", "0.9.0"));
        assert!(!est_posterieure("0.9.0", "0.10.0"));
    }

    #[test]
    fn une_preversion_se_compare_sur_ses_nombres() {
        // Le suffixe est ignoré : une préversion du même numéro n'est pas une
        // mise à jour.
        assert!(!est_posterieure("0.1.0-dev.3", "0.1.0"));
        assert!(est_posterieure("0.2.0-beta.1", "0.1.0"));
    }

    #[test]
    fn une_version_incomprehensible_ne_declenche_rien() {
        // Un tag qui n'est pas un numéro se lit comme des zéros : mieux vaut ne
        // rien proposer que de proposer n'importe quoi.
        assert!(!est_posterieure("dernière", "0.1.0"));
    }
}
