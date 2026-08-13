//! Regles d'automatisation : modele de donnees, persistance et moteur d'execution.
//!
//! - [`model`] : le format de `regles.json` et la comparaison d'expediteurs.
//! - [`store`] : lecture et ecriture atomiques du fichier.
//! - Le moteur qui applique les regles a une liste de messages Gmail viendra
//!   s'ajouter ici (`engine`), une fois le client Gmail disponible.

pub mod model;
pub mod store;

pub use model::{Action, Categorie, Frequence, Rule, RuleSet, normaliser_adresse};
pub use store::RulesStore;
