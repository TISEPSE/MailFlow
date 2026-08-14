/**
 * Enveloppes typées des commandes Tauri.
 *
 * Tout appel au backend passe par ce fichier : c'est le seul endroit où
 * `invoke` est importé, ce qui rend la surface backend visible d'un coup d'œil.
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  ErreurBackend,
  EtatApplication,
  JeuDeRegles,
  MessageAffiche,
  ProfilCompte,
  RapportExecution,
  Regle,
} from '../types/backend'

/** Vrai lorsqu'une valeur rejetée a la forme d'une erreur backend. */
export function estErreurBackend(e: unknown): e is ErreurBackend {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as ErreurBackend).message === 'string'
  )
}

/**
 * Ramène n'importe quel rejet à un message affichable.
 *
 * Une panne inattendue ne doit pas exposer sa trace à un utilisateur non
 * technique : elle part dans la console et l'interface reste compréhensible.
 */
export function messageDErreur(e: unknown): string {
  if (estErreurBackend(e)) return e.message
  console.error('erreur inattendue du backend', e)
  return "Une erreur inattendue s'est produite."
}

/** État de santé du backend, appelé au démarrage. */
export function appHealth(): Promise<EtatApplication> {
  return invoke<EtatApplication>('app_health')
}

/**
 * Lance le parcours de connexion Google.
 *
 * La promesse ne se résout qu'à la fin du parcours — l'utilisateur passe par son
 * navigateur entre-temps. Aucun jeton ne revient ici : l'état de connexion se
 * relit avec `appHealth`.
 */
export function googleConnecter(): Promise<void> {
  return invoke<void>('google_connecter')
}

/** Déconnecte le compte et révoque l'autorisation chez Google. */
export function googleDeconnecter(): Promise<void> {
  return invoke<void>('google_deconnecter')
}

/**
 * Applique les règles à la boîte Gmail.
 *
 * Le parcours entier reste côté Rust : ne reviennent ici que des décomptes,
 * jamais des identifiants de messages.
 */
export function gmailSynchroniser(): Promise<RapportExecution> {
  return invoke<RapportExecution>('gmail_synchroniser')
}

/** Jeu de regles tel qu'il est sur le disque. */
export function reglesLister(): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regles_lister')
}

/**
 * Enregistre une regle et rend le jeu complet.
 *
 * Les commandes de regles rendent toujours l'ensemble plutot qu'un accuse de
 * reception : l'interface se reaffiche a partir de ce qui est reellement sur le
 * disque, au lieu de maintenir sa propre copie qui finirait par diverger.
 */
export function regleAjouter(regle: Regle): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_ajouter', { regle })
}

export function regleSupprimer(id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_supprimer', { id })
}

export function regleBasculer(id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_basculer', { id })
}

/** Releve la boite de reception, deja classee par vue. */
export function boiteLister(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('boite_lister')
}

/** Adresse du compte relié, ou `null` si aucun ne l'est. */
export function compteAdresse(): Promise<string | null> {
  return invoke<string | null>('compte_adresse')
}

/**
 * Profil du compte relié : adresse, nom affiché, photo.
 *
 * La photo arrive en URI de données parce que la politique de sécurité de
 * l'interface interdit les images d'origine externe.
 */
export function compteProfil(): Promise<ProfilCompte | null> {
  return invoke<ProfilCompte | null>('compte_profil')
}

/**
 * Logos des expediteurs, indexes par domaine.
 *
 * Chaque logo est demande au domaine de l'expediteur, jamais a un service
 * tiers : un agregateur d'icones apprendrait la liste complete des
 * correspondants de l'utilisateur.
 */
export function logosExpediteurs(
  adresses: string[],
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('logos_expediteurs', { adresses })
}
