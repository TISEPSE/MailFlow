//! Le carnet d'adresses, copié depuis celui de l'utilisateur chez Google.
//!
//! # Pourquoi il ne vient plus des messages
//!
//! Il se déduisait des en-têtes : expéditeurs, destinataires et copies des
//! messages sous la main. C'était sans coût en autorisations, mais toute
//! personne ayant écrit une fois entrait dans les suggestions, robot
//! d'expédition et newsletter compris. Or écrire à quelqu'un est un geste
//! délibéré ; en recevoir ne l'est pas.
//!
//! Le carnet est désormais celui que Google tient — voir [`people`] — et le
//! disque n'en garde qu'une copie, pour que les suggestions s'affichent à la
//! frappe sans appel réseau.

pub mod people;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cache::{cloison, ecrire_prive};
use crate::error::{AppError, Resultat};

const NOM_FICHIER: &str = "contacts.json";

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

pub fn chemin(racine: &Path, compte: &str) -> PathBuf {
    racine.join(cloison(compte)).join(NOM_FICHIER)
}

/// Relit le carnet rangé sur le disque.
///
/// Un fichier illisible rend un carnet vide plutôt qu'une erreur : c'est le cas
/// des fichiers écrits avant que le carnet ne vienne de Google, qui portaient un
/// compteur d'apparitions et pas d'origine. La synchronisation du démarrage les
/// remplace sans que personne n'ait à s'en occuper.
pub fn charger(racine: &Path, compte: &str) -> Vec<ContactConnu> {
    std::fs::read_to_string(chemin(racine, compte))
        .ok()
        .and_then(|texte| serde_json::from_str(&texte).ok())
        .unwrap_or_default()
}

pub fn enregistrer(racine: &Path, compte: &str, contacts: &[ContactConnu]) -> Resultat<()> {
    let chemin_fichier = chemin(racine, compte);
    if let Some(parent) = chemin_fichier.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Config(format!("création du dossier de contacts : {e}")))?;
    }
    let json = serde_json::to_string_pretty(contacts)?;
    ecrire_prive(&chemin_fichier, &json)
        .map_err(|e| AppError::Config(format!("écriture du carnet de contacts : {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn un_carnet_absent_rend_une_liste_vide() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(charger(d.path(), "jamais-vu@gmail.com"), Vec::new());
    }
}
