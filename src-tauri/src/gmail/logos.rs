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
//! Trois décisions en découlent.
//!
//! **Jamais de service tiers.** Un agrégateur d'icônes comme celui de Google
//! répondrait plus vite et plus souvent — au prix de lui transmettre la liste
//! complète des correspondants de l'utilisateur. C'est exactement ce que
//! MailFlow évite ailleurs ; ce serait incohérent de le faire ici.
//!
//! **Jamais un domaine qui n'a pas écrit.** Une page d'accueil peut désigner
//! son icône n'importe où, y compris chez un tiers. On ne suit ce renvoi que
//! s'il reste sur le domaine principal de l'expéditeur.
//!
//! **Une seule campagne de requêtes par domaine, mise en cache sur le disque**,
//! y compris quand elle échoue. Sans cache négatif, un domaine sans logo serait
//! redemandé à chaque ouverture.
//!
//! # Pourquoi le type déclaré ne sert à rien
//!
//! Une première version acceptait la réponse si son `Content-Type` commençait
//! par `image/`. Mesuré sur une vraie boîte : `ouigo.com` sert son icône en
//! `application/octet-stream`, et des serveurs répondent `200 text/html` avec
//! une page d'erreur. L'en-tête ne dit donc ni ce qui est une image, ni ce qui
//! n'en est pas. On lit la signature des octets, ce qui répond aux deux
//! questions à la fois.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::Resultat;

/// Au-delà, ce n'est pas une icône de site.
const TAILLE_MAX: usize = 100 * 1024;

/// De quoi couvrir le `<head>` d'une page d'accueil, pas la page entière.
///
/// Mesuré : l'accueil d'`ugreen.com` pèse 1,3 Mo pour une déclaration d'icône
/// située dans les premiers kilo-octets. On coupe la lecture au lieu de refuser
/// la page — c'est la différence entre trouver l'icône et ne rien trouver.
const TAILLE_MAX_HTML: usize = 256 * 1024;

/// Court : un logo absent ne doit pas retarder l'affichage de la boîte.
const DELAI: Duration = Duration::from_secs(4);

/// Nombre d'icônes déclarées qu'on veut bien essayer sur une page.
const ICONES_DECLAREES_MAX: usize = 3;

/// Domaines interrogés de front. Bornés : ce sont des tiers, pas notre serveur.
const PARALLELISME: usize = 6;

/// Marque de cache négatif : le domaine a été interrogé, sans résultat.
///
/// Le numéro est celui de la stratégie de récupération. Quand elle s'améliore,
/// il change, et les échecs enregistrés par l'ancienne sont retentés au lieu de
/// rester faux pour toujours.
const SANS_LOGO: &str = "-2";

/// Un serveur sans identification cliente répond parfois 403.
fn agent() -> String {
    format!("MailFlow/{}", env!("CARGO_PKG_VERSION"))
}

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

/// Domaine principal : `pasngr.ouigo.com` → `ouigo.com`.
///
/// Approximation volontaire des suffixes publics. On garde trois étiquettes
/// quand l'avant-dernière est courte, ce qui couvre `co.uk` sans embarquer la
/// liste complète des suffixes.
fn apex(domaine: &str) -> String {
    let etiquettes: Vec<&str> = domaine.split('.').collect();
    if etiquettes.len() <= 2 {
        return domaine.to_lowercase();
    }

    let garde = if etiquettes[etiquettes.len() - 2].len() <= 3 {
        3
    } else {
        2
    };
    let garde = garde.min(etiquettes.len());
    etiquettes[etiquettes.len() - garde..]
        .join(".")
        .to_lowercase()
}

/// Domaines à interroger, du plus précis au plus général.
///
/// Beaucoup d'expéditeurs écrivent depuis un sous-domaine technique
/// (`pasngr.ouigo.com`, `email.steampowered.com`) qui n'héberge aucune icône,
/// alors que le domaine principal en a une. On retombe donc d'un cran, une
/// seule fois : au-delà, on interrogerait des domaines qui n'ont jamais écrit à
/// l'utilisateur.
fn candidats(domaine: &str) -> Vec<String> {
    let principal = apex(domaine);
    if principal == domaine.to_lowercase() {
        vec![domaine.to_string()]
    } else {
        vec![domaine.to_string(), principal]
    }
}

