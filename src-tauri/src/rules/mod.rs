//! Règles d'automatisation : modèle de données, persistance et moteur d'exécution.
//!
//! - [`model`] : le format de `regles.json` et la comparaison d'expéditeurs.
//! - [`store`] : lecture et écriture atomiques du fichier.
//! - [`engine`] : fonction pure qui, à partir d'un jeu de règles et de
//!   métadonnées de messages, produit le plan d'actions à appliquer à Gmail.

pub mod engine;
pub mod model;
pub mod store;

pub use engine::{ActionPlanifiee, EntreePlan, MessageResume, planifier};
pub use model::{Action, Categorie, Frequence, Rule, RuleSet, normaliser_adresse};
pub use store::RulesStore;
