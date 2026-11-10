//! Composition d'un message sortant.
//!
//! # Ce que ce module fait, et pourquoi il est petit
//!
//! Il assemble un message `text/plain` en UTF-8, accompagné le cas échéant de
//! fichiers joints, et rien d'autre : ni corps enrichi, ni signature. Le
//! besoin est d'écrire à quelqu'un, de lui joindre un document et de
//! transférer une lettre, pas de refaire un éditeur de courrier. Chaque forme
//! MIME ajoutée ici est une forme de plus à vérifier avant d'envoyer quelque
//! chose au nom de l'utilisateur.
//!
//! Sans fichier joint, le message reste le `text/plain` nu d'avant : la forme
//! `multipart/mixed` n'apparaît que lorsqu'il y a quelque chose à y mettre.
//!
//! # Le point de sécurité, et il n'y en a qu'un
//!
//! **Un en-tête ne contient jamais de fin de ligne.** C'est toute l'affaire.
//!
//! Un message MIME sépare ses en-têtes de son corps par une ligne vide, et
//! chaque en-tête par un saut de ligne. Un objet qui contiendrait `\r\n` — ou
//! le seul `\n` — permettrait donc d'écrire ce qu'on veut à la suite :
//! destinataires supplémentaires en copie cachée, en-tête `From` refait, corps
//! entier remplacé. Le texte de l'objet et des adresses vient de l'interface,
//! mais il vient aussi, dans un transfert, de l'**expéditeur d'origine** — dont
//! l'objet est reproduit dans le nôtre. C'est-à-dire de n'importe qui.
//!
//! D'où le refus net plutôt que le nettoyage : une adresse ou un objet qui
//! porte une fin de ligne est rejeté, il n'est pas rafistolé. Rafistoler
//! laisserait le doute sur ce qui a été envoyé.

use base64::Engine;

use crate::error::{AppError, Resultat};

/// Ce qu'il faut pour écrire un message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Brouillon {
    /// Adresse de l'expéditeur, c'est-à-dire le compte connecté.
    pub de: String,
    pub destinataires: Vec<String>,
    pub copies: Vec<String>,
    pub sujet: String,
    pub corps: String,
    /// Fichiers joints, dans l'ordre où l'utilisateur les a ajoutés.
    pub pieces: Vec<PieceJointe>,
}

/// Un fichier joint au message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PieceJointe {
    /// Nom montré au destinataire. Jamais un chemin : voir [`nom_de_piece`].
    pub nom: String,
    /// Type annoncé par l'interface. Il n'est repris que s'il a la forme d'un
    /// type MIME : voir [`type_de_piece`].
    pub type_mime: String,
    pub contenu: Vec<u8>,
}

/// Poids total des fichiers joints au-delà duquel on refuse d'envoyer.
///
/// C'est la limite de Gmail lui-même : 25 Mo de pièces, qui en font un peu
/// moins de 35 une fois encodées — le plafond de son API d'envoi. Refuser ici
/// vaut mieux que de téléverser trente mégaoctets pour s'entendre dire non.
pub const POIDS_MAX_PIECES: usize = 25 * 1024 * 1024;

/// Caractères qu'aucun en-tête ne peut porter.
///
/// Le retour chariot seul est de la partie : certains analyseurs le traitent
/// comme une fin de ligne à lui tout seul, et il ne coûte rien de le refuser.
/// Le caractère nul suit la même logique — il tronque une chaîne dans plus d'un
/// analyseur écrit en C.
const INTERDITS_EN_ENTETE: &[char] = &['\r', '\n', '\0'];

/// Cette valeur peut-elle figurer dans un en-tête ?
fn entete_sure(valeur: &str) -> bool {
    !valeur.contains(INTERDITS_EN_ENTETE)
}

