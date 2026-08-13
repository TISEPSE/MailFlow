//! Authentification OAuth2 aupres de Google.
//!
//! # Flux retenu : code d'autorisation + PKCE, redirection loopback
//!
//! MailFlow est une application de bureau installee chez l'utilisateur. Elle ne
//! peut donc pas detenir de secret : tout binaire distribue est desassemblable.
//! Google le reconnait explicitement pour les clients de type « Desktop app », et
//! la securite du flux ne repose pas sur le `client_secret` mais sur PKCE
//! (RFC 7636).
//!
//! Deroulement :
//!
//! 1. Rust ouvre un serveur HTTP ephemere sur `127.0.0.1`, port attribue par l'OS.
//! 2. Il genere un `code_verifier` aleatoire et son `code_challenge` (SHA-256),
//!    ainsi qu'un jeton anti-CSRF (`state`).
//! 3. Il ouvre l'URL d'autorisation dans le **navigateur systeme**, jamais dans un
//!    webview de l'application : l'utilisateur voit la vraie barre d'adresse de
//!    Google et son gestionnaire de mots de passe fonctionne normalement.
//! 4. Google redirige vers `http://127.0.0.1:<port>` avec le code d'autorisation.
//! 5. Le serveur ephemere verifie le `state`, recupere le code, puis s'arrete.
//! 6. Rust echange le code contre les jetons, en POST, avec le `code_verifier`.
//! 7. Le `refresh_token` part dans le trousseau systeme (voir [`crate::secrets`]).
//!    L'`access_token`, de courte duree, reste en memoire uniquement.
//!
//! # Ce qui ne doit jamais arriver
//!
//! - Aucun jeton ne traverse l'IPC vers le webview. Le frontend ne connait que
//!   l'etat « connecte / non connecte » et l'adresse du compte.
//! - Le serveur loopback n'accepte qu'une seule requete, sur le chemin de
//!   redirection, et compare le `state` en temps constant avant tout traitement.
//! - Une redirection vers `localhost` plutot que `127.0.0.1` est a eviter : la
//!   resolution peut passer par IPv6 ou par un fichier `hosts` modifie.
//!
//! # Portee des autorisations
//!
//! `gmail.modify` est un scope *restricted* chez Google. En mode test, il est
//! limite a 100 comptes. Toute distribution publique impose une verification
//! annuelle avec audit de securite par un tiers. C'est un prealable a la
//! diffusion, pas au developpement.

/// Lecture des messages, gestion des libelles, mise a la corbeille.
///
/// Volontairement sans `gmail.send` : le bouton « Repondre » de la vue 1 ouvrira
/// un brouillon dans le client par defaut plutot que d'obtenir le droit d'envoyer
/// du courrier au nom de l'utilisateur.
pub const SCOPE_GMAIL: &str = "https://www.googleapis.com/auth/gmail.modify";

/// Adresse du compte connecte, pour l'afficher dans l'interface.
pub const SCOPE_EMAIL: &str = "https://www.googleapis.com/auth/userinfo.email";

pub const URL_AUTORISATION: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const URL_JETON: &str = "https://oauth2.googleapis.com/token";
pub const URL_REVOCATION: &str = "https://oauth2.googleapis.com/revoke";

/// Adresse d'ecoute du serveur de redirection. Le port est attribue par l'OS.
pub const HOTE_REDIRECTION: &str = "127.0.0.1";

/// Marge appliquee a l'expiration de l'`access_token` : il est renouvele un peu
/// avant l'echeance annoncee, pour absorber la derive d'horloge et la latence.
pub const MARGE_RENOUVELLEMENT_SECS: i64 = 60;
