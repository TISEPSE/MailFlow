//! Le cadre où s'affiche le corps d'un message, servi par son propre protocole.
//!
//! # Pourquoi ce module existe
//!
//! Le corps était posé dans une `iframe` par `srcdoc`, en bac à sable sans
//! `allow-scripts`. Rien ne s'y exécutait — et c'était la garantie qu'on
//! voulait. Mais un clic sur un lien n'y produisait rien non plus, et pas par
//! maladresse : **un document dont le bac à sable a désactivé le script ne se
//! voit servir aucun écouteur d'événement**, y compris ceux qu'un autre cadre y
//! pose depuis l'extérieur. C'est la spécification, pas un accident. Le clic ne
//! pouvait donc pas être intercepté, quoi qu'on écrive.
//!
//! Mesuré et non supposé : une sonde posée dans le cadre s'envoyait un
//! événement à elle-même et ne le recevait jamais.
//!
//! # Ce que le protocole change
//!
//! Un document servi par `srcdoc` **hérite de la politique de sécurité de
//! l'application**. Impossible d'y autoriser quoi que ce soit sans relâcher
//! celle de l'application entière — le mauvais niveau pour un besoin qui ne
//! concerne qu'un cadre.
//!
//! Servi par un protocole à lui, le document a sa propre origine et ses propres
//! en-têtes. On y écrit exactement la politique qu'on veut, et l'héritage ne
//! joue plus.
//!
//! # Ce qu'on gagne, ce qu'on perd
//!
//! Perdu : « aucun script du tout », garantie du moteur. Le cadre exécute
//! désormais un script — le nôtre, et lui seul.
//!
//! Gagné : **l'isolation d'origine**, qui manquait. Le HTML de l'expéditeur
//! était jusqu'ici servi *dans l'origine de MailFlow* (`allow-same-origin` sur
//! un `srcdoc`), ce qui n'était sans conséquence que tant que le premier verrou
//! tenait. Il vit maintenant sous `mailflow-corps://`, une origine distincte :
//! son script ne peut ni lire le document de l'application, ni atteindre
//! `frameElement` pour se défaire de son propre bac à sable.
//!
//! # Ce qui n'a pas bougé
//!
//! - `default-src 'none'` : aucune requête ne sort du cadre, et les pixels de
//!   suivi restent morts.
//! - Le HTML est toujours désinfecté côté Rust avant d'arriver ici.
//! - `script-src 'self'` n'autorise que ce que ce module sert lui-même,
//!   c'est-à-dire un seul fichier. Ni `unsafe-inline`, ni `unsafe-eval` : une
//!   balise `<script>` ou un attribut `onclick` qui aurait échappé au
//!   désinfectant serait refusé par le moteur.

use tauri::http::{Request, Response};

/// Nom du protocole. Doit correspondre à ce que le frontend construit et à ce
/// que `frame-src` autorise dans `tauri.conf.json`.
pub const SCHEME: &str = "mailflow-corps";

/// La politique du document du cadre.
///
/// Écrite ici et pas dans `tauri.conf.json` : elle ne concerne que ce document.
/// C'est tout l'intérêt d'avoir un protocole à soi.
///
/// `script-src 'self'` désigne l'origine du cadre — donc ce module, et rien
/// d'autre. L'origine de l'application n'y figure pas : même si un script de
/// MailFlow était injecté dans le corps d'un message, il ne s'exécuterait pas.
const POLITIQUE: &str = "default-src 'none'; \
     script-src 'self'; \
     style-src 'unsafe-inline'; \
     img-src data:; \
     font-src data:; \
     form-action 'none'; \
     base-uri 'none'";

