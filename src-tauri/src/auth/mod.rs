//! Authentification OAuth2 auprès de Google.
//!
//! # Flux retenu : code d'autorisation + PKCE, redirection loopback
//!
//! MailFlow est une application de bureau installée chez l'utilisateur. Elle ne
//! peut donc pas détenir de secret : tout binaire distribué est désassemblable.
//! Google le reconnaît explicitement pour les clients de type « Desktop app », et
//! la sécurité du flux ne repose pas sur le `client_secret` mais sur PKCE
//! (RFC 7636).
//!
//! **Google exige néanmoins ce `client_secret`** sur son endpoint de jetons, y
//! compris pour un client « Desktop » et y compris avec PKCE : sans lui, il
//! répond `invalid_request` / « client_secret is missing. » Les deux idées
//! coexistent — la valeur n'est pas un secret au sens usuel, et Google la
//! distribue lui-même dans le fichier téléchargé depuis sa console, mais elle
//! reste obligatoire dans la requête. Voir [`crate::config`].
//!
//! Deroulement :
//!
//! 1. Rust ouvre un serveur HTTP éphémère sur `127.0.0.1`, port attribué par l'OS.
//! 2. Il génère un `code_verifier` aléatoire et son `code_challenge` (SHA-256),
//!    ainsi qu'un jeton anti-CSRF (`state`).
//! 3. Il ouvre l'URL d'autorisation dans le **navigateur système**, jamais dans un
//!    webview de l'application : l'utilisateur voit la vraie barre d'adresse de
//!    Google et son gestionnaire de mots de passe fonctionne normalement.
//! 4. Google redirige vers `http://127.0.0.1:<port>` avec le code d'autorisation.
//! 5. Le serveur éphémère vérifie le `state`, récupère le code, puis s'arrête.
//! 6. Rust échange le code contre les jetons, en POST, avec le `code_verifier`
//!    et le `client_secret`.
//! 7. Le `refresh_token` part dans le trousseau système (voir [`crate::secrets`]).
//!    L'`access_token`, de courte durée, reste en mémoire uniquement.
//!
//! # Ce qui ne doit jamais arriver
//!
//! - Aucun jeton ne traverse l'IPC vers le webview. Le frontend ne connaît que
//!   l'état « connecté / non connecté » et l'adresse du compte.
//! - Le serveur loopback n'accepte qu'une seule requête, sur le chemin de
//!   redirection, et compare le `state` en temps constant avant tout traitement.
//! - Une redirection vers `localhost` plutôt que `127.0.0.1` est à éviter : la
//!   résolution peut passer par IPv6 ou par un fichier `hosts` modifié.
//!
//! # Portée des autorisations
//!
//! `gmail.modify` est un scope *restricted* chez Google. En mode test, il est
//! limité à 100 comptes. Toute distribution publique impose une vérification
//! annuelle avec audit de sécurité par un tiers. C'est un préalable à la
//! diffusion, pas au développement.

pub mod flux;
pub mod jetons;
pub mod loopback;
pub mod serveur;
pub mod session;

/// Lecture des messages, gestion des libellés, mise à la corbeille, envoi.
///
/// Toujours sans `gmail.send` ni `gmail.compose` — mais non parce que MailFlow
/// s'interdirait d'envoyer : `users.messages.send` accepte `gmail.modify`, et
/// c'est par là que passe la fenêtre de rédaction. Demander `gmail.send` en
/// plus n'ajouterait aucun pouvoir et élargirait l'écran de consentement pour
/// rien.
///
/// Le bouton « Répondre » de la vue 1, lui, ouvre toujours un brouillon dans le
/// client du système. Ce n'est plus une nécessité, c'est une habitude qu'on n'a
/// pas défaite en même temps que le reste.
pub const SCOPE_GMAIL: &str = "https://www.googleapis.com/auth/gmail.modify";

/// Adresse du compte connecté, pour l'afficher dans l'interface.
pub const SCOPE_EMAIL: &str = "https://www.googleapis.com/auth/userinfo.email";

/// Nom et photo du compte, pour que l'utilisateur reconnaisse d'un coup d'œil
/// lequel de ses comptes est relié.
///
/// Portée non sensible : elle ne donne accès qu'à ce que l'utilisateur montre
/// déjà à toute application Google.
pub const SCOPE_PROFIL: &str = "https://www.googleapis.com/auth/userinfo.profile";

/// Le carnet d'adresses, en lecture seule.
///
/// C'est lui qui peuple les suggestions de destinataires. Sans lui, il fallait
/// les déduire des messages reçus, ce qui proposait un robot d'expédition ou une
/// newsletter aussi volontiers qu'un correspondant.
pub const SCOPE_CONTACTS: &str = "https://www.googleapis.com/auth/contacts.readonly";

/// Les adresses que Google retient de lui-même quand on écrit à quelqu'un.
///
/// Elles n'appartiennent à aucun carnet et n'ont ni nom ni photo, mais ce sont
/// elles que Gmail propose pour les correspondants qu'on n'a jamais enregistrés.
/// Sans cette portée, la moitié des suggestions manquerait.
pub const SCOPE_AUTRES_CONTACTS: &str = "https://www.googleapis.com/auth/contacts.other.readonly";

