//! Appels à l'API Gmail : transport, réessais, pagination.
//!
//! Deux frontières sont posées ici, et elles portent tout le reste :
//!
//! - [`Transport`] isole l'émission HTTP. La boucle de réessais — la partie où
//!   une erreur brûle du quota ou fige l'interface — se teste donc sans réseau.
//! - [`SourceJeton`] isole l'obtention d'un `access_token`. Le client sait qu'il
//!   faut en redemander un après un `401`, sans rien connaître d'OAuth2.
//!
//! Aucun jeton n'est stocké ici : il est redemandé à chaque appel, et la source
//! décide s'il faut le renouveler.

use std::time::Duration;

use super::execution::{OperationGmail, RapportExecution};
use super::modele::{MessageMetadata, RefMessage, ReponseErreur, ReponseListe};
use super::reessai::{Suite, suite_apres};
use super::{BASE_API, ENTETES_TRI};
use crate::error::{AppError, Resultat};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Methode {
    Get,
    Post,
}

/// Reponse HTTP réduite à ce dont la décision de réessai a besoin.
#[derive(Debug, Clone)]
pub struct ReponseBrute {
    pub statut: u16,
    pub corps: String,
    pub retry_after: Option<Duration>,
}

/// Émission d'une requête HTTP authentifiée.
#[allow(async_fn_in_trait)]
pub trait Transport {
    async fn envoyer(
        &self,
        methode: Methode,
        url: &str,
        corps: Option<String>,
        jeton: &str,
    ) -> Resultat<ReponseBrute>;
}

/// Fourniture d'un jeton d'accès.
#[allow(async_fn_in_trait)]
pub trait SourceJeton {
    /// `forcer` demande un renouvellement même si le jeton en mémoire paraît
    /// valide : c'est le cas après un `401`, où Google fait autorité contre
    /// notre calcul d'expiration.
    async fn jeton(&self, forcer: bool) -> Resultat<String>;
}

/// Gigue du recul exponentiel.
///
/// Tirée de l'horloge plutôt que d'un générateur dédié : il ne s'agit pas de
/// cryptographie, seulement d'éviter que deux clients repartent à la même
/// milliseconde.
fn alea() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() % 1000) as f64 / 1000.0)
        .unwrap_or(0.5)
}

