# Suggestions de destinataires depuis le carnet Google — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le carnet déduit des messages reçus par le vrai carnet Google, lu via la People API.

**Architecture:** Un module `contacts/people.rs` monté sur le `Transport` et la `SourceJeton` déjà en service interroge deux points d'entrée paginés de la People API. Le carnet garde son fichier et son cache par compte ; seule la source de remplissage change. Le classement des suggestions, déjà correct côté frontend, ne bouge pas.

**Tech Stack:** Rust (reqwest via `TransportHttp`, serde), Tauri 2, React 19, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-suggestions-contacts-people-api-design.md`

## Global Constraints

- Les commentaires et la documentation sont en français, comme tout le dépôt.
- Aucun test ne touche le réseau : le `Transport` est simulé, comme dans `gmail/client.rs` (voir son `mod tests`).
- `cargo fmt --all`, `cargo clippy --all-targets -- -D warnings` et `cargo test` doivent passer avant chaque commit ; côté frontend `npm run lint`, `npm run build`, `npm test`.
- Portées exactes : `https://www.googleapis.com/auth/contacts.readonly` et `https://www.googleapis.com/auth/contacts.other.readonly`.
- Points d'entrée exacts : `https://people.googleapis.com/v1/people/me/connections` et `https://people.googleapis.com/v1/otherContacts`.
- Le champ `apparitions` disparaît partout ; ne pas le remplacer par un chiffre inventé.

---

### Task 1: Modèle du carnet

**Files:**
- Modify: `src-tauri/src/contacts.rs`
- Test: `src-tauri/src/contacts.rs` (module `tests` en fin de fichier)

**Interfaces:**
- Consumes: rien.
- Produces: `ContactConnu { adresse: String, nom: String, photo: Option<String>, origine: Origine }`, `enum Origine { Carnet, Autre }`, `contacts::charger`, `contacts::enregistrer` (signatures inchangées).

- [ ] **Step 1: Écrire le test qui échoue**

Dans le `mod tests` de `src-tauri/src/contacts.rs` :

```rust
#[test]
fn un_carnet_d_ancienne_forme_se_relit_en_carnet_vide() {
    // Les fichiers écrits avant la People API portent `apparitions` et pas
    // `origine` : ils ne doivent pas faire échouer le démarrage, seulement
    // être remplacés à la première synchronisation.
    let d = tempfile::tempdir().unwrap();
    let chemin_fichier = chemin(d.path(), "moi@gmail.com");
    std::fs::create_dir_all(chemin_fichier.parent().unwrap()).unwrap();
    std::fs::write(
        &chemin_fichier,
        r#"[{"adresse":"a@b.fr","nom":"A","apparitions":3}]"#,
    )
    .unwrap();

    assert_eq!(charger(d.path(), "moi@gmail.com"), Vec::new());
}

#[test]
fn un_contact_se_range_et_se_relit() {
    let d = tempfile::tempdir().unwrap();
    let contacts = vec![ContactConnu {
        adresse: "a@b.fr".into(),
        nom: "Alice".into(),
        photo: Some("https://lh3.googleusercontent.com/x".into()),
        origine: Origine::Carnet,
    }];

    enregistrer(d.path(), "moi@gmail.com", &contacts).unwrap();
    assert_eq!(charger(d.path(), "moi@gmail.com"), contacts);
}
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd src-tauri && cargo test contacts::tests -- --nocapture`
Expected: FAIL, `ContactConnu` n'a ni `photo` ni `origine`.

- [ ] **Step 3: Modifier la structure**

Remplacer la définition de `ContactConnu` dans `src-tauri/src/contacts.rs` :

```rust
/// D'où vient une entrée du carnet.
///
/// Sert de départage : à correspondance égale, quelqu'un que l'utilisateur a
/// délibérément enregistré passe avant une adresse que Google a retenue toute
/// seule.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Origine {
    /// Le carnet d'adresses Google, celui que l'utilisateur tient lui-même.
    Carnet,
    /// Les « autres contacts » : adresses collectées par Google à l'envoi.
    Autre,
}

/// Une entrée du carnet.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactConnu {
    pub adresse: String,
    pub nom: String,
    /// URL fournie par Google. Absente des « autres contacts », que l'API ne
    /// sert jamais avec une photo.
    #[serde(default)]
    pub photo: Option<String>,
    pub origine: Origine,
}
```

Mettre à jour l'en-tête du module : le carnet ne vient plus des messages mais de la People API.

- [ ] **Step 4: Supprimer `fusionner`**

