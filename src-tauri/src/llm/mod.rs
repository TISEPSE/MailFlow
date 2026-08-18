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

/// Même rôle, pour la synthèse du jour. Elle a sa propre consigne, donc sa
/// propre péremption : reformuler l'une n'a pas à faire repayer l'autre.
pub const GENERATION_SYNTHESE: u8 = 1;

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

    /// Réunit en trois points ce que les publications du jour ont apporté.
    ///
    /// # Ce qu'elle prend, et ce qu'elle ne prend pas
    ///
    /// Des couples `(nom de la publication, résumé déjà produit)`, et rien
    /// d'autre. Elle ne relit aucun mail : elle part de nos propres résumés,
    /// déjà expurgés de leurs liens et de l'adresse de l'utilisateur au moment
    /// où ils ont été fabriqués. Un passage d'analyse coûte donc **un appel de
    /// plus**, pas un de plus par publication, et rien de neuf ne sort de la
    /// machine.
    ///
    /// # Pourquoi des numéros et non des noms
    ///
    /// Les publications sont numérotées dans le texte envoyé, et le modèle rend
    /// des **numéros**. C'est l'implémentation qui les retraduit, en jetant tout
    /// numéro hors bornes. Un nom rendu en clair aurait été affiché tel quel :
    /// une publication inventée par le modèle, ou soufflée par le contenu d'un
    /// tiers, se serait retrouvée à l'écran sous couleur de source.
    async fn synthetiser(&self, publications: &[(String, String)]) -> Resultat<Synthese>;
}

/// Un point de la synthèse : une phrase, et d'où elle vient.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PointDeSynthese {
    pub texte: String,
    /// Rangs des publications dont le point est tiré, **numérotés à partir de
    /// 1** comme ils l'ont été dans l'invite. Toujours dans les bornes : c'est
    /// la lecture de la réponse qui s'en porte garante.
    pub sources: Vec<usize>,
}

/// Ce que la journée a apporté, en trois points au plus.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Synthese {
    pub points: Vec<PointDeSynthese>,
    /// Étiquettes thématiques de l'ensemble, sans le croisillon. Six au plus.
    pub hashtags: Vec<String>,

    /// La consigne qui l'a produite. Voir [`GENERATION_SYNTHESE`].
    #[serde(default)]
    pub generation: u8,
}