/// Type d'image d'après la signature des octets, ou `None`.
///
/// C'est la seule question qui compte : ces octets vont dans un `<img>`. Ce que
/// le serveur en dit dans ses en-têtes n'engage que lui.
fn type_image(octets: &[u8]) -> Option<&'static str> {
    match octets {
        [0x00, 0x00, 0x01, 0x00, ..] => Some("image/x-icon"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        _ => est_un_svg(octets).then_some("image/svg+xml"),
    }
}

/// Le SVG n'a pas de signature binaire : il faut regarder le début du texte.
fn est_un_svg(octets: &[u8]) -> bool {
    let debut = &octets[..octets.len().min(512)];
    let Ok(texte) = std::str::from_utf8(debut) else {
        return false;
    };

    let texte = texte.trim_start_matches('\u{feff}').trim_start();
    texte.starts_with("<svg") || (texte.starts_with("<?xml") && texte.contains("<svg"))
}

/// Convertit une réponse en URI de données, ou refuse.
///
/// Le contenu vient d'un tiers : on n'accepte qu'une image reconnaissable à sa
/// signature et de taille bornée. Un serveur qui répond une page HTML d'erreur
/// en 200 — cas courant — ne doit pas produire une image cassée dans
/// l'interface.
pub fn en_data_uri(octets: &[u8]) -> Option<String> {
    use base64::Engine;

    if octets.is_empty() || octets.len() > TAILLE_MAX {
        return None;
    }
    let type_contenu = type_image(octets)?;

    let encode = base64::engine::general_purpose::STANDARD.encode(octets);
    Some(format!("data:{type_contenu};base64,{encode}"))
}

/// Valeur d'un attribut dans une balise HTML.
///
/// Écrit à la main plutôt qu'avec un analyseur complet : on ne lit qu'une
/// balise `<link>`, et rien de ce qui en sort n'est interprété comme du HTML.
fn valeur_attribut(balise: &str, nom: &str) -> Option<String> {
    let bas = balise.to_lowercase();
    let mut depuis = 0;

    while let Some(pos) = bas[depuis..].find(nom) {
        let debut = depuis + pos;
        depuis = debut + nom.len();

        // Sans quoi `rel` serait trouvé dans `data-rel` ou `hreflang`.
        let separe = debut == 0 || bas[..debut].ends_with([' ', '\t', '\n', '\r', '/']);
        let apres = balise[debut + nom.len()..].trim_start();

        if separe && let Some(valeur) = apres.strip_prefix('=') {
            let valeur = valeur.trim_start();
            let brute = if let Some(r) = valeur.strip_prefix('"') {
                r.split('"').next()?
            } else if let Some(r) = valeur.strip_prefix('\'') {
                r.split('\'').next()?
            } else {
                valeur.split([' ', '\t', '\n', '\r', '>']).next()?
            };
            return Some(brute.trim().to_string());
        }
    }

    None
}

/// Transforme un `href` de page en URL absolue, ou refuse.
///
/// Refuse tout ce qui sort du domaine principal de l'expéditeur : une page peut
/// désigner son icône chez n'importe qui, et contacter ce tiers reviendrait à
/// lui apprendre que l'utilisateur reçoit du courrier de ce domaine.
fn absolutiser(href: &str, domaine: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() || href.starts_with("data:") {
        return None;
    }

    let url = if let Some(reste) = href.strip_prefix("//") {
        format!("https://{reste}")
    } else if href.starts_with("https://") {
        href.to_string()
    } else if href.contains("://") {
        // `http://` en clair, ou un schéma exotique : ni l'un ni l'autre.
        return None;
    } else if let Some(reste) = href.strip_prefix('/') {
        format!("https://{domaine}/{reste}")
    } else {
        format!("https://{domaine}/{href}")
    };

    let hote = url
        .strip_prefix("https://")?
        .split(['/', '?', '#'])
        .next()?;
    (apex(hote) == apex(domaine)).then_some(url)
}

