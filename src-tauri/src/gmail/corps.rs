//! Corps des messages : extraction MIME, décodage, désinfection.
//!
//! # Pourquoi ce module a mis si longtemps à exister
//!
//! Le corps d'un e-mail est du HTML écrit par un inconnu. L'afficher dans une
//! application de bureau, c'est lui donner une occasion de s'exécuter chez
//! l'utilisateur. MailFlow s'en est passé tant qu'il n'y avait pas de cadre sûr
//! pour le montrer.
//!
//! # Ce qui protège réellement
//!
//! Trois barrières, dans cet ordre d'importance.
//!
//! 1. **Le bac à sable du navigateur.** L'interface affiche ce HTML dans une
//!    `iframe` déclarée `sandbox` sans `allow-scripts` : le moteur refuse
//!    d'exécuter le moindre script, quoi que contienne le document. C'est une
//!    garantie du navigateur, pas une promesse de notre part.
//!
//! 2. **Une politique de sécurité dans le document lui-même.** `default-src
//!    'none'` interdit toute requête sortante. Les images distantes ne partent
//!    donc pas — et avec elles les pixels de suivi, qui signaleraient à
//!    l'expéditeur l'heure exacte à laquelle son message a été ouvert.
//!
//! 3. **Le nettoyage fait ici.** Il retire les scripts, les gestionnaires
//!    d'événements et les URL `javascript:`. C'est une précaution de plus, pas
//!    la barrière principale : un nettoyeur écrit à la main se contourne, un
//!    bac à sable non. Il ne faut donc jamais rien lui faire porter seul.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::gmail::modele::Charge;
use crate::html::{fin_de_balise, valeur_attribut};

/// Au-delà, on n'affiche pas : ce n'est plus une lettre, c'est un document.
const TAILLE_MAX: usize = 2 * 1024 * 1024;

/// Nombre d'images qu'on veut bien rapatrier pour un message.
///
/// Une lettre commerciale en compte une trentaine ; au-delà, on est face à un
/// document qui ferait attendre l'utilisateur sans rien lui apprendre de plus.
pub const IMAGES_MAX: usize = 40;

/// Ce qu'on a su tirer d'un message.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CorpsMessage {
    pub html: Option<String>,
    pub texte: Option<String>,
}

impl CorpsMessage {
    pub fn est_vide(&self) -> bool {
        self.html.is_none() && self.texte.is_none()
    }
}

/// Décode le `base64url` de Gmail.
///
/// Gmail emploie l'alphabet URL — `-` et `_` — et omet le remplissage. Le
/// décodeur standard échouerait sur les deux.
pub fn decoder(donnees: &str) -> Option<String> {
    use base64::Engine;

    let octets = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(donnees.trim_end_matches('='))
        .ok()?;

    if octets.len() > TAILLE_MAX {
        return None;
    }

    // Un corps mal étiqueté ne doit pas faire disparaître le message entier :
    // les octets invalides deviennent le caractère de remplacement.
    Some(String::from_utf8_lossy(&octets).into_owned())
}

/// Parcourt l'arbre MIME et retient la meilleure version de chaque type.
///
/// Un message `multipart/alternative` porte les deux, du plus pauvre au plus
/// riche ; un `multipart/related` cache le HTML sous un niveau de plus. On
/// descend donc partout plutôt que de supposer une forme.
pub fn extraire(charge: &Charge) -> CorpsMessage {
    let mut corps = CorpsMessage::default();
    collecter(charge, &mut corps);
    corps
}

fn collecter(charge: &Charge, corps: &mut CorpsMessage) {
    let mime = charge.mime_type.as_deref().unwrap_or("");

    // Une pièce jointe porte un nom de fichier. Son contenu n'est pas le corps
    // du message, même quand son type est `text/html`.
    let piece_jointe = charge.filename.as_deref().is_some_and(|f| !f.is_empty());

    if !piece_jointe && let Some(donnees) = charge.body.as_ref().and_then(|b| b.data.as_deref()) {
        match mime {
            "text/html" if corps.html.is_none() => corps.html = decoder(donnees),
            "text/plain" if corps.texte.is_none() => corps.texte = decoder(donnees),
            _ => {}
        }
    }

    for partie in &charge.parts {
        collecter(partie, corps);
    }
}

