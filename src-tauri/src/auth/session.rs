//! État d'authentification d'une session MailFlow.
//!
//! Fait tenir ensemble trois choses : le `refresh_token` durable du trousseau,
//! l'`access_token` volatil en mémoire, et le moment où il faut renouveler.
//!
//! Le renouvellement est réactif, pas planifié : on ne rafraîchit pas en tâche de
//! fond « au cas où », on le fait quand un appel Gmail en a besoin. Un timer qui
//! renouvelle en permanence garde un jeton chaud sans raison et multiplie les
//! occasions de le faire fuiter.

use chrono::{DateTime, Utc};

use super::jetons::{Jetons, ReponseJeton};
use crate::error::{AppError, Resultat};
use crate::secrets::{CLE_REFRESH_TOKEN_GOOGLE, SecretStore};

/// Ce dont la session a besoin du réseau, et rien de plus.
///
/// Isolé pour que la logique de renouvellement — la partie où une erreur coûte
/// cher — soit testable sans joindre Google.
#[allow(async_fn_in_trait)]
pub trait RenouvelleurJetons {
    async fn renouveler(&self, refresh_token: &str) -> Resultat<ReponseJeton>;
}

impl RenouvelleurJetons for super::flux::ClientOAuth {
    async fn renouveler(&self, refresh_token: &str) -> Resultat<ReponseJeton> {
        super::flux::ClientOAuth::renouveler(self, refresh_token).await
    }
}

pub struct SessionAuth<S: SecretStore> {
    secrets: S,
    jetons: Option<Jetons>,
}

impl<S: SecretStore> SessionAuth<S> {
    pub fn nouvelle(secrets: S) -> Self {
        Self {
            secrets,
            jetons: None,
        }
    }

    /// Vrai s'il existe un `refresh_token` durable.
    ///
    /// N'atteste pas qu'il soit encore valide : l'utilisateur a pu révoquer
    /// l'accès depuis son compte Google. Seul un appel réel le dira.
    pub fn est_connecte(&self) -> Resultat<bool> {
        Ok(self.secrets.get(CLE_REFRESH_TOKEN_GOOGLE)?.is_some())
    }

    /// Enregistre le résultat de la première autorisation.
    pub fn ouvrir(&mut self, reponse: ReponseJeton, maintenant: DateTime<Utc>) -> Resultat<()> {
        let jetons = Jetons::depuis(reponse, maintenant);

        // Sans jeton durable, la session mourrait à la première expiration sans
        // que rien ne l'annonce. Autant échouer maintenant.
        let refresh = jetons
            .refresh_token()
            .ok_or_else(|| AppError::Auth("Google n'a pas délivré de refresh_token".into()))?;
        self.secrets.set(CLE_REFRESH_TOKEN_GOOGLE, refresh)?;

        self.jetons = Some(jetons);
        Ok(())
    }

    /// Rend un `access_token` utilisable, en renouvelant si nécessaire.
    pub async fn access_token(
        &mut self,
        renouvelleur: &impl RenouvelleurJetons,
        maintenant: DateTime<Utc>,
    ) -> Resultat<String> {
        if let Some(jetons) = &self.jetons
            && jetons.utilisable(maintenant)
        {
            return Ok(jetons.access_token().to_string());
        }

        // Le trousseau fait autorité : au lancement, la mémoire est vide mais le
        // jeton durable, lui, a survécu.
        let refresh = match self.jetons.as_ref().and_then(Jetons::refresh_token) {
            Some(r) => r.to_string(),
            None => self
                .secrets
                .get(CLE_REFRESH_TOKEN_GOOGLE)?
                .ok_or(AppError::NonAuthentifie)?,
        };

        let reponse = match renouvelleur.renouveler(&refresh).await {
            Ok(r) => r,

            // Google a répondu, et il refuse : le jeton est mort (accès révoqué,
            // mot de passe change). Le garder ferait croire l'application
            // connectée à chaque lancement, sans jamais aboutir.
            Err(e @ AppError::Auth(_)) => {
                log::warn!("refresh_token rejeté, session effacée : {e}");
                self.fermer()?;
                return Err(e);
            }

            // Google n'a pas répondu. L'utilisateur est hors ligne, pas
            // déconnecté : effacer son jeton l'obligerait à refaire tout le
            // parcours d'autorisation au retour du réseau.
            Err(e) => return Err(e),
        };

        match &mut self.jetons {
            Some(jetons) => jetons.renouveler(reponse, maintenant),
            None => self.jetons = Some(Jetons::depuis(reponse, maintenant)),
        }

        let jetons = self.jetons.as_ref().expect("jetons posés juste au-dessus");

        // Google peut faire tourner le jeton durable. Ne pas réécrire laisserait
        // le trousseau sur une valeur périmée.
        if let Some(nouveau) = jetons.refresh_token()
            && nouveau != refresh
        {
            self.secrets.set(CLE_REFRESH_TOKEN_GOOGLE, nouveau)?;
        }

        Ok(jetons.access_token().to_string())
    }

