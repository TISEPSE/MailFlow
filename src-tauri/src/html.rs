//! Lecture minimale de balises HTML.
//!
//! Deux besoins seulement — retrouver l'icône déclarée dans un `<head>`, et les
//! images d'un corps de message — dont aucun ne justifie un analyseur complet.
//! Rien de ce qui sort d'ici n'est réinterprété comme du balisage.

/// Valeur d'un attribut dans une balise HTML.
///
/// Écrit à la main plutôt qu'avec un analyseur complet : on ne lit qu'une
/// balise `<link>`, et rien de ce qui en sort n'est interprété comme du HTML.
/// Rend son texte à une chaîne échappée en HTML.
///
/// # Pourquoi Gmail nous en envoie
///
/// Le `snippet` d'un message est destiné à être posé dans une page web : Gmail
/// l'échappe donc avant de le rendre. Affiché tel quel dans une interface qui
/// n'interprète rien, il montre sa mécanique — « Quelqu&#39;un de Ministère des
/// Armées », qu'aucun expéditeur n'a jamais écrit.
///
/// # Ce que cette fonction n'est pas
///
/// Un décodeur d'entités complet, ni un analyseur HTML. Elle traite les cinq
/// entités nommées que produit un échappement standard et les formes
/// numériques. Rien de ce qu'elle rend n'est réinterprété comme du balisage —
/// c'est du texte, affiché comme du texte, et c'est ce qui rend l'opération
/// sûre : décoder `&lt;script&gt;` ne crée pas un script, cela crée les
/// caractères qu'un correspondant a réellement tapés.
pub fn desechapper(texte: &str) -> String {
    if !texte.contains('&') {
        return texte.to_string();
    }

    let mut sortie = String::with_capacity(texte.len());
    let octets = texte.as_bytes();
    let mut i = 0;

    while i < texte.len() {
        if octets[i] != b'&' {
            // On avance d'un caractère entier : une coupure au milieu d'un
            // octet UTF-8 rendrait une chaîne invalide.
            let suivant = (i + 1..=texte.len())
                .find(|&j| texte.is_char_boundary(j))
                .unwrap_or(texte.len());
            sortie.push_str(&texte[i..suivant]);
            i = suivant;
            continue;
        }

        // Une entité se termine par `;` et reste courte. Sans cette borne, un
        // `&` isolé ferait parcourir tout le reste du texte à chaque fois.
        let fin = texte[i..]
            .char_indices()
            .take(12)
            .find(|(_, c)| *c == ';')
            .map(|(o, _)| i + o);

        let Some(fin) = fin else {
            sortie.push('&');
            i += 1;
            continue;
        };

        let corps = &texte[i + 1..fin];
        let rendu = match corps {
            "amp" => Some("&".to_string()),
            "lt" => Some("<".to_string()),
            "gt" => Some(">".to_string()),
            "quot" => Some("\"".to_string()),
            "apos" | "#39" => Some("'".to_string()),
            "nbsp" => Some("\u{a0}".to_string()),
            _ => numerique(corps).map(|c| c.to_string()),
        };

        match rendu {
            Some(texte_rendu) => {
                sortie.push_str(&texte_rendu);
                i = fin + 1;
            }
            // Ce qu'on ne sait pas lire reste tel quel : mieux vaut un « &eacute; »
            // visible qu'un caractère inventé.
            None => {
                sortie.push('&');
                i += 1;
            }
        }
    }

    sortie
}

/// `#39`, `#x27` → le caractère correspondant, s'il en existe un.
fn numerique(corps: &str) -> Option<char> {
    let chiffres = corps.strip_prefix('#')?;
    let point = match chiffres.strip_prefix(['x', 'X']) {
        Some(hexa) => u32::from_str_radix(hexa, 16).ok()?,
        None => chiffres.parse::<u32>().ok()?,
    };
    char::from_u32(point)
}

pub fn valeur_attribut(balise: &str, nom: &str) -> Option<String> {
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

/// Position juste après le `>` qui ferme une balise ouverte en `debut`.
///
/// Une balise jamais refermée s'étend jusqu'à la fin du document : c'est aussi
/// ce que ferait un navigateur.
pub fn fin_de_balise(bas: &str, debut: usize) -> usize {
    bas[debut..].find('>').map_or(bas.len(), |f| debut + f + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_formes_usuelles_de_valeur_sont_lues() {
        assert_eq!(
            valeur_attribut(r#"<a href="/x">"#, "href").as_deref(),
            Some("/x")
        );
        assert_eq!(
            valeur_attribut("<a href='/y'>", "href").as_deref(),
            Some("/y")
        );
        assert_eq!(
            valeur_attribut("<a href=/z>", "href").as_deref(),
            Some("/z")
        );
    }

    #[test]
    fn un_nom_d_attribut_ne_se_trouve_pas_au_milieu_d_un_autre() {
        // Sans quoi `rel` serait lu dans `hreflang` ou `data-rel`.
        assert_eq!(
            valeur_attribut(r#"<link hreflang="fr" rel="icon">"#, "rel").as_deref(),
            Some("icon")
        );
        assert_eq!(valeur_attribut(r#"<link data-src="x">"#, "src"), None);
    }

    #[test]
    fn une_balise_non_refermee_s_etend_jusqu_a_la_fin() {
        assert_eq!(fin_de_balise("<img src=x", 0), 10);
    }

    #[test]
    fn l_apostrophe_echappee_par_gmail_redevient_une_apostrophe() {
        // Le cas vu à l'écran : « Quelqu&#39;un de Ministère des Armées ».
        assert_eq!(
            desechapper("Quelqu&#39;un a trouvé votre profil"),
            "Quelqu'un a trouvé votre profil"
        );
    }

    #[test]
    fn les_entites_nommees_courantes_sont_rendues() {
        assert_eq!(
            desechapper("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"),
            "a & b <c> \"d\" 'e'"
        );
    }

    #[test]
    fn les_formes_numeriques_decimale_et_hexadecimale_se_valent() {
        assert_eq!(desechapper("&#233;t&#xe9;"), "été");
    }

    #[test]
    fn ce_qu_on_ne_sait_pas_lire_reste_lisible() {
        // Un caractère inventé serait pire qu'une entité visible.
        assert_eq!(desechapper("&eacute; & &#zz;"), "&eacute; & &#zz;");
    }

    #[test]
    fn un_texte_sans_entite_traverse_intact() {
        // Y compris les caractères hors ASCII, qu'un parcours par octets
        // couperait au milieu.
        assert_eq!(desechapper("Été à Nîmes 🍋"), "Été à Nîmes 🍋");
    }

    #[test]
    fn une_esperluette_isolee_ne_fait_pas_boucler() {
        assert_eq!(desechapper("R&D & co"), "R&D & co");
        assert_eq!(desechapper("&"), "&");
    }
}
