/**
 * Cache des corps de message, en mémoire.
 *
 * Sans lui, revenir sur un message déjà ouvert le retéléchargeait entièrement,
 * images comprises — plusieurs mégaoctets et une seconde d'attente pour un
 * contenu qu'on venait d'avoir sous les yeux.
 *
 * En mémoire seulement : rien du contenu des messages n'est écrit sur le
 * disque, ce que le projet s'est interdit depuis le début. Le prix en est
 * connu et assumé : tout est rechargé au prochain lancement.
 */
import type { CorpsMessage } from '../types/backend'

/**
 * Au-delà, on oublie les plus anciens.
 *
 * Un corps avec ses images intégrées pèse plusieurs mégaoctets ; sans borne,
 * une session d'une journée finirait par tout garder.
 */
export const CAPACITE = 80

/** `Map` conserve l'ordre d'insertion : le premier est le plus ancien. */
export type CacheCorps = Map<string, CorpsMessage>

export function creerCache(): CacheCorps {
  return new Map()
}

/**
 * Range un corps et évince les plus anciens si besoin.
 *
 * Rend une nouvelle `Map` : React ne redessine que si la référence change.
 */
export function ranger(
  cache: CacheCorps,
  id: string,
  corps: CorpsMessage,
): CacheCorps {
  const suivant = new Map(cache)

  // Réinséré en dernier : un message qu'on vient de consulter est le moins
  // susceptible d'être oublié.
  suivant.delete(id)
  suivant.set(id, corps)

  while (suivant.size > CAPACITE) {
    const plusAncien = suivant.keys().next().value
    if (plusAncien === undefined) break
    suivant.delete(plusAncien)
  }

  return suivant
}

/**
 * Retire un corps du cache.
 *
 * Appelé quand le message quitte la boîte — archivé ou mis à la corbeille. Le
 * garder retiendrait plusieurs mégaoctets d'images pour un message qu'on ne
 * peut plus ouvrir.
 */
export function oublier(cache: CacheCorps, id: string): CacheCorps {
  if (!cache.has(id)) return cache

  const suivant = new Map(cache)
  suivant.delete(id)
  return suivant
}
