//! Le carnet d'adresses, demandé à Google plutôt que déduit des messages.
//!
//! # Pourquoi deux points d'entrée
//!
//! Gmail propose deux natures d'entrées, et l'API les sépare. `connections`
//! rend le carnet que l'utilisateur tient lui-même, avec noms et photos.
//! `otherContacts` rend les adresses que Google retient de lui-même quand on
//! écrit à quelqu'un : ce sont elles qui donnent les propositions sans nom.
//! N'en demander qu'un des deux amputerait la liste de moitié.
//!
//! # Ce qui n'est pas demandé
//!
//! Les deux portées sont en lecture seule. MailFlow n'écrit jamais dans le
//! carnet de qui que ce soit.

use serde::Deserialize;

use super::{ContactConnu, Origine};
use crate::error::{AppError, Resultat};
use crate::gmail::client::{Methode, SourceJeton, Transport};

const RACINE: &str = "https://people.googleapis.com/v1";

/// Taille de page maximale acceptée par l'API pour ces deux points d'entrée.
const PAR_PAGE: usize = 1000;

#[derive(Deserialize)]
struct Nom {
    #[serde(rename = "displayName")]
    affichage: Option<String>,
}

#[derive(Deserialize)]
struct Adresse {
    value: Option<String>,
}

#[derive(Deserialize)]
struct Photo {
    url: Option<String>,
}

#[derive(Deserialize)]
struct Personne {
    #[serde(default)]
    names: Vec<Nom>,
    #[serde(default, rename = "emailAddresses")]
    adresses: Vec<Adresse>,
    #[serde(default)]
    photos: Vec<Photo>,
}

#[derive(Deserialize)]
struct PageConnections {
    #[serde(default)]
    connections: Vec<Personne>,
    #[serde(rename = "nextPageToken")]
    suite: Option<String>,
}

#[derive(Deserialize)]
struct PageAutres {
    #[serde(default, rename = "otherContacts")]
    autres: Vec<Personne>,
    #[serde(rename = "nextPageToken")]
    suite: Option<String>,
}

/// Une personne devient autant d'entrées qu'elle a d'adresses.
///
/// C'est ce que fait Gmail : on y choisit une adresse, pas une personne. Un
/// collègue qui a une adresse professionnelle et une personnelle apparaît deux
/// fois, sous le même nom.
fn en_contacts(personne: &Personne, origine: Origine) -> Vec<ContactConnu> {
    let nom = personne
        .names
        .first()
        .and_then(|n| n.affichage.clone())
        .unwrap_or_default()
        .trim()
        .to_string();

    let photo = personne.photos.first().and_then(|p| p.url.clone());

    personne
        .adresses
        .iter()
        .filter_map(|a| a.value.as_ref())
        .map(|a| a.trim().to_lowercase())
        .filter(|a| !a.is_empty())
        .map(|adresse| ContactConnu {
            adresse,
            nom: nom.clone(),
            photo: photo.clone(),
            origine,
        })
        .collect()
}

/// Lit une page du carnet. Rend les contacts et, s'il y en a une, la page suivante.
///
/// Une réponse illisible rend un carnet vide plutôt qu'une erreur : le carnet
/// est un confort de saisie, pas une donnée dont dépend l'envoi.
pub fn lire_connections(json: &str) -> (Vec<ContactConnu>, Option<String>) {
    let Ok(page) = serde_json::from_str::<PageConnections>(json) else {
        return (Vec::new(), None);
    };

    let contacts = page
        .connections
        .iter()
        .flat_map(|p| en_contacts(p, Origine::Carnet))
        .collect();

    (contacts, page.suite)
}

/// Lit une page des « autres contacts ».
pub fn lire_autres(json: &str) -> (Vec<ContactConnu>, Option<String>) {
    let Ok(page) = serde_json::from_str::<PageAutres>(json) else {
        return (Vec::new(), None);
    };

    let contacts = page
        .autres
        .iter()
        .flat_map(|p| en_contacts(p, Origine::Autre))
        .collect();

    (contacts, page.suite)
}

