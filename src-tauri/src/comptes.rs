//! Comptes Google connus, et bascule de l'un à l'autre.
//!
//! # Ce qui est stocké, et où
//!
//! Deux choses, séparées à dessein.
//!
//! Les **jetons** restent dans le trousseau du système, un par compte. Celui du
//! compte actif garde la clé historique [`CLE_REFRESH_TOKEN_GOOGLE`] ; les
//! autres vivent sous `google_refresh_token:<adresse>`.
//!
//! Un jeton n'est **jamais dupliqué** : basculer d'un compte à l'autre déplace
//! celui qui est actif vers son emplacement nommé et remonte celui de la cible.
//! Sans cette règle, Google renouvelant parfois le `refresh_token`, la copie
//! inactive se périmerait en silence et le compte deviendrait injoignable — une
//! panne qui n'apparaîtrait qu'au moment d'en changer.
//!
//! L'**annuaire** — quelles adresses sont connues, laquelle est active — va
//! dans un simple fichier JSON à côté des règles. Ce ne sont pas des secrets :
//! l'utilisateur voit son adresse affichée en permanence dans l'application.
//!
//! # Ce que la bascule ne fait pas
//!
//! Elle ne touche ni aux règles ni au classement, qui sont communs. Les règles
//! de l'utilisateur s'appliqueront donc à la boîte du compte choisi. C'est
//! cohérent tant qu'il s'agit de ses propres boîtes ; ça cesserait de l'être
//! pour des comptes sans rapport, et il faudrait alors ranger les règles par
//! compte.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Resultat};
use crate::secrets::{CLE_REFRESH_TOKEN_GOOGLE, SecretStore};

/// Fichier de l'annuaire, dans le dossier de configuration.
pub const FICHIER: &str = "comptes.json";

/// Un compte déjà autorisé.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Compte {
    pub adresse: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nom: Option<String>,
}

/// Ce que l'application sait des comptes, hors secrets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Annuaire {
    /// Adresse du compte dont le jeton occupe l'emplacement actif.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actif: Option<String>,
    #[serde(default)]
    pub connus: Vec<Compte>,
}

/// Clé de trousseau d'un compte inactif.
///
/// Le compte actif, lui, garde la clé historique : c'est ce qui permet à une
/// installation existante de continuer à fonctionner sans migration.
pub fn cle_compte(adresse: &str) -> String {
    format!(
        "{CLE_REFRESH_TOKEN_GOOGLE}:{}",
        adresse.trim().to_lowercase()
    )
}

impl Annuaire {
    /// Enregistre un compte, ou met à jour son nom, et le rend actif.
    pub fn retenir(&mut self, adresse: &str, nom: Option<String>) {
        let adresse = adresse.trim().to_lowercase();
        if adresse.is_empty() {
            return;
        }

        match self.connus.iter_mut().find(|c| c.adresse == adresse) {
            // Le nom peut avoir changé chez Google ; l'absence de nom ne doit
            // pas effacer celui qu'on avait.
            Some(connu) => {
                if nom.is_some() {
                    connu.nom = nom;
                }
            }
            None => self.connus.push(Compte {
                adresse: adresse.clone(),
                nom,
            }),
        }

        self.actif = Some(adresse);
    }

    /// Retire un compte de l'annuaire. Vrai s'il y était.
    pub fn oublier(&mut self, adresse: &str) -> bool {
        let adresse = adresse.trim().to_lowercase();
        let avant = self.connus.len();
        self.connus.retain(|c| c.adresse != adresse);

        if self.actif.as_deref() == Some(adresse.as_str()) {
            self.actif = None;
        }

        self.connus.len() != avant
    }

    pub fn est_connu(&self, adresse: &str) -> bool {
        let adresse = adresse.trim().to_lowercase();
        self.connus.iter().any(|c| c.adresse == adresse)
    }
}

fn chemin(dossier: &Path) -> PathBuf {
    dossier.join(FICHIER)
}

/// Lit l'annuaire, ou en rend un vide.
///
/// Un fichier absent ou illisible ne doit pas empêcher l'application de
/// démarrer : au pire l'utilisateur ne voit plus qu'un compte, et le
/// reconnecte.
pub fn charger(dossier: &Path) -> Annuaire {
    std::fs::read_to_string(chemin(dossier))
        .ok()
        .and_then(|texte| serde_json::from_str(&texte).ok())
        .unwrap_or_default()
}

pub fn ecrire(dossier: &Path, annuaire: &Annuaire) -> Resultat<()> {
    std::fs::create_dir_all(dossier)
        .map_err(|e| AppError::Config(format!("dossier de configuration illisible : {e}")))?;

    let texte = serde_json::to_string_pretty(annuaire)
        .map_err(|e| AppError::Config(format!("annuaire non sérialisable : {e}")))?;

    std::fs::write(chemin(dossier), texte)
        .map_err(|e| AppError::Config(format!("annuaire non enregistrable : {e}")))
}