/// Le squelette. Il ne contient **aucun contenu d'expéditeur**.
///
/// Le corps arrive ensuite par `postMessage`, depuis l'application. Servir le
/// message lui-même obligerait à le ranger quelque part côté Rust, à l'indexer,
/// à le périmer — trois occasions de se tromper pour un texte que le frontend a
/// déjà en main.
const SQUELETTE: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>
  html { background: #ffffff; }
  /* La barre de défilement du message est masquée : le cadre a la sienne, et
     deux barres côte à côte n'en font pas une meilleure. */
  body::-webkit-scrollbar { width: 0; height: 0; }
  body {
    margin: 0; padding: 20px 24px;
    /* Un message bâti sur un tableau large défile ici, au lieu d'élargir le
       cadre et de pousser toute l'application hors de la fenêtre. */
    overflow-x: auto;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    color: #1d1d1f; overflow-wrap: break-word;
  }
  img, table { max-width: 100%; }
  img { height: auto; }
  a { color: #2f6bff; cursor: pointer; }
</style>
<script src="cadre.js" defer></script>
</head><body></body></html>"#;

/// Le seul script autorisé dans le cadre.
///
/// Trois tâches, et rien de plus : recevoir le corps, annoncer la hauteur du
/// document, annoncer le lien cliqué. Il ne lit rien de l'application et ne lui
/// envoie que ces deux messages.
///
/// Écrit en JavaScript ancien, sans rien qui demande une transpilation : il est
/// servi tel quel, sans passer par l'outillage du frontend, donc ce qui est
/// écrit ici est exactement ce qui s'exécute.
const SCRIPT: &str = r#"(function () {
  'use strict';

  var pere = window.parent;
  if (pere === window) return;

  function poster(message) {
    // L'origine du père n'est pas vérifiable depuis un cadre en bac à sable, et
    // il n'y a de toute façon rien de secret ici : le seul contenu de ce
    // document est celui que le père vient de nous donner.
    pere.postMessage(message, '*');
  }

  function mesurer() {
    poster({
      type: 'mailflow:hauteur',
      hauteur: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      )
    });
  }

  window.addEventListener('message', function (evenement) {
    // Seul le père parle à ce cadre. Un autre cadre de la page n'a rien à y
    // écrire.
    if (evenement.source !== pere) return;

    var donnees = evenement.data;
    if (!donnees || donnees.type !== 'mailflow:corps') return;
    if (typeof donnees.html !== 'string') return;

    // Le HTML est déjà désinfecté côté Rust. `innerHTML` n'exécute pas les
    // balises `<script>`, et la politique du document refuse de toute façon
    // tout script qui ne vient pas d'ici.
    document.body.innerHTML = donnees.html;
    mesurer();
  });

  document.addEventListener(
    'click',
    function (evenement) {
      var cible = evenement.target;
      var lien = cible && cible.closest ? cible.closest('a[href], area[href]') : null;
      if (!lien) return;

      // Annulé dans tous les cas : même refusée par Rust, cette navigation ne
      // doit pas emporter le cadre.
      evenement.preventDefault();

      var adresse = (lien.getAttribute('href') || '').trim();
      if (!adresse || adresse.charAt(0) === '#') return;

      // L'adresse part telle que l'expéditeur l'a écrite, sans être résolue :
      // Rust doit voir exactement cela, et refuser lui-même ce qui n'est pas
      // une adresse absolue de schéma autorisé.
      poster({ type: 'mailflow:lien', adresse: adresse });
    },
    true
  );

  // Les images arrivent après le document et changent la hauteur : sans cette
  // observation, une lettre illustrée resterait tronquée à la taille de son
  // seul texte.
  if (window.ResizeObserver) {
    new ResizeObserver(mesurer).observe(document.body);
  }
  window.addEventListener('load', mesurer);

  // Le père attend ce signal pour envoyer le corps : lui écrire avant que le
  // script n'écoute reviendrait à parler dans le vide.
  poster({ type: 'mailflow:pret' });
})();
"#;

/// Répond aux requêtes du protocole du cadre.
///
/// Deux chemins et deux seulement. Tout le reste est un 404 : ce protocole ne
/// sert pas de fichiers, il sert un cadre.
pub fn servir(requete: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let chemin = requete.uri().path();

    match chemin_demande(chemin) {
        Some(Ressource::Document) => {
            // Une ligne par message affiché, et elle vaut sa place : un cadre
            // qui ne se charge pas rend **tous** les messages blancs, sur
            // toutes les pages à la fois, sans que rien d'autre ne le dise.
            // C'est arrivé, et il a fallu le journal pour le voir.
            //
            // `info` et non `debug` : le journal est filtré à partir de `info`,
            // et une trace de diagnostic qui ne s'écrit jamais est pire que pas
            // de trace du tout — elle donne l'illusion d'un garde-fou. Le coût
            // est d'une ligne, à côté du « corps lu » déjà écrit pour le même
            // message.
            log::info!("cadre du corps servi");
            reponse("text/html; charset=utf-8", SQUELETTE.as_bytes())
        }
        Some(Ressource::Script) => {
            // En `debug` celui-là : il suit toujours le précédent, et le dire
            // deux fois n'apprend rien.
            log::debug!("script du cadre servi");
            reponse("text/javascript; charset=utf-8", SCRIPT.as_bytes())
        }
        None => {
            log::warn!("chemin inconnu demandé au protocole du cadre");
            Response::builder()
            .status(404)
            .header("Content-Security-Policy", POLITIQUE)
            .body(Vec::new())
            .expect("réponse 404 constructible")
        }
    }
}

