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

/** Miroir de `gmail::corps::PieceJointe`. */
export interface PieceJointe {
  /** Nom choisi par l'expéditeur : à afficher, jamais à employer tel quel
   *  comme nom de fichier. Le backend l'assainit avant d'écrire. */
  nom: string
  typeMime: string
  taille: number
  id: string
}

/** Miroir de `gmail::corps::CorpsMessage`. */
export interface CorpsMessage {
  /** HTML de l'expéditeur, désinfecté. À n'afficher qu'en bac à sable. */
  html: string | null
  texte: string | null
  /** Les fichiers joints, sans leur contenu. Les images déjà intégrées au
   *  document n'y figurent pas : elles sont sous les yeux du lecteur. */
  pieces: PieceJointe[]
}

/** Miroir de `maj::Verification`. */
export interface VerificationMaj {
  versionActuelle: string
  /** `null` quand le depot n'a encore aucune publication definitive. */
  versionPubliee: string | null
  disponible: boolean
  adresse: string | null
}

/** Miroir de `commands::LibelleAffiche`. */
export interface LibelleGmail {
  id: string
  nom: string
}

/** Miroir de `commands::CompteConnu`. */
export interface CompteConnu {
  adresse: string
  nom: string | null
  /** URI de données : la politique de sécurité interdit les images distantes. */
  photo: string | null
  actif: boolean
}

/** Miroir de `gmail::classement::CategorieMessage`. */
export type CategorieMessage = 'humain' | 'publicite' | 'newsletter' | 'formation'

/** Miroir de `gmail::boite::Contact`. */
export interface Contact {
  /** Nom choisi par l'expediteur du message. Cosmetique. */
  nom: string
  /** Adresse normalisee, en minuscules. */
  adresse: string
}

/** Miroir de `gmail::boite::MessageAffiche`. */
export interface MessageAffiche {
  id: string
  /** Nom choisi par l'expéditeur. Cosmétique : ne sert jamais à comparer. */
  nom: string
  /** Adresse normalisée. C'est elle qui sert à créer une règle. */
  adresse: string
  /** Destinataires visibles, en-tête `To`. */
  destinataires: Contact[]
  /** Personnes en copie, en-tête `Cc`. La copie cachée n'y figure pas. */
  copies: Contact[]
  sujet: string
  /** Extrait fourni par Gmail. Du texte, jamais du balisage. */
  extrait: string
  date: string | null
  nonLu: boolean
  categorie: CategorieMessage
  /** Adresse du compte qui a reçu ce message. Sert à la vue mélangée. */
  compte: string
  /**
   * Libellés posés par l'utilisateur, sans ceux du système.
   *
   * C'est ce qui fait les tas de la table des archives : un tas **est** un
   * libellé Gmail. Absent des relevés écrits par une version antérieure, d'où
   * le défaut à la lecture côté Rust.
   */
  libelles: string[]
}

/** Position d'un objet sur la table des archives. Miroir de `tableau::Position`. */
export interface Position {
  x: number
  y: number
}

/**
 * Disposition de la table des archives. Miroir de `tableau::Tableau`.
 *
 * Ne porte que des positions : le classement, lui, vit chez Gmail sous forme
 * de libellés. Perdre ce fichier fait perdre une mise en page, jamais un
 * rangement.
 */
export interface Tableau {
  /** Position des tas, par identifiant de libellé Gmail. */
  tas: Record<string, Position>
  /** Position des messages laissés seuls sur la table. */
  messages: Record<string, Position>
}

/** Miroir de `rules::model::Categorie`. */
export type Categorie = 'humain' | 'publicite' | 'newsletter' | 'formation'

/** Miroir de `rules::model::Action`. */
export type ActionRegle =
  | 'supprimer_toujours'
  | 'archiver_automatique'
  | 'generer_resume_et_archiver'
  /** Ne touche pas à Gmail : la règle ne fait que ranger l'expéditeur. */
  | 'classer_seulement'

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
  /** Identifiant du libellé Gmail de destination, pour un archivage. */
  libelle?: string
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

/** Miroir de `commands::ReglesDuCompte`.
 *
 *  Les règles appartiennent à un compte : une même adresse peut mériter un sort
 *  différent selon la boîte qui la reçoit. */
export interface ReglesDuCompte {
  compte: string
  regles: JeuDeRegles
}

/** Miroir de `gmail::apercu::Apercu`.
 *
 *  Union discriminée par `genre`, comme l'énumération Rust. Ce que le backend
 *  ne sait pas montrer arrive en `impossible`, avec une raison en clair — ce
 *  n'est pas une erreur, c'est une réponse. */
export type Apercu =
  | { genre: 'image'; donnees: string }
  | { genre: 'pdf'; donnees: string }
  | { genre: 'texte'; contenu: string; tronque: boolean }
  | { genre: 'impossible'; raison: string }

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

/** Résumé d'une newsletter, produit par un modèle de langage. */
export interface Resume {
  texte: string
  /** Étiquettes thématiques, sans le croisillon. Trois au plus. */
  hashtags: string[]
}

/**
 * Ce qu'un passage de résumés a réellement produit.
 *
 * Miroir de `commands::resumes::RapportResumes`. Le détail compte : sans lui,
 * l'interface déduisait par soustraction et annonçait « aucun résumé n'a pu
 * être produit » devant vingt-huit résumés en place et deux publications
 * simplement muettes.
 */
export interface RapportResumes {
  /** Résumés en main à la fin, ceux d'avant compris. */
  disponibles: number
  total: number
  /** Produits pendant ce passage. */
  produits: number
  /** Publications dont aucun numéro n'avait de texte à envoyer. */
  sansTexte: number
  /** Publications que le moteur a réellement refusées. */
  echecs: number
}

/** Ce que l'interface sait du moteur de résumés. La clé n'en sort jamais. */
export interface EtatLlm {
  cleConfiguree: boolean
  modele: string
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
  | 'RESUME_INDISPONIBLE'
