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

use std::sync::Arc;

#[derive(Copy, Clone, PartialEq, Eq)]
enum GenrePage {
    Succes,
    Refus,
    Erreur,
}

fn page(genre: GenrePage, titre: &str, message: &str) -> String {
    let (badge_bg, badge_icon_svg, bouton_texte) = match genre {
        GenrePage::Succes => (
            "var(--hero-bg, #C4EED0)",
            r##"<svg width="42" height="42" viewBox="0 0 48 48" fill="none"><path d="M14 24.5L21 31.5L34 17.5" stroke="var(--hero-stroke, #137333)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>"##,
            "Revenir à l'application",
        ),
        GenrePage::Refus | GenrePage::Erreur => (
            "var(--hero-err-bg, #FCE8E6)",
            r##"<svg width="42" height="42" viewBox="0 0 48 48" fill="none"><path d="M24 16V26M24 32H24.02" stroke="var(--hero-err-stroke, #C5221F)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>"##,
            "Fermer cet onglet",
        ),
    };

    format!(
        r##"<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MailFlow • {titre}</title>
  <style>
    :root {{
      --bg: #F0F4F9;
      --card-bg: #FFFFFF;
      --card-border: #E0E2EC;
      --text: #1F1F1F;
      --subtext: #44474E;
      --btn-bg: #0B57D0;
      --btn-text: #FFFFFF;
      --btn-hover: #0842A0;
      --hero-bg: #C4EED0;
      --hero-stroke: #137333;
      --hero-err-bg: #FCE8E6;
      --hero-err-stroke: #C5221F;
      --shadow: 0 16px 44px rgba(0, 0, 0, 0.08);
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #111318;
        --card-bg: #1E2025;
        --card-border: #33363D;
        --text: #E2E2E9;
        --subtext: #C4C6D0;
        --btn-bg: #A8C7FA;
        --btn-text: #062E6F;
        --btn-hover: #D3E3FD;
        --hero-bg: #1A3E2B;
        --hero-stroke: #6DD58C;
        --hero-err-bg: #442726;
        --hero-err-stroke: #F2B8B5;
        --shadow: 0 16px 44px rgba(0, 0, 0, 0.45);
      }}
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', 'Roboto', 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      -webkit-font-smoothing: antialiased;
    }}
    .card {{
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 32px;
      padding: 44px 36px;
      max-width: 480px;
      width: 100%;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      animation: appear 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }}
    @keyframes appear {{
      from {{ opacity: 0; transform: scale(0.96) translateY(10px); }}
      to {{ opacity: 1; transform: scale(1) translateY(0); }}
    }}
    .header-bar {{
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }}
    .brand-logo {{
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: linear-gradient(135deg, #2F6BFF, #4C3BCF);
      color: #FFF;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
    }}
    .brand-name {{
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--text);
    }}
    .brand-dot {{
      color: var(--subtext);
      font-size: 0.8125rem;
    }}
    .google-pill {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--subtext);
    }}
    .icon-hero {{
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: {badge_bg};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }}
    h1 {{
      font-size: 1.75rem;
      font-weight: 600;
      letter-spacing: -0.015em;
      line-height: 1.25;
      margin-bottom: 10px;
      color: var(--text);
    }}
    p.detail {{
      font-size: 1.0625rem;
      line-height: 1.55;
      color: var(--subtext);
      margin-bottom: 32px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 52px;
      border-radius: 26px;
      background: var(--btn-bg);
      color: var(--btn-text);
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      border: none;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
    }}
    .btn:hover {{
      background: var(--btn-hover);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    }}
    .btn:active {{
      transform: scale(0.98);
    }}
    .footer {{
      margin-top: 24px;
      font-size: 0.75rem;
      color: var(--subtext);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header-bar">
      <div class="brand-logo">M</div>
      <span class="brand-name">MailFlow</span>
      <span class="brand-dot">•</span>
      <div class="google-pill">
        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        <span>Google Workspace</span>
      </div>
    </div>

    <div class="icon-hero">
      {badge_icon_svg}
    </div>

    <h1>{titre}</h1>
    <p class="detail">{message}</p>

    <button type="button" class="btn" id="closeBtn" onclick="revenir()">
      {bouton_texte}
    </button>

    <div class="footer">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span>Autorisation sécurisée OAuth 2.0 PKCE • MailFlow</span>
    </div>
  </div>
  <script>
    function revenir() {{
      fetch('/focus').catch(function(){{}});
      try {{
        window.open('', '_self', '');
        window.close();
      }} catch (e) {{}}
      try {{ window.close(); }} catch (e) {{}}
      try {{ window.blur(); }} catch (e) {{}}
      var b = document.getElementById('closeBtn');
      if (b) {{
        b.textContent = "MailFlow est ouvert !";
        b.style.background = "var(--hero-stroke, #137333)";
        b.style.color = "#FFFFFF";
      }}
    }}
  </script>
</body>
</html>"##
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
    pub async fn attendre_le_code(
        self,
        state_attendu: &str,
        delai: Duration,
        on_focus: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> Resultat<String> {
        let (code, ecouteur) =
            tokio::time::timeout(delai, self.boucle(state_attendu, on_focus.clone()))
                .await
                .map_err(|_| AppError::Auth("aucune redirection reçue avant le délai".into()))??;

        if let Some(on_focus_cb) = on_focus {
            tokio::spawn(async move {
                let _ = tokio::time::timeout(Duration::from_secs(60), async move {
                    loop {
                        if let Ok((mut flux, _)) = ecouteur.accept().await {
                            let (lecture, mut ecriture) = flux.split();
                            let mut ligne = String::new();
                            let mut lecteur = BufReader::new(lecture.take(TAILLE_MAX_LIGNE));
                            if let Ok(Ok(n)) =
                                tokio::time::timeout(DELAI_LECTURE, lecteur.read_line(&mut ligne))
                                    .await
                            {
                                if n > 0 {
                                    if ligne.starts_with("GET /focus")
                                        || ligne.starts_with("GET /revenir")
                                    {
                                        on_focus_cb();
                                        repondre(&mut ecriture, "200 OK", "OK").await;
                                    } else {
                                        repondre(&mut ecriture, "404 Not Found", "Non trouvé")
                                            .await;
                                    }
                                }
                            }
                        }
                    }
                })
                .await;
            });
        }

        Ok(code)
    }

    async fn boucle(
        self,
        state_attendu: &str,
        on_focus: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> Resultat<(String, TcpListener)> {
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

            if ligne.starts_with("GET /focus") || ligne.starts_with("GET /revenir") {
                if let Some(ref cb) = on_focus {
                    cb();
                }
                repondre(&mut ecriture, "200 OK", "OK").await;
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
                                GenrePage::Erreur,
                                "Connexion refusée",
                                "Cette demande ne correspond pas à celle lancée par MailFlow.",
                            ),
                        )
                        .await;
                        return Err(AppError::Auth("state de la redirection incorrect".into()));
                    }

                    if let Some(ref cb) = on_focus {
                        cb();
                    }

                    repondre(
                        &mut ecriture,
                        "200 OK",
                        &page(
                            GenrePage::Succes,
                            "Compte connecté !",
                            "Votre compte Gmail a été relié avec succès.",
                        ),
                    )
                    .await;
                    return Ok((code, self.ecouteur));
                }

                Ok(RetourAutorisation::Refus { motif }) => {
                    repondre(
                        &mut ecriture,
                        "200 OK",
                        &page(
                            GenrePage::Refus,
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
                        &page(GenrePage::Erreur, "MailFlow", "Rien ici."),
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
                .attendre_le_code("etat-attendu", Duration::from_secs(5), None)
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
                .attendre_le_code("etat-attendu", Duration::from_secs(5), None)
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
                .attendre_le_code("etat-attendu", Duration::from_secs(5), None)
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
                .attendre_le_code("etat-attendu", Duration::from_secs(5), None)
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
            .attendre_le_code("etat-attendu", Duration::from_millis(150), None)
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
                .attendre_le_code("etat-attendu", Duration::from_secs(5), None)
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
