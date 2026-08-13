//! Le serveur éphémère qui recueille la redirection du navigateur.
//!
//! Durée de vie : le temps que l'utilisateur donne son accord chez Google, et pas
//! une seconde de plus. Le port reste ouvert sur `127.0.0.1` pendant ce laps de
//! temps, donc joignable par tout programme tournant sous la même session — c'est
//! une propriété du flux loopback, pas un défaut de celui-ci. Ce qui protège, ce
//! sont le `state` imprévisible et la fenêtre courte.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use super::loopback::{RetourAutorisation, analyser_redirection, reponse_http, secrets_egaux};
use crate::error::{AppError, Resultat};

/// Taille maximale de la ligne de requête acceptée.
///
/// Un code d'autorisation Google fait quelques centaines d'octets. Au-dela, ce
/// n'est pas la redirection attendue, et on n'a aucune raison de bufferiser sans
/// limite ce que nous envoie un client inconnu.
const TAILLE_MAX_LIGNE: u64 = 8 * 1024;

/// Délai laissé à un client pour envoyer sa ligne de requête après connexion.
///
/// Sans cela, une connexion ouverte et muette bloquerait la boucle d'acceptation
/// jusqu'au délai global.
const DELAI_LECTURE: Duration = Duration::from_secs(5);

fn page(titre: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">\
         <title>MailFlow</title></head>\
         <body style=\"font-family:system-ui,sans-serif;text-align:center;padding:4rem\">\
         <h1>{titre}</h1><p>{message}</p></body></html>"
    )
}

pub struct ServeurRedirection {
    ecouteur: TcpListener,
    port: u16,
}