Supprimer entièrement la fonction `pub fn fusionner(...)` de `src-tauri/src/contacts.rs` et tous les tests qui l'exercent. Elle agrégeait des `MessageAffiche` en carnet ; plus rien ne l'appellera après la tâche 4. Retirer l'import `use crate::gmail::boite::MessageAffiche;` devenu inutile.

- [ ] **Step 5: Lancer les tests**

Run: `cd src-tauri && cargo test contacts`
Expected: PASS. Les appels restants à `fusionner` dans `commands/mod.rs` font échouer la compilation : c'est attendu, la tâche 4 les remplace. Pour finir cette tâche, commenter temporairement l'appel n'est pas acceptable — enchaîner directement sur la tâche 4 avant de commiter.

- [ ] **Step 6: Commit (après la tâche 4)**

Cette tâche et la tâche 4 partagent un commit, la compilation ne tenant pas entre les deux.

---

### Task 2: Lecture des réponses People

**Files:**
- Create: `src-tauri/src/contacts/people.rs`
- Modify: `src-tauri/src/contacts.rs` → devient `src-tauri/src/contacts/mod.rs`
- Test: dans `people.rs`

**Interfaces:**
- Consumes: `ContactConnu`, `Origine` (tâche 1).
- Produces: `pub fn lire_connections(json: &str) -> (Vec<ContactConnu>, Option<String>)` et `pub fn lire_autres(json: &str) -> (Vec<ContactConnu>, Option<String>)`, rendant les contacts et le jeton de page suivante.

Déplacer d'abord `src-tauri/src/contacts.rs` vers `src-tauri/src/contacts/mod.rs` (`git mv`), puis y ajouter `pub mod people;`.

- [ ] **Step 1: Écrire les tests qui échouent**

```rust
#[cfg(test)]
mod tests {
    use super::*;

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
}
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd src-tauri && cargo test contacts::people`
Expected: FAIL, `lire_connections` n'existe pas.

- [ ] **Step 3: Écrire l'implémentation minimale**

En tête de `src-tauri/src/contacts/people.rs` :

```rust
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
pub fn lire_connections(json: &str) -> (Vec<ContactConnu>, Option<String>) {
    let page: PageConnections = match serde_json::from_str(json) {
        Ok(p) => p,
        Err(_) => return (Vec::new(), None),
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
    let page: PageAutres = match serde_json::from_str(json) {
        Ok(p) => p,
        Err(_) => return (Vec::new(), None),
    };

    let contacts = page
        .autres
        .iter()
        .flat_map(|p| en_contacts(p, Origine::Autre))
        .collect();

    (contacts, page.suite)
}
```

- [ ] **Step 4: Lancer les tests**

Run: `cd src-tauri && cargo test contacts::people`
Expected: PASS, six tests.

- [ ] **Step 5: Commit**

```bash
cd /home/baptiste/Vscode/MailFlow
git add src-tauri/src/contacts/
git commit -m "feat(contacts) : lecture des reponses de la People API"
```

---

### Task 3: Relevé paginé et refus de portée

**Files:**
- Modify: `src-tauri/src/contacts/people.rs`
- Test: dans `people.rs`

**Interfaces:**
- Consumes: `lire_connections`, `lire_autres` (tâche 2) ; `Transport`, `Methode`, `ReponseBrute`, `SourceJeton` de `crate::gmail::client`.
- Produces: `pub async fn relever<T: Transport, S: SourceJeton>(transport: &T, jetons: &S) -> Resultat<Vec<ContactConnu>>` et `AppError::PorteeManquante`.

- [ ] **Step 1: Ajouter la variante d'erreur**

Dans `src-tauri/src/error.rs`, ajouter à `AppError` :

```rust
    /// Le jeton ne couvre pas les contacts : l'autorisation a été accordée
    /// avant que MailFlow ne demande cette portée. Google ne l'élargit pas
    /// rétroactivement, seule une reconnexion la donne.
    PorteeManquante,
```

Lui donner le code `PORTEE_MANQUANTE` dans la conversion vers l'IPC, à côté des variantes existantes, et le message « Reliez à nouveau votre compte Google pour accéder à vos contacts. ». Ajouter `PORTEE_MANQUANTE` à l'union `CodeErreur` de `src/types/backend.ts`.

- [ ] **Step 2: Écrire les tests qui échouent**