/// Les `src` d'images d'un document, dans l'ordre d'apparition, sans doublon.
///
/// Sert deux besoins : relier un `cid:` à la pièce jointe qui le porte, et
/// dresser la liste des adresses distantes à rapatrier côté Rust — le cadre
/// d'affichage, lui, n'a le droit d'émettre aucune requête.
pub fn sources_d_images(html: &str) -> Vec<String> {
    let bas = html.to_lowercase();
    let mut trouvees: Vec<String> = Vec::new();
    let mut depuis = 0;

    while let Some(pos) = bas[depuis..].find("<img") {
        let debut = depuis + pos;
        let fin = fin_de_balise(&bas, debut);
        depuis = fin.max(debut + 4);

        // `<image>` n'est pas `<img>` ; sans ce contrôle, on capturerait des
        // balises qui n'en sont pas.
        if bas[debut + 4..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            continue;
        }

        let Some(src) = valeur_attribut(&html[debut..fin], "src") else {
            continue;
        };
        let src = src.trim().to_string();

        if src.is_empty() || src.starts_with("data:") || trouvees.contains(&src) {
            continue;
        }
        if trouvees.len() == IMAGES_MAX {
            break;
        }
        trouvees.push(src);
    }

    trouvees
}

/// Remplace les `src` d'images par les URI de données fournies.
///
/// Ce qui manque à la table reste tel quel : le cadre d'affichage n'a pas le
/// droit d'aller le chercher, et l'image montrera son texte de remplacement.
/// C'est préférable à une image vide sans explication.
pub fn substituer_images(html: &str, table: &HashMap<String, String>) -> String {
    if table.is_empty() {
        return html.to_string();
    }

    let mut sortie = String::with_capacity(html.len());
    let bas = html.to_lowercase();
    let mut i = 0;

    while let Some(pos) = bas[i..].find("<img") {
        let debut = i + pos;
        let fin = fin_de_balise(&bas, debut);
        sortie.push_str(&html[i..debut]);
        i = fin;

        let balise = &html[debut..fin];
        match valeur_attribut(balise, "src")
            .and_then(|src| table.get(src.trim()).map(|uri| (src, uri)))
        {
            Some((src, uri)) => sortie.push_str(&balise.replace(&src, uri)),
            None => sortie.push_str(balise),
        }
    }

    sortie.push_str(&html[i..]);
    sortie
}

/// Identifiants de pièces jointes, indexés par la référence `cid:` qui les
/// désigne dans le HTML.
///
/// Un `Content-ID` s'écrit `<abc@def>` dans l'en-tête et `cid:abc@def` dans le
/// document : les chevrons sont à retirer, sans quoi rien ne se relie.
pub fn pieces_par_cid(charge: &Charge) -> HashMap<String, String> {
    let mut table = HashMap::new();
    collecter_cid(charge, &mut table);
    table
}

fn collecter_cid(charge: &Charge, table: &mut HashMap<String, String>) {
    let identifiant = charge
        .headers
        .iter()
        .find(|e| e.name.eq_ignore_ascii_case("content-id"))
        .map(|e| e.value.trim().trim_start_matches('<').trim_end_matches('>'));

    if let Some(cid) = identifiant
        && !cid.is_empty()
        && let Some(piece) = charge
            .body
            .as_ref()
            .and_then(|b| b.attachment_id.as_deref())
    {
        table.insert(format!("cid:{cid}"), piece.to_string());
    }

    for partie in &charge.parts {
        collecter_cid(partie, table);
    }
}

