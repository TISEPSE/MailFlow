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
use super::{BASE_API, ENTETES_TRI, libelles};
use crate::auth::URL_USERINFO;

/// Ce que Google veut bien dire d'un compte : de quoi le reconnaître, rien de
/// plus. Les deux champs sont facultatifs côté Google, donc ici aussi.
#[derive(Debug, Default, serde::Deserialize)]
pub struct Renseignements {
    pub name: Option<String>,
    pub picture: Option<String>,
}
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

/// URL de `users.messages.get`, message entier.
fn url_complet(id: &str) -> String {
    let id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
    format!("{BASE_API}/users/me/messages/{id}?format=full")
}

fn url_libelles() -> String {
    format!("{BASE_API}/users/me/labels")
}

/// URL de `users.messages.attachments.get`.
fn url_piece_jointe(message: &str, piece: &str) -> String {
    let encoder = |v: &str| url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>();
    format!(
        "{BASE_API}/users/me/messages/{}/attachments/{}",
        encoder(message),
        encoder(piece)
    )
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

    /// Adresse du compte relié, telle que Gmail la connaît.
    ///
    /// Une unité de quota, et pas de scope supplémentaire : `gmail.modify`
    /// suffit. Sert à afficher de quel compte il s'agit — utile dès qu'on en
    /// gère plusieurs, et rassurant quand on n'en a qu'un.
    pub async fn adresse_du_compte(&self) -> Resultat<String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Profil {
            email_address: String,
        }

        let corps = self
            .appeler(Methode::Get, &format!("{BASE_API}/users/me/profile"), None)
            .await?;

        serde_json::from_str::<Profil>(&corps)
            .map(|p| p.email_address)
            .map_err(|e| AppError::Reseau(format!("profil illisible : {e}")))
    }

    /// Nom affiché et adresse de la photo du compte.
    ///
    /// Lu sur le point d'entrée OpenID de Google plutôt que sur l'API Gmail,
    /// qui ne connaît ni l'un ni l'autre. Rendu sans erreur quand les champs
    /// manquent : un compte sans photo est un cas ordinaire, pas une panne.
    pub async fn renseignements_du_compte(&self) -> Resultat<Renseignements> {
        let corps = self.appeler(Methode::Get, URL_USERINFO, None).await?;

        serde_json::from_str::<Renseignements>(&corps)
            .map_err(|e| AppError::Reseau(format!("renseignements illisibles : {e}")))
    }

    /// Retire le libellé `UNREAD` de messages.
    ///
    /// Seul endroit où MailFlow touche à l'état de lecture. Le geste vient de
    /// l'utilisateur — il vient d'ouvrir le message — et reste réversible
    /// depuis Gmail, qui sait remettre un message en non-lu.
    ///
    /// Un lot vide n'appelle rien : Gmail refuse `batchModify` sans
    /// identifiant, et ce serait dépenser une requête pour un refus.
    pub async fn marquer_lu(&self, ids: &[String]) -> Resultat<()> {
        if ids.is_empty() {
            return Ok(());
        }

        let corps = serde_json::json!({
            "ids": ids,
            "removeLabelIds": [libelles::UNREAD],
        })
        .to_string();

        self.appeler(Methode::Post, &url_batch_modify(), Some(corps))
            .await
            .map(|_| ())
    }

    /// Signale des messages comme indésirables.
    ///
    /// Reproduit exactement ce que fait Gmail : le libellé `SPAM` est posé, et
    /// le message quitte la boîte de réception. Google apprend de ce geste et
    /// filtrera de lui-même les suivants — c'est pourquoi aucune règle locale
    /// n'est créée en plus, qui ferait double emploi et se contredirait le jour
    /// où l'utilisateur retirerait le message des indésirables.
    pub async fn marquer_spam(&self, ids: &[String]) -> Resultat<()> {
        if ids.is_empty() {
            return Ok(());
        }

        let corps = serde_json::json!({
            "ids": ids,
            "addLabelIds": [libelles::SPAM],
            "removeLabelIds": [libelles::INBOX],
        })
        .to_string();

        self.appeler(Methode::Post, &url_batch_modify(), Some(corps))
            .await
            .map(|_| ())
    }

    /// Libellés que l'utilisateur a créés lui-même.
    ///
    /// Les libellés système — `INBOX`, `SPAM`, `CATEGORY_PROMOTIONS` — sont
    /// écartés : ce sont des états de message, pas des dossiers où l'on range.
    /// Les proposer conduirait l'utilisateur à croire qu'il peut classer un
    /// message dans « Indésirables » comme dans « Factures ».
    pub async fn libelles(&self) -> Resultat<Vec<crate::gmail::modele::LibelleGmail>> {
        use crate::gmail::modele::ReponseLibelles;

        let corps = self.appeler(Methode::Get, &url_libelles(), None).await?;
        let reponse: ReponseLibelles = serde_json::from_str(&corps)
            .map_err(|e| AppError::Reseau(format!("libellés illisibles : {e}")))?;

        let mut propres: Vec<_> = reponse
            .labels
            .into_iter()
            .filter(|l| l.genre == "user")
            .collect();

        propres.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(propres)
    }

    /// Crée un libellé et le rend tel que Gmail l'a enregistré.
    ///
    /// Le nom est rendu par Google, pas repris de la demande : Gmail normalise
    /// les espaces et peut refuser un doublon. Se fier à ce qu'on a envoyé
    /// afficherait un libellé qui n'existe pas sous ce nom.
    pub async fn creer_libelle(&self, nom: &str) -> Resultat<crate::gmail::modele::LibelleGmail> {
        let nom = nom.trim();
        if nom.is_empty() {
            return Err(AppError::Config("un libellé a besoin d'un nom".into()));
        }

        let corps = serde_json::json!({
            "name": nom,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        })
        .to_string();

        let reponse = self
            .appeler(Methode::Post, &url_libelles(), Some(corps))
            .await?;

        serde_json::from_str(&reponse)
            .map_err(|e| AppError::Reseau(format!("libellé créé mais illisible : {e}")))
    }

    /// Range des messages sous un libellé et les sort de la boîte de réception.
    ///
    /// Sans `libelle`, c'est un archivage simple — exactement le bouton
    /// d'archivage de Gmail, qui ne fait qu'ôter `INBOX`.
    pub async fn ranger(&self, ids: &[String], libelle: Option<&str>) -> Resultat<()> {
        if ids.is_empty() {
            return Ok(());
        }

        let ajouts: Vec<&str> = libelle.into_iter().collect();
        let corps = serde_json::json!({
            "ids": ids,
            "addLabelIds": ajouts,
            "removeLabelIds": [libelles::INBOX],
        })
        .to_string();

        self.appeler(Methode::Post, &url_batch_modify(), Some(corps))
            .await
            .map(|_| ())
    }

    /// Contenu d'une pièce jointe, décodé.
    ///
    /// Gmail ne met en ligne que les petites parties ; les images intégrées à un
    /// message demandent presque toujours cet appel supplémentaire.
    pub async fn piece_jointe(&self, message: &str, piece: &str) -> Resultat<Vec<u8>> {
        use base64::Engine;

        let corps = self
            .appeler(Methode::Get, &url_piece_jointe(message, piece), None)
            .await?;

        let reponse: crate::gmail::modele::PieceJointe = serde_json::from_str(&corps)
            .map_err(|e| AppError::Reseau(format!("pièce jointe illisible : {e}")))?;

        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(reponse.data.trim_end_matches('='))
            .map_err(|e| AppError::Reseau(format!("pièce jointe mal encodée : {e}")))
    }

    /// Message complet, corps compris.
    ///
    /// Bien plus coûteux que `format=metadata` — on télécharge le HTML entier —
    /// donc réservé au message que l'utilisateur vient d'ouvrir. Le tri, lui,
    /// continue de ne lire que des en-têtes.
    pub async fn message_complet(&self, id: &str) -> Resultat<MessageMetadata> {
        let corps = self.appeler(Methode::Get, &url_complet(id), None).await?;

        serde_json::from_str(&corps)
            .map_err(|e| AppError::Reseau(format!("message illisible : {e}")))
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
                OperationGmail::ModifierLibelles {
                    ids,
                    ajouter,
                    retirer,
                } => {
                    let corps = serde_json::json!({
                        "ids": ids,
                        "addLabelIds": ajouter,
                        "removeLabelIds": retirer,
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
                    OperationGmail::ModifierLibelles { ids, .. } => rapport.archives += ids.len(),
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
        let ops = vec![OperationGmail::ModifierLibelles {
            ids: vec!["m1".into(), "m2".into()],
            ajouter: Vec::new(),
            retirer: vec!["INBOX".into()],
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
    async fn l_adresse_du_compte_est_lue_sur_le_profil() {
        let c = client(vec![ok(
            r#"{"emailAddress":"moi@gmail.com","messagesTotal":42}"#,
        )]);

        assert_eq!(c.client.adresse_du_compte().await.unwrap(), "moi@gmail.com");
        assert!(c.urls()[0].ends_with("/users/me/profile"));
    }

    #[tokio::test(start_paused = true)]
    async fn seuls_les_libelles_de_l_utilisateur_sont_proposes() {
        // `INBOX` ou `SPAM` sont des états, pas des dossiers : les offrir comme
        // destination laisserait croire qu'on peut y ranger un message.
        let c = client(vec![ok(r#"{"labels":[
                {"id":"INBOX","name":"INBOX","type":"system"},
                {"id":"L2","name":"factures","type":"user"},
                {"id":"L1","name":"Archives","type":"user"}
            ]}"#)]);

        let noms: Vec<String> = c
            .client
            .libelles()
            .await
            .unwrap()
            .into_iter()
            .map(|l| l.name)
            .collect();

        // Triés sans tenir compte de la casse, sinon « factures » passerait
        // après tous les libellés commençant par une majuscule.
        assert_eq!(noms, ["Archives", "factures"]);
    }

    #[tokio::test(start_paused = true)]
    async fn un_libelle_cree_est_rendu_tel_que_google_l_a_enregistre() {
        // Gmail normalise les noms : afficher celui qu'on a demandé montrerait
        // un libellé qui n'existe pas sous cette forme.
        let c = client(vec![ok(r#"{"id":"L9","name":"Factures","type":"user"}"#)]);

        let cree = c.client.creer_libelle("  Factures  ").await.unwrap();

        assert_eq!(cree.name, "Factures");
        assert_eq!(cree.id, "L9");
        let envoye: serde_json::Value = serde_json::from_str(&c.corps_envoyes()[0]).unwrap();
        assert_eq!(envoye["name"], "Factures");
    }

    #[tokio::test(start_paused = true)]
    async fn un_libelle_sans_nom_n_est_pas_demande_a_google() {
        let c = client(vec![]);

        assert!(c.client.creer_libelle("   ").await.is_err());
        assert!(c.urls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn ranger_sans_libelle_se_contente_d_archiver() {
        let c = client(vec![ok("{}")]);

        c.client.ranger(&["m1".to_string()], None).await.unwrap();

        let envoye: serde_json::Value = serde_json::from_str(&c.corps_envoyes()[0]).unwrap();
        assert_eq!(envoye["addLabelIds"], serde_json::json!([]));
        assert_eq!(envoye["removeLabelIds"], serde_json::json!(["INBOX"]));
    }

    #[tokio::test(start_paused = true)]
    async fn ranger_sous_un_libelle_le_pose_et_retire_la_boite() {
        let c = client(vec![ok("{}")]);

        c.client
            .ranger(&["m1".to_string()], Some("L1"))
            .await
            .unwrap();

        let envoye: serde_json::Value = serde_json::from_str(&c.corps_envoyes()[0]).unwrap();
        assert_eq!(envoye["addLabelIds"], serde_json::json!(["L1"]));
        assert_eq!(envoye["removeLabelIds"], serde_json::json!(["INBOX"]));
    }

    #[tokio::test(start_paused = true)]
    async fn signaler_un_spam_le_sort_de_la_boite_de_reception() {
        // Poser `SPAM` sans retirer `INBOX` laisserait le message sous les yeux
        // de l'utilisateur, qui croirait le geste sans effet.
        let c = client(vec![ok("{}")]);

        c.client.marquer_spam(&["m1".to_string()]).await.unwrap();

        let envoye: serde_json::Value = serde_json::from_str(&c.corps_envoyes()[0]).unwrap();

        assert_eq!(envoye["addLabelIds"], serde_json::json!(["SPAM"]));
        assert_eq!(envoye["removeLabelIds"], serde_json::json!(["INBOX"]));
    }

    #[tokio::test(start_paused = true)]
    async fn marquer_lu_ne_retire_que_le_libelle_de_non_lu() {
        // Un `removeLabelIds` trop large retirerait le message de la boîte de
        // réception, alors que l'utilisateur n'a fait que l'ouvrir.
        let c = client(vec![ok("{}")]);

        c.client
            .marquer_lu(&["m1".to_string(), "m2".to_string()])
            .await
            .unwrap();

        let corps = c.corps_envoyes()[0].clone();
        let envoye: serde_json::Value = serde_json::from_str(&corps).unwrap();

        assert_eq!(envoye["removeLabelIds"], serde_json::json!(["UNREAD"]));
        assert_eq!(envoye["ids"], serde_json::json!(["m1", "m2"]));
        assert!(envoye.get("addLabelIds").is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn marquer_lu_sans_message_n_appelle_rien() {
        let c = client(vec![]);

        c.client.marquer_lu(&[]).await.unwrap();

        assert!(c.urls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn le_nom_et_la_photo_sont_lus_sur_le_point_d_entree_openid() {
        // L'API Gmail ne connaît ni l'un ni l'autre : c'est bien un autre hôte
        // qu'il faut interroger, avec le même jeton.
        let c = client(vec![ok(
            r#"{"name":"Lucie Marchand","picture":"https://lh3.googleusercontent.com/a/x=s96"}"#,
        )]);

        let r = c.client.renseignements_du_compte().await.unwrap();

        assert_eq!(r.name.as_deref(), Some("Lucie Marchand"));
        assert!(r.picture.unwrap().starts_with("https://"));
        assert_eq!(c.urls()[0], URL_USERINFO);
    }

    #[tokio::test(start_paused = true)]
    async fn un_compte_sans_photo_n_est_pas_une_panne() {
        // Beaucoup de comptes n'en ont pas ; l'interface doit alors retomber
        // sur le logo Google, pas afficher une erreur.
        let c = client(vec![ok(r#"{"email":"moi@gmail.com"}"#)]);

        let r = c.client.renseignements_du_compte().await.unwrap();

        assert!(r.picture.is_none());
        assert!(r.name.is_none());
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
