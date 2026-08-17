//! Resume des newsletters par un modèle de langage.
//!
//! Le fournisseur n'est pas encore arrête. Ce trait fixe la frontière pour que le
//! choix reste un détail d'implémentation : la vue 3 dépend de `LlmProvider`, pas
//! d'Anthropic ni d'OpenAI ni d'Ollama.
//!
//! # Contrainte de confidentialité
//!
//! Résumer une newsletter, c'est envoyer le courrier de l'utilisateur à un tiers.
//! Trois conséquences pour l'implémentation :
//!
//! - Le corps transmis est nettoyé au préalable : pas d'en-têtes, pas de pixels de
//!   suivi, pas d'URL de désabonnement — ces dernières contiennent l'adresse de
//!   l'utilisateur, souvent en clair.
//! - Seuls les messages relevant d'une règle `newsletter` sont envoyés. Jamais un
//!   message de la vue 1 (correspondance humaine).
//! - L'utilisateur doit pouvoir refuser : sans clé d'API configurée, la vue 3
//!   fonctionne sans résumés plutôt que de tomber en panne.
//!
//! Le contenu d'une newsletter est du texte non fiable, susceptible de contenir
//! des instructions destinées au modèle. L'invite doit donc l'encadrer comme une
//! donnée à résumer, et la réponse ne doit jamais être traitée comme une commande :
//! aucune action Gmail ne découle de ce que le modèle répond.

pub mod gemini;

use crate::error::Resultat;

/// Resume produit pour une newsletter.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Resume {
    pub texte: String,
    /// Etiquettes thématiques servant au filtrage de la vue 3 (`#IA`, `#Tech`...).
    pub hashtags: Vec<String>,
}

#[allow(async_fn_in_trait)]
pub trait LlmProvider {
    /// Resume une newsletter isolée, pour sa carte dans la vue 3.
    async fn resumer_newsletter(&self, contenu: &str) -> Resultat<Resume>;

    /// Synthese en trois points de l'ensemble des newsletters du jour.
    async fn synthese_du_jour(&self, contenus: &[String]) -> Resultat<Resume>;
}