/// Retire d'un HTML de tiers ce qui n'a rien à faire dans une lettre.
///
/// Précaution de plus, jamais la barrière principale : voir la documentation du
/// module. Le résultat reste destiné à une `iframe` en bac à sable.
pub fn assainir(html: &str) -> String {
    let mut sortie = String::with_capacity(html.len());
    let bas = html.to_lowercase();
    let mut i = 0;

    while let Some(pos) = bas[i..].find('<') {
        let debut = i + pos;
        sortie.push_str(&html[i..debut]);

        let reste = &bas[debut..];
        if let Some(nom) = balise_a_supprimer(reste) {
            // Le contenu de ces balises est du code, pas du texte : on saute
            // jusqu'à la fermeture plutôt que de le laisser s'afficher en clair.
            i = fin_de_bloc(&bas, debut, nom);
            continue;
        }

        let fin = fin_de_balise(&bas, debut);
        sortie.push_str(&nettoyer_attributs(&html[debut..fin]));
        i = fin;
    }

    sortie.push_str(&html[i..]);
    sortie
}

/// Balises dont le contenu entier doit disparaître.
fn balise_a_supprimer(reste: &str) -> Option<&'static str> {
    for nom in ["script", "iframe", "object", "embed", "frame", "frameset"] {
        let ouvrante = format!("<{nom}");
        if reste.starts_with(&ouvrante) {
            let apres = reste.as_bytes().get(ouvrante.len());
            // `<scriptural>` n'est pas `<script>`.
            if apres.is_none_or(|c| !c.is_ascii_alphanumeric()) {
                return Some(nom);
            }
        }
    }
    None
}

fn fin_de_bloc(bas: &str, debut: usize, nom: &str) -> usize {
    let fermeture = format!("</{nom}");
    match bas[debut..].find(&fermeture) {
        Some(pos) => fin_de_balise(bas, debut + pos),
        // Balise jamais refermée : tout ce qui suit lui appartient.
        None => bas.len(),
    }
}

/// Retire d'une balise ses gestionnaires d'événements et ses URL exécutables.
fn nettoyer_attributs(balise: &str) -> String {
    let bas = balise.to_lowercase();
    if !bas.contains("on") && !bas.contains("javascript:") {
        return balise.to_string();
    }

    let mut sortie = String::with_capacity(balise.len());
    let mut i = 0;

    while i < balise.len() {
        let reste = &bas[i..];
        let saut = reste.find([' ', '\t', '\n', '\r']).map(|p| i + p + 1);

        let Some(debut_attribut) = saut else {
            sortie.push_str(&balise[i..]);
            break;
        };

        sortie.push_str(&balise[i..debut_attribut]);
        let attribut = &bas[debut_attribut..];

        if commence_par_gestionnaire(attribut)
            || attribut.starts_with("href=\"javascript:")
            || attribut.starts_with("href='javascript:")
            || attribut.starts_with("src=\"javascript:")
            || attribut.starts_with("src='javascript:")
        {
            i = fin_d_attribut(&bas, debut_attribut);
            continue;
        }

        i = debut_attribut;
        let fin = fin_d_attribut(&bas, debut_attribut);
        sortie.push_str(&balise[i..fin]);
        i = fin;
    }

    sortie
}

/// Tout attribut dont le nom commence par `on` suivi de lettres.
///
/// Volontairement large : aucun attribut HTML standard ne commence par `on`
/// hormis les gestionnaires d'événements. Chercher à distinguer `onclick` d'un
/// hypothétique `once` reviendrait à tenir la liste de tous les événements
/// existants — et à laisser passer le premier qui manquerait.
fn commence_par_gestionnaire(attribut: &str) -> bool {
    let Some(reste) = attribut.strip_prefix("on") else {
        return false;
    };
    let nom: String = reste
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    !nom.is_empty() && reste[nom.len()..].trim_start().starts_with('=')
}

/// Fin d'un attribut, valeur entre guillemets comprise.
fn fin_d_attribut(bas: &str, debut: usize) -> usize {
    let reste = &bas[debut..];
    let Some(egal) = reste.find('=') else {
        return reste
            .find([' ', '\t', '\n', '\r', '>'])
            .map_or(bas.len(), |p| debut + p);
    };

    let apres = reste[egal + 1..].trim_start();
    let decalage = debut + egal + 1 + (reste[egal + 1..].len() - apres.len());

    for guillemet in ['"', '\''] {
        if apres.starts_with(guillemet) {
            return bas[decalage + 1..]
                .find(guillemet)
                .map_or(bas.len(), |p| decalage + 1 + p + 1);
        }
    }

    bas[decalage..]
        .find([' ', '\t', '\n', '\r', '>'])
        .map_or(bas.len(), |p| decalage + p)
}