/// URLs d'icônes déclarées dans une page, de la plus probable à la moins.
///
/// Beaucoup de sites ne servent plus `/favicon.ico` et ne déclarent leur icône
/// que dans le `<head>`.
fn icones_declarees(html: &str, domaine: &str) -> Vec<String> {
    let bas = html.to_lowercase();
    let mut trouvees: Vec<(u8, String)> = Vec::new();

    let mut depuis = 0;
    while let Some(pos) = bas[depuis..].find("<link") {
        let debut = depuis + pos;
        let fin = bas[debut..].find('>').map_or(bas.len(), |f| debut + f);
        depuis = fin.max(debut + 5);

        let balise = &html[debut..fin];
        let Some(rel) = valeur_attribut(balise, "rel") else {
            continue;
        };
        let rel = rel.to_lowercase();
        if !rel
            .split_whitespace()
            .any(|m| m == "icon" || m == "apple-touch-icon")
        {
            continue;
        }

        let Some(href) = valeur_attribut(balise, "href") else {
            continue;
        };
        let Some(url) = absolutiser(&href, domaine) else {
            continue;
        };

        // `apple-touch-icon` est un repli : c'est une image d'écran d'accueil,
        // souvent plus lourde et parfois sans transparence.
        let rang = u8::from(!rel.split_whitespace().any(|m| m == "icon"));
        if !trouvees.iter().any(|(_, u)| *u == url) {
            trouvees.push((rang, url));
        }
    }

    trouvees.sort_by_key(|(rang, _)| *rang);
    trouvees
        .into_iter()
        .map(|(_, url)| url)
        .take(ICONES_DECLAREES_MAX)
        .collect()
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

/// Ce que le cache disque sait déjà d'un domaine.
enum Connu {
    Logo(String),
    Aucun,
    /// Rien, ou une trace laissée par une stratégie de récupération périmée.
    ARetenter,
}

fn lire_cache(chemin: &Path) -> Connu {
    match std::fs::read_to_string(chemin) {
        Ok(contenu) if contenu.starts_with("data:") => Connu::Logo(contenu),
        Ok(contenu) if contenu == SANS_LOGO => Connu::Aucun,
        _ => Connu::ARetenter,
    }
}

/// Va chercher les logos manquants et rend ceux qui sont connus.
pub async fn logos(
    http: &reqwest::Client,
    dossier: &Path,
    domaines: &[String],
) -> Resultat<HashMap<String, String>> {
    let _ = std::fs::create_dir_all(dossier);
    let mut trouves = HashMap::new();
    let mut a_chercher = Vec::new();

    for domaine in domaines {
        match lire_cache(&chemin_cache(dossier, domaine)) {
            Connu::Logo(uri) => {
                trouves.insert(domaine.clone(), uri);
            }
            Connu::Aucun => {}
            Connu::ARetenter => a_chercher.push(domaine.clone()),
        }
    }

    // De front : une boîte peut compter des dizaines d'expéditeurs, et un
    // domaine qui ne répond pas immobiliserait tous les suivants pendant son
    // délai d'attente.
    for paquet in a_chercher.chunks(PARALLELISME) {
        let mut travaux = tokio::task::JoinSet::new();
        for domaine in paquet {
            let (http, domaine) = (http.clone(), domaine.clone());
            travaux.spawn(async move {
                let uri = recuperer(&http, &domaine).await;
                (domaine, uri)
            });
        }

        while let Some(fini) = travaux.join_next().await {
            let Ok((domaine, uri)) = fini else { continue };
            let chemin = chemin_cache(dossier, &domaine);
            match uri {
                Some(uri) => {
                    let _ = std::fs::write(&chemin, &uri);
                    trouves.insert(domaine, uri);
                }
                // Cache négatif : sans lui, un domaine sans logo serait
                // redemandé à chaque ouverture de l'application.
                None => {
                    let _ = std::fs::write(&chemin, SANS_LOGO);
                }
            }
        }
    }

    Ok(trouves)
}

async fn recuperer(http: &reqwest::Client, domaine: &str) -> Option<String> {
    for essai in candidats(domaine) {
        if let Some(uri) = telecharger_image(http, &url_favicon(&essai)).await {
            return Some(uri);
        }

        for url in icones_de_la_page(http, &essai).await {
            if let Some(uri) = telecharger_image(http, &url).await {
                return Some(uri);
            }
        }
    }
    None
}

async fn icones_de_la_page(http: &reqwest::Client, domaine: &str) -> Vec<String> {
    let url = format!("https://{domaine}/");
    let Some(html) = telecharger(http, &url, TAILLE_MAX_HTML, Trop::Tronquer).await else {
        return Vec::new();
    };

    // Une page d'accueil est rarement en UTF-8 strict ; les balises `<link>` ne
    // contiennent de toute façon que de l'ASCII.
    icones_declarees(&String::from_utf8_lossy(&html), domaine)
}

async fn telecharger_image(http: &reqwest::Client, url: &str) -> Option<String> {
    let octets = telecharger(http, url, TAILLE_MAX, Trop::Refuser).await?;
    en_data_uri(&octets)
}

/// Que faire d'une réponse qui dépasse le plafond.
#[derive(Clone, Copy)]
enum Trop {
    /// Pour du HTML : ce qu'on cherche est dans le `<head>`.
    Tronquer,
    /// Pour une image : tronquée, elle serait illisible.
    Refuser,
}

async fn telecharger(
    http: &reqwest::Client,
    url: &str,
    plafond: usize,
    trop: Trop,
) -> Option<Vec<u8>> {
    let mut reponse = http
        .get(url)
        .header(reqwest::header::USER_AGENT, agent())
        .timeout(DELAI)
        .send()
        .await
        .ok()?;

    if !reponse.status().is_success() {
        return None;
    }

    // `Content-Length` évite de commencer une lecture qu'on refusera, mais il
    // est déclaratif : le plafond est réappliqué morceau par morceau, sans quoi
    // un serveur hostile ferait grossir la mémoire indéfiniment.
    let annonce_trop = reponse.content_length().is_some_and(|n| n > plafond as u64);
    if annonce_trop && matches!(trop, Trop::Refuser) {
        return None;
    }

    let mut octets: Vec<u8> = Vec::new();
    while let Ok(Some(morceau)) = reponse.chunk().await {
        octets.extend_from_slice(&morceau);
        if octets.len() >= plafond {
            return match trop {
                Trop::Tronquer => {
                    octets.truncate(plafond);
                    Some(octets)
                }
                Trop::Refuser => None,
            };
        }
    }

    Some(octets)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une icône ICO minimale : quatre octets de signature suffisent au test.
    const ICO: &[u8] = &[0x00, 0x00, 0x01, 0x00, 0x01, 0x00];
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

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
        assert_eq!(apex("mail.boutique.co.uk"), "boutique.co.uk");
        assert_eq!(apex("boutique.fr"), "boutique.fr");
    }

    #[test]
    fn une_image_est_reconnue_a_sa_signature_pas_a_son_en_tete() {
        // Mesuré : `ouigo.com` sert son icône en `application/octet-stream`.
        // Se fier au type déclaré revenait à jeter une icône parfaitement
        // valide.
        let uri = en_data_uri(ICO).unwrap();

        assert!(uri.starts_with("data:image/x-icon;base64,"), "{uri}");
        assert!(en_data_uri(PNG).unwrap().starts_with("data:image/png;"));
        assert!(
            en_data_uri(b"GIF89a...")
                .unwrap()
                .starts_with("data:image/gif;")
        );
        assert!(
            en_data_uri(b"\xff\xd8\xff\xe0..")
                .unwrap()
                .starts_with("data:image/jpeg;")
        );
        assert!(
            en_data_uri(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
                .unwrap()
                .starts_with("data:image/webp;")
        );
    }

    #[test]
    fn un_svg_est_accepte_meme_precede_d_une_declaration_xml() {
        assert!(
            en_data_uri(br#"<?xml version="1.0"?><svg xmlns="..."/>"#)
                .unwrap()
                .starts_with("data:image/svg+xml;")
        );
        assert!(en_data_uri(b"  <svg viewBox='0 0 1 1'/>").is_some());
    }

    #[test]
    fn une_reponse_qui_n_est_pas_une_image_est_refusee() {
        // Beaucoup de sites répondent 200 avec une page d'erreur HTML.
        assert!(en_data_uri(b"<!doctype html><html>").is_none());
        assert!(en_data_uri(b"{\"erreur\":\"absent\"}").is_none());
        assert!(en_data_uri(b"").is_none());
        assert!(en_data_uri(b"ab").is_none());
    }

    #[test]
    fn une_image_demesuree_est_refusee() {
        let mut enorme = PNG.to_vec();
        enorme.resize(TAILLE_MAX + 1, 0);

        assert!(en_data_uri(&enorme).is_none());
    }

    #[test]
    fn l_icone_declaree_dans_la_page_est_retrouvee() {
        // Mesuré : `ugreen.com` répond 404 sur `/favicon.ico` et ne déclare son
        // icône que dans le `<head>`, en URL sans schéma.
        let html = r#"<head><link rel="icon" type="image/png"
            href="//www.ugreen.com/cdn/shop/files/favicon.png?v=1" /></head>"#;

        assert_eq!(
            icones_declarees(html, "ugreen.com"),
            ["https://www.ugreen.com/cdn/shop/files/favicon.png?v=1"]
        );
    }

    #[test]
    fn les_formes_usuelles_de_declaration_sont_acceptees() {
        let html = "<link rel='shortcut icon' href='/static/f.ico'>\
                    <link rel=icon href=/autre.png>";

        assert_eq!(
            icones_declarees(html, "site.fr"),
            ["https://site.fr/static/f.ico", "https://site.fr/autre.png"]
        );
    }

    #[test]
    fn l_icone_de_page_d_accueil_passe_avant_celle_d_ecran_d_accueil() {
        let html = r#"<link rel="apple-touch-icon" href="/gros.png">
                      <link rel="icon" href="/petit.png">"#;

        assert_eq!(
            icones_declarees(html, "site.fr")
                .first()
                .map(String::as_str),
            Some("https://site.fr/petit.png")
        );
    }

    #[test]
    fn une_icone_hebergee_ailleurs_n_est_pas_reclamee() {
        // Suivre ce renvoi apprendrait à un tiers que l'utilisateur reçoit du
        // courrier de ce domaine — précisément ce qu'on refuse de divulguer.
        let html = r#"<link rel="icon" href="https://cdn-tiers.net/site.png">
                      <link rel="icon" href="http://site.fr/clair.png">
                      <link rel="icon" href="data:image/png;base64,AA">"#;

        assert!(icones_declarees(html, "site.fr").is_empty());
    }

    #[test]
    fn un_sous_domaine_du_meme_site_reste_acceptable() {
        let html = r#"<link rel="icon" href="https://static.site.fr/f.png">"#;

        assert_eq!(
            icones_declarees(html, "www.site.fr"),
            ["https://static.site.fr/f.png"]
        );
    }

    #[test]
    fn une_balise_sans_icone_est_ignoree() {
        let html = r#"<link rel="stylesheet" href="/a.css">
                      <link rel="canonical" href="/">
                      <link rel="preload" hreflang="fr" href="/b.js">"#;

        assert!(icones_declarees(html, "site.fr").is_empty());
    }

    #[test]
    fn le_nombre_d_icones_essayees_est_borne() {
        // Une page ne doit pas pouvoir nous faire émettre dix requêtes.
        let html: String = (0..10)
            .map(|i| format!(r#"<link rel="icon" href="/f{i}.png">"#))
            .collect();

        assert_eq!(
            icones_declarees(&html, "site.fr").len(),
            ICONES_DECLAREES_MAX
        );
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

    #[test]
    fn un_echec_enregistre_par_une_ancienne_strategie_est_retente() {
        // Sinon les domaines rejetés à tort par la version précédente — celle
        // qui se fiait au `Content-Type` — resteraient sans logo pour toujours.
        let dossier = tempfile::tempdir().unwrap();
        let chemin = chemin_cache(dossier.path(), "ouigo.com");
        std::fs::write(&chemin, "-").unwrap();

        assert!(matches!(lire_cache(&chemin), Connu::ARetenter));
    }
}