impl ServeurRedirection {
    /// Ouvre un port sur la boucle locale, attribué par le système.
    pub async fn ouvrir() -> Resultat<Self> {
        let adresse = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let ecouteur = TcpListener::bind(adresse)
            .await
            .map_err(|e| AppError::io(adresse, e))?;
        let port = ecouteur
            .local_addr()
            .map_err(|e| AppError::io(adresse, e))?
            .port();

        Ok(Self { ecouteur, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// URI de redirection à déclarer à Google, exactement sous cette forme.
    pub fn uri_redirection(&self) -> String {
        format!("http://{}:{}", super::HOTE_REDIRECTION, self.port)
    }

    /// Attend la redirection et rend le code d'autorisation.
    ///
    /// Les requêtes qui ne sont pas la redirection attendue (le navigateur réclame
    /// volontiers `/favicon.ico`) reçoivent un 404 et ne comptent pas : on continue
    /// d'écouter jusqu'à `delai`.
    pub async fn attendre_le_code(self, state_attendu: &str, delai: Duration) -> Resultat<String> {
        tokio::time::timeout(delai, self.boucle(state_attendu))
            .await
            .map_err(|_| AppError::Auth("aucune redirection reçue avant le délai".into()))?
    }

    async fn boucle(&self, state_attendu: &str) -> Resultat<String> {
        loop {
            let (mut flux, _) = self
                .ecouteur
                .accept()
                .await
                .map_err(|e| AppError::io(self.uri_redirection(), e))?;

            let (lecture, mut ecriture) = flux.split();
            let mut ligne = String::new();

            // Deux garde-fous sur ce que peut faire un client inconnu : un plafond
            // d'octets, et un délai pour les envoyer.
            let mut lecteur = BufReader::new(lecture.take(TAILLE_MAX_LIGNE));
            let lue = matches!(
                tokio::time::timeout(DELAI_LECTURE, lecteur.read_line(&mut ligne)).await,
                Ok(Ok(n)) if n > 0
            );
            if !lue {
                continue;
            }

            match analyser_redirection(ligne.trim_end()) {
                Ok(RetourAutorisation::Succes { code, state }) => {
                    if !secrets_egaux(&state, state_attendu) {
                        // Quelqu'un d'autre que notre navigateur parle sur ce port.
                        repondre(
                            &mut ecriture,
                            "400 Bad Request",
                            &page(
                                "Connexion refusée",
                                "Cette demande ne correspond pas à celle lancée par MailFlow.",
                            ),
                        )
                        .await;
                        return Err(AppError::Auth("state de la redirection incorrect".into()));
                    }

                    repondre(
                        &mut ecriture,
                        "200 OK",
                        &page(
                            "C'est bon",
                            "Votre compte Gmail est connecté. Vous pouvez fermer cet onglet et \
                             revenir à MailFlow.",
                        ),
                    )
                    .await;
                    return Ok(code);
                }

                Ok(RetourAutorisation::Refus { motif }) => {
                    repondre(
                        &mut ecriture,
                        "200 OK",
                        &page(
                            "Connexion abandonnée",
                            "Aucun accès n'a été accordé. Vous pouvez fermer cet onglet.",
                        ),
                    )
                    .await;
                    return Err(AppError::Auth(format!("refus côté Google : {motif}")));
                }

                // Ni la redirection, ni un refus : du bruit. On répond et on
                // continue d'attendre la vraie redirection.
                Err(e) => {
                    log::debug!("requête ignorée sur le port de redirection : {e}");
                    repondre(
                        &mut ecriture,
                        "404 Not Found",
                        &page("MailFlow", "Rien ici."),
                    )
                    .await;
                }
            }
        }
    }
}

/// Écrit la réponse et ferme proprement.
///
/// Les erreurs d'écriture sont ignorées à dessein : le navigateur peut avoir
/// refermé l'onglet. Ce qui compte est le résultat rendu à l'appelant, pas la
/// page de courtoisie.
async fn repondre<E: AsyncWriteExt + Unpin>(ecriture: &mut E, statut: &str, corps: &str) {
    let _ = ecriture
        .write_all(reponse_http(statut, corps).as_bytes())
        .await;
    let _ = ecriture.flush().await;
    let _ = ecriture.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn envoyer(port: u16, ligne_requete: &str) -> String {
        let mut flux = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        flux.write_all(format!("{ligne_requete}\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut reponse = String::new();
        flux.read_to_string(&mut reponse).await.unwrap();
        reponse
    }

    #[tokio::test]
    async fn n_ecoute_que_sur_la_boucle_locale() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();

        let adresse = serveur.ecouteur.local_addr().unwrap();
        assert_eq!(adresse.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_ne!(adresse.port(), 0, "le port doit être attribué");
    }

    #[tokio::test]
    async fn l_uri_de_redirection_utilise_l_adresse_numerique() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();

        // `localhost` est proscrit : la résolution peut passer par IPv6 ou par un
        // fichier hosts modifié.
        assert_eq!(
            serveur.uri_redirection(),
            format!("http://127.0.0.1:{}", serveur.port())
        );
    }

    #[tokio::test]
    async fn rend_le_code_quand_le_state_correspond() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();
        let port = serveur.port();

        let attente = tokio::spawn(async move {
            serveur
                .attendre_le_code("etat-attendu", Duration::from_secs(5))
                .await
        });

        let reponse = envoyer(port, "GET /?code=4%2F0AX4&state=etat-attendu HTTP/1.1").await;

        assert_eq!(attente.await.unwrap().unwrap(), "4/0AX4");
        assert!(reponse.starts_with("HTTP/1.1 200 OK"));
    }

    #[tokio::test]
    async fn rejette_un_state_qui_ne_correspond_pas() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();
        let port = serveur.port();

        let attente = tokio::spawn(async move {
            serveur
                .attendre_le_code("etat-attendu", Duration::from_secs(5))
                .await
        });

        let reponse = envoyer(port, "GET /?code=4a5b6c&state=etat-forge HTTP/1.1").await;

        assert!(attente.await.unwrap().is_err());
        assert!(reponse.starts_with("HTTP/1.1 400"));
    }

    #[tokio::test]
    async fn signale_le_refus_de_l_utilisateur() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();
        let port = serveur.port();

        let attente = tokio::spawn(async move {
            serveur
                .attendre_le_code("etat-attendu", Duration::from_secs(5))
                .await
        });

        envoyer(
            port,
            "GET /?error=access_denied&state=etat-attendu HTTP/1.1",
        )
        .await;

        let erreur = attente.await.unwrap().unwrap_err();
        assert_eq!(erreur.code(), "ECHEC_CONNEXION");
    }

    #[tokio::test]
    async fn ignore_une_requete_parasite_puis_accepte_la_redirection() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();
        let port = serveur.port();

        let attente = tokio::spawn(async move {
            serveur
                .attendre_le_code("etat-attendu", Duration::from_secs(5))
                .await
        });

        let parasite = envoyer(port, "GET /favicon.ico HTTP/1.1").await;
        assert!(parasite.starts_with("HTTP/1.1 404"));

        envoyer(port, "GET /?code=4a5b6c&state=etat-attendu HTTP/1.1").await;

        assert_eq!(attente.await.unwrap().unwrap(), "4a5b6c");
    }

    #[tokio::test]
    async fn abandonne_apres_le_delai() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();

        let erreur = serveur
            .attendre_le_code("etat-attendu", Duration::from_millis(150))
            .await
            .unwrap_err();

        assert_eq!(erreur.code(), "ECHEC_CONNEXION");
    }

    #[tokio::test]
    async fn ne_bufferise_pas_une_ligne_de_requete_demesuree() {
        let serveur = ServeurRedirection::ouvrir().await.unwrap();
        let port = serveur.port();

        let attente = tokio::spawn(async move {
            serveur
                .attendre_le_code("etat-attendu", Duration::from_secs(5))
                .await
        });

        // Une seule ligne, sans fin, bien au-dela du plafond.
        let mut flux = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let bourrage = "GET /?code=".to_string() + &"A".repeat(64 * 1024);
        let _ = flux.write_all(bourrage.as_bytes()).await;
        drop(flux);

        // La connexion abusive est écartée, le serveur reste disponible.
        envoyer(port, "GET /?code=4a5b6c&state=etat-attendu HTTP/1.1").await;

        assert_eq!(attente.await.unwrap().unwrap(), "4a5b6c");
    }
}
