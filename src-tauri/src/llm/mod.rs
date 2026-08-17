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

/// Ce que vaut un résumé rangé sur le disque.
///
/// # Pourquoi un numéro de génération
///
/// Un résumé coûte un appel : on ne le refait pas sans raison. Mais la consigne
/// donnée au modèle change — elle est passée d'une phrase à trois, et elle a
/// cessé de parler de « numéros » pour parler de « mails ». Les résumés
/// produits avant restaient sur le disque et gardaient le vocabulaire de la
/// veille, sans qu'aucun geste de l'utilisateur ne puisse les rafraîchir.
///
/// Ce numéro règle la question : un résumé d'une génération antérieure est lu
/// comme absent, donc refait une fois, puis plus jamais. **À incrémenter à
/// chaque changement de consigne**, et à cette seule condition.
pub const GENERATION_RESUME: u8 = 2;

/// Resume produit pour une newsletter.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Resume {
    pub texte: String,
    /// Etiquettes thématiques servant au filtrage de la vue 3 (`#IA`, `#Tech`...).
    pub hashtags: Vec<String>,

    /// La consigne qui l'a produit. `default` à zéro : les résumés écrits avant
    /// que ce champ n'existe se relisent, et sont de ce fait périmés.
    #[serde(default)]
    pub generation: u8,
}

#[allow(async_fn_in_trait)]
pub trait LlmProvider {
    /// Resume une newsletter isolée, pour sa carte dans la vue 3.
    ///
    /// `adresse_utilisateur` n'est pas décorative : l'implémentation doit
    /// l'effacer du texte avant de l'envoyer, en même temps que les liens.
    /// Elle figure dans la signature pour que le nettoyage ait lieu *dans* le
    /// fournisseur — un appelant peut oublier de nettoyer, un fournisseur qui
    /// reçoit l'adresse ne le peut pas.
    async fn resumer_newsletter(
        &self,
        contenu: &str,
        adresse_utilisateur: &str,
    ) -> Resultat<Resume>;

    /// Résume **une publication entière** — tous les numéros reçus d'un même
    /// émetteur — en un seul appel.
    ///
    /// # Pourquoi c'est la voie normale, et le résumé isolé l'exception
    ///
    /// Un appel par numéro épuisait le palier gratuit avant la fin de la page :
    /// trente newsletters, trente appels, et le journal finissait en
    /// « quota atteint, reprise dans 59 s ». Or la question que l'on se pose
    /// devant une page de newsletters n'est pas « que dit ce numéro » mais
    /// « est-ce que je lis cette publication ». Une réponse par publication
    /// suffit donc, et elle coûte huit appels au lieu de trente.
    ///
    /// Le résumé d'un numéro précis reste disponible — [`Self::resumer_newsletter`]
    /// — mais à la demande, quand un titre intrigue.
    ///
    /// `numeros` est ordonné du plus récent au plus ancien : l'implémentation
    /// garde les premiers si elle doit choisir.
    async fn resumer_groupe(
        &self,
        numeros: &[String],
        adresse_utilisateur: &str,
    ) -> Resultat<Resume>;

    /// Synthese en trois points de l'ensemble des newsletters du jour.
    async fn synthese_du_jour(&self, contenus: &[String]) -> Resultat<Resume>;
}
