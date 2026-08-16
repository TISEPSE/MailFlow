//! Aperçu d'une pièce jointe, avant tout enregistrement.
//!
//! # Le problème
//!
//! Une pièce jointe est le seul contenu qu'un inconnu dépose directement sur la
//! machine de l'utilisateur. C'est, historiquement, le premier vecteur du
//! courrier piégé. L'application refusait donc de l'ouvrir : elle l'enregistrait,
//! et l'utilisateur décidait ensuite. C'est sûr, mais cela oblige à sortir de
//! l'application pour savoir ce qu'on vient de recevoir — y compris pour une
//! facture qu'on voulait seulement lire.
//!
//! # Le principe retenu
//!
//! Montrer sans exécuter, et surtout **sans transmettre les octets d'origine**.
//! Trois familles seulement passent, et chacune est reconstruite avant
//! d'atteindre l'interface :
//!
//! - **Images** : décodées ici, en Rust, puis ré-encodées en PNG. Ce qui part
//!   vers le webview n'est donc jamais le fichier reçu, mais une image neuve
//!   produite à partir de ses pixels. Les métadonnées disparaissent au passage —
//!   dont les coordonnées GPS que porte toute photo prise au téléphone — et un
//!   fichier « polyglotte », valide à la fois comme image et comme document
//!   exécutable, perd sa seconde nature.
//! - **PDF** : transmis tels quels, mais lus par un visualiseur enfermé dans un
//!   cadre isolé, sans accès au réseau ni au reste de l'application. Les
//!   analyser ici, en natif, serait moins sûr — pas plus.
//! - **Texte** : rendu comme du texte, jamais comme du balisage. Un `.html`
//!   joint s'affiche donc en clair, ce qui est précisément ce qu'on veut voir.
//!
//! Tout le reste — traitement de texte, tableur, archive, exécutable — n'a pas
//! d'aperçu. Afficher un `.docx` supposerait d'embarquer un analyseur de format
//! complexe nourri par un inconnu : c'est le défaut qu'on cherche à éviter, pas
//! une commodité à ajouter.
//!
//! # Ce qui décide du type
//!
//! Les octets, et rien d'autre. Ni le nom du fichier, ni le type annoncé par
//! Gmail : les deux sont écrits par l'expéditeur. Un `facture.pdf` qui commence
//! par `MZ` est un exécutable, et n'aura pas d'aperçu.

use serde::Serialize;

/// Au-delà, aucun aperçu : le fichier doit être enregistré.
///
/// La limite protège la mémoire du webview autant que la patience de
/// l'utilisateur — les octets voyagent en base64, donc enflés d'un tiers.
pub const TAILLE_MAX: usize = 25 * 1024 * 1024;

/// Plus grand côté d'une image d'aperçu, en pixels.
///
/// Une photo de téléphone fait couramment 4 000 pixels de large ; la ré-encoder
/// telle quelle produirait plusieurs mégaoctets pour un panneau qui en montre le
/// dixième. La réduction est faite ici, une fois, plutôt que par le webview à
/// chaque affichage.
pub const COTE_MAX: u32 = 1_600;

/// Garde-fou contre les images « bombes » : un en-tête minuscule qui annonce
/// des dimensions énormes, et le décodeur alloue des gigaoctets.
pub const PIXELS_MAX: u64 = 50_000_000;

/// Plus grand côté d'une vignette, en pixels.
///
/// Assez pour reconnaître une photo dans une bande de trois, pas davantage :
/// une vignette est faite pour être vue de loin, et elle voyage avant même
/// qu'on ait demandé à voir le fichier.
pub const COTE_VIGNETTE: u32 = 480;

/// Longueur maximale d'un aperçu texte, en caractères.
pub const CARACTERES_MAX: usize = 200_000;

/// Ce qu'on sait montrer d'une pièce jointe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "genre", rename_all = "camelCase")]
pub enum Apercu {
    /// Image ré-encodée en PNG, en base64. Prête pour un `src` de données.
    Image {
        donnees: String,
    },

