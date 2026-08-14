//! Lecture minimale de balises HTML.
//!
//! Deux besoins seulement — retrouver l'icône déclarée dans un `<head>`, et les
//! images d'un corps de message — dont aucun ne justifie un analyseur complet.
//! Rien de ce qui sort d'ici n'est réinterprété comme du balisage.

/// Valeur d'un attribut dans une balise HTML.
///
/// Écrit à la main plutôt qu'avec un analyseur complet : on ne lit qu'une
/// balise `<link>`, et rien de ce qui en sort n'est interprété comme du HTML.
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
}