/// Ce que le protocole sait servir.
#[derive(Debug, PartialEq, Eq)]
enum Ressource {
    Document,
    Script,
}

/// Reconnaît le chemin demandé.
///
/// Comparaison exacte sur une liste fermée, et non recherche d'un fichier : un
/// protocole qui résout un chemin est un protocole qui finit par servir
/// `../../secrets`. Ici il n'y a rien à traverser, parce qu'il n'y a pas de
/// disque au bout.
fn chemin_demande(chemin: &str) -> Option<Ressource> {
    match chemin.trim_start_matches('/') {
        "" | "cadre.html" => Some(Ressource::Document),
        "cadre.js" => Some(Ressource::Script),
        _ => None,
    }
}

fn reponse(type_mime: &str, corps: &[u8]) -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", type_mime)
        .header("Content-Security-Policy", POLITIQUE)
        // Le cadre n'est pas une page : rien ne doit deviner son type ni le
        // rejouer ailleurs.
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(corps.to_vec())
        .expect("réponse constructible")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seuls_deux_chemins_existent() {
        assert_eq!(chemin_demande("/cadre.html"), Some(Ressource::Document));
        assert_eq!(chemin_demande("/"), Some(Ressource::Document));
        assert_eq!(chemin_demande("/cadre.js"), Some(Ressource::Script));
    }

    #[test]
    fn aucun_chemin_ne_traverse_vers_le_disque() {
        // La comparaison est exacte : il n'y a rien à traverser, mais mieux
        // vaut que ce soit vérifié que supposé.
        for hostile in [
            "/../../etc/passwd",
            "/cadre.js/../../secrets",
            "/CADRE.JS",
            "/cadre.html.js",
            "/index.html",
        ] {
            assert_eq!(chemin_demande(hostile), None, "« {hostile} » doit être refusé");
        }
    }

    #[test]
    fn le_squelette_ne_porte_aucun_contenu_d_expediteur() {
        // Le corps arrive par `postMessage`. Si un jour quelqu'un le glissait
        // ici, il serait servi avec l'origine du cadre à toutes les requêtes.
        assert!(SQUELETTE.contains("<body></body>"));
    }

    #[test]
    fn la_politique_refuse_tout_script_qui_ne_vient_pas_du_cadre() {
        assert!(POLITIQUE.contains("script-src 'self'"));
        assert!(!POLITIQUE.contains("unsafe-inline; script"));
        // Un `unsafe-inline` dans `script-src` rendrait au HTML de l'expéditeur
        // le droit d'exécuter ses attributs `onclick`.
        assert!(!POLITIQUE.contains("script-src 'unsafe-inline'"));
        assert!(!POLITIQUE.contains("unsafe-eval"));
    }

    #[test]
    fn aucune_requete_ne_sort_du_cadre() {
        // Ce qui neutralise les pixels de suivi. C'est la garantie qui ne doit
        // pas être perdue en chemin.
        assert!(POLITIQUE.starts_with("default-src 'none'"));
        assert!(POLITIQUE.contains("img-src data:"));
        assert!(!POLITIQUE.contains("img-src https:"));
    }

    #[test]
    fn chaque_reponse_porte_sa_politique() {
        for chemin in ["/cadre.html", "/cadre.js", "/inconnu"] {
            let requete = Request::builder()
                .uri(format!("mailflow-corps://localhost{chemin}"))
                .body(Vec::new())
                .unwrap();

            let reponse = servir(requete);

            assert_eq!(
                reponse.headers().get("Content-Security-Policy").unwrap(),
                POLITIQUE,
                "« {chemin} » doit porter la politique"
            );
        }
    }

    #[test]
    fn un_chemin_inconnu_ne_sert_rien() {
        let requete = Request::builder()
            .uri("mailflow-corps://localhost/inconnu")
            .body(Vec::new())
            .unwrap();

        let reponse = servir(requete);

        assert_eq!(reponse.status(), 404);
        assert!(reponse.body().is_empty());
    }

    #[test]
    fn le_script_renvoie_les_liens_sans_les_resoudre() {
        // `getAttribute` et non `.href` : Rust doit voir l'adresse telle que
        // l'expéditeur l'a écrite pour pouvoir refuser une adresse relative.
        assert!(SCRIPT.contains("getAttribute('href')"));
        assert!(!SCRIPT.contains("lien.href"));
    }

    #[test]
    fn le_script_n_ecoute_que_son_pere() {
        assert!(SCRIPT.contains("evenement.source !== pere"));
    }
}