    /// PDF d'origine, en base64. Destiné au seul cadre isolé.
    Pdf {
        donnees: String,
    },

    Texte {
        contenu: String,
        tronque: bool,
    },

    /// Aucun aperçu possible. `raison` s'adresse à l'utilisateur, en clair.
    Impossible {
        raison: String,
    },
}

/// Prépare l'aperçu d'un fichier reçu.
///
/// Ne rend jamais d'erreur : un fichier qu'on ne sait pas montrer n'est pas une
/// panne, c'est une réponse. Elle vaut pour un format inconnu comme pour une
/// image corrompue.
pub fn preparer(octets: &[u8]) -> Apercu {
    if octets.is_empty() {
        return impossible("Ce fichier est vide.");
    }

    if octets.len() > TAILLE_MAX {
        return impossible(
            "Ce fichier est trop volumineux pour être affiché ici. Enregistrez-le pour l'ouvrir.",
        );
    }

    if est_un_pdf(octets) {
        use base64::Engine;
        return Apercu::Pdf {
            donnees: base64::engine::general_purpose::STANDARD.encode(octets),
        };
    }

    if est_une_image(octets) {
        return match reencoder(octets, COTE_MAX) {
            Ok(donnees) => Apercu::Image { donnees },
            Err(raison) => {
                log::warn!("image jointe illisible : {raison}");
                impossible("Cette image est illisible ou endommagée.")
            }
        };
    }

    if let Some((contenu, tronque)) = en_texte(octets) {
        return Apercu::Texte { contenu, tronque };
    }

    impossible("Ce type de fichier ne peut pas être affiché ici. Enregistrez-le pour l'ouvrir.")
}

fn impossible(raison: &str) -> Apercu {
    Apercu::Impossible {
        raison: raison.to_string(),
    }
}

/// Un PDF commence par `%PDF-`, avant tout en-tête.
fn est_un_pdf(octets: &[u8]) -> bool {
    octets.starts_with(b"%PDF-")
}

/// Image matricielle reconnue à sa signature.
///
/// Le SVG en est volontairement absent : c'est un document, qui peut porter des
/// scripts et référencer des adresses distantes. Il n'a rien d'une image du
/// point de vue de la sécurité, et il finira donc en aperçu texte — ce qui
/// montre exactement ce qu'il contient.
fn est_une_image(octets: &[u8]) -> bool {
    matches!(
        octets,
        [0x89, b'P', b'N', b'G', ..]
            | [b'G', b'I', b'F', b'8', ..]
            | [0xFF, 0xD8, 0xFF, ..]
            | [b'B', b'M', ..]
            | [
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
                ..
            ]
    )
}

/// Vignette d'un fichier joint, ou `None` si ce n'en est pas une image.
///
/// Même traitement que l'aperçu — décodage puis ré-encodage — pour la même
/// raison : ce qui atteint l'interface ne doit jamais être le fichier reçu. Un
/// PDF ou un document n'en a pas : la bande de vignettes montre alors une
/// pastille de nom de fichier, ce qui est plus honnête qu'une image générique.
pub fn vignette(octets: &[u8]) -> Option<String> {
    if octets.is_empty() || octets.len() > TAILLE_MAX || !est_une_image(octets) {
        return None;
    }

    reencoder(octets, COTE_VIGNETTE)
        .inspect_err(|e| log::warn!("vignette impossible : {e}"))
        .ok()
}

