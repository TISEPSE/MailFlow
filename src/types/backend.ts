/**
 * Miroir TypeScript des types sérialisés par le backend Rust.
 *
 * Ces définitions sont écrites à la main et doivent rester alignées sur
 * `src-tauri/src/commands/mod.rs` et `src-tauri/src/error.rs`. Toute
 * divergence se manifeste à l'exécution, pas à la compilation.
 */

/** Miroir de `commands::EtatApplication`. */
export interface EtatApplication {
  version: string
  plateforme: string
  /** Faux quand aucun trousseau système n'est joignable. */
  trousseauDisponible: boolean
  cheminRegles: string
  /** `null` quand le fichier de règles existe mais est illisible. */
  nombreDeRegles: number | null
  compteConnecte: boolean
  /**
   * Faux tant que l'identifiant client Google n'a pas été renseigné. La vue de
   * connexion doit alors renvoyer vers `docs/connexion-google.md` plutôt que de
   * proposer un bouton qui ne peut pas aboutir.
   */
  clientGoogleConfigure: boolean
}

/** Miroir de `commands::ProfilCompte`. */
export interface ProfilCompte {
  adresse: string
  nom: string | null
  /** URI de données : la politique de sécurité interdit les images distantes. */
  photo: string | null
}

/** Miroir de `commands::CompteConnu`. */
export interface CompteConnu {
  adresse: string
  nom: string | null
  actif: boolean
}

/** Miroir de `gmail::classement::CategorieMessage`. */
export type CategorieMessage = 'humain' | 'publicite' | 'newsletter' | 'formation'

/** Miroir de `gmail::boite::MessageAffiche`. */
export interface MessageAffiche {
  id: string
  /** Nom choisi par l'expediteur. Cosmetique : ne sert jamais a comparer. */
  nom: string
  /** Adresse normalisee. C'est elle qui sert a creer une regle. */
  adresse: string
  sujet: string
  /** Extrait fourni par Gmail. Du texte, jamais du balisage. */
  extrait: string
  date: string | null
  nonLu: boolean
  categorie: CategorieMessage
}

/** Miroir de `rules::model::Categorie`. */
export type Categorie = 'publicite' | 'newsletter' | 'formation'

/** Miroir de `rules::model::Action`. */
export type ActionRegle =
  | 'supprimer_toujours'
  | 'archiver_automatique'
  | 'generer_resume_et_archiver'

/** Miroir de `rules::model::Rule`. Les noms de champs suivent `regles.json`. */
export interface Regle {
  id: string
  expediteur: string
  nom_affichage: string
  categorie: Categorie
  action: ActionRegle
  active: boolean
  /** `AAAA-MM-JJ`. */
  date_ajout: string
  frequence?: 'tous_les_vendredis'
  /** `HH:MM`. */
  heure_execution?: string
}

/** Miroir de `rules::model::RuleSet`. */
export interface JeuDeRegles {
  version: string
  last_updated: string
  automations: Regle[]
}

/** Miroir de `gmail::execution::RapportExecution`. */
export interface RapportExecution {
  archives: number
  misALaCorbeille: number
  /** Appels abandonnés après réessais. Le reste du plan a quand même été appliqué. */
  echecs: number
}

/**
 * Miroir de la sérialisation de `error::AppError`.
 *
 * Le backend ne transmet jamais de détail technique : `code` sert au branchement
 * logique, `message` est directement affichable à l'utilisateur.
 */
export interface ErreurBackend {
  code: CodeErreur
  message: string
}

export type CodeErreur =
  | 'TROUSSEAU_INDISPONIBLE'
  | 'ERREUR_FICHIER'
  | 'REGLES_CORROMPUES'
  | 'NON_AUTHENTIFIE'
  | 'ECHEC_CONNEXION'
  | 'ERREUR_GMAIL'
  | 'ERREUR_RESEAU'
  | 'CONFIG_INVALIDE'
