//! Le registre des messages archivés **depuis MailFlow**.
//!
//! # Pourquoi un registre, et non une requête Gmail
//!
//! La table des archives a d'abord demandé à Gmail « tout ce qui n'est pas dans
//! la boîte de réception ». C'était la définition juste — et la mauvaise.
//!
//! Gmail n'a pas de dossier « Archives » : archiver, c'est retirer l'étiquette
//! `INBOX` et ne rien mettre à la place. La requête rendait donc tout ce qui a
//! quitté la boîte depuis toujours : des messages de 2024 triés par un filtre,
//! des notifications Instagram, un courriel de ChatGPT — des centaines de
//! choses que l'utilisateur n'a jamais touchées et ne reconnaît pas.
//!
//! Or ce qu'on attend de cette table est précis : **y retrouver ce qu'on vient
//! d'y mettre**, pour le classer. C'est un plan de travail, pas un inventaire.
//! Le registre est donc écrit par le geste d'archivage lui-même : on y entre en
//! archivant depuis MailFlow, et par aucun autre chemin.
//!
//! # Où il vit, et pourquoi pas dans le cache
//!
//! Dans le dossier de configuration, à côté des règles et de la disposition des
//! tables — jamais dans le cache. Un cache se reconstruit ; ceci ne se
//! reconstruit pas. C'est une intention de l'utilisateur, et « Tout effacer »
//! ne doit pas la balayer avec les corps de messages.
//!
//! # Ce qu'il ne prétend pas être
//!
//! Une copie fidèle de Gmail. Si un message est désarchivé depuis le téléphone,
//! il reste ici jusqu'à ce qu'on l'en sorte. C'est le prix d'une table qui
//! montre ce qu'on y a posé plutôt que ce qu'un serveur veut bien y voir — et
//! c'est le bon prix, puisqu'une table de travail qu'on ne maîtrise pas ne sert
//! à rien.

use std::path::{Path, PathBuf};

use crate::cache::{cloison, ecrire_prive};
use crate::error::{AppError, Resultat};
use crate::gmail::boite::MessageAffiche;

const NOM_FICHIER: &str = "archives.json";

/// Fichier du registre d'un compte.
///
/// Cloisonné par compte, comme tout le reste : les archives de l'un n'ont rien
/// à faire sur la table de l'autre, et les identifiants Gmail d'une boîte ne
/// désignent rien dans une autre.
pub fn chemin(racine: &Path, compte: &str) -> PathBuf {
    racine.join(cloison(compte)).join(NOM_FICHIER)
}

/// Lit le registre d'un compte, ou en rend un vide.
///
/// Un fichier absent est le cas normal — personne n'a encore rien archivé. Un
/// fichier illisible se traite pareil : refuser d'afficher la table parce qu'un
/// octet a été abîmé serait pire que de la montrer vide, puisque le geste
/// d'archivage la remplira de nouveau.
pub fn charger(racine: &Path, compte: &str) -> Vec<MessageAffiche> {
    std::fs::read_to_string(chemin(racine, compte))
        .ok()
        .and_then(|texte| serde_json::from_str(&texte).ok())
        .unwrap_or_default()
}

/// Écrit le registre d'un compte.
pub fn enregistrer(racine: &Path, compte: &str, messages: &[MessageAffiche]) -> Resultat<()> {
    let fichier = chemin(racine, compte);

    if let Some(dossier) = fichier.parent() {
        std::fs::create_dir_all(dossier).map_err(|e| AppError::io(dossier.display(), e))?;
    }

    let texte = serde_json::to_string_pretty(messages)
        .map_err(|e| AppError::Config(format!("registre non sérialisable : {e}")))?;

    ecrire_prive(&fichier, &texte).map_err(|e| AppError::io(fichier.display(), e))
}

/// Inscrit un message, ou remplace celui qui portait déjà cet identifiant.
///
/// Le plus récemment archivé passe en tête : c'est l'ordre dans lequel on
/// s'attend à retrouver ce qu'on vient de poser.
pub fn poser(mut registre: Vec<MessageAffiche>, message: MessageAffiche) -> Vec<MessageAffiche> {
    registre.retain(|m| m.id != message.id);
    registre.insert(0, message);
    registre
}