/// Une adresse utilisable comme destinataire.
///
/// Le même contrôle que celui du `mailto:` : volontairement grossier, il ne
/// s'agit pas de valider la RFC 5322 mais d'empêcher qu'une saisie fantaisiste
/// parte chez Gmail. Les chevrons sont refusés parce qu'ils marquent la
/// frontière entre nom affiché et adresse : les laisser passer permettrait de
/// glisser une seconde adresse dans un champ qui n'en attend qu'une.
pub fn adresse_utilisable(adresse: &str) -> bool {
    let a = adresse.trim();
    !a.is_empty() && a.contains('@') && !a.contains(['<', '>', ',', ';']) && entete_sure(a)
}

/// Encode un texte d'en-tête en RFC 2047 s'il en a besoin.
///
/// Un objet en pur ASCII part tel quel : c'est ce qui se lit le mieux dans les
/// journaux et dans les clients anciens. Dès qu'un accent apparaît, l'en-tête
/// doit être encodé, sans quoi il arrive en mojibake — et le français en met
/// partout.
///
/// La forme `=?UTF-8?B?...?=` (base64) plutôt que `Q` : elle est plus simple à
/// produire sans se tromper, et la différence de taille n'a aucune importance
/// sur un objet.
fn encoder_entete(valeur: &str) -> String {
    if valeur.is_ascii() {
        return valeur.to_string();
    }

    format!(
        "=?UTF-8?B?{}?=",
        base64::engine::general_purpose::STANDARD.encode(valeur)
    )
}

/// Assemble le message MIME complet.
///
/// Rend une erreur de configuration — donc un message affichable — plutôt que
/// de nettoyer ce qui cloche : voir l'en-tête du module.
pub fn composer(brouillon: &Brouillon) -> Resultat<String> {
    let destinataires = adresses_valides(&brouillon.destinataires)?;

    if destinataires.is_empty() {
        return Err(AppError::Config(
            "Indiquez au moins un destinataire.".into(),
        ));
    }

    let copies = adresses_valides(&brouillon.copies)?;

    if !adresse_utilisable(&brouillon.de) {
        return Err(AppError::Config(
            "L'adresse du compte connecté n'est pas utilisable.".into(),
        ));
    }

    if !entete_sure(&brouillon.sujet) {
        // Le cas arrive pour de bon au transfert : l'objet reproduit est celui
        // de l'expéditeur d'origine.
        return Err(AppError::Config(
            "L'objet ne peut pas contenir de retour à la ligne.".into(),
        ));
    }

    let mut message = String::new();
    message.push_str(&format!("From: {}\r\n", brouillon.de.trim()));
    message.push_str(&format!("To: {}\r\n", destinataires.join(", ")));

    if !copies.is_empty() {
        message.push_str(&format!("Cc: {}\r\n", copies.join(", ")));
    }

    message.push_str(&format!(
        "Subject: {}\r\n",
        encoder_entete(&brouillon.sujet)
    ));
    message.push_str("MIME-Version: 1.0\r\n");

    if brouillon.pieces.is_empty() {
        message.push_str(&partie_texte(&brouillon.corps));
        return Ok(message);
    }

    let poids: usize = brouillon.pieces.iter().map(|p| p.contenu.len()).sum();
    if poids > POIDS_MAX_PIECES {
        return Err(AppError::Config(
            "Les fichiers joints dépassent 25 Mo au total.".into(),
        ));
    }

    let frontiere = frontiere();
    message.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{frontiere}\"\r\n\r\n"
    ));

    message.push_str(&format!("--{frontiere}\r\n"));
    message.push_str(&partie_texte(&brouillon.corps));
    message.push_str("\r\n");

    for piece in &brouillon.pieces {
        let nom = encoder_entete(&nom_de_piece(&piece.nom)?);
        let type_mime = type_de_piece(&piece.type_mime);

        message.push_str(&format!("--{frontiere}\r\n"));
        message.push_str(&format!("Content-Type: {type_mime}; name=\"{nom}\"\r\n"));
        message.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{nom}\"\r\n"
        ));
        message.push_str("Content-Transfer-Encoding: base64\r\n");
        message.push_str("\r\n");
        message.push_str(&en_base64_replie(&piece.contenu));
        message.push_str("\r\n");
    }

    message.push_str(&format!("--{frontiere}--\r\n"));

    Ok(message)
}