/// Relève tout le carnet : les adresses collectées, puis le carnet propre.
///
/// Les deux listes sont réunies sur l'adresse, qui identifie. Le carnet passe
/// en second et écrase donc les « autres contacts » : c'est lui qui porte le
/// nom et la photo, et une même adresse figure souvent des deux côtés.
pub async fn relever<T: Transport, S: SourceJeton>(
    transport: &T,
    jetons: &S,
) -> Resultat<Vec<ContactConnu>> {
    let jeton = jetons.jeton(false).await?;
    let mut par_adresse: std::collections::HashMap<String, ContactConnu> =
        std::collections::HashMap::new();

    type Lecture = fn(&str) -> (Vec<ContactConnu>, Option<String>);

    let sources: [(String, Lecture); 2] = [
        (
            format!("{RACINE}/otherContacts?readMask=names,emailAddresses&pageSize={PAR_PAGE}"),
            lire_autres,
        ),
        (
            format!(
                "{RACINE}/people/me/connections?personFields=names,emailAddresses,photos&pageSize={PAR_PAGE}"
            ),
            lire_connections,
        ),
    ];

    for (base, lecture) in sources {
        let mut page_suivante: Option<String> = None;

        loop {
            let url = match &page_suivante {
                Some(jeton_page) => format!("{base}&pageToken={jeton_page}"),
                None => base.clone(),
            };

            let reponse = transport.envoyer(Methode::Get, &url, None, &jeton).await?;

            // Le compte a été relié avant que MailFlow ne demande les contacts.
            // Google ne complète pas une autorisation déjà accordée : il faut
            // repasser par l'écran de consentement, et le dire.
            if reponse.statut == 403 && reponse.corps.contains("insufficient authentication scopes")
            {
                return Err(AppError::PorteeManquante);
            }

            if reponse.statut >= 400 {
                // `ApiGmail` porte déjà « une API Google a répondu tel statut ».
                // Lui ajouter une jumelle pour People n'apporterait qu'un nom.
                return Err(AppError::ApiGmail {
                    statut: reponse.statut,
                });
            }

            let (contacts, suite) = lecture(&reponse.corps);
            // Compté par source : un carnet vide et un carnet refusé se
            // ressemblent trop pour qu'on les distingue après coup.
            log::info!(
                "{} adresse(s) rendues par {}",
                contacts.len(),
                if base.contains("otherContacts") {
                    "les autres contacts"
                } else {
                    "le carnet Google"
                }
            );
            for contact in contacts {
                par_adresse.insert(contact.adresse.clone(), contact);
            }

            match suite {
                Some(s) => page_suivante = Some(s),
                None => break,
            }
        }
    }

    Ok(par_adresse.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::client::ReponseBrute;

    #[test]
    fn une_personne_a_plusieurs_adresses_donne_plusieurs_entrees() {
        // Dans Gmail on choisit une adresse, pas une personne : deux adresses
        // pour Alice sont deux propositions distinctes.
        let json = r#"{"connections":[{
            "names":[{"displayName":"Alice Martin"}],
            "emailAddresses":[{"value":"alice@exemple.fr"},{"value":"a.martin@travail.fr"}],
            "photos":[{"url":"https://lh3.googleusercontent.com/a"}]
        }]}"#;

        let (contacts, suite) = lire_connections(json);

        assert_eq!(contacts.len(), 2);
        assert_eq!(contacts[0].adresse, "alice@exemple.fr");
        assert_eq!(contacts[1].adresse, "a.martin@travail.fr");
        assert!(contacts.iter().all(|c| c.nom == "Alice Martin"));
        assert!(contacts.iter().all(|c| c.origine == Origine::Carnet));
        assert_eq!(
            contacts[0].photo.as_deref(),
            Some("https://lh3.googleusercontent.com/a")
        );
        assert_eq!(suite, None);
    }

    #[test]
    fn une_entree_sans_nom_garde_son_adresse_et_pas_de_nom() {
        // Les « autres contacts » n'ont souvent que l'adresse. Recopier
        // l'adresse dans le nom afficherait deux fois la même chose.
        let json = r#"{"otherContacts":[{
            "emailAddresses":[{"value":"baceva1993@gmail.com"}]
        }]}"#;

        let (contacts, _) = lire_autres(json);

        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].adresse, "baceva1993@gmail.com");
        assert_eq!(contacts[0].nom, "");
        assert_eq!(contacts[0].photo, None);
        assert_eq!(contacts[0].origine, Origine::Autre);
    }

    #[test]
    fn une_entree_sans_adresse_est_ignoree() {
        // Un contact sans adresse ne peut pas être un destinataire.
        let json = r#"{"connections":[{"names":[{"displayName":"Sans Adresse"}]}]}"#;
        let (contacts, _) = lire_connections(json);
        assert!(contacts.is_empty());
    }

    #[test]
    fn le_jeton_de_page_suivante_est_rendu() {
        let json = r#"{"connections":[],"nextPageToken":"abc123"}"#;
        let (_, suite) = lire_connections(json);
        assert_eq!(suite.as_deref(), Some("abc123"));
    }

    #[test]
    fn une_reponse_vide_ne_casse_rien() {
        let (contacts, suite) = lire_connections("{}");
        assert!(contacts.is_empty());
        assert_eq!(suite, None);
    }

    #[test]
    fn les_adresses_sont_ramenees_en_minuscules() {
        // Le carnet identifie par l'adresse : deux casses différentes seraient
        // deux entrées pour la même personne.
        let json = r#"{"connections":[{
            "emailAddresses":[{"value":"Alice@Exemple.FR"}]
        }]}"#;
        let (contacts, _) = lire_connections(json);
        assert_eq!(contacts[0].adresse, "alice@exemple.fr");
    }

    /// Transport simulé : rend les réponses préparées, dans l'ordre.
    struct TransportFactice {
        reponses: std::sync::Mutex<Vec<ReponseBrute>>,
        urls: std::sync::Mutex<Vec<String>>,
    }

    impl TransportFactice {
        fn nouveau(corps: Vec<(u16, &str)>) -> Self {
            Self {
                reponses: std::sync::Mutex::new(
                    corps
                        .into_iter()
                        .map(|(statut, c)| ReponseBrute {
                            statut,
                            corps: c.to_string(),
                            retry_after: None,
                        })
                        .rev()
                        .collect(),
                ),
                urls: std::sync::Mutex::new(Vec::new()),
            }
        }
    }

    impl Transport for TransportFactice {
        async fn envoyer(
            &self,
            _m: Methode,
            url: &str,
            _corps: Option<String>,
            _jeton: &str,
        ) -> Resultat<ReponseBrute> {
            self.urls.lock().unwrap().push(url.to_string());
            Ok(self.reponses.lock().unwrap().pop().unwrap())
        }
    }

    struct JetonFactice;

    impl SourceJeton for JetonFactice {
        async fn jeton(&self, _forcer: bool) -> Resultat<String> {
            Ok("jeton-de-test".into())
        }
    }

    #[tokio::test]
    async fn les_deux_sources_sont_interrogees_et_reunies() {
        let t = TransportFactice::nouveau(vec![
            (
                200,
                r#"{"otherContacts":[{"emailAddresses":[{"value":"bob@exemple.fr"}]}]}"#,
            ),
            (
                200,
                r#"{"connections":[{"names":[{"displayName":"Alice"}],"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#,
            ),
        ]);

        let contacts = relever(&t, &JetonFactice).await.unwrap();

        assert_eq!(contacts.len(), 2);
        let urls = t.urls.lock().unwrap().clone();
        assert!(urls[0].contains("otherContacts"));
        assert!(urls[1].contains("people/me/connections"));
    }

    #[tokio::test]
    async fn la_pagination_est_suivie_jusqu_au_bout() {
        let t = TransportFactice::nouveau(vec![
            (
                200,
                r#"{"otherContacts":[{"emailAddresses":[{"value":"un@exemple.fr"}]}],"nextPageToken":"p2"}"#,
            ),
            (
                200,
                r#"{"otherContacts":[{"emailAddresses":[{"value":"deux@exemple.fr"}]}]}"#,
            ),
            (200, r#"{"connections":[]}"#),
        ]);

        let contacts = relever(&t, &JetonFactice).await.unwrap();

        assert_eq!(contacts.len(), 2);
        assert!(t.urls.lock().unwrap()[1].contains("pageToken=p2"));
    }

    #[tokio::test]
    async fn un_refus_de_portee_est_nomme() {
        // Le cas d'un compte relié avant que MailFlow ne demande les contacts.
        let t = TransportFactice::nouveau(vec![(
            403,
            r#"{"error":{"status":"PERMISSION_DENIED","message":"Request had insufficient authentication scopes."}}"#,
        )]);

        let erreur = relever(&t, &JetonFactice).await.unwrap_err();

        assert!(matches!(erreur, AppError::PorteeManquante));
    }

    #[tokio::test]
    async fn une_adresse_vue_deux_fois_ne_compte_qu_une_fois() {
        // La même adresse peut être dans le carnet et dans les autres contacts.
        // C'est celle du carnet qui doit rester : elle porte le nom.
        let t = TransportFactice::nouveau(vec![
            (
                200,
                r#"{"otherContacts":[{"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#,
            ),
            (
                200,
                r#"{"connections":[{"names":[{"displayName":"Alice"}],"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#,
            ),
        ]);

        let contacts = relever(&t, &JetonFactice).await.unwrap();

        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].nom, "Alice");
        assert_eq!(contacts[0].origine, Origine::Carnet);
    }
}
