/**
 * Enveloppes typées des commandes Tauri.
 *
 * Tout appel au backend passe par ce fichier : c'est le seul endroit où
 * `invoke` est importé, ce qui rend la surface backend visible d'un coup d'œil.
 */

import { invoke } from '@tauri-apps/api/core'
import type { ErreurBackend, EtatApplication } from '../types/backend'

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