/// Les en-têtes et le contenu de la partie texte.
///
/// Les mêmes qu'elle soit le message entier ou la première partie d'un
/// `multipart` : c'est ce qui garantit qu'ajouter un fichier ne change rien à
/// la façon dont la lettre elle-même arrive.
fn partie_texte(corps: &str) -> String {
    let mut partie = String::new();
    partie.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
    // Le corps part en base64 plutôt qu'en `quoted-printable` : il n'y a alors
    // aucune ligne à replier, aucun caractère à échapper, et donc aucune
    // occasion de produire un corps qui se relit mal. Le surcoût de taille est
    // d'un tiers sur du texte, ce qui ne se remarque pas sur une lettre.
    partie.push_str("Content-Transfer-Encoding: base64\r\n");
    partie.push_str("\r\n");
    partie.push_str(&corps_encode(corps));
    partie
}

/// La ligne qui sépare les parties d'un message à pièces jointes.
///
/// Elle ne peut pas apparaître dans une partie : toutes sont en base64, dont
/// l'alphabet ne contient pas `_` et ne place `=` qu'en fin de contenu. Aucune
/// vérification du contenu n'est donc nécessaire, et un fichier ne peut pas
/// fabriquer une fausse frontière pour glisser une partie de son cru.
///
/// L'horloge n'est là que pour distinguer deux messages dans un fil de
/// transferts imbriqués, pas pour la sécurité.
fn frontiere() -> String {
    let instant = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();

    format!("=_mailflow_{instant:x}")
}

/// Le nom sous lequel un fichier part, ou un refus.
///
/// Le nom vient de l'interface, donc du disque de l'utilisateur — mais il
/// figure dans un en-tête, et la règle du module vaut pour lui comme pour
/// l'objet : une fin de ligne est refusée, pas rafistolée.
///
/// Les guillemets et la barre oblique inverse fermeraient ou échapperaient la
/// valeur entre guillemets : ils deviennent des tirets bas, ce qui ne change
/// rien au fichier et se relit sans surprise. Seul le dernier segment d'un
/// chemin est gardé : le destinataire n'a pas à apprendre où le fichier était
/// rangé.
fn nom_de_piece(brut: &str) -> Resultat<String> {
    if !entete_sure(brut) {
        return Err(AppError::Config(
            "Le nom d'un fichier joint ne peut pas contenir de retour à la ligne.".into(),
        ));
    }

    let dernier = brut.rsplit(['/', '\\']).next().unwrap_or(brut).trim();
    let propre: String = dernier
        .chars()
        .map(|c| if c == '"' || c.is_control() { '_' } else { c })
        .collect();

    if propre.is_empty() {
        return Ok("fichier".to_string());
    }

    Ok(propre)
}

/// Le type MIME annoncé pour un fichier joint.
///
/// Celui que donne l'interface est repris s'il a la forme `type/sous-type` et
/// rien de plus : il part dans un en-tête, où un point-virgule ajouterait des
/// paramètres et une fin de ligne un en-tête entier. À défaut, le type
/// générique — le client du destinataire se fiera alors à l'extension.
fn type_de_piece(annonce: &str) -> String {
    const GENERIQUE: &str = "application/octet-stream";

    let annonce = annonce.trim().to_ascii_lowercase();
    let permis = |c: char| c.is_ascii_alphanumeric() || "!#$&^_.+-".contains(c);

    match annonce.split_once('/') {
        Some((genre, sous_type))
            if !genre.is_empty()
                && !sous_type.is_empty()
                && genre.chars().all(permis)
                && sous_type.chars().all(permis) =>
        {
            annonce
        }
        _ => GENERIQUE.to_string(),
    }
}

/// Le corps en base64, replié à 76 colonnes comme le veut MIME.
///
/// Une ligne trop longue est refusée par des serveurs qui appliquent la RFC à
/// la lettre. Le repli ne coûte rien et évite d'avoir à découvrir lesquels.
fn corps_encode(corps: &str) -> String {
    en_base64_replie(corps.as_bytes())
}

