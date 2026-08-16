//! Fige les identifiants Google dans le binaire au moment de la compilation.
//!
//! Sans cela, un binaire compilé localement ne trouve ses identifiants qu'en
//! remontant depuis le dossier courant à la recherche d'un `.env` — il
//! fonctionne donc lancé depuis le projet, et échoue lancé depuis n'importe où
//! ailleurs. C'est exactement ce qui est arrivé : l'application installée
//! annonçait « configuration incomplète », refusait la connexion, et chacun de
//! ses relevés échouait puisqu'elle se croyait par ailleurs reliée à un compte.
//!
//! La variable d'environnement garde la priorité : c'est ainsi que la chaîne
//! GitHub injecte les secrets du dépôt. Le `.env` du projet n'est qu'un repli,
//! pour que toute compilation locale produise elle aussi un binaire autonome.

const VARIABLES: [&str; 2] = ["MAILFLOW_GOOGLE_CLIENT_ID", "MAILFLOW_GOOGLE_CLIENT_SECRET"];

fn main() {
    for variable in VARIABLES {
        println!("cargo::rerun-if-env-changed={variable}");
    }

    // Le `.env` vit à la racine du projet, un cran au-dessus de `src-tauri`.
    let racine = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let dotenv = racine.join(".env");
    println!("cargo::rerun-if-changed={}", dotenv.display());

    let contenu = std::fs::read_to_string(&dotenv).unwrap_or_default();

    for variable in VARIABLES {
        // Déjà dans l'environnement : `option_env!` la lira directement, et la
        // réécrire ici ne ferait que risquer de la contredire.
        if std::env::var(variable).is_ok_and(|v| !v.trim().is_empty()) {
            continue;
        }

        if let Some(valeur) = valeur_dotenv(&contenu, variable) {
            // La valeur est figée, jamais journalisée : un script de
            // compilation écrit dans un journal que d'autres outils relisent.
            println!("cargo::rustc-env={variable}={valeur}");
        }
    }

    tauri_build::build()
}

/// Extrait une valeur d'un contenu de `.env`.
///
/// Volontairement minimal, et jumeau de `config::valeur_dotenv` : un script de
/// compilation ne peut pas emprunter au module qu'il sert à construire, et une
/// dizaine de lignes dupliquées coûtent moins qu'une caisse partagée pour ça.
/// Pas d'interpolation, pas d'échappement — un `.env` qui en aurait besoin
/// contiendrait autre chose qu'un identifiant client.
fn valeur_dotenv(contenu: &str, cle: &str) -> Option<String> {
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
        // Une valeur multiligne casserait la directive `cargo::rustc-env`, qui
        // se termine à la fin de la ligne : mieux vaut ne rien figer.
        .filter(|v| !v.contains('\n'))
}