/// URL de `users.messages.list`.
fn url_liste(requete: &str, page: Option<&str>, max_par_page: usize) -> String {
    let mut url = format!("{BASE_API}/users/me/messages");
    let mut params = vec![
        ("q".to_string(), requete.to_string()),
        ("maxResults".to_string(), max_par_page.to_string()),
    ];
    if let Some(p) = page {
        params.push(("pageToken".to_string(), p.to_string()));
    }
    url.push('?');
    url.push_str(
        &params
            .iter()
            .map(|(c, v)| {
                format!(
                    "{c}={}",
                    url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("&"),
    );
    url
}

/// URL de `users.messages.get`, en `format=metadata`.
///
/// Le tri ne dépend que de quelques en-têtes. Demander le message complet
/// téléchargerait des corps HTML dont on n'a rien à faire, à chaque
/// synchronisation.
fn url_metadonnees(id: &str) -> String {
    let entetes: String = ENTETES_TRI
        .iter()
        .map(|h| format!("&metadataHeaders={h}"))
        .collect();
    let id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
    format!("{BASE_API}/users/me/messages/{id}?format=metadata{entetes}")
}

fn url_batch_modify() -> String {
    format!("{BASE_API}/users/me/messages/batchModify")
}

fn url_trash(id: &str) -> String {
    let id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
    format!("{BASE_API}/users/me/messages/{id}/trash")
}

pub struct ClientGmail<T: Transport, J: SourceJeton> {
    transport: T,
    jetons: J,
}

impl<T: Transport, J: SourceJeton> ClientGmail<T, J> {
    pub fn nouveau(transport: T, jetons: J) -> Self {
        Self { transport, jetons }
    }

    /// Émet une requête, en la rejouant selon [`super::reessai`].
    async fn appeler(
        &self,
        methode: Methode,
        url: &str,
        corps: Option<String>,
    ) -> Resultat<String> {
        let mut tentative = 1;
        let mut renouveler = false;

        loop {
            let jeton = self.jetons.jeton(renouveler).await?;
            let reponse = self
                .transport
                .envoyer(methode, url, corps.clone(), &jeton)
                .await?;

            if (200..300).contains(&reponse.statut) {
                return Ok(reponse.corps);
            }

            // Le motif ne sert qu'à distinguer un 403 de quota d'un 403 de
            // permission ; un corps illisible n'est pas une raison d'échouer ici.
            let erreur: Option<ReponseErreur> = serde_json::from_str(&reponse.corps).ok();
            let motif = erreur.as_ref().and_then(ReponseErreur::motif);

            match suite_apres(
                reponse.statut,
                motif,
                tentative,
                reponse.retry_after,
                alea(),
            ) {
                Suite::Reessayer(delai) => {
                    log::debug!(
                        "Gmail a répondu {}, nouvelle tentative dans {delai:?}",
                        reponse.statut
                    );
                    tokio::time::sleep(delai).await;
                    renouveler = false;
                }

                Suite::Renouveler => {
                    log::info!("jeton refusé par Gmail, renouvellement");
                    renouveler = true;
                }

                Suite::Abandonner => {
                    // Le message de Google est en anglais et souvent technique :
                    // il reste dans les logs, le frontend n'aura que le statut.
                    log::warn!(
                        "appel Gmail abandonné ({}) : {}",
                        reponse.statut,
                        erreur
                            .as_ref()
                            .map(|e| e.error.message.as_str())
                            .unwrap_or("sans détail")
                    );
                    return Err(AppError::ApiGmail {
                        statut: reponse.statut,
                    });
                }
            }

            tentative += 1;
        }
    }

    /// Identifiants des messages correspondant à une requête Gmail.
    ///
    /// `plafond` borne la pagination : une boîte de vingt mille messages ne doit
    /// pas se traduire par vingt mille lectures au premier lancement.
    pub async fn lister(&self, requete: &str, plafond: usize) -> Resultat<Vec<RefMessage>> {
        let mut trouves: Vec<RefMessage> = Vec::new();
        let mut page: Option<String> = None;

        while trouves.len() < plafond {
            let reste = plafond - trouves.len();
            let url = url_liste(requete, page.as_deref(), reste.min(500));

            let corps = self.appeler(Methode::Get, &url, None).await?;
            let reponse: ReponseListe = serde_json::from_str(&corps)
                .map_err(|e| AppError::Reseau(format!("liste de messages illisible : {e}")))?;

            trouves.extend(reponse.messages);

            match reponse.next_page_token {
                Some(suivante) if trouves.len() < plafond => page = Some(suivante),
                _ => break,
            }
        }

        trouves.truncate(plafond);
        Ok(trouves)
    }

    pub async fn metadonnees(&self, id: &str) -> Resultat<MessageMetadata> {
        let corps = self
            .appeler(Methode::Get, &url_metadonnees(id), None)
            .await?;

        serde_json::from_str(&corps)
            .map_err(|e| AppError::Reseau(format!("métadonnées illisibles : {e}")))
    }

    /// Applique les opérations et rend le compte de ce qui a été fait.
    ///
    /// Un échec sur une opération n'interrompt pas les suivantes : un message
    /// devenu introuvable ne doit pas empêcher d'archiver les cent autres.
    pub async fn appliquer(&self, operations: &[OperationGmail]) -> RapportExecution {
        let mut rapport = RapportExecution::default();

        for operation in operations {
            let issue = match operation {
                OperationGmail::RetirerLibelles { ids, libelles } => {
                    let corps = serde_json::json!({
                        "ids": ids,
                        "removeLabelIds": libelles,
                    })
                    .to_string();
                    self.appeler(Methode::Post, &url_batch_modify(), Some(corps))
                        .await
                }
                OperationGmail::MettreALaCorbeille { id } => {
                    self.appeler(Methode::Post, &url_trash(id), Some("{}".into()))
                        .await
                }
            };

            match issue {
                Ok(_) => match operation {
                    OperationGmail::RetirerLibelles { ids, .. } => rapport.archives += ids.len(),
                    OperationGmail::MettreALaCorbeille { .. } => rapport.mis_a_la_corbeille += 1,
                },

                // On continue : un message devenu introuvable ne doit pas
                // empêcher de traiter les suivants.
                Err(e) => {
                    log::warn!("opération Gmail échouée : {e}");
                    rapport.echecs += operation.nombre_de_messages();
                }
            }
        }

        rapport
    }
}

/// Doublures partagées par les tests de ce module et ceux de la synchronisation.
#[cfg(test)]
pub mod tests_support {
    use super::*;
    use std::cell::RefCell;

    /// Transport de test : rejoue une file de réponses et note ce qu'il a reçu.
    /// Une requête telle que le transport l'a vue partir.
    struct RequeteVue {
        url: String,
        corps: Option<String>,
        jeton: String,
    }

    pub struct FauxTransport {
        reponses: RefCell<Vec<ReponseBrute>>,
        recus: RefCell<Vec<RequeteVue>>,
    }

    impl Transport for FauxTransport {
        async fn envoyer(
            &self,
            _methode: Methode,
            url: &str,
            corps: Option<String>,
            jeton: &str,
        ) -> Resultat<ReponseBrute> {
            self.recus.borrow_mut().push(RequeteVue {
                url: url.to_string(),
                corps,
                jeton: jeton.to_string(),
            });
            self.reponses
                .borrow_mut()
                .pop()
                .ok_or_else(|| AppError::Reseau("plus de réponse en réserve".into()))
        }
    }

    /// Source de jetons de test : compte les renouvellements demandés.
    pub struct FauxJetons {
        renouvellements: RefCell<u32>,
    }

    impl SourceJeton for FauxJetons {
        async fn jeton(&self, forcer: bool) -> Resultat<String> {
            if forcer {
                *self.renouvellements.borrow_mut() += 1;
            }
            Ok(format!("jeton-{}", self.renouvellements.borrow()))
        }
    }

    pub fn ok(corps: &str) -> ReponseBrute {
        ReponseBrute {
            statut: 200,
            corps: corps.into(),
            retry_after: None,
        }
    }

    pub fn echec(statut: u16, corps: &str) -> ReponseBrute {
        ReponseBrute {
            statut,
            corps: corps.into(),
            retry_after: None,
        }
    }

    /// Client câblé sur les doublures, avec de quoi inspecter ce qui est parti.
    pub struct ClientDeTest {
        pub client: ClientGmail<FauxTransport, FauxJetons>,
    }

    impl ClientDeTest {
        pub fn avec(reponses: Vec<ReponseBrute>) -> Self {
            Self {
                client: ClientGmail::nouveau(
                    FauxTransport {
                        // `pop` prend par la fin : on inverse pour servir dans l'ordre.
                        reponses: RefCell::new(reponses.into_iter().rev().collect()),
                        recus: RefCell::new(Vec::new()),
                    },
                    FauxJetons {
                        renouvellements: RefCell::new(0),
                    },
                ),
            }
        }

        pub fn appels(&self) -> usize {
            self.client.transport.recus.borrow().len()
        }

        pub fn urls(&self) -> Vec<String> {
            self.client
                .transport
                .recus
                .borrow()
                .iter()
                .map(|r| r.url.clone())
                .collect()
        }

        pub fn corps_envoyes(&self) -> Vec<String> {
            self.client
                .transport
                .recus
                .borrow()
                .iter()
                .filter_map(|r| r.corps.clone())
                .collect()
        }

        pub fn jetons_utilises(&self) -> Vec<String> {
            self.client
                .transport
                .recus
                .borrow()
                .iter()
                .map(|r| r.jeton.clone())
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::tests_support::*;
    use super::*;

    fn client(reponses: Vec<ReponseBrute>) -> ClientDeTest {
        ClientDeTest::avec(reponses)
    }

    #[test]
    fn l_url_de_liste_encode_la_requete_gmail() {
        let u = url_liste("in:inbox is:unread", None, 100);

        assert!(u.starts_with(&format!("{BASE_API}/users/me/messages?")));
        assert!(u.contains("q=in%3Ainbox+is%3Aunread"), "url : {u}");
        assert!(u.contains("maxResults=100"));
        assert!(!u.contains("pageToken"));
    }

    #[test]
    fn l_url_de_liste_transporte_le_jeton_de_page() {
        let u = url_liste("in:inbox", Some("07123&x=1"), 100);

        assert!(u.contains("pageToken=07123%26x%3D1"), "url : {u}");
    }

    #[test]
    fn l_url_de_metadonnees_evite_de_telecharger_les_corps() {
        let u = url_metadonnees("18c5f0a1");

        assert!(u.contains("format=metadata"));
        for entete in ENTETES_TRI {
            assert!(u.contains(&format!("metadataHeaders={entete}")), "{entete}");
        }
    }

    #[test]
    fn les_identifiants_de_message_sont_encodes_dans_l_url() {
        // Ils viennent de Gmail, mais rien ne justifie de les coller tels quels
        // dans un chemin d'URL.
        assert!(url_trash("a/b?c").contains("a%2Fb%3Fc"));
        assert!(url_metadonnees("a/b").contains("a%2Fb"));
    }

    #[tokio::test(start_paused = true)]
    async fn un_appel_qui_reussit_ne_rejoue_pas() {
        let c = client(vec![ok(r#"{"resultSizeEstimate":0}"#)]);

        c.client.lister("in:inbox", 100).await.unwrap();

        assert_eq!(c.appels(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn chaque_requete_porte_un_jeton() {
        let c = client(vec![ok(r#"{"resultSizeEstimate":0}"#)]);

        c.client.lister("in:inbox", 100).await.unwrap();

        assert_eq!(c.jetons_utilises(), ["jeton-0"]);
    }

    #[tokio::test(start_paused = true)]
    async fn un_429_est_rejoue_puis_aboutit() {
        let c = client(vec![
            echec(429, ""),
            echec(429, ""),
            ok(r#"{"resultSizeEstimate":0}"#),
        ]);

        c.client.lister("in:inbox", 100).await.unwrap();

        assert_eq!(c.appels(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn un_401_fait_renouveler_le_jeton_avant_de_rejouer() {
        let c = client(vec![echec(401, ""), ok(r#"{"resultSizeEstimate":0}"#)]);

        c.client.lister("in:inbox", 100).await.unwrap();

        // Le second appel doit porter un jeton neuf, sans quoi il reprendra un 401.
        assert_eq!(c.jetons_utilises(), ["jeton-0", "jeton-1"]);
    }

    #[tokio::test(start_paused = true)]
    async fn une_erreur_de_requete_remonte_sans_rejouer() {
        let c = client(vec![echec(
            400,
            r#"{"error":{"code":400,"message":"Invalid query"}}"#,
        )]);

        let e = c.client.lister("requête invalide", 100).await.unwrap_err();

        assert_eq!(e.code(), "ERREUR_GMAIL");
        assert_eq!(c.appels(), 1, "un 400 ne se rejoue pas");
    }

    #[tokio::test(start_paused = true)]
    async fn un_403_de_permission_ne_se_rejoue_pas() {
        // Le scope manque : marteler ne changera rien.
        let c = client(vec![echec(
            403,
            r#"{"error":{"code":403,"message":"Insufficient Permission",
                 "errors":[{"reason":"insufficientPermissions"}]}}"#,
        )]);

        assert!(c.client.lister("in:inbox", 100).await.is_err());
        assert_eq!(c.appels(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn les_reessais_finissent_par_s_arreter() {
        let c = client((0..10).map(|_| echec(503, "")).collect());

        let e = c.client.lister("in:inbox", 100).await.unwrap_err();

        assert_eq!(e.code(), "ERREUR_GMAIL");
        assert!(c.appels() <= 6, "trop de tentatives");
    }

    #[tokio::test(start_paused = true)]
    async fn la_pagination_suit_les_jetons_de_page() {
        let c = client(vec![
            ok(r#"{"messages":[{"id":"a1","threadId":"t1"}],"nextPageToken":"p2"}"#),
            ok(r#"{"messages":[{"id":"a2","threadId":"t2"}]}"#),
        ]);

        let messages = c.client.lister("in:inbox", 100).await.unwrap();

        assert_eq!(messages.len(), 2);
        assert!(c.urls()[1].contains("pageToken=p2"));
    }

    #[tokio::test(start_paused = true)]
    async fn la_pagination_s_arrete_au_plafond() {
        // Une boîte de plusieurs milliers de messages ne doit pas se traduire par
        // une pagination sans fin au premier lancement.
        let c = client(vec![
            ok(
                r#"{"messages":[{"id":"a1","threadId":"t1"},{"id":"a2","threadId":"t2"}],
                   "nextPageToken":"p2"}"#,
            ),
            ok(r#"{"messages":[{"id":"a3","threadId":"t3"}],"nextPageToken":"p3"}"#),
        ]);

        let messages = c.client.lister("in:inbox", 3).await.unwrap();

        assert_eq!(messages.len(), 3);
        assert_eq!(c.appels(), 2, "pas de page superflue");
    }

    #[tokio::test(start_paused = true)]
    async fn l_archivage_envoie_un_seul_appel_par_lot() {
        let c = client(vec![ok("")]);
        let ops = vec![OperationGmail::RetirerLibelles {
            ids: vec!["m1".into(), "m2".into()],
            libelles: vec!["INBOX".into()],
        }];

        let rapport = c.client.appliquer(&ops).await;

        assert_eq!(c.appels(), 1);
        assert_eq!(rapport.archives, 2, "le rapport compte les messages");
        assert_eq!(rapport.echecs, 0);

        let corps = &c.corps_envoyes()[0];
        assert!(corps.contains("removeLabelIds"), "corps : {corps}");
        assert!(corps.contains("INBOX"));
        assert!(corps.contains("m1") && corps.contains("m2"));
    }

    #[tokio::test(start_paused = true)]
    async fn la_mise_a_la_corbeille_vise_l_endpoint_trash() {
        let c = client(vec![ok("{}")]);
        let ops = vec![OperationGmail::MettreALaCorbeille { id: "m1".into() }];

        let rapport = c.client.appliquer(&ops).await;

        assert_eq!(rapport.mis_a_la_corbeille, 1);
        // `trash` et non `delete` : la corbeille reste réversible trente jours.
        assert!(c.urls()[0].ends_with("/messages/m1/trash"));
    }

    #[tokio::test(start_paused = true)]
    async fn l_echec_d_une_operation_n_empeche_pas_les_suivantes() {
        let c = client(vec![
            echec(404, r#"{"error":{"code":404,"message":"Not Found"}}"#),
            ok("{}"),
        ]);
        let ops = vec![
            OperationGmail::MettreALaCorbeille {
                id: "disparu".into(),
            },
            OperationGmail::MettreALaCorbeille { id: "m2".into() },
        ];

        let rapport = c.client.appliquer(&ops).await;

        assert_eq!(rapport.echecs, 1);
        assert_eq!(rapport.mis_a_la_corbeille, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn les_metadonnees_sont_analysees() {
        let c = client(vec![ok(r#"{
            "id":"m1","threadId":"t1","labelIds":["INBOX"],
            "payload":{"headers":[{"name":"From","value":"a@b.fr"}]}
        }"#)]);

        let m = c.client.metadonnees("m1").await.unwrap();

        assert_eq!(m.from(), "a@b.fr");
        assert!(c.urls()[0].contains("format=metadata"));
    }
}