/// Renseignements publics du compte : `name`, `picture`, `email`.
pub const URL_USERINFO: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

pub const URL_AUTORISATION: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const URL_JETON: &str = "https://oauth2.googleapis.com/token";
pub const URL_REVOCATION: &str = "https://oauth2.googleapis.com/revoke";

/// Adresse d'écoute du serveur de redirection. Le port est attribué par l'OS.
pub const HOTE_REDIRECTION: &str = "127.0.0.1";

/// Marge appliquée à l'expiration de l'`access_token` : il est renouvelé un peu
/// avant l'echeance annoncée, pour absorber la dérive d'horloge et la latence.
pub const MARGE_RENOUVELLEMENT_SECS: i64 = 60;

/// Temps laissé à l'utilisateur pour donner son accord chez Google.
///
/// Assez large pour se connecter, retrouver un mot de passe et passer une
/// validation en deux étapes ; assez court pour que le port loopback ne reste pas
/// ouvert une demi-journée si l'onglet est simplement oublié.
pub const DELAI_AUTORISATION: Duration = Duration::from_secs(5 * 60);

use std::time::Duration;

use chrono::Utc;

use crate::error::Resultat;
use crate::secrets::SecretStore;
use flux::ClientOAuth;
use serveur::ServeurRedirection;
use session::SessionAuth;

/// Deroule le parcours complet de connexion.
///
/// `ouvrir_navigateur` est injecté plutôt qu'appelé en dur : c'est le seul effet
/// de bord de la fonction, et l'isoler la rend observable.
///
/// L'ordre compte. Le serveur est ouvert **avant** de construire l'URL, parce que
/// l'URI de redirection annoncée à Google doit contenir le port réellement écouté.
/// Construire l'URL d'abord obligerait à deviner un port, donc à en choisir un
/// fixe — et un port fixe est un port qu'un autre programme peut avoir pris.
pub async fn connecter<S: SecretStore>(
    client: &ClientOAuth,
    session: &mut SessionAuth<S>,
    ouvrir_navigateur: impl FnOnce(&url::Url) -> Resultat<()>,
    delai: Duration,
) -> Resultat<()> {
    let serveur = ServeurRedirection::ouvrir().await?;
    let demande = client.demarrer(serveur.uri_redirection())?;

    ouvrir_navigateur(demande.url())?;

    let code = serveur.attendre_le_code(demande.state(), delai).await?;
    let reponse = client.echanger_le_code(&demande, &code).await?;

    session.ouvrir(reponse, Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::secrets::MemoryStore;
    use std::cell::RefCell;

    const CLIENT_ID: &str = "123456789012-abcdef.apps.googleusercontent.com";
    const CLIENT_SECRET: &str = "GOCSPX-secret-de-test";

    /// Interrompt le parcours juste après l'ouverture du navigateur, ce qui
    /// permet d'observer l'URL sans joindre Google.
    async fn url_proposee_a_l_utilisateur() -> url::Url {
        let client = ClientOAuth::nouveau(CLIENT_ID.into(), CLIENT_SECRET.into()).unwrap();
        let mut session = SessionAuth::nouvelle(MemoryStore::new());
        let vue = RefCell::new(None);

        let r = connecter(
            &client,
            &mut session,
            |url| {
                *vue.borrow_mut() = Some(url.clone());
                Err(AppError::Auth("navigateur indisponible".into()))
            },
            Duration::from_millis(50),
        )
        .await;

        assert!(r.is_err());
        vue.into_inner().expect("le navigateur doit être sollicité")
    }

    #[tokio::test]
    async fn la_redirection_annoncee_a_google_porte_un_port_reellement_attribue() {
        let url = url_proposee_a_l_utilisateur().await;

        let redirect = url
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .map(|(_, v)| v.into_owned())
            .expect("redirect_uri absent");

        let port = redirect
            .strip_prefix("http://127.0.0.1:")
            .expect("la redirection doit viser la boucle locale en adresse numérique");
        assert!(port.parse::<u16>().unwrap() > 0);
    }

    #[tokio::test]
    async fn un_navigateur_indisponible_n_ouvre_aucune_session() {
        let client = ClientOAuth::nouveau(CLIENT_ID.into(), CLIENT_SECRET.into()).unwrap();
        let mut session = SessionAuth::nouvelle(MemoryStore::new());

        let e = connecter(
            &client,
            &mut session,
            |_| Err(AppError::Auth("navigateur indisponible".into())),
            Duration::from_millis(50),
        )
        .await
        .unwrap_err();

        assert_eq!(e.code(), "ECHEC_CONNEXION");
        assert!(!session.est_connecte().unwrap());
    }

    #[tokio::test]
    async fn un_accord_qui_n_arrive_jamais_finit_par_abandonner() {
        let client = ClientOAuth::nouveau(CLIENT_ID.into(), CLIENT_SECRET.into()).unwrap();
        let mut session = SessionAuth::nouvelle(MemoryStore::new());

        let e = connecter(
            &client,
            &mut session,
            |_| Ok(()),
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();

        assert_eq!(e.code(), "ECHEC_CONNEXION");
        assert!(!session.est_connecte().unwrap());
    }
}
