//! Resume des newsletters par un modele de langage.
//!
//! Le fournisseur n'est pas encore arrete. Ce trait fixe la frontiere pour que le
//! choix reste un detail d'implementation : la vue 3 depend de `LlmProvider`, pas
//! d'Anthropic ni d'OpenAI ni d'Ollama.
//!
//! # Contrainte de confidentialite
//!
//! Resumer une newsletter, c'est envoyer le courrier de l'utilisateur a un tiers.
//! Trois consequences pour l'implementation :
//!
//! - Le corps transmis est nettoye au prealable : pas d'en-tetes, pas de pixels de
//!   suivi, pas d'URL de desabonnement — ces dernieres contiennent l'adresse de
//!   l'utilisateur, souvent en clair.
//! - Seuls les messages relevant d'une regle `newsletter` sont envoyes. Jamais un
//!   message de la vue 1 (correspondance humaine).
//! - L'utilisateur doit pouvoir refuser : sans cle d'API configuree, la vue 3
//!   fonctionne sans resumes plutot que de tomber en panne.
//!
//! Le contenu d'une newsletter est du texte non fiable, susceptible de contenir
//! des instructions destinees au modele. L'invite doit donc l'encadrer comme une
//! donnee a resumer, et la reponse ne doit jamais etre traitee comme une commande :
//! aucune action Gmail ne decoule de ce que le modele repond.

use crate::error::Resultat;

/// Resume produit pour une newsletter.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Resume {
    pub texte: String,
    /// Etiquettes thematiques servant au filtrage de la vue 3 (`#IA`, `#Tech`...).
    pub hashtags: Vec<String>,
}

#[allow(async_fn_in_trait)]
pub trait LlmProvider {
    /// Resume une newsletter isolee, pour sa carte dans la vue 3.
    async fn resumer_newsletter(&self, contenu: &str) -> Resultat<Resume>;

    /// Synthese en trois points de l'ensemble des newsletters du jour.
    async fn synthese_du_jour(&self, contenus: &[String]) -> Resultat<Resume>;
}