/// Décode l'image reçue et en produit une neuve, en PNG.
///
/// L'aller-retour par les pixels est le cœur de la manœuvre : rien de la
/// structure du fichier d'origine ne survit. Les limites posées avant le décodage
/// sont ce qui empêche un en-tête menteur de faire allouer toute la mémoire.
fn reencoder(octets: &[u8], cote_max: u32) -> Result<String, String> {
    use base64::Engine;
    use std::io::Cursor;

    /// Lecteur borné : les limites sont posées avant que le moindre pixel ne
    /// soit alloué, sur la foi d'un en-tête écrit par un inconnu.
    fn lecteur(octets: &[u8]) -> Result<image::ImageReader<Cursor<&[u8]>>, String> {
        let mut limites = image::Limits::default();
        limites.max_image_width = Some(20_000);
        limites.max_image_height = Some(20_000);
        limites.max_alloc = Some(512 * 1024 * 1024);

        let mut lecteur = image::ImageReader::new(Cursor::new(octets))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        lecteur.limits(limites);

        Ok(lecteur)
    }

    let (largeur, hauteur) = lecteur(octets)?
        .into_dimensions()
        .map_err(|e| e.to_string())?;

    if u64::from(largeur) * u64::from(hauteur) > PIXELS_MAX {
        return Err(format!("image démesurée : {largeur}×{hauteur}"));
    }

    // `into_dimensions` consomme le lecteur : il faut le reconstruire. Coût
    // négligeable — c'est l'en-tête qu'on relit, pas l'image.
    let image = lecteur(octets)?.decode().map_err(|e| e.to_string())?;

    let image = if largeur.max(hauteur) > cote_max {
        image.thumbnail(cote_max, cote_max)
    } else {
        image
    };

    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Rend le contenu texte et un drapeau de troncature, ou `None` si ce n'est pas
/// du texte.
///
/// Le critère est strict : de l'UTF-8 valide, sans caractère de contrôle autre
/// que les blancs. Un binaire y échoue presque toujours dès ses premiers octets,
/// et une pièce jointe affichée comme une suite de symboles n'apprendrait rien à
/// personne.
fn en_texte(octets: &[u8]) -> Option<(String, bool)> {
    let texte = std::str::from_utf8(octets).ok()?;

    if texte
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return None;
    }

    let mut coupe: String = texte.chars().take(CARACTERES_MAX).collect();
    let tronque = coupe.len() < texte.len();

    if tronque {
        coupe.push_str("\n\n[…] Fichier tronqué : enregistrez-le pour le lire en entier.");
    }

    Some((coupe, tronque))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG valide de 1×1, blanc.
    fn png_minuscule() -> Vec<u8> {
        use std::io::Cursor;
        let image = image::DynamicImage::new_rgb8(1, 1);
        let mut octets = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut octets), image::ImageFormat::Png)
            .unwrap();
        octets
    }

    fn genre(apercu: &Apercu) -> &'static str {
        match apercu {
            Apercu::Image { .. } => "image",
            Apercu::Pdf { .. } => "pdf",
            Apercu::Texte { .. } => "texte",
            Apercu::Impossible { .. } => "impossible",
        }
    }

    #[test]
    fn un_pdf_est_reconnu_a_sa_signature() {
        assert_eq!(genre(&preparer(b"%PDF-1.7\n1 0 obj\n")), "pdf");
    }

    /// Somme de contrôle des blocs PNG. Écrite ici plutôt qu'empruntée : elle ne
    /// sert qu'à fabriquer le fichier d'un seul test.
    fn crc32(octets: &[u8]) -> u32 {
        let mut reste = 0xFFFF_FFFFu32;
        for &o in octets {
            reste ^= u32::from(o);
            for _ in 0..8 {
                reste = if reste & 1 != 0 {
                    (reste >> 1) ^ 0xEDB8_8320
                } else {
                    reste >> 1
                };
            }
        }
        reste ^ 0xFFFF_FFFF
    }

    /// PNG valide portant un commentaire — comme une photo porte ses
    /// coordonnées GPS.
    fn png_bavard(commentaire: &[u8]) -> Vec<u8> {
        let mut bloc = b"tEXt".to_vec();
        bloc.extend_from_slice(commentaire);

        let mut chunk = (commentaire.len() as u32).to_be_bytes().to_vec();
        chunk.extend_from_slice(&bloc);
        chunk.extend_from_slice(&crc32(&bloc).to_be_bytes());

        let mut png = png_minuscule();
        let fin = png.len() - 12; // le bloc IEND fait douze octets
        png.splice(fin..fin, chunk);
        png
    }

    #[test]
    fn une_image_est_reencodee_et_non_transmise_telle_quelle() {
        use base64::Engine;

        let porteur = png_bavard(b"Comment\0 48.85, 2.35");

        // Le fichier de départ est bien lisible : sans quoi le test ne
        // prouverait que sa propre maladresse.
        assert!(image::load_from_memory(&porteur).is_ok());
        assert!(porteur.windows(4).any(|f| f == b"tEXt"));

        let Apercu::Image { donnees } = preparer(&porteur) else {
            panic!("un PNG doit produire un aperçu image");
        };

        let rendu = base64::engine::general_purpose::STANDARD
            .decode(&donnees)
            .unwrap();

        assert!(
            !rendu.windows(4).any(|f| f == b"tEXt"),
            "aucune métadonnée du fichier reçu ne doit survivre"
        );
    }

    #[test]
    fn un_fichier_texte_est_rendu_comme_du_texte() {
        let Apercu::Texte { contenu, tronque } = preparer("Bonjour,\nvoici la facture.".as_bytes())
        else {
            panic!("du texte doit produire un aperçu texte");
        };

        assert!(contenu.starts_with("Bonjour,"));
        assert!(!tronque);
    }

    #[test]
    fn un_svg_n_est_pas_traite_comme_une_image() {
        // Un SVG peut porter des scripts et appeler des adresses distantes. Vu
        // comme du texte, il montre exactement ce qu'il contient.
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;

        assert_eq!(genre(&preparer(svg)), "texte");
    }

    #[test]
    fn un_executable_deguise_en_pdf_n_a_pas_d_apercu() {
        // Le nom du fichier ne compte pour rien : seuls les octets décident.
        let mut exe = b"MZ\x90\x00\x03".to_vec();
        exe.extend_from_slice(&[0u8; 64]);

        assert_eq!(genre(&preparer(&exe)), "impossible");
    }

    #[test]
    fn un_fichier_trop_gros_est_refuse_avant_tout_decodage() {
        let enorme = vec![b'a'; TAILLE_MAX + 1];

        assert_eq!(genre(&preparer(&enorme)), "impossible");
    }

    #[test]
    fn un_fichier_vide_est_refuse() {
        assert_eq!(genre(&preparer(b"")), "impossible");
    }

    #[test]
    fn une_image_annoncee_mais_corrompue_ne_fait_pas_paniquer() {
        let mut faux = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        faux.extend_from_slice(b"ce qui suit n'est pas un PNG");

        assert_eq!(genre(&preparer(&faux)), "impossible");
    }

    #[test]
    fn un_texte_tres_long_est_tronque() {
        let long = "a".repeat(CARACTERES_MAX + 500);

        let Apercu::Texte { contenu, tronque } = preparer(long.as_bytes()) else {
            panic!("du texte doit produire un aperçu texte");
        };

        assert!(tronque);
        assert!(contenu.len() < long.len() + 200);
    }

    #[test]
    fn une_grande_image_est_reduite() {
        use std::io::Cursor;

        let grande = image::DynamicImage::new_rgb8(COTE_MAX + 400, 200);
        let mut octets = Vec::new();
        grande
            .write_to(&mut Cursor::new(&mut octets), image::ImageFormat::Png)
            .unwrap();

        let Apercu::Image { donnees } = preparer(&octets) else {
            panic!("un PNG doit produire un aperçu image");
        };

        use base64::Engine;
        let rendu = base64::engine::general_purpose::STANDARD
            .decode(&donnees)
            .unwrap();
        let relue = image::load_from_memory(&rendu).unwrap();

        assert!(
            relue.width() <= COTE_MAX,
            "largeur obtenue : {}",
            relue.width()
        );
    }
}
