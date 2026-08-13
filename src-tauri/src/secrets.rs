//! Stockage des secrets dans le trousseau du système d'exploitation.
//!
//! Trousseau Keychain sur macOS, Secret Service (GNOME Keyring / KWallet) sur Linux.
//! Rien n'est écrit en clair sur le disque : ni le `refresh_token` Google, ni la
//! clé d'API du fournisseur LLM.
//!
//! L'accès passe par le trait [`SecretStore`] plutôt que par `keyring::Entry` en
//! direct, pour deux raisons : les tests n'ont pas de trousseau disponible, et
//! une machine de CI headless non plus.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::{AppError, Resultat};

/// Nom de service sous lequel les entrées apparaissent dans le trousseau.
/// Doit rester identique à l'identifiant applicatif de `tauri.conf.json`.
pub const SERVICE: &str = "fr.mailflow.desktop";

/// Jeton de rafraîchissement OAuth2 Google. Le seul secret réellement durable :
/// il donne un accès permanent à la boîte mail tant qu'il n'est pas révoqué.
pub const CLE_REFRESH_TOKEN_GOOGLE: &str = "google_refresh_token";

/// Cle d'API du fournisseur LLM, saisie par l'utilisateur dans les réglages.
pub const CLE_API_LLM: &str = "llm_api_key";

pub trait SecretStore: Send + Sync {
    fn set(&self, cle: &str, valeur: &str) -> Resultat<()>;

    /// `Ok(None)` quand l'entrée n'existe pas — ce n'est pas une erreur.
    fn get(&self, cle: &str) -> Resultat<Option<String>>;

    /// Idempotent : supprimer une entrée absente réussit.
    fn delete(&self, cle: &str) -> Resultat<()>;
}

/// Implementation réelle, adossée au trousseau du système.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self {
            service: SERVICE.to_string(),
        }
    }

    /// Verifie que le trousseau est joignable, sans créer d'entrée.
    ///
    /// Échoue notamment sur une session Linux sans agent Secret Service actif
    /// (machine headless, conteneur, certains environnements de bureau minimaux).
    /// Le cas doit être détecté au démarrage et expliqué à l'utilisateur, pas
    /// découvert au milieu du flux de connexion Google.
    pub fn disponible() -> Resultat<()> {
        match keyring::Entry::store_status() {
            Ok(()) => Ok(()),
            Err(e) => Err(AppError::Keyring(cloner_erreur(e))),
        }
    }

    fn entree(&self, cle: &str) -> Resultat<keyring::Entry> {
        keyring::Entry::new(&self.service, cle).map_err(AppError::Keyring)
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, cle: &str, valeur: &str) -> Resultat<()> {
        self.entree(cle)?
            .set_password(valeur)
            .map_err(AppError::Keyring)
    }

    fn get(&self, cle: &str) -> Resultat<Option<String>> {
        match self.entree(cle)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Keyring(e)),
        }
    }

    fn delete(&self, cle: &str) -> Resultat<()> {
        match self.entree(cle)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keyring(e)),
        }
    }
}

/// `keyring::Error` n'est pas `Clone` et `store_status` ne rend qu'une référence.
/// On reconstruit une erreur équivalente à partir de son message.
fn cloner_erreur(e: &keyring::Error) -> keyring::Error {
    keyring::Error::NotSupportedByStore(e.to_string())
}

/// Implementation en mémoire, pour les tests et les environnements sans trousseau.
///
/// Ne persiste rien et ne doit jamais servir en production : elle est ici pour
/// que la logique métier reste testable sans dépendre du bureau de l'hôte.
#[derive(Default)]
pub struct MemoryStore {
    contenu: Mutex<HashMap<String, String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemoryStore {
    fn set(&self, cle: &str, valeur: &str) -> Resultat<()> {
        self.contenu
            .lock()
            .expect("mutex du MemoryStore empoisonné")
            .insert(cle.to_string(), valeur.to_string());
        Ok(())
    }

    fn get(&self, cle: &str) -> Resultat<Option<String>> {
        Ok(self
            .contenu
            .lock()
            .expect("mutex du MemoryStore empoisonné")
            .get(cle)
            .cloned())
    }

    fn delete(&self, cle: &str) -> Resultat<()> {
        self.contenu
            .lock()
            .expect("mutex du MemoryStore empoisonné")
            .remove(cle);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_cle_absente_rend_none_et_non_une_erreur() {
        let store = MemoryStore::new();
        assert_eq!(store.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap(), None);
    }

    #[test]
    fn ecrire_puis_relire_rend_la_meme_valeur() {
        let store = MemoryStore::new();
        store
            .set(CLE_REFRESH_TOKEN_GOOGLE, "1//jeton-secret")
            .unwrap();

        assert_eq!(
            store.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some("1//jeton-secret")
        );
    }

    #[test]
    fn reecrire_une_cle_remplace_l_ancienne_valeur() {
        let store = MemoryStore::new();
        store.set(CLE_API_LLM, "ancienne").unwrap();
        store.set(CLE_API_LLM, "nouvelle").unwrap();

        assert_eq!(store.get(CLE_API_LLM).unwrap().as_deref(), Some("nouvelle"));
    }

    #[test]
    fn supprimer_une_cle_absente_reussit() {
        let store = MemoryStore::new();
        assert!(store.delete("cle_inexistante").is_ok());
    }

    #[test]
    fn supprimer_efface_bien_la_valeur() {
        let store = MemoryStore::new();
        store.set(CLE_REFRESH_TOKEN_GOOGLE, "jeton").unwrap();
        store.delete(CLE_REFRESH_TOKEN_GOOGLE).unwrap();

        assert_eq!(store.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap(), None);
    }
}