```rust
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
            (200, r#"{"connections":[{"names":[{"displayName":"Alice"}],"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#),
            (200, r#"{"otherContacts":[{"emailAddresses":[{"value":"bob@exemple.fr"}]}]}"#),
        ]);

        let contacts = relever(&t, &JetonFactice).await.unwrap();

        assert_eq!(contacts.len(), 2);
        let urls = t.urls.lock().unwrap().clone();
        assert!(urls[0].contains("people/me/connections"));
        assert!(urls[1].contains("otherContacts"));
    }

    #[tokio::test]
    async fn la_pagination_est_suivie_jusqu_au_bout() {
        let t = TransportFactice::nouveau(vec![
            (200, r#"{"connections":[{"emailAddresses":[{"value":"un@exemple.fr"}]}],"nextPageToken":"p2"}"#),
            (200, r#"{"connections":[{"emailAddresses":[{"value":"deux@exemple.fr"}]}]}"#),
            (200, r#"{"otherContacts":[]}"#),
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
            (200, r#"{"connections":[{"names":[{"displayName":"Alice"}],"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#),
            (200, r#"{"otherContacts":[{"emailAddresses":[{"value":"alice@exemple.fr"}]}]}"#),
        ]);

        let contacts = relever(&t, &JetonFactice).await.unwrap();

        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].nom, "Alice");
        assert_eq!(contacts[0].origine, Origine::Carnet);
    }
}
```

Ajouter en tête du `mod tests` :

```rust
    use crate::error::AppError;
    use crate::gmail::client::{Methode, ReponseBrute, SourceJeton, Transport};
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd src-tauri && cargo test contacts::people`
Expected: FAIL, `relever` n'existe pas.

- [ ] **Step 4: Écrire l'implémentation**

```rust
const RACINE: &str = "https://people.googleapis.com/v1";

/// Taille de page maximale acceptée par l'API pour ces deux points d'entrée.
const PAR_PAGE: usize = 1000;

/// Relève tout le carnet : le carnet propre, puis les adresses collectées.
///
/// Les deux listes sont réunies sur l'adresse, qui identifie. Le carnet
/// l'emporte sur les « autres contacts » : c'est lui qui porte le nom et la
/// photo.
pub async fn relever<T: Transport, S: SourceJeton>(
    transport: &T,
    jetons: &S,
) -> Resultat<Vec<ContactConnu>> {
    let jeton = jetons.jeton(false).await?;

    let mut par_adresse: std::collections::HashMap<String, ContactConnu> =
        std::collections::HashMap::new();

    // Les « autres contacts » d'abord, le carnet ensuite : le second écrase le
    // premier, et c'est l'ordre voulu.
    for (base, lecture) in [
        (
            format!("{RACINE}/otherContacts?readMask=names,emailAddresses&pageSize={PAR_PAGE}"),
            lire_autres as fn(&str) -> (Vec<ContactConnu>, Option<String>),
        ),
        (
            format!(
                "{RACINE}/people/me/connections?personFields=names,emailAddresses,photos&pageSize={PAR_PAGE}"
            ),
            lire_connections as fn(&str) -> (Vec<ContactConnu>, Option<String>),
        ),
    ] {
        let mut page_suivante: Option<String> = None;

        loop {
            let url = match &page_suivante {
                Some(jeton_page) => format!("{base}&pageToken={jeton_page}"),
                None => base.clone(),
            };

            let reponse = transport.envoyer(Methode::Get, &url, None, &jeton).await?;

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
```

Ajouter les imports en tête du fichier :

```rust
use crate::error::{AppError, Resultat};
use crate::gmail::client::{Methode, SourceJeton, Transport};
```

- [ ] **Step 5: Lancer les tests**

Run: `cd src-tauri && cargo test contacts::people`
Expected: PASS, dix tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/contacts/people.rs src-tauri/src/error.rs src/types/backend.ts
git commit -m "feat(contacts) : releve pagine du carnet Google"
```

---

### Task 4: Brancher la commande

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:2359-2388` (`contacts_synchroniser`)
- Modify: `src-tauri/src/commands/mod.rs:2332` (`contacts_lister`, tri)

**Interfaces:**
- Consumes: `contacts::people::relever` (tâche 3), `Origine` (tâche 1).
- Produces: `contacts_synchroniser` rendant `Vec<ContactConnu>` issus de People.

- [ ] **Step 1: Remplacer le corps de `contacts_synchroniser`**