    /// Jette l'`access_token` en mémoire sans toucher au jeton durable.
    ///
    /// Sert après un `401` de Gmail : notre calcul d'expiration disait le jeton
    /// valable, Google dit le contraire. C'est Google qui a raison — il a pu être
    /// révoqué, ou les horloges divergent. Le prochain appel en redemandera un.
    pub fn oublier_le_jeton_courant(&mut self) {
        self.jetons = None;
    }

    /// Oublie la session et rend le `refresh_token` à révoquer chez Google.
    pub fn fermer(&mut self) -> Resultat<Option<String>> {
        let a_revoquer = self.secrets.get(CLE_REFRESH_TOKEN_GOOGLE)?.or_else(|| {
            self.jetons
                .as_ref()
                .and_then(Jetons::refresh_token)
                .map(str::to_string)
        });

        self.secrets.delete(CLE_REFRESH_TOKEN_GOOGLE)?;
        self.jetons = None;

        Ok(a_revoquer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use std::cell::Cell;

    const REFRESH: &str = "1//0g-durable";

    fn t0() -> DateTime<Utc> {
        "2026-08-13T10:00:00Z".parse().unwrap()
    }

    fn reponse(refresh: Option<&str>) -> ReponseJeton {
        ReponseJeton {
            access_token: "ya29.acces".into(),
            expires_in: 3600,
            refresh_token: refresh.map(str::to_string),
            scope: None,
        }
    }

    /// Renouvelleur de test : compte ses appels et joue un scénario fixe.
    struct FauxRenouvelleur {
        appels: Cell<u32>,
        resultat: fn() -> Resultat<ReponseJeton>,
    }

    impl FauxRenouvelleur {
        fn qui_reussit() -> Self {
            Self {
                appels: Cell::new(0),
                resultat: || {
                    Ok(ReponseJeton {
                        access_token: "ya29.renouvele".into(),
                        expires_in: 3600,
                        refresh_token: None,
                        scope: None,
                    })
                },
            }
        }

        fn qui_echoue(resultat: fn() -> Resultat<ReponseJeton>) -> Self {
            Self {
                appels: Cell::new(0),
                resultat,
            }
        }
    }

    impl RenouvelleurJetons for FauxRenouvelleur {
        async fn renouveler(&self, _refresh_token: &str) -> Resultat<ReponseJeton> {
            self.appels.set(self.appels.get() + 1);
            (self.resultat)()
        }
    }

    fn session_ouverte() -> SessionAuth<MemoryStore> {
        let mut s = SessionAuth::nouvelle(MemoryStore::new());
        s.ouvrir(reponse(Some(REFRESH)), t0()).unwrap();
        s
    }

    #[test]
    fn une_session_neuve_n_est_pas_connectee() {
        let s = SessionAuth::nouvelle(MemoryStore::new());

        assert!(!s.est_connecte().unwrap());
    }

    #[test]
    fn l_ouverture_place_le_refresh_token_dans_le_trousseau() {
        let s = session_ouverte();

        assert_eq!(
            s.secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some(REFRESH)
        );
        assert!(s.est_connecte().unwrap());
    }

    #[test]
    fn une_premiere_autorisation_sans_refresh_token_est_une_erreur() {
        // Arrive quand `access_type=offline` manque à l'URL d'autorisation : la
        // connexion semblerait réussir puis mourir à la première expiration.
        let mut s = SessionAuth::nouvelle(MemoryStore::new());

        let e = s.ouvrir(reponse(None), t0()).unwrap_err();

        assert_eq!(e.code(), "ECHEC_CONNEXION");
        assert!(!s.est_connecte().unwrap());
    }

    #[tokio::test]
    async fn sans_refresh_token_l_acces_est_refuse() {
        let mut s = SessionAuth::nouvelle(MemoryStore::new());
        let faux = FauxRenouvelleur::qui_reussit();

        let e = s.access_token(&faux, t0()).await.unwrap_err();

        assert_eq!(e.code(), "NON_AUTHENTIFIE");
        assert_eq!(faux.appels.get(), 0, "aucun appel réseau sans jeton");
    }

    #[tokio::test]
    async fn un_access_token_encore_valide_est_reutilise_sans_reseau() {
        let mut s = session_ouverte();
        let faux = FauxRenouvelleur::qui_reussit();

        let jeton = s.access_token(&faux, t0()).await.unwrap();

        assert_eq!(jeton, "ya29.acces");
        assert_eq!(faux.appels.get(), 0);
    }

    #[tokio::test]
    async fn un_access_token_expire_est_renouvele() {
        let mut s = session_ouverte();
        let faux = FauxRenouvelleur::qui_reussit();

        let jeton = s
            .access_token(&faux, t0() + chrono::Duration::hours(2))
            .await
            .unwrap();

        assert_eq!(jeton, "ya29.renouvele");
        assert_eq!(faux.appels.get(), 1);
    }

    #[tokio::test]
    async fn un_renouvellement_apres_redemarrage_repart_du_trousseau() {
        // Cas normal au lancement : le trousseau a survécu, la mémoire non.
        let secrets = MemoryStore::new();
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, REFRESH).unwrap();
        let mut s = SessionAuth::nouvelle(secrets);
        let faux = FauxRenouvelleur::qui_reussit();

        let jeton = s.access_token(&faux, t0()).await.unwrap();

        assert_eq!(jeton, "ya29.renouvele");
        assert_eq!(faux.appels.get(), 1);
    }

    #[tokio::test]
    async fn un_refus_de_google_efface_le_refresh_token_devenu_inutile() {
        // L'utilisateur a révoqué l'accès depuis son compte Google. Garder le
        // jeton mort ferait croire l'application connectée à chaque lancement.
        let mut s = session_ouverte();
        let faux = FauxRenouvelleur::qui_echoue(|| Err(AppError::Auth("invalid_grant".into())));

        let e = s
            .access_token(&faux, t0() + chrono::Duration::hours(2))
            .await
            .unwrap_err();

        assert_eq!(e.code(), "ECHEC_CONNEXION");
        assert!(!s.est_connecte().unwrap());
    }

    #[tokio::test]
    async fn une_panne_reseau_ne_deconnecte_pas_l_utilisateur() {
        // Distinction essentielle : un train sans réseau ne doit pas obliger à
        // refaire tout le parcours Google au retour.
        let mut s = session_ouverte();
        let faux =
            FauxRenouvelleur::qui_echoue(|| Err(AppError::Reseau("connexion refusée".into())));

        let e = s
            .access_token(&faux, t0() + chrono::Duration::hours(2))
            .await
            .unwrap_err();

        assert_eq!(e.code(), "ERREUR_RESEAU");
        assert!(s.est_connecte().unwrap());
    }

    #[tokio::test]
    async fn un_refresh_token_renouvele_par_google_est_reecrit_dans_le_trousseau() {
        let mut s = session_ouverte();
        let faux = FauxRenouvelleur::qui_echoue(|| {
            Ok(ReponseJeton {
                access_token: "ya29.renouvele".into(),
                expires_in: 3600,
                refresh_token: Some("1//0g-remplacant".into()),
                scope: None,
            })
        });

        s.access_token(&faux, t0() + chrono::Duration::hours(2))
            .await
            .unwrap();

        assert_eq!(
            s.secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some("1//0g-remplacant")
        );
    }

    #[test]
    fn fermer_efface_le_trousseau_et_rend_le_jeton_a_revoquer() {
        let mut s = session_ouverte();

        let a_revoquer = s.fermer().unwrap();

        assert_eq!(a_revoquer.as_deref(), Some(REFRESH));
        assert!(!s.est_connecte().unwrap());
    }

    #[test]
    fn fermer_une_session_deja_fermee_reussit() {
        let mut s = SessionAuth::nouvelle(MemoryStore::new());

        assert_eq!(s.fermer().unwrap(), None);
    }

    #[tokio::test]
    async fn oublier_le_jeton_courant_force_un_renouvellement_sans_deconnecter() {
        let mut s = session_ouverte();
        let faux = FauxRenouvelleur::qui_reussit();

        // Sans invalidation, le jeton en mémoire serait réutilisé tel quel.
        s.oublier_le_jeton_courant();
        let jeton = s.access_token(&faux, t0()).await.unwrap();

        assert_eq!(jeton, "ya29.renouvele");
        assert_eq!(faux.appels.get(), 1);
        assert!(s.est_connecte().unwrap(), "le jeton durable reste en place");
    }

    #[tokio::test]
    async fn apres_fermeture_l_acces_est_refuse() {
        let mut s = session_ouverte();
        s.fermer().unwrap();
        let faux = FauxRenouvelleur::qui_reussit();

        let e = s.access_token(&faux, t0()).await.unwrap_err();

        assert_eq!(e.code(), "NON_AUTHENTIFIE");
    }
}
