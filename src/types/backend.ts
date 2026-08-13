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