```rust
/// Synchronise le carnet depuis le carnet d'adresses Google.
///
/// Deux ou trois appels paginés, là où la version précédente relevait 250
/// messages à chaque démarrage pour en déduire les mêmes adresses.
#[tauri::command]
pub async fn contacts_synchroniser(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<crate::contacts::ContactConnu>> {
    let compte = compte_actif(&app);
    let dossier = dossier_config(&app)?;

    let transport = TransportHttp::nouveau()?;
    let jetons = JetonsDeSession { etat: &etat };

    let contacts = crate::contacts::people::relever(&transport, &jetons).await?;

    crate::contacts::enregistrer(&dossier, &compte, &contacts)?;

    log::info!("{} contact(s) relevés dans le carnet Google", contacts.len());
    Ok(contacts)
}
```

Retirer les `use` devenus inutiles (`RulesStore` et `ClientGmail` s'ils ne servent plus dans cette fonction ; vérifier qu'ils servent ailleurs dans le fichier avant de les supprimer).

- [ ] **Step 2: Corriger le tri de `contacts_lister`**

Remplacer `tous.sort_by_key(|c| std::cmp::Reverse(c.apparitions));` par :

```rust
    // Le carnet propre avant les adresses collectées, puis l'ordre alphabétique
    // du nom pour que la liste ne bouge pas d'un lancement à l'autre.
    tous.sort_by(|a, b| {
        (a.origine != crate::contacts::Origine::Carnet)
            .cmp(&(b.origine != crate::contacts::Origine::Carnet))
            .then_with(|| a.nom.cmp(&b.nom))
    });
```

- [ ] **Step 3: Compiler et lancer toute la suite**

Run: `cd src-tauri && cargo fmt --all && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: compilation propre, tous les tests au vert. La suppression de `fusionner` (tâche 1) ne casse plus rien.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/
git commit -m "feat(contacts) : le carnet vient de Google et non plus des messages"
```

---

### Task 5: Portées OAuth

**Files:**
- Modify: `src-tauri/src/auth/mod.rs:44-77`
- Modify: `src-tauri/src/auth/flux.rs:98` et ses tests `flux.rs:344-348`

**Interfaces:**
- Consumes: rien.
- Produces: `SCOPE_CONTACTS`, `SCOPE_AUTRES_CONTACTS`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans le `mod tests` de `src-tauri/src/auth/flux.rs`, à côté des assertions existantes sur les portées :

```rust
        assert!(p["scope"].contains(SCOPE_CONTACTS));
        assert!(p["scope"].contains(SCOPE_AUTRES_CONTACTS));
        // Lecture seule : MailFlow n'écrit jamais dans le carnet.
        assert!(!p["scope"].contains("auth/contacts "));
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd src-tauri && cargo test auth::flux`
Expected: FAIL, `SCOPE_CONTACTS` n'existe pas.

- [ ] **Step 3: Déclarer les portées**

Dans `src-tauri/src/auth/mod.rs`, après `SCOPE_PROFIL` :

```rust
/// Le carnet d'adresses, en lecture seule.
///
/// C'est lui qui peuple les suggestions de destinataires. Sans lui, il faudrait
/// les déduire des messages reçus, ce qui proposait des robots d'expédition et
/// des newsletters aussi volontiers que des correspondants.
pub const SCOPE_CONTACTS: &str = "https://www.googleapis.com/auth/contacts.readonly";

/// Les adresses que Google retient de lui-même quand on écrit à quelqu'un.
///
/// Elles n'appartiennent à aucun carnet et n'ont ni nom ni photo, mais ce sont
/// elles que Gmail propose pour les correspondants qu'on n'a jamais enregistrés.
pub const SCOPE_AUTRES_CONTACTS: &str =
    "https://www.googleapis.com/auth/contacts.other.readonly";
```

Réécrire le commentaire de `SCOPE_PROFIL`, dont la dernière phrase affirme qu'on ne demande rien à l'annuaire de contacts.

- [ ] **Step 4: Les joindre à la requête**

Dans `src-tauri/src/auth/flux.rs`, remplacer la construction du paramètre `scope` :

```rust
        .append_pair(
            "scope",
            &format!("{SCOPE_GMAIL} {SCOPE_EMAIL} {SCOPE_PROFIL} {SCOPE_CONTACTS} {SCOPE_AUTRES_CONTACTS}"),
        )
```

Et compléter l'import : `use super::{SCOPE_AUTRES_CONTACTS, SCOPE_CONTACTS, SCOPE_EMAIL, SCOPE_GMAIL, SCOPE_PROFIL, ...};`

- [ ] **Step 5: Lancer les tests**

