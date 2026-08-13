//! Serveur éphémère qui recueille la redirection de Google.
//!
//! Après que l'utilisateur a donné son accord, Google renvoie le navigateur vers
//! `http://127.0.0.1:<port>/?code=...&state=...`. Ce module écoute cette unique
//! requête, en extrait le code d'autorisation, et rend la main.
//!
//! Le serveur est volontairement minimal : il ne sert aucun fichier, ne lit qu'une
//! ligne de requête plafonnée, et s'arrête dès qu'il a ce qu'il attend. Tout ce
//! qui arrive sur ce port vient du navigateur de l'utilisateur, mais rien ne
//! garantit que ce soit *seulement* le navigateur : n'importe quel programme de la
//! machine peut s'y connecter tant qu'il est ouvert. D'ou la fenêtre courte et la
//! vérification du `state`.

use crate::error::{AppError, Resultat};

/// Ce que le navigateur a rapporté.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetourAutorisation {
    /// Google a délivré un code. Le `state` reste à vérifier par l'appelant.
    Succes { code: String, state: String },

    /// L'utilisateur a refusé, ou Google a rejeté la demande. Le motif est le
    /// code d'erreur brut du protocole (`access_denied`, `invalid_scope`, ...),
    /// utile dans les logs, jamais montre tel quel.
    Refus { motif: String },
}

/// Analyse la ligne de requête HTTP (`GET /?code=... HTTP/1.1`).
///
/// Une erreur signifie « ce n'est pas la redirection attendue », pas « la
/// connexion a échoué » : le navigateur peut très bien demander `/favicon.ico`
/// sur le même port. L'appelant continue d'écouter jusqu'à son délai.
pub fn analyser_redirection(ligne_requete: &str) -> Resultat<RetourAutorisation> {
    let mut morceaux = ligne_requete.split(' ');

    let methode = morceaux
        .next()
        .ok_or_else(|| AppError::Auth("ligne de requête vide".into()))?;
    if methode != "GET" {
        return Err(AppError::Auth(format!("méthode inattendue : {methode}")));
    }

    let cible = morceaux
        .next()
        .filter(|c| c.starts_with('/'))
        .ok_or_else(|| AppError::Auth("cible de requête absente ou relative".into()))?;

    // `Url` exige une base absolue ; l'hôte est fictif et n'est jamais utilisé.
    let url = url::Url::parse(&format!("http://127.0.0.1{cible}"))
        .map_err(|_| AppError::Auth("cible de requête illisible".into()))?;

    if url.path() != "/" {
        return Err(AppError::Auth(format!("chemin inattendu : {}", url.path())));
    }

    let mut code = None;
    let mut state = None;
    let mut erreur = None;
    for (cle, valeur) in url.query_pairs() {
        match cle.as_ref() {
            "code" => code = Some(valeur.into_owned()),
            "state" => state = Some(valeur.into_owned()),
            "error" => erreur = Some(valeur.into_owned()),
            _ => {}
        }
    }

    if let Some(motif) = erreur {
        return Ok(RetourAutorisation::Refus { motif });
    }

    match (code, state) {
        (Some(code), Some(state)) if !code.is_empty() && !state.is_empty() => {
            Ok(RetourAutorisation::Succes { code, state })
        }
        _ => Err(AppError::Auth(
            "redirection sans code ni state exploitables".into(),
        )),
    }
}

/// Comparaison à temps constant de deux valeurs secrètes.
///
/// Le `state` est compare avant tout traitement. Un `==` classique s'arrête au
/// premier octet différent, ce qui laisse mesurer la position de la divergence et
/// reconstituer la valeur attendue octet par octet.
pub fn secrets_egaux(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    // La longueur, elle, fuite de toute façon : elle est fixée par le générateur.
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Reponse HTTP complète, prête à être écrite sur la socket.
///
/// `Content-Length` compte des **octets**, pas des caractères : un corps accentué
/// tronque le navigateur si on lui donne la longueur en `char`.
pub fn reponse_http(statut: &str, corps: &str) -> String {
    format!(
        "HTTP/1.1 {statut}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\
         \r\n\
         {corps}",
        corps.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrait_le_code_et_le_state_d_une_redirection_valide() {
        let retour = analyser_redirection("GET /?code=4a5b6c&state=xyz HTTP/1.1").unwrap();

        assert_eq!(
            retour,
            RetourAutorisation::Succes {
                code: "4a5b6c".into(),
                state: "xyz".into(),
            }
        );
    }

    #[test]
    fn decode_les_caracteres_encodes_du_code() {
        // Les codes Google commencent par `4/0A...` : la barre oblique arrive
        // encodée et doit être rendue telle quelle à l'échange de jetons.
        let retour = analyser_redirection("GET /?code=4%2F0AX4&state=xyz HTTP/1.1").unwrap();

        let RetourAutorisation::Succes { code, .. } = retour else {
            panic!("succès attendu");
        };
        assert_eq!(code, "4/0AX4");
    }

    #[test]
    fn signale_le_refus_de_l_utilisateur() {
        let retour = analyser_redirection("GET /?error=access_denied&state=xyz HTTP/1.1").unwrap();

        assert_eq!(
            retour,
            RetourAutorisation::Refus {
                motif: "access_denied".into()
            }
        );
    }

    #[test]
    fn rejette_une_redirection_sans_code() {
        assert!(analyser_redirection("GET /?state=xyz HTTP/1.1").is_err());
    }

    #[test]
    fn rejette_une_redirection_sans_state() {
        // Sans `state`, rien ne prouve que la redirection répond à notre demande.
        assert!(analyser_redirection("GET /?code=4a5b6c HTTP/1.1").is_err());
    }

    #[test]
    fn rejette_une_methode_autre_que_get() {
        assert!(analyser_redirection("POST /?code=4a5b6c&state=xyz HTTP/1.1").is_err());
    }

    #[test]
    fn rejette_une_requete_sur_un_autre_chemin() {
        // Le navigateur réclame souvent /favicon.ico sur le même port.
        assert!(analyser_redirection("GET /favicon.ico HTTP/1.1").is_err());
    }

    #[test]
    fn rejette_une_ligne_malformee() {
        assert!(analyser_redirection("").is_err());
        assert!(analyser_redirection("GET").is_err());
        assert!(analyser_redirection("GET pas-un-chemin HTTP/1.1").is_err());
    }

    #[test]
    fn la_comparaison_constante_accepte_deux_valeurs_identiques() {
        assert!(secrets_egaux("9f3c2a1b", "9f3c2a1b"));
    }

    #[test]
    fn la_comparaison_constante_rejette_une_valeur_differente() {
        assert!(!secrets_egaux("9f3c2a1b", "9f3c2a1c"));
        assert!(!secrets_egaux("9f3c2a1b", "0f3c2a1b"));
    }

    #[test]
    fn la_comparaison_constante_rejette_un_prefixe() {
        assert!(!secrets_egaux("9f3c2a1b", "9f3c"));
        assert!(!secrets_egaux("", "9f3c"));
    }

    #[test]
    fn la_reponse_http_compte_les_octets_et_non_les_caracteres() {
        let corps = "Connexion réussie"; // 17 caracteres, 18 octets
        let reponse = reponse_http("200 OK", corps);

        assert!(reponse.contains("Content-Length: 18"));
        assert!(reponse.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(reponse.contains("charset=utf-8"));
        assert!(reponse.ends_with(corps));
    }
}
