//! Le carnet de contacts synchronisé depuis Gmail.
//!
//! Extrait les contacts (nom, adresse, nombre d'apparitions) des messages envoyés
//! (`in:sent`) et reçus depuis Gmail, et les conserve sur le disque pour des
//! suggestions instantanées et riches.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cache::{cloison, ecrire_prive};
use crate::error::{AppError, Resultat};
use crate::gmail::boite::MessageAffiche;

const NOM_FICHIER: &str = "contacts.json";

/// Un contact connu extrait des e-mails.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactConnu {
    pub adresse: String,
    pub nom: String,
    pub apparitions: usize,
}

pub fn chemin(racine: &Path, compte: &str) -> PathBuf {
    racine.join(cloison(compte)).join(NOM_FICHIER)
}

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

/// Fusionne une liste de messages avec les contacts existants.
pub fn fusionner(
    existants: Vec<ContactConnu>,
    messages: &[MessageAffiche],
    moi: &str,
) -> Vec<ContactConnu> {
    let mon_adresse = moi.trim().to_lowercase();
    let mut map: HashMap<String, (String, usize)> = HashMap::new();

    for c in existants {
        map.insert(c.adresse.to_lowercase(), (c.nom, c.apparitions));
    }

    let mut noter = |nom: &str, adresse: &str| {
        let addr = adresse.trim().to_lowercase();
        if addr.is_empty() || !addr.contains('@') || addr == mon_adresse {
            return;
        }

        let entry = map
            .entry(addr.clone())
            .or_insert_with(|| (String::new(), 0));
        entry.1 += 1;
        if (entry.0.is_empty() || entry.0.to_lowercase() == addr)
            && !nom.trim().is_empty()
            && nom.trim().to_lowercase() != addr
        {
            entry.0 = nom.trim().to_string();
        }
    };

    for m in messages {
        noter(&m.nom, &m.adresse);
        for d in &m.destinataires {
            noter(&d.nom, &d.adresse);
        }
        for c in &m.copies {
            noter(&c.nom, &c.adresse);
        }
    }

    let mut resultat: Vec<ContactConnu> = map
        .into_iter()
        .map(|(adresse, (nom, apparitions))| ContactConnu {
            adresse,
            nom,
            apparitions,
        })
        .collect();

    resultat.sort_by(|a, b| {
        b.apparitions
            .cmp(&a.apparitions)
            .then_with(|| a.nom.cmp(&b.nom))
            .then_with(|| a.adresse.cmp(&b.adresse))
    });

    resultat
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::boite::Contact;
    use crate::gmail::classement::CategorieMessage;

    #[test]
    fn fusionne_contacts_depuis_messages() {
        let m = MessageAffiche {
            id: "1".into(),
            nom: "Alice".into(),
            adresse: "alice@test.com".into(),
            destinataires: vec![Contact {
                nom: "Bob".into(),
                adresse: "bob@test.com".into(),
            }],
            copies: vec![],
            sujet: "Test".into(),
            extrait: "".into(),
            date: None,
            non_lu: false,
            categorie: CategorieMessage::Humain,
            compte: "moi@test.com".into(),
            libelles: vec![],
        };

        let res = fusionner(vec![], &[m], "moi@test.com");
        assert_eq!(res.len(), 2);
        assert!(
            res.iter()
                .any(|c| c.adresse == "alice@test.com" && c.nom == "Alice")
        );
        assert!(
            res.iter()
                .any(|c| c.adresse == "bob@test.com" && c.nom == "Bob")
        );
    }
}
