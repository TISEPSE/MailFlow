fn main() {
    // `config::client_id_google` et sa jumelle lisent ces variables par
    // `option_env!`, donc à la compilation : c'est ainsi que les identifiants
    // Google entrent dans un binaire distribué, où il n'y a pas de `.env`.
    //
    // Sans ces deux lignes, Cargo ne considère pas leur valeur comme une entrée
    // du build : un cache de compilation garderait l'ancienne, et la version
    // publiée partirait avec les identifiants du build précédent — ou sans
    // aucun, ce qui rend la connexion impossible sans que rien ne le signale.
    println!("cargo::rerun-if-env-changed=MAILFLOW_GOOGLE_CLIENT_ID");
    println!("cargo::rerun-if-env-changed=MAILFLOW_GOOGLE_CLIENT_SECRET");

    tauri_build::build()
}
