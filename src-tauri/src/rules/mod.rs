//! Regles d'automatisation : modele de donnees, persistance et moteur d'execution.
//!
//! - [`model`] : le format de `regles.json` et la comparaison d'expediteurs.
//! - [`store`] : lecture et ecriture atomiques du fichier.
//! - [`engine`] : fonction pure qui, a partir d'un jeu de regles et de
//!   metadonnees de messages, produit le plan d'actions a appliquer a Gmail.

pub mod engine;
pub mod model;
pub mod store;

pub use engine::{ActionPlanifiee, EntreePlan, MessageResume, planifier};
pub use model::{Action, Categorie, Frequence, Rule, RuleSet, normaliser_adresse};
pub use store::RulesStore;