/// Retire un message du registre.
///
/// Appelé quand il part à la corbeille : le laisser sur la table proposerait de
/// classer un message qui n'existe plus.
pub fn retirer(mut registre: Vec<MessageAffiche>, id: &str) -> Vec<MessageAffiche> {
    registre.retain(|m| m.id != id);
    registre
}

/// Met à jour les libellés d'un message déjà inscrit.
///
/// C'est ce qui fait survivre les tas d'une ouverture à l'autre : un message
/// déposé sur un tas porte désormais son libellé, et le registre doit le savoir
/// sans quoi la tuile ressortirait seule au prochain lancement.
pub fn noter_les_libelles(
    mut registre: Vec<MessageAffiche>,
    id: &str,
    libelles: Vec<String>,
) -> Vec<MessageAffiche> {
    for message in &mut registre {
        if message.id == id {
            message.libelles = libelles;
            break;
        }
    }
    registre
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::classement::CategorieMessage;

    fn message(id: &str) -> MessageAffiche {
        MessageAffiche {
            id: id.to_string(),
            nom: "Karim".into(),
            adresse: "karim@atelier.fr".into(),
            destinataires: Vec::new(),
            copies: Vec::new(),
            sujet: format!("Sujet {id}"),
            extrait: String::new(),
            date: None,
            non_lu: false,
            categorie: CategorieMessage::Humain,
            compte: "moi@gmail.com".into(),
            libelles: Vec::new(),
        }
    }

    #[test]
    fn le_dernier_archive_passe_en_tete() {
        // On retrouve d'abord ce qu'on vient de poser : c'est l'ordre du geste.
        let registre = poser(poser(Vec::new(), message("m1")), message("m2"));

        assert_eq!(
            registre.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["m2", "m1"]
        );
    }

    #[test]
    fn archiver_deux_fois_le_meme_message_ne_le_double_pas() {
        // Archiver depuis deux pages, ou cliquer deux fois : la table ne doit
        // pas montrer deux tuiles pour un seul message.
        let registre = poser(poser(Vec::new(), message("m1")), message("m1"));

        assert_eq!(registre.len(), 1);
    }

    #[test]
    fn un_message_mis_a_la_corbeille_quitte_le_registre() {
        let registre = retirer(poser(Vec::new(), message("m1")), "m1");

        assert!(registre.is_empty());
    }

    #[test]
    fn retirer_un_inconnu_ne_touche_a_rien() {
        let registre = retirer(poser(Vec::new(), message("m1")), "jamais-vu");

        assert_eq!(registre.len(), 1);
    }

    #[test]
    fn les_libelles_deposes_sur_un_tas_sont_retenus() {
        // Sans cela, la tuile ressortirait seule au prochain lancement, et le
        // tas qu'on vient de faire aurait disparu.
        let registre = noter_les_libelles(
            poser(Vec::new(), message("m1")),
            "m1",
            vec!["Label_7".into()],
        );

        assert_eq!(registre[0].libelles, vec!["Label_7".to_string()]);
    }

    #[test]
    fn un_registre_illisible_vaut_un_registre_vide() {
        // Refuser d'afficher la table parce qu'un octet a été abîmé serait pire
        // que de la montrer vide : le geste d'archivage la remplira de nouveau.
        let dossier = tempfile::tempdir().unwrap();
        let fichier = chemin(dossier.path(), "moi@gmail.com");
        std::fs::create_dir_all(fichier.parent().unwrap()).unwrap();
        std::fs::write(&fichier, "{ ceci n'est pas du json").unwrap();

        assert!(charger(dossier.path(), "moi@gmail.com").is_empty());
    }

    #[test]
    fn ce_qui_est_ecrit_se_relit() {
        let dossier = tempfile::tempdir().unwrap();
        let registre = poser(Vec::new(), message("m1"));

        enregistrer(dossier.path(), "moi@gmail.com", &registre).unwrap();

        let relu = charger(dossier.path(), "moi@gmail.com");
        assert_eq!(relu.len(), 1);
        assert_eq!(relu[0].id, "m1");
    }

    #[test]
    fn les_comptes_ne_se_melangent_pas() {
        // Le cœur du cloisonnement : un identifiant Gmail d'une boîte ne
        // désigne rien dans une autre.
        let dossier = tempfile::tempdir().unwrap();

        enregistrer(
            dossier.path(),
            "un@gmail.com",
            &poser(Vec::new(), message("m1")),
        )
        .unwrap();

        assert!(charger(dossier.path(), "deux@gmail.com").is_empty());
    }
}
