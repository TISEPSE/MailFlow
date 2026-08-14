//! Logos des expéditeurs.
//!
//! Gmail ne fournit pas d'avatar. Le seul moyen d'afficher le logo d'un
//! expéditeur est d'aller le chercher sur son domaine.
//!
//! # Ce que ça coûte en confidentialité
//!
//! Demander `https://ouigo.com/favicon.ico`, c'est révéler à OUIGO l'adresse IP
//! de l'utilisateur et le moment où il ouvre son courrier. C'est peu, mais ce
//! n'est pas rien pour une application qui met la confidentialité en avant.
//!
//! Deux décisions en découlent.
//!
//! **Jamais de service tiers.** Un agrégateur d'icônes comme celui de Google
//! répondrait plus vite et plus souvent — au prix de lui transmettre la liste
//! complète des correspondants de l'utilisateur. C'est exactement ce que
//! MailFlow évite ailleurs ; ce serait incohérent de le faire ici.
//!
//! **Une seule requête par domaine, mise en cache sur le disque**, y compris
//! quand elle échoue. Sans cache négatif, un domaine sans logo serait redemandé
//! à chaque ouverture.
//!
//! Le domaine interrogé est celui qui a déjà écrit à l'utilisateur : il sait
//! donc déjà que celui-ci existe. On ne contacte jamais un domaine tiers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::Resultat;

/// Au-delà, ce n'est pas une icône de site.
const TAILLE_MAX: usize = 100 * 1024;

/// Court : un logo absent ne doit pas retarder l'affichage de la boîte.
const DELAI: Duration = Duration::from_secs(4);

/// Marque de cache négatif : le domaine a été interrogé, sans résultat.
const SANS_LOGO: &str = "-";

/// Domaine d'une adresse normalisée.
pub fn domaine(adresse: &str) -> Option<&str> {
    let (_, domaine) = adresse.rsplit_once('@')?;
    let domaine = domaine.trim();

    // Un domaine sans point n'en est pas un ; une barre oblique ou deux-points
    // signalent une valeur qui n'a rien à faire dans une URL.
    let plausible = domaine.contains('.')
        && !domaine.contains(['/', ':', '\\', '?', '#', '@'])
        && domaine.chars().all(|c| c.is_ascii_graphic());

    plausible.then_some(domaine)
}

fn url_favicon(domaine: &str) -> String {
    format!("https://{domaine}/favicon.ico")
}

/// Domaines à interroger, du plus précis au plus général.
///
/// Beaucoup d'expéditeurs écrivent depuis un sous-domaine technique
/// (`pasngr.ouigo.com`, `email.steampowered.com`) qui n'héberge aucune icône,
/// alors que le domaine principal en a une. On retombe donc d'un cran, une
/// seule fois : au-delà, on interrogerait des domaines qui n'ont jamais écrit à
/// l'utilisateur.
fn candidats(domaine: &str) -> Vec<String> {
    let mut essais = vec![domaine.to_string()];

    let etiquettes: Vec<&str> = domaine.split('.').collect();
    if etiquettes.len() > 2 {
        // `a.b.co.uk` donnerait `co.uk` : on garde trois étiquettes quand
        // l'avant-dernière est courte, ce qui couvre les suffixes composés.
        let garde = if etiquettes[etiquettes.len() - 2].len() <= 3 {
            3
        } else {
            2
        };
        if etiquettes.len() > garde {
            essais.push(etiquettes[etiquettes.len() - garde..].join("."));
        }
    }

    essais
}

/// Convertit une réponse en URI de données, ou refuse.
///
/// Le contenu vient d'un tiers : on n'accepte qu'un type d'image déclaré et une
/// taille bornée. Un serveur qui répond une page HTML d'erreur en 200 — cas
/// courant — ne doit pas produire une image cassée dans l'interface.
pub fn en_data_uri(type_contenu: Option<&str>, octets: &[u8]) -> Option<String> {
    use base64::Engine;

    let type_contenu = type_contenu?.split(';').next()?.trim().to_lowercase();
    if !type_contenu.starts_with("image/") {
        return None;
    }
    if octets.is_empty() || octets.len() > TAILLE_MAX {
        return None;
    }

    let encode = base64::engine::general_purpose::STANDARD.encode(octets);
    Some(format!("data:{type_contenu};base64,{encode}"))
}

fn chemin_cache(dossier: &Path, domaine: &str) -> PathBuf {
    // Le domaine vient d'un en-tête : il ne sert jamais tel quel comme nom de
    // fichier, sans quoi `../` s'y inviterait.
    let sur: String = domaine
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    dossier.join(format!("{sur}.txt"))
}

/// Va chercher les logos manquants et rend ceux qui sont connus.
pub async fn logos(
    http: &reqwest::Client,
    dossier: &Path,
    domaines: &[String],
) -> Resultat<HashMap<String, String>> {
    let _ = std::fs::create_dir_all(dossier);
    let mut trouves = HashMap::new();

    for domaine in domaines {
        let chemin = chemin_cache(dossier, domaine);

        if let Ok(contenu) = std::fs::read_to_string(&chemin) {
            if contenu != SANS_LOGO {
                trouves.insert(domaine.clone(), contenu);
            }
            continue;
        }

        let uri = match recuperer(http, domaine).await {
            Some(uri) => uri,
            None => {
                // Cache négatif : sans lui, un domaine sans logo serait
                // redemandé à chaque ouverture de l'application.
                let _ = std::fs::write(&chemin, SANS_LOGO);
                continue;
            }
        };

        let _ = std::fs::write(&chemin, &uri);
        trouves.insert(domaine.clone(), uri);
    }

    Ok(trouves)
}