/// Des octets en base64, repliés à 76 colonnes.
fn en_base64_replie(octets: &[u8]) -> String {
    let encode = base64::engine::general_purpose::STANDARD.encode(octets);

    encode
        .as_bytes()
        .chunks(76)
        // Sûr : l'alphabet base64 est entièrement ASCII, donc chaque octet est
        // un caractère et aucune découpe ne tombe au milieu d'un point de code.
        .map(|ligne| String::from_utf8_lossy(ligne).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n")
}

/// Nettoie une liste d'adresses, et refuse la première qui ne va pas.
///
/// Les entrées vides sont retirées et non refusées : un champ « Cc » qu'on a
/// ouvert puis laissé tel quel ne doit pas empêcher l'envoi.
fn adresses_valides(brutes: &[String]) -> Resultat<Vec<String>> {
    let mut propres = Vec::new();

    for brute in brutes {
        let adresse = brute.trim();
        if adresse.is_empty() {
            continue;
        }

        if !adresse_utilisable(adresse) {
            return Err(AppError::Config(format!(
                "« {adresse} » n'est pas une adresse valide."
            )));
        }

        propres.push(adresse.to_string());
    }

    Ok(propres)
}

/// Le message MIME sous la forme que l'API Gmail attend : `base64url`, sans
/// remplissage.
pub fn encoder_pour_gmail(mime: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mime)
}

