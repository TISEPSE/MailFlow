/**
 * Miroir TypeScript des types serialises par le backend Rust.
 *
 * Ces definitions sont ecrites a la main et doivent rester alignees sur
 * `src-tauri/src/commands/mod.rs` et `src-tauri/src/error.rs`. Toute
 * divergence se manifeste a l'execution, pas a la compilation.
 */

/** Miroir de `commands::EtatApplication`. */
export interface EtatApplication {
  version: string
  plateforme: string
  /** Faux quand aucun trousseau systeme n'est joignable. */
  trousseauDisponible: boolean
  cheminRegles: string
  /** `null` quand le fichier de regles existe mais est illisible. */
  nombreDeRegles: number | null
  compteConnecte: boolean
  /**
   * Faux tant que l'identifiant client Google n'a pas ete renseigne. La vue de
   * connexion doit alors renvoyer vers `docs/connexion-google.md` plutot que de
   * proposer un bouton qui ne peut pas aboutir.
   */
  clientGoogleConfigure: boolean
}

/**
 * Miroir de la serialisation de `error::AppError`.
 *
 * Le backend ne transmet jamais de detail technique : `code` sert au branchement
 * logique, `message` est directement affichable a l'utilisateur.
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
