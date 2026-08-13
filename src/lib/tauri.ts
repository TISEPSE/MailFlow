/**
 * Enveloppes typees des commandes Tauri.
 *
 * Tout appel au backend passe par ce fichier : c'est le seul endroit ou
 * `invoke` est importe, ce qui rend la surface backend visible d'un coup d'oeil.
 */

import { invoke } from '@tauri-apps/api/core'
import type { ErreurBackend, EtatApplication } from '../types/backend'

/** Vrai lorsqu'une valeur rejetee a la forme d'une erreur backend. */
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
 * Ramene n'importe quel rejet a un message affichable.
 *
 * Une panne inattendue ne doit pas exposer sa trace a un utilisateur non
 * technique : elle part dans la console et l'interface reste comprehensible.
 */
export function messageDErreur(e: unknown): string {
  if (estErreurBackend(e)) return e.message
  console.error('erreur inattendue du backend', e)
  return "Une erreur inattendue s'est produite."
}

/** Etat de sante du backend, appele au demarrage. */
export function appHealth(): Promise<EtatApplication> {
  return invoke<EtatApplication>('app_health')
}
