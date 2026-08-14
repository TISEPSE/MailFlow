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

use crate::gmail::modele::Charge;

/// Au-delà, on n'affiche pas : ce n'est plus une lettre, c'est un document.
const TAILLE_MAX: usize = 2 * 1024 * 1024;

/// Ce qu'on a su tirer d'un message.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
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

fn fin_de_balise(bas: &str, debut: usize) -> usize {
    bas[debut..].find('>').map_or(bas.len(), |f| debut + f + 1)
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
    fn un_corps_demesure_est_refuse() {
        use base64::Engine;
        let enorme =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(vec![b'a'; TAILLE_MAX + 1]);

        assert!(decoder(&enorme).is_none());
    }
}