/// Déplace le jeton actif vers son emplacement nommé.
///
/// Sans objet quand l'adresse active est inconnue : le jeton reste où il est,
/// et sera écrasé par la bascule. C'est le cas d'une installation antérieure à
/// l'annuaire, dont on ignore encore à qui appartient le jeton.
fn ranger_l_actif<S: SecretStore>(secrets: &S, adresse_active: Option<&str>) -> Resultat<()> {
    let Some(adresse) = adresse_active else {
        return Ok(());
    };
    let Some(jeton) = secrets.get(CLE_REFRESH_TOKEN_GOOGLE)? else {
        return Ok(());
    };

    secrets.set(&cle_compte(adresse), &jeton)
}

/// Bascule sur un compte déjà connu.
///
/// Rend une erreur explicite quand le trousseau n'a pas de jeton pour lui : ça
/// arrive si l'utilisateur a nettoyé son trousseau à la main, et il vaut mieux
/// le dire que de le laisser sur une boîte vide.
pub fn basculer<S: SecretStore>(secrets: &S, annuaire: &mut Annuaire, vers: &str) -> Resultat<()> {
    let vers = vers.trim().to_lowercase();

    if annuaire.actif.as_deref() == Some(vers.as_str()) {
        return Ok(());
    }
    if !annuaire.est_connu(&vers) {
        return Err(AppError::Auth(format!("compte inconnu : {vers}")));
    }

    let cle_cible = cle_compte(&vers);
    let Some(jeton_cible) = secrets.get(&cle_cible)? else {
        return Err(AppError::Auth(format!(
            "l'autorisation de {vers} n'est plus dans le trousseau"
        )));
    };

    // Dans cet ordre : l'actif est rangé avant d'être écrasé. L'inverse le
    // perdrait, et l'utilisateur devrait se reconnecter à son compte principal.
    ranger_l_actif(secrets, annuaire.actif.as_deref())?;
    secrets.set(CLE_REFRESH_TOKEN_GOOGLE, &jeton_cible)?;
    secrets.delete(&cle_cible)?;

    annuaire.actif = Some(vers);
    Ok(())
}