async fn recuperer(http: &reqwest::Client, domaine: &str) -> Option<String> {
    for essai in candidats(domaine) {
        if let Some(uri) = recuperer_un(http, &essai).await {
            return Some(uri);
        }
    }
    None
}

async fn recuperer_un(http: &reqwest::Client, domaine: &str) -> Option<String> {
    let reponse = http
        .get(url_favicon(domaine))
        .timeout(DELAI)
        .send()
        .await
        .ok()?;

    if !reponse.status().is_success() {
        return None;
    }

    let type_contenu = reponse
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let octets = reponse.bytes().await.ok()?;
    en_data_uri(type_contenu.as_deref(), &octets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_domaine_est_extrait_de_l_adresse() {
        assert_eq!(domaine("promo@offres-tech.fr"), Some("offres-tech.fr"));
        assert_eq!(domaine("a@mail.google.com"), Some("mail.google.com"));
    }

    #[test]
    fn une_adresse_douteuse_ne_produit_aucun_domaine() {
        // Ces valeurs finiraient dans une URL : mieux vaut ne rien demander.
        assert_eq!(domaine("sans-arobase"), None);
        assert_eq!(domaine("a@localhost"), None);
        assert_eq!(domaine("a@evil.fr/../x"), None);
        assert_eq!(domaine("a@evil.fr:8080"), None);
        assert_eq!(domaine("a@évil.fr"), None);
    }

    #[test]
    fn le_logo_est_demande_au_domaine_de_l_expediteur() {
        // Et jamais à un service tiers, qui apprendrait la liste complète des
        // correspondants de l'utilisateur.
        let url = url_favicon("offres-tech.fr");

        assert_eq!(url, "https://offres-tech.fr/favicon.ico");
        assert!(url.starts_with("https://"));
        assert!(!url.contains("google.com"));
    }

    #[test]
    fn un_sous_domaine_retombe_sur_le_domaine_principal() {
        // `pasngr.ouigo.com` n'héberge pas d'icône, `ouigo.com` si.
        assert_eq!(
            candidats("pasngr.ouigo.com"),
            ["pasngr.ouigo.com", "ouigo.com"]
        );
        assert_eq!(candidats("email.steampowered.com")[1], "steampowered.com");
    }

    #[test]
    fn un_domaine_simple_n_a_qu_un_candidat() {
        assert_eq!(candidats("github.com"), ["github.com"]);
    }

    #[test]
    fn un_suffixe_compose_n_est_pas_tronque_a_l_exces() {
        // Retomber sur `co.uk` interrogerait un domaine qui n'a jamais écrit.
        assert_eq!(candidats("mail.boutique.co.uk")[1], "boutique.co.uk");
    }

    #[test]
    fn une_image_devient_une_uri_de_donnees() {
        let uri = en_data_uri(Some("image/png"), b"\x89PNG...").unwrap();

        assert!(uri.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn le_parametre_du_type_de_contenu_est_ignore() {
        let uri = en_data_uri(Some("image/x-icon; charset=binary"), b"abc").unwrap();

        assert!(uri.starts_with("data:image/x-icon;base64,"));
    }

    #[test]
    fn une_reponse_qui_n_est_pas_une_image_est_refusee() {
        // Beaucoup de sites répondent 200 avec une page d'erreur HTML.
        assert!(en_data_uri(Some("text/html"), b"<!doctype html>").is_none());
        assert!(en_data_uri(None, b"abc").is_none());
    }

    #[test]
    fn une_image_demesuree_est_refusee() {
        let enorme = vec![0u8; TAILLE_MAX + 1];

        assert!(en_data_uri(Some("image/png"), &enorme).is_none());
        assert!(en_data_uri(Some("image/png"), b"").is_none());
    }

    #[test]
    fn le_nom_de_cache_ne_peut_pas_sortir_du_dossier() {
        // Le domaine vient d'un en-tête écrit par un tiers.
        let dossier = Path::new("/tmp/logos");
        let chemin = chemin_cache(dossier, "../../etc/passwd");

        // La propriété qui compte : le fichier reste dans le dossier. Le nom
        // peut bien contenir des points, il ne contient aucun séparateur.
        assert_eq!(chemin.parent(), Some(dossier));
        let nom = chemin.file_name().unwrap().to_string_lossy();
        assert!(!nom.contains('/') && !nom.contains('\\'), "nom : {nom}");
    }

    #[tokio::test]
    async fn un_domaine_deja_en_cache_n_est_pas_redemande() {
        let dossier = tempfile::tempdir().unwrap();
        std::fs::write(
            chemin_cache(dossier.path(), "x.fr"),
            "data:image/png;base64,AA",
        )
        .unwrap();

        // Client sans résolution possible : s'il partait sur le réseau, l'appel
        // échouerait au lieu de rendre la valeur en cache.
        let http = reqwest::Client::new();
        let trouves = logos(&http, dossier.path(), &["x.fr".to_string()])
            .await
            .unwrap();

        assert_eq!(
            trouves.get("x.fr").map(String::as_str),
            Some("data:image/png;base64,AA")
        );
    }

    #[tokio::test]
    async fn un_domaine_sans_logo_est_retenu_comme_tel() {
        let dossier = tempfile::tempdir().unwrap();
        std::fs::write(chemin_cache(dossier.path(), "vide.fr"), SANS_LOGO).unwrap();

        let http = reqwest::Client::new();
        let trouves = logos(&http, dossier.path(), &["vide.fr".to_string()])
            .await
            .unwrap();

        assert!(
            trouves.is_empty(),
            "le marqueur ne doit pas être rendu comme un logo"
        );
    }
}