Run: `cd src-tauri && cargo test auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/auth/
git commit -m "feat(auth) : demander le carnet d'adresses Google"
```

---

### Task 6: Frontend, type unique et départage

**Files:**
- Modify: `src/types/backend.ts:337-341`
- Modify: `src/lib/contacts.ts`
- Test: `src/lib/contacts.test.ts`

**Interfaces:**
- Consumes: la forme JSON de `ContactConnu` (tâche 1).
- Produces: `Connaissance { adresse, nom, photo: string | null, origine: 'carnet' | 'autre' }`, déclarée dans `types/backend.ts` uniquement.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/lib/contacts.test.ts` :

```ts
it('départage par origine à correspondance égale', () => {
  // Deux adresses correspondent aussi bien l'une que l'autre : celle que
  // l'utilisateur a enregistrée doit passer devant.
  const carnet: Connaissance[] = [
    { adresse: 'martin@autre.fr', nom: 'Martin Autre', photo: null, origine: 'autre' },
    { adresse: 'martin@carnet.fr', nom: 'Martin Carnet', photo: null, origine: 'carnet' },
  ]

  const resultat = proposer(carnet, 'martin')

  expect(resultat[0].adresse).toBe('martin@carnet.fr')
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- contacts`
Expected: FAIL, `origine` n'existe pas sur `Connaissance`.

- [ ] **Step 3: Unifier le type**

Dans `src/types/backend.ts`, remplacer l'interface `Connaissance` :

```ts
/** D'où vient une entrée du carnet. Miroir de `contacts::Origine`. */
export type OrigineContact = 'carnet' | 'autre'

/** Miroir de `contacts::ContactConnu`. */
export interface Connaissance {
  adresse: string
  nom: string
  /** URL de la photo Google. Absente des « autres contacts ». */
  photo: string | null
  origine: OrigineContact
}
```

Dans `src/lib/contacts.ts`, supprimer la déclaration locale de `Connaissance` et l'importer depuis `../types/backend`. C'est ce doublon qui produisait `Cannot find name 'Connaissance'`.

- [ ] **Step 4: Corriger le départage**

Dans `proposer()`, remplacer la ligne de tri :

```ts
    // Le rang d'abord, l'origine ensuite : une correspondance en début de nom
    // passe avant un contact enregistré qui ne correspond qu'au milieu.
    .sort(
      (a, b) =>
        a.r - b.r ||
        Number(a.c.origine !== 'carnet') - Number(b.c.origine !== 'carnet'),
    )
```

- [ ] **Step 5: Supprimer `carnet()`**

Supprimer la fonction `carnet()` de `src/lib/contacts.ts`, ses tests dans `contacts.test.ts`, et l'import de `MessageAffiche` s'il ne sert plus. Réécrire l'en-tête du module : le carnet vient de Google, pas des messages.

- [ ] **Step 6: Lancer les tests**

Run: `npm test -- contacts && npx tsc -b --force`
Expected: PASS, aucune erreur de types.

- [ ] **Step 7: Commit**

```bash
git add src/types/backend.ts src/lib/contacts.ts src/lib/contacts.test.ts
git commit -m "feat(contacts) : type unique et departage par origine"
```

---

### Task 7: Avatars dans les suggestions

**Files:**
- Modify: `src/composants/ChampDestinataires.tsx`
- Modify: `src-tauri/tauri.conf.json` (politique de sécurité de contenu)

**Interfaces:**
- Consumes: `Connaissance` avec `photo` et `origine` (tâche 6).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Autoriser l'hôte des photos**

Dans `src-tauri/tauri.conf.json`, la directive `img-src` de `security.csp` vaut aujourd'hui `'self' data: blob: asset: http://asset.localhost`. Y ajouter `https://*.googleusercontent.com` :

```json
        "img-src": "'self' data: blob: asset: http://asset.localhost https://*.googleusercontent.com",
```

Faire la même chose dans `devCsp` si elle porte une directive `img-src`.

Sans cette ligne, les avatars restent vides sans qu'aucune erreur ne soit visible dans l'interface.

- [ ] **Step 2: Afficher l'avatar**

Dans la ligne de proposition de `ChampDestinataires.tsx`, avant le nom, insérer :

```tsx
{c.photo ? (
  <img
    src={c.photo}
    alt=""
    className="h-7 w-7 flex-none rounded-full object-cover"
    // Une photo que Google ne sert plus ne doit pas laisser d'icône cassée.
    onError={(e) => {
      e.currentTarget.style.display = 'none'
    }}
  />
) : (
  <span
    aria-hidden
    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[0.75rem] font-semibold text-white"
    style={{ background: couleurDePastille(c.adresse) }}
  >
    {(c.nom || c.adresse).trim().charAt(0).toUpperCase()}
  </span>
)}
```

Et la fonction de couleur, en bas du fichier :

```tsx
/**
 * Couleur de pastille pour une adresse sans photo.
 *
 * Tirée de l'adresse et non d'un tirage au sort : la même personne garde sa
 * couleur d'un lancement à l'autre, ce qui aide à la reconnaître du coin de
 * l'œil.
 */
function couleurDePastille(adresse: string): string {
  let somme = 0
  for (const c of adresse) {
    somme = (somme * 31 + c.charCodeAt(0)) % 360
  }
  return `hsl(${somme} 55% 45%)`
}
```

- [ ] **Step 3: Vérifier**

Run: `npm run lint && npx tsc -b --force && npm test`
Expected: tout au vert.

- [ ] **Step 4: Commit**

```bash
git add src/composants/ChampDestinataires.tsx src-tauri/tauri.conf.json
git commit -m "feat(contacts) : avatars dans les suggestions de destinataires"
```

---

### Task 8: Documents et vérification finale

**Files:**
- Modify: `site/confidentialite.html` (paragraphe 3 et tableau des portées)
- Modify: `docs/connexion-google.md`
- Modify: `README.md` si la description des portées y figure

**Interfaces:**
- Consumes: les portées de la tâche 5.
- Produces: rien.

- [ ] **Step 1: Corriger la politique de confidentialité**

Dans `site/confidentialite.html`, ajouter deux lignes au tableau des portées, après `userinfo.profile` :

```html
          <tr>
            <td><code>contacts.readonly</code></td>
            <td>Lire votre carnet d'adresses Google : noms, adresses, photos.</td>
            <td>Vous proposer les bons destinataires quand vous écrivez un message, plutôt que de deviner à partir de votre courrier reçu.</td>
          </tr>
          <tr>
            <td><code>contacts.other.readonly</code></td>
            <td>Lire les adresses que Google retient automatiquement lorsque vous écrivez à quelqu'un.</td>
            <td>Retrouver les correspondants que vous n'avez jamais enregistrés dans votre carnet.</td>
          </tr>
```

Et corriger la phrase qui suit le tableau, qui affirme aujourd'hui que MailFlow ne demande rien concernant les contacts :

```html
    <p>MailFlow ne demande aucune autre autorisation. Les deux portées relatives aux contacts sont en <strong>lecture seule</strong> : l'application ne crée, ne modifie et ne supprime jamais aucun contact. En particulier, elle ne demande rien concernant Google Drive, Google Agenda, votre historique de navigation ou votre position.</p>
```

Ajouter le carnet à la liste du paragraphe 4, « Ce qui est gardé sur votre ordinateur » :

```html
      <li><strong>Votre carnet d'adresses</strong>, copié depuis Google pour proposer des destinataires sans appel réseau à chaque frappe. Il ne quitte pas votre machine et s'efface avec le bouton des réglages.</li>
```

- [ ] **Step 2: Compléter la documentation de connexion**

Dans `docs/connexion-google.md`, à l'étape 2, ajouter l'activation de la People API à côté de celle de l'API Gmail. À l'étape 4, ajouter les deux portées sous `gmail.modify`, avec une phrase disant qu'elles servent aux suggestions de destinataires et qu'elles sont en lecture seule.

- [ ] **Step 3: Vérifier que le garde-fou du site passe toujours**

Run: `grep -rn --include='*.html' -E '\[(NOM|ADRESSE|LICENCE|VOTRE-COMPTE)' site/`
Expected: seule l'adresse de contact subsiste, comme avant cette tâche.

- [ ] **Step 4: Lancer toute la chaîne**

```bash
cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test
cd .. && npm run lint && npm run build && npm test
```

Expected: tout au vert.

- [ ] **Step 5: Commit**

```bash
git add site/ docs/ README.md
git commit -m "docs : les portees contacts dans la politique et la doc de connexion"
```

---

## Après le plan

Deux gestes manuels, hors code, sans lesquels rien ne fonctionnera :

1. Activer la **People API** dans la console Google Cloud du projet MailFlow.
2. Déclarer les deux portées dans l'écran de consentement OAuth, puis relier son compte à nouveau une fois.

Ces deux étapes sont décrites dans `docs/connexion-google.md` après la tâche 8.