/// Dossier où déposer les corps déjà chargés.
///
/// `$XDG_RUNTIME_DIR` de préférence : le système l'efface à chaque démarrage de
/// la machine. Fermer et rouvrir MailFlow retrouve donc tout, mais éteindre
/// l'ordinateur remet à zéro — le contenu des messages ne s'installe jamais
/// durablement sur le disque.
pub fn dossier_cache() -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);

    base.join("mailflow").join("corps")
}

/// Chemin du fichier d'un message.
///
/// L'identifiant vient de Gmail, mais il ne sert jamais tel quel comme nom de
/// fichier : la même précaution que pour les logos, pour la même raison.
pub fn chemin_cache(dossier: &Path, id: &str) -> PathBuf {
    let sur: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    dossier.join(format!("{sur}.json"))
}

/// Lit un corps déjà rangé, ou `None`.
pub fn lire(dossier: &Path, id: &str) -> Option<CorpsMessage> {
    let texte = std::fs::read_to_string(chemin_cache(dossier, id)).ok()?;
    serde_json::from_str(&texte).ok()
}

/// Range un corps. Un échec d'écriture n'est pas une raison de ne rien rendre.
pub fn ranger(dossier: &Path, id: &str, corps: &CorpsMessage) {
    let _ = std::fs::create_dir_all(dossier);
    if let Ok(texte) = serde_json::to_string(corps) {
        let _ = std::fs::write(chemin_cache(dossier, id), texte);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::modele::{Charge, CorpsPartie};

    fn encoder(texte: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(texte)
    }

    fn partie(mime: &str, contenu: &str) -> Charge {
        Charge {
            mime_type: Some(mime.into()),
            body: Some(CorpsPartie {
                data: Some(encoder(contenu)),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn l_alphabet_url_de_gmail_est_decode() {
        // Le décodeur standard échouerait sur `-`, `_` et l'absence de
        // remplissage.
        let brut = "PGI-w6nDoDwvYj4";

        assert_eq!(decoder(brut).as_deref(), Some("<b>éà</b>"));
    }

    #[test]
    fn un_corps_illisible_ne_fait_pas_disparaitre_le_message() {
        use base64::Engine;
        let invalide = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0xff, 0xfe]);

        assert!(decoder(&invalide).is_some());
    }

    #[test]
    fn le_html_est_prefere_mais_le_texte_est_conserve() {
        let message = Charge {
            mime_type: Some("multipart/alternative".into()),
            parts: vec![
                partie("text/plain", "bonjour"),
                partie("text/html", "<p>bonjour</p>"),
            ],
            ..Default::default()
        };

        let corps = extraire(&message);

        assert_eq!(corps.html.as_deref(), Some("<p>bonjour</p>"));
        assert_eq!(corps.texte.as_deref(), Some("bonjour"));
    }

    #[test]
    fn le_html_est_trouve_meme_imbrique() {
        // `multipart/related` range le HTML sous un niveau de plus, avec les
        // images qu'il référence.
        let message = Charge {
            mime_type: Some("multipart/mixed".into()),
            parts: vec![Charge {
                mime_type: Some("multipart/related".into()),
                parts: vec![partie("text/html", "<p>ici</p>")],
                ..Default::default()
            }],
            ..Default::default()
        };

        assert_eq!(extraire(&message).html.as_deref(), Some("<p>ici</p>"));
    }

    #[test]
    fn un_message_simple_sans_parties_est_lu() {
        assert_eq!(
            extraire(&partie("text/plain", "juste du texte"))
                .texte
                .as_deref(),
            Some("juste du texte")
        );
    }

    #[test]
    fn une_piece_jointe_n_est_pas_prise_pour_le_corps() {
        // Une facture en HTML jointe au message remplacerait sinon le message.
        let mut jointe = partie("text/html", "<p>facture</p>");
        jointe.filename = Some("facture.html".into());

        let message = Charge {
            mime_type: Some("multipart/mixed".into()),
            parts: vec![jointe, partie("text/html", "<p>le vrai corps</p>")],
            ..Default::default()
        };

        assert_eq!(
            extraire(&message).html.as_deref(),
            Some("<p>le vrai corps</p>")
        );
    }

    #[test]
    fn un_message_sans_corps_ne_rend_rien() {
        let corps = extraire(&Charge::default());

        assert!(corps.est_vide());
    }

    #[test]
    fn les_scripts_disparaissent_avec_leur_contenu() {
        // Laisser le contenu afficherait du code en clair au milieu de la
        // lettre, ce qui est laid autant que suspect.
        let sale = "<p>avant</p><script>alert(1)</script><p>après</p>";

        assert_eq!(assainir(sale), "<p>avant</p><p>après</p>");
    }

    #[test]
    fn un_script_jamais_referme_emporte_toute_la_suite() {
        // Le navigateur ferait de même : mieux vaut perdre la fin du message
        // que de la rendre exécutable.
        let sale = "<p>avant</p><script>tout ce qui suit";

        assert_eq!(assainir(sale), "<p>avant</p>");
    }

    #[test]
    fn les_cadres_imbriques_sont_retires() {
        let sale = "<iframe src=\"https://ailleurs.fr\"></iframe><p>reste</p>";

        assert_eq!(assainir(sale), "<p>reste</p>");
    }

    #[test]
    fn une_balise_qui_commence_comme_script_est_conservee() {
        // `<scriptural>` n'existe pas, mais la règle doit porter sur le nom
        // entier : autrement, une balise inconnue emporterait la page.
        let html = "<scriptural>gardé</scriptural>";

        assert_eq!(assainir(html), html);
    }

    #[test]
    fn les_gestionnaires_d_evenements_sont_retires() {
        let sale = r#"<img src="x" onerror="alert(1)" alt="a">"#;

        let propre = assainir(sale);

        assert!(!propre.contains("onerror"));
        assert!(propre.contains(r#"src="x""#));
        assert!(propre.contains(r#"alt="a""#));
    }

    #[test]
    fn tout_attribut_en_on_est_retire() {
        // La règle est large à dessein : aucun attribut HTML standard ne
        // commence par `on`. Tenir la liste des événements pour épargner un
        // `once=` inventé, c'est se condamner à rater celui qui manquera.
        let sale = r#"<div onclick="x" once="1" class="c">texte</div>"#;

        let propre = assainir(sale);

        assert!(!propre.contains("onclick"));
        assert!(!propre.contains("once"));
        assert!(propre.contains(r#"class="c""#));
        assert!(propre.contains("texte"));
    }

    #[test]
    fn les_liens_executables_sont_retires() {
        let sale = r#"<a href="javascript:alert(1)">clic</a>"#;

        assert!(!assainir(sale).contains("javascript:"));
    }

    #[test]
    fn un_message_ordinaire_traverse_sans_dommage() {
        // La désinfection ne doit pas abîmer ce qu'elle ne comprend pas : la
        // plupart des lettres sont des tableaux et des styles en ligne.
        let sain = r#"<table style="width:100%"><tr><td class="a">
            <a href="https://exemple.fr">Voir</a><img src="cid:logo"></td></tr></table>"#;

        assert_eq!(assainir(sain), sain);
    }

    #[test]
    fn les_sources_d_images_sont_relevees_dans_l_ordre_sans_doublon() {
        let html = r#"<img src="cid:logo"><p>x</p><img src='https://a.fr/1.png'>
            <img src="cid:logo"><img src="data:image/png;base64,AA">"#;

        assert_eq!(sources_d_images(html), ["cid:logo", "https://a.fr/1.png"]);
    }

    #[test]
    fn le_nombre_d_images_relevees_est_borne() {
        // Sans borne, un document de mille images ferait attendre l'utilisateur
        // sans rien lui apprendre de plus.
        let html: String = (0..IMAGES_MAX + 20)
            .map(|i| format!(r#"<img src="https://a.fr/{i}.png">"#))
            .collect();

        assert_eq!(sources_d_images(&html).len(), IMAGES_MAX);
    }

    #[test]
    fn une_balise_qui_commence_comme_img_n_est_pas_relevee() {
        assert!(sources_d_images(r#"<image src="https://a.fr/1.png"/>"#).is_empty());
    }

    #[test]
    fn les_images_connues_sont_substituees_et_les_autres_laissees() {
        let html = r#"<img src="cid:logo" alt="a"><img src="https://a.fr/2.png">"#;
        let table = HashMap::from([(
            "cid:logo".to_string(),
            "data:image/png;base64,AA".to_string(),
        )]);

        let sortie = substituer_images(html, &table);

        assert!(sortie.contains(r#"src="data:image/png;base64,AA" alt="a""#));
        // Celle qu'on n'a pas su rapatrier garde son adresse : le cadre ne la
        // chargera pas, mais son texte de remplacement s'affichera.
        assert!(sortie.contains(r#"src="https://a.fr/2.png""#));
    }

    #[test]
    fn un_content_id_est_debarrasse_de_ses_chevrons() {
        // L'en-tête écrit `<abc@def>`, le document écrit `cid:abc@def`.
        let charge = Charge {
            mime_type: Some("multipart/related".into()),
            parts: vec![Charge {
                mime_type: Some("image/png".into()),
                headers: vec![crate::gmail::modele::Entete {
                    name: "Content-ID".into(),
                    value: "<abc@def>".into(),
                }],
                body: Some(CorpsPartie {
                    attachment_id: Some("piece-1".into()),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        };

        let table = pieces_par_cid(&charge);

        assert_eq!(
            table.get("cid:abc@def").map(String::as_str),
            Some("piece-1")
        );
    }

    #[test]
    fn une_partie_sans_piece_jointe_n_entre_pas_dans_la_table() {
        // Le corps HTML lui-même porte parfois un `Content-ID` ; le prendre pour
        // une image produirait une substitution absurde.
        let charge = Charge {
            headers: vec![crate::gmail::modele::Entete {
                name: "Content-ID".into(),
                value: "<corps>".into(),
            }],
            body: Some(CorpsPartie {
                data: Some("AA".into()),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(pieces_par_cid(&charge).is_empty());
    }

    #[test]
    fn un_corps_range_se_relit() {
        let dossier = tempfile::tempdir().unwrap();
        let corps = CorpsMessage {
            html: Some("<p>a</p>".into()),
            texte: None,
        };

        ranger(dossier.path(), "m1", &corps);

        assert_eq!(lire(dossier.path(), "m1"), Some(corps));
        assert_eq!(lire(dossier.path(), "inconnu"), None);
    }

    #[test]
    fn le_nom_de_fichier_ne_peut_pas_sortir_du_dossier() {
        // L'identifiant vient de Gmail : il ne sert jamais tel quel.
        let dossier = Path::new("/tmp/corps");
        let chemin = chemin_cache(dossier, "../../etc/passwd");

        assert_eq!(chemin.parent(), Some(dossier));
        let nom = chemin.file_name().unwrap().to_string_lossy();
        assert!(!nom.contains('/') && !nom.contains(".."), "nom : {nom}");
    }

    #[test]
    fn le_cache_vit_dans_un_dossier_efface_au_demarrage_machine() {
        // C'est tout l'intérêt du choix : rien ne s'installe durablement.
        let d = dossier_cache();

        assert!(d.ends_with("mailflow/corps"), "{}", d.display());
    }

    #[test]
    fn un_corps_demesure_est_refuse() {
        use base64::Engine;
        let enorme =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(vec![b'a'; TAILLE_MAX + 1]);

        assert!(decoder(&enorme).is_none());
    }
}