/// Objet d'un transfert : `Tr : ` devant, une seule fois.
///
/// Transférer trois fois le même message empilait auparavant les préfixes chez
/// les clients qui les ajoutent sans regarder. Le contrôle est insensible à la
/// casse et accepte la forme anglaise, qu'on reçoit tout autant.
pub fn objet_de_transfert(objet: &str) -> String {
    let propre = objet.trim();
    let bas = propre.to_lowercase();

    if bas.starts_with("tr :") || bas.starts_with("tr:") || bas.starts_with("fwd:") {
        return propre.to_string();
    }

    if propre.is_empty() {
        return "Tr : (sans objet)".to_string();
    }

    format!("Tr : {propre}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brouillon() -> Brouillon {
        Brouillon {
            de: "moi@exemple.fr".into(),
            destinataires: vec!["toi@exemple.fr".into()],
            copies: vec![],
            sujet: "Bonjour".into(),
            corps: "Un mot.".into(),
            pieces: vec![],
        }
    }

    fn piece(nom: &str, type_mime: &str, contenu: &[u8]) -> PieceJointe {
        PieceJointe {
            nom: nom.into(),
            type_mime: type_mime.into(),
            contenu: contenu.to_vec(),
        }
    }

    /// Les parties d'un message à pièces jointes : (en-têtes, contenu décodé).
    fn parties(mime: &str) -> Vec<(String, Vec<u8>)> {
        let frontiere = mime
            .split_once("boundary=\"")
            .and_then(|(_, suite)| suite.split_once('"'))
            .map(|(f, _)| f.to_string())
            .expect("le message annonce sa frontière");
        let (_, corps) = mime.split_once("\r\n\r\n").unwrap();

        corps
            .split(&format!("--{frontiere}"))
            .filter(|p| !p.trim().is_empty() && p.trim() != "--")
            .map(|p| {
                let (entetes, contenu) = p
                    .trim_start_matches("\r\n")
                    .split_once("\r\n\r\n")
                    .expect("chaque partie a ses en-têtes");
                let octets = base64::engine::general_purpose::STANDARD
                    .decode(contenu.replace("\r\n", ""))
                    .expect("contenu en base64");
                (entetes.to_string(), octets)
            })
            .collect()
    }

    #[test]
    fn un_fichier_joint_part_dans_un_message_en_plusieurs_parties() {
        let mut b = brouillon();
        b.pieces = vec![piece("devis.pdf", "application/pdf", b"%PDF-1.7 contenu")];

        let mime = composer(&b).unwrap();

        assert!(mime.contains("Content-Type: multipart/mixed; boundary=\""));
        let parties = parties(&mime);
        assert_eq!(parties.len(), 2);

        assert!(parties[0].0.contains("text/plain"));
        assert_eq!(parties[0].1, b"Un mot.");

        assert!(
            parties[1]
                .0
                .contains("Content-Type: application/pdf; name=\"devis.pdf\"")
        );
        assert!(
            parties[1]
                .0
                .contains("Content-Disposition: attachment; filename=\"devis.pdf\"")
        );
        assert_eq!(parties[1].1, b"%PDF-1.7 contenu");
    }

    #[test]
    fn le_contenu_d_un_fichier_arrive_a_l_octet_pres() {
        // Tous les octets possibles, sur plus d'une ligne repliée : un encodage
        // qui passerait par du texte en perdrait en route.
        let contenu: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        let mut b = brouillon();
        b.pieces = vec![piece("donnees.bin", "application/octet-stream", &contenu)];

        let mime = composer(&b).unwrap();

        assert_eq!(parties(&mime)[1].1, contenu);
        assert!(mime.lines().all(|l| l.len() <= 78), "lignes repliées");
    }

    #[test]
    fn plusieurs_fichiers_gardent_leur_ordre() {
        let mut b = brouillon();
        b.pieces = vec![
            piece("a.txt", "text/plain", b"premier"),
            piece("b.txt", "text/plain", b"second"),
        ];

        let parties = parties(&composer(&b).unwrap());

        assert_eq!(parties.len(), 3);
        assert_eq!(parties[1].1, b"premier");
        assert_eq!(parties[2].1, b"second");
    }

    #[test]
    fn sans_fichier_le_message_reste_un_texte_simple() {
        let mime = composer(&brouillon()).unwrap();

        assert!(!mime.contains("multipart"));
        assert!(!mime.contains("boundary"));
    }

    #[test]
    fn un_nom_de_fichier_accentue_est_encode() {
        let mut b = brouillon();
        b.pieces = vec![piece("résumé été.pdf", "application/pdf", b"x")];

        let mime = composer(&b).unwrap();

        assert!(!mime.contains("résumé"));
        assert!(mime.contains("filename=\"=?UTF-8?B?"));
        assert!(
            mime.is_ascii(),
            "un message MIME est en ASCII de bout en bout"
        );
    }

    #[test]
    fn un_nom_de_fichier_avec_fin_de_ligne_est_refuse() {
        // La règle du module vaut pour le nom comme pour l'objet : sans elle,
        // un fichier bien nommé ajouterait ses propres en-têtes à la partie.
        let mut b = brouillon();
        b.pieces = vec![piece(
            "a.txt\r\nContent-Type: text/html",
            "text/plain",
            b"x",
        )];

        assert_eq!(composer(&b).unwrap_err().code(), "CONFIG_INVALIDE");
    }

    #[test]
    fn un_nom_de_fichier_ne_peut_pas_fermer_ses_guillemets() {
        let mut b = brouillon();
        b.pieces = vec![piece("a\".txt; x=\"y", "text/plain", b"x")];

        let mime = composer(&b).unwrap();

        assert!(mime.contains("filename=\"a_.txt; x=_y\""));
    }

    #[test]
    fn un_chemin_ne_part_pas_avec_le_fichier() {
        assert_eq!(
            nom_de_piece("C:\\Users\\moi\\Documents\\devis.pdf").unwrap(),
            "devis.pdf"
        );
        assert_eq!(nom_de_piece("/home/moi/devis.pdf").unwrap(), "devis.pdf");
        assert_eq!(nom_de_piece("  ").unwrap(), "fichier");
    }

    #[test]
    fn un_type_fantaisiste_retombe_sur_le_type_generique() {
        assert_eq!(type_de_piece("application/pdf"), "application/pdf");
        assert_eq!(type_de_piece("Image/PNG"), "image/png");
        assert_eq!(type_de_piece(""), "application/octet-stream");
        assert_eq!(type_de_piece("pdf"), "application/octet-stream");
        assert_eq!(
            type_de_piece("text/html; charset=x"),
            "application/octet-stream"
        );
        assert_eq!(
            type_de_piece("text/plain\r\nBcc: x@y.z"),
            "application/octet-stream"
        );
    }

    #[test]
    fn des_fichiers_trop_lourds_sont_refuses_avant_l_envoi() {
        let mut b = brouillon();
        b.pieces = vec![piece(
            "film.mp4",
            "video/mp4",
            &vec![0u8; POIDS_MAX_PIECES + 1],
        )];

        assert_eq!(composer(&b).unwrap_err().code(), "CONFIG_INVALIDE");
    }

    #[test]
    fn la_frontiere_ne_peut_pas_figurer_dans_une_partie() {
        // Elle porte un `_`, que l'alphabet base64 ne contient pas.
        assert!(frontiere().contains('_'));
        assert!(frontiere().starts_with("=_"));
    }

    /// Le décodage du corps, pour éprouver ce qui arrivera vraiment.
    fn corps_decode(mime: &str) -> String {
        let (_, corps) = mime
            .split_once("\r\n\r\n")
            .expect("le MIME sépare ses parties");
        let sans_repli = corps.replace("\r\n", "");
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(sans_repli)
                .expect("corps en base64"),
        )
        .expect("corps en UTF-8")
    }

    #[test]
    fn un_message_simple_porte_ses_entetes_et_son_corps() {
        let mime = composer(&brouillon()).unwrap();

        assert!(mime.contains("From: moi@exemple.fr\r\n"));
        assert!(mime.contains("To: toi@exemple.fr\r\n"));
        assert!(mime.contains("Subject: Bonjour\r\n"));
        assert!(mime.contains("Content-Type: text/plain; charset=\"UTF-8\"\r\n"));
        assert_eq!(corps_decode(&mime), "Un mot.");
    }

    #[test]
    fn les_copies_ne_figurent_que_lorsqu_il_y_en_a() {
        let sans = composer(&brouillon()).unwrap();
        assert!(!sans.contains("Cc:"));

        let mut avec = brouillon();
        avec.copies = vec!["elle@exemple.fr".into(), "lui@exemple.fr".into()];

        let mime = composer(&avec).unwrap();
        assert!(mime.contains("Cc: elle@exemple.fr, lui@exemple.fr\r\n"));
    }

    #[test]
    fn une_copie_vide_ne_bloque_pas_l_envoi() {
        // Le champ « Cc » qu'on ouvre puis qu'on laisse tel quel arrive ainsi.
        let mut b = brouillon();
        b.copies = vec!["  ".into(), String::new()];

        let mime = composer(&b).unwrap();
        assert!(!mime.contains("Cc:"));
    }

    #[test]
    fn un_objet_accentue_est_encode_et_non_envoye_tel_quel() {
        let mut b = brouillon();
        b.sujet = "Réunion de rentrée".into();

        let mime = composer(&b).unwrap();

        assert!(mime.contains("Subject: =?UTF-8?B?"));
        assert!(!mime.contains("Réunion"));
    }

    #[test]
    fn un_objet_sans_accent_reste_lisible_dans_le_message() {
        let mime = composer(&brouillon()).unwrap();

        assert!(mime.contains("Subject: Bonjour\r\n"));
        assert!(!mime.contains("=?UTF-8?B?"));
    }

    #[test]
    fn un_corps_accentue_traverse_l_encodage_sans_perte() {
        let mut b = brouillon();
        b.corps = "Voilà où en est le dossier : à revoir.\nÀ demain — moi".into();

        let mime = composer(&b).unwrap();

        assert_eq!(
            corps_decode(&mime),
            "Voilà où en est le dossier : à revoir.\nÀ demain — moi"
        );
    }

    /// Le test qui compte.
    ///
    /// Sans lui, un objet contenant `\r\n` écrirait ses propres en-têtes à la
    /// suite du nôtre : une copie cachée vers un tiers, un `From` refait, ou un
    /// corps entier remplacé. Le cas n'est pas théorique : au transfert, l'objet
    /// reproduit est celui de l'expéditeur d'origine, c'est-à-dire de n'importe
    /// qui.
    #[test]
    fn un_objet_qui_porte_une_fin_de_ligne_est_refuse_et_non_nettoye() {
        for hostile in [
            "Facture\r\nBcc: pirate@exemple.net",
            "Facture\nBcc: pirate@exemple.net",
            "Facture\rBcc: pirate@exemple.net",
            "Facture\0Bcc: pirate@exemple.net",
        ] {
            let mut b = brouillon();
            b.sujet = hostile.into();

            let resultat = composer(&b);

            assert!(
                resultat.is_err(),
                "« {hostile} » doit être refusé, pas rafistolé"
            );
        }
    }

    #[test]
    fn une_adresse_qui_porte_une_fin_de_ligne_est_refusee() {
        let mut b = brouillon();
        b.destinataires = vec!["toi@exemple.fr\r\nBcc: pirate@exemple.net".into()];

        assert!(composer(&b).is_err());
    }

    #[test]
    fn une_adresse_qui_en_cache_une_seconde_est_refusee() {
        // Les chevrons séparent nom affiché et adresse ; la virgule sépare deux
        // destinataires. L'un comme l'autre laisserait glisser une adresse de
        // plus dans un champ qui n'en attend qu'une.
        for hostile in [
            "\"Banque\" <pirate@exemple.net>",
            "toi@exemple.fr, pirate@exemple.net",
            "toi@exemple.fr; pirate@exemple.net",
        ] {
            let mut b = brouillon();
            b.destinataires = vec![hostile.into()];

            assert!(composer(&b).is_err(), "« {hostile} » doit être refusé");
        }
    }

    #[test]
    fn un_message_sans_destinataire_ne_part_pas() {
        let mut b = brouillon();
        b.destinataires = vec![];

        assert!(composer(&b).is_err());
    }

    #[test]
    fn un_destinataire_fait_de_blancs_ne_compte_pas_pour_un() {
        let mut b = brouillon();
        b.destinataires = vec!["   ".into()];

        assert!(composer(&b).is_err());
    }

    #[test]
    fn le_corps_encode_ne_depasse_jamais_soixante_seize_colonnes() {
        let mut b = brouillon();
        b.corps = "x".repeat(5_000);

        let mime = composer(&b).unwrap();
        let (_, corps) = mime.split_once("\r\n\r\n").unwrap();

        for ligne in corps.split("\r\n") {
            assert!(ligne.len() <= 76, "ligne de {} caractères", ligne.len());
        }
    }

    #[test]
    fn un_long_corps_se_relit_a_l_identique_malgre_le_repli() {
        let mut b = brouillon();
        b.corps = "Une phrase accentuée : à é î ô ù. ".repeat(200);

        let mime = composer(&b).unwrap();

        assert_eq!(corps_decode(&mime), b.corps);
    }

    #[test]
    fn l_encodage_pour_gmail_n_emploie_ni_plus_ni_barre_oblique() {
        // `base64url` : l'API refuse le base64 ordinaire, dont les caractères
        // `+` et `/` n'ont pas leur place dans un corps JSON d'URL.
        let mime = composer(&brouillon()).unwrap();
        let encode = encoder_pour_gmail(&mime);

        assert!(!encode.contains('+'));
        assert!(!encode.contains('/'));
        assert!(!encode.contains('='));
    }

    #[test]
    fn l_objet_de_transfert_ne_s_empile_pas() {
        assert_eq!(objet_de_transfert("Facture"), "Tr : Facture");
        assert_eq!(objet_de_transfert("Tr : Facture"), "Tr : Facture");
        assert_eq!(objet_de_transfert("TR : Facture"), "TR : Facture");
        assert_eq!(objet_de_transfert("Fwd: Invoice"), "Fwd: Invoice");
    }

    #[test]
    fn un_transfert_sans_objet_le_dit() {
        assert_eq!(objet_de_transfert("   "), "Tr : (sans objet)");
    }
}