/// Range le compte actif et libère l'emplacement, pour en autoriser un autre.
///
/// Le jeton n'est pas révoqué : c'est tout l'intérêt, on veut pouvoir y revenir
/// sans repasser par Google.
pub fn mettre_de_cote<S: SecretStore>(secrets: &S, annuaire: &mut Annuaire) -> Resultat<()> {
    ranger_l_actif(secrets, annuaire.actif.as_deref())?;
    secrets.delete(CLE_REFRESH_TOKEN_GOOGLE)?;
    annuaire.actif = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    fn annuaire_avec(adresses: &[&str]) -> Annuaire {
        let mut a = Annuaire::default();
        for adresse in adresses {
            a.retenir(adresse, None);
        }
        a
    }

    #[test]
    fn un_compte_retenu_devient_actif() {
        let a = annuaire_avec(&["moi@gmail.com"]);

        assert_eq!(a.actif.as_deref(), Some("moi@gmail.com"));
        assert_eq!(a.connus.len(), 1);
    }

    #[test]
    fn la_meme_adresse_n_est_pas_ajoutee_deux_fois() {
        // Sinon se reconnecter au même compte remplirait la liste de doublons.
        let mut a = annuaire_avec(&["Moi@Gmail.com"]);
        a.retenir("moi@gmail.com", Some("Moi".into()));

        assert_eq!(a.connus.len(), 1);
        assert_eq!(a.connus[0].nom.as_deref(), Some("Moi"));
    }

    #[test]
    fn un_nom_deja_connu_n_est_pas_efface_par_son_absence() {
        // `renseignements_du_compte` peut échouer : ce serait perdre le nom
        // affiché pour une panne réseau passagère.
        let mut a = Annuaire::default();
        a.retenir("moi@gmail.com", Some("Lucie".into()));
        a.retenir("moi@gmail.com", None);

        assert_eq!(a.connus[0].nom.as_deref(), Some("Lucie"));
    }

    #[test]
    fn oublier_le_compte_actif_laisse_l_annuaire_sans_actif() {
        let mut a = annuaire_avec(&["moi@gmail.com"]);

        assert!(a.oublier("moi@gmail.com"));
        assert_eq!(a.actif, None);
        assert!(a.connus.is_empty());
    }

    #[test]
    fn la_cle_d_un_compte_derive_de_son_adresse() {
        assert_eq!(
            cle_compte("Moi@Gmail.com"),
            "google_refresh_token:moi@gmail.com"
        );
    }

    #[test]
    fn basculer_echange_les_deux_jetons_sans_les_dupliquer() {
        let secrets = MemoryStore::new();
        let mut a = annuaire_avec(&["a@x.fr", "b@x.fr"]);
        // `retenir` a laissé `b` actif ; on place les jetons en conséquence.
        a.actif = Some("a@x.fr".into());
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, "jeton-a").unwrap();
        secrets.set(&cle_compte("b@x.fr"), "jeton-b").unwrap();

        basculer(&secrets, &mut a, "b@x.fr").unwrap();

        assert_eq!(a.actif.as_deref(), Some("b@x.fr"));
        assert_eq!(
            secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some("jeton-b")
        );
        assert_eq!(
            secrets.get(&cle_compte("a@x.fr")).unwrap().as_deref(),
            Some("jeton-a")
        );
        // Le jeton de b n'existe plus qu'à l'emplacement actif : sans quoi la
        // copie inactive se périmerait au premier renouvellement.
        assert_eq!(secrets.get(&cle_compte("b@x.fr")).unwrap(), None);
    }

    #[test]
    fn basculer_vers_le_compte_deja_actif_ne_fait_rien() {
        let secrets = MemoryStore::new();
        let mut a = annuaire_avec(&["a@x.fr"]);
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, "jeton-a").unwrap();

        basculer(&secrets, &mut a, "a@x.fr").unwrap();

        assert_eq!(
            secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some("jeton-a")
        );
        assert_eq!(secrets.get(&cle_compte("a@x.fr")).unwrap(), None);
    }

    #[test]
    fn basculer_sans_jeton_en_reserve_echoue_et_ne_touche_a_rien() {
        // Trousseau nettoyé à la main : mieux vaut le dire que de laisser
        // l'utilisateur devant une boîte vide sans explication.
        let secrets = MemoryStore::new();
        let mut a = annuaire_avec(&["a@x.fr", "b@x.fr"]);
        a.actif = Some("a@x.fr".into());
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, "jeton-a").unwrap();

        assert!(basculer(&secrets, &mut a, "b@x.fr").is_err());
        assert_eq!(a.actif.as_deref(), Some("a@x.fr"));
        assert_eq!(
            secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap().as_deref(),
            Some("jeton-a")
        );
    }

    #[test]
    fn basculer_vers_un_compte_inconnu_echoue() {
        let secrets = MemoryStore::new();
        let mut a = annuaire_avec(&["a@x.fr"]);

        assert!(basculer(&secrets, &mut a, "inconnu@x.fr").is_err());
    }

    #[test]
    fn mettre_de_cote_libere_l_emplacement_sans_perdre_le_jeton() {
        // C'est ce qui permet d'autoriser un second compte tout en gardant le
        // premier à portée.
        let secrets = MemoryStore::new();
        let mut a = annuaire_avec(&["a@x.fr"]);
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, "jeton-a").unwrap();

        mettre_de_cote(&secrets, &mut a).unwrap();

        assert_eq!(a.actif, None);
        assert_eq!(secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap(), None);
        assert_eq!(
            secrets.get(&cle_compte("a@x.fr")).unwrap().as_deref(),
            Some("jeton-a")
        );
        assert!(a.est_connu("a@x.fr"));
    }

    #[test]
    fn une_installation_sans_annuaire_ne_perd_pas_son_jeton() {
        // Version antérieure : le trousseau porte un jeton, l'annuaire est
        // vide, et on ignore à qui il appartient.
        let secrets = MemoryStore::new();
        let mut a = Annuaire::default();
        secrets.set(CLE_REFRESH_TOKEN_GOOGLE, "historique").unwrap();

        mettre_de_cote(&secrets, &mut a).unwrap();

        // Il n'y avait nulle part où le ranger, mais rien d'autre n'a été
        // corrompu et l'utilisateur peut se reconnecter.
        assert_eq!(secrets.get(CLE_REFRESH_TOKEN_GOOGLE).unwrap(), None);
    }

    #[test]
    fn l_annuaire_se_relit_tel_qu_il_a_ete_ecrit() {
        let dossier = tempfile::tempdir().unwrap();
        let mut a = Annuaire::default();
        a.retenir("moi@gmail.com", Some("Lucie".into()));

        ecrire(dossier.path(), &a).unwrap();

        assert_eq!(charger(dossier.path()), a);
    }

    #[test]
    fn un_annuaire_illisible_ne_bloque_pas_le_demarrage() {
        let dossier = tempfile::tempdir().unwrap();
        std::fs::write(dossier.path().join(FICHIER), "{pas du json").unwrap();

        assert_eq!(charger(dossier.path()), Annuaire::default());
    }
}
