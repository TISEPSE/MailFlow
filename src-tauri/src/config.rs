//! Où MailFlow trouve les identifiants Google de son client OAuth2.
//!
//! Deux valeurs, issues du même fichier téléchargé depuis la console Google :
//! l'identifiant client et le « secret » client.
//!
//! Ni l'un ni l'autre n'a sa place dans le trousseau. L'identifiant apparaît de
//! toute façon dans l'URL d'autorisation. Quant au second, malgré son nom,
//! Google documente qu'il n'est pas traité comme un secret pour les applications
//! installées — il est extractible de tout binaire distribué, et Google
//! l'imprime dans un fichier qu'il invite à télécharger. Les traiter comme des
//! secrets d'utilisateur rendrait la mise en place inutilement pénible sans rien
//! protéger : c'est de la configuration.
//!
//! Trois sources, dans cet ordre :
//!
//! 1. la variable d'environnement, qui permet de surcharger ponctuellement ;
//! 2. la valeur figée à la compilation, utilisée pour les binaires distribués ;
//! 3. le fichier `.env` du projet, qui est le chemin décrit dans
//!    `docs/connexion-google.md`.

pub const VAR_CLIENT_ID: &str = "MAILFLOW_GOOGLE_CLIENT_ID";

/// Secret client Google.
///
/// Google l'exige sur son endpoint de jetons, y compris pour un client
/// « Desktop » et y compris avec PKCE. Il est distribué dans le fichier
/// téléchargé depuis la console, et Google documente qu'il n'est pas traité
/// comme un secret pour les applications installées — il est de toute façon
/// extractible de tout binaire distribué. C'est donc de la configuration, au
/// même titre que l'identifiant : pas une entrée de trousseau.
pub const VAR_CLIENT_SECRET: &str = "MAILFLOW_GOOGLE_CLIENT_SECRET";

/// Extrait une valeur d'un contenu de fichier `.env`.
///
/// Deliberement minimal : pas d'interpolation de variables, pas d'echappement.
/// Un `.env` qui aurait besoin de ces mécanismes contiendrait autre chose qu'un
/// identifiant client.
pub fn valeur_dotenv(contenu: &str, cle: &str) -> Option<String> {
    contenu
        .lines()
        .filter_map(|ligne| {
            let ligne = ligne.trim();
            let ligne = ligne.strip_prefix("export ").unwrap_or(ligne);
            if ligne.starts_with('#') {
                return None;
            }

            // `split_once` et non `split` : une valeur peut contenir des `=`.
            let (nom, valeur) = ligne.split_once('=')?;
            (nom.trim() == cle).then_some(valeur)
        })
        // La dernière affectation gagne, comme dans un shell.
        .next_back()
        .map(|v| {
            v.trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .trim()
                .to_string()
        })
        .filter(|v| !v.is_empty())
}

/// Cherche un `.env` dans le dossier courant puis dans ses parents.
fn depuis_dotenv(cle: &str) -> Option<String> {
    let mut dossier = std::env::current_dir().ok()?;

    loop {
        if let Ok(contenu) = std::fs::read_to_string(dossier.join(".env"))
            && let Some(v) = valeur_dotenv(&contenu, cle)
        {
            return Some(v);
        }
        if !dossier.pop() {
            return None;
        }
    }
}

fn non_vide(v: String) -> Option<String> {
    let v = v.trim().to_string();
    (!v.is_empty()).then_some(v)
}

fn resoudre(variable: &str, fige_a_la_compilation: Option<&str>) -> Option<String> {
    std::env::var(variable)
        .ok()
        .and_then(non_vide)
        .or_else(|| fige_a_la_compilation.map(String::from).and_then(non_vide))
        .or_else(|| depuis_dotenv(variable))
}

/// Identifiant client Google, ou `None` s'il n'a pas été configuré.
pub fn client_id_google() -> Option<String> {
    resoudre(VAR_CLIENT_ID, option_env!("MAILFLOW_GOOGLE_CLIENT_ID"))
}

/// Secret client Google, ou `None` s'il n'a pas été configuré.
pub fn client_secret_google() -> Option<String> {
    resoudre(
        VAR_CLIENT_SECRET,
        option_env!("MAILFLOW_GOOGLE_CLIENT_SECRET"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_une_valeur_simple() {
        assert_eq!(
            valeur_dotenv(
                "MAILFLOW_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com\n",
                VAR_CLIENT_ID
            ),
            Some("123-abc.apps.googleusercontent.com".into())
        );
    }

    #[test]
    fn ignore_les_commentaires_et_les_lignes_vides() {
        let contenu = "# identifiant Google\n\n  \n#MAILFLOW_GOOGLE_CLIENT_ID=ancien\nMAILFLOW_GOOGLE_CLIENT_ID=bon\n";

        assert_eq!(valeur_dotenv(contenu, VAR_CLIENT_ID), Some("bon".into()));
    }

    #[test]
    fn accepte_le_prefixe_export() {
        assert_eq!(
            valeur_dotenv("export MAILFLOW_GOOGLE_CLIENT_ID=bon", VAR_CLIENT_ID),
            Some("bon".into())
        );
    }

    #[test]
    fn retire_les_guillemets_et_les_espaces() {
        assert_eq!(
            valeur_dotenv("  MAILFLOW_GOOGLE_CLIENT_ID = \"bon\"  ", VAR_CLIENT_ID),
            Some("bon".into())
        );
        assert_eq!(
            valeur_dotenv("MAILFLOW_GOOGLE_CLIENT_ID='bon'", VAR_CLIENT_ID),
            Some("bon".into())
        );
    }

    #[test]
    fn ne_confond_pas_deux_cles_de_meme_prefixe() {
        let contenu = "MAILFLOW_GOOGLE_CLIENT_ID_ANCIEN=mauvais\nMAILFLOW_GOOGLE_CLIENT_ID=bon\n";

        assert_eq!(valeur_dotenv(contenu, VAR_CLIENT_ID), Some("bon".into()));
    }

    #[test]
    fn rend_none_pour_une_cle_absente_ou_vide() {
        // Cas le plus fréquent : `.env` copié depuis `.env.example`, jamais rempli.
        assert_eq!(
            valeur_dotenv("MAILFLOW_GOOGLE_CLIENT_ID=\n", VAR_CLIENT_ID),
            None
        );
        assert_eq!(
            valeur_dotenv("MAILFLOW_LLM_API_KEY=x\n", VAR_CLIENT_ID),
            None
        );
        assert_eq!(valeur_dotenv("", VAR_CLIENT_ID), None);
    }

    #[test]
    fn conserve_les_signes_egal_de_la_valeur() {
        assert_eq!(
            valeur_dotenv("MAILFLOW_LLM_API_KEY=sk-a=b=c", "MAILFLOW_LLM_API_KEY"),
            Some("sk-a=b=c".into())
        );
    }
}
