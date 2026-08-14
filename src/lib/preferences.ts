/**
 * Préférences d'affichage, conservées entre deux lancements.
 *
 * Elles vivent dans le `localStorage` du webview et non dans le trousseau ni
 * dans `regles.json` : ce ne sont ni des secrets, ni des automatisations. Perdre
 * un thème n'a aucune conséquence, et les mêler aux règles compliquerait un
 * fichier que l'utilisateur avancé peut ouvrir.
 */

export interface Preferences {
  sombre: boolean
  accent: string
  /** Appliquer les règles dès l'ouverture de l'application. */
  syncAuLancement: boolean
  /** Intervalle entre deux relevés de la boîte. */
  frequence: Frequence
}

export const FREQUENCES = ['1 min', '5 min', '15 min'] as const
export type Frequence = (typeof FREQUENCES)[number]

export const MINUTES: Record<Frequence, number> = {
  '1 min': 1,
  '5 min': 5,
  '15 min': 15,
}

export const DEFAUTS: Preferences = {
  sombre: false,
  accent: '#2F6BFF',
  syncAuLancement: false,
  frequence: '5 min',
}

const CLE = 'mailflow.preferences'

/**
 * Relit les préférences enregistrées.
 *
 * Chaque champ est validé séparément : un `localStorage` corrompu — édité à la
 * main, écrit par une version antérieure — ne doit pas empêcher l'application
 * de s'afficher.
 */
export function lirePreferences(depot: Storage = localStorage): Preferences {
  let brut: unknown
  try {
    brut = JSON.parse(depot.getItem(CLE) ?? 'null')
  } catch {
    return { ...DEFAUTS }
  }

  if (typeof brut !== 'object' || brut === null) return { ...DEFAUTS }
  const p = brut as Partial<Record<keyof Preferences, unknown>>

  return {
    sombre: typeof p.sombre === 'boolean' ? p.sombre : DEFAUTS.sombre,
    accent:
      typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent)
        ? p.accent
        : DEFAUTS.accent,
    syncAuLancement:
      typeof p.syncAuLancement === 'boolean'
        ? p.syncAuLancement
        : DEFAUTS.syncAuLancement,
    frequence: FREQUENCES.includes(p.frequence as Frequence)
      ? (p.frequence as Frequence)
      : DEFAUTS.frequence,
  }
}

/** Enregistre les préférences. Un dépôt indisponible n'est pas une panne. */
export function ecrirePreferences(
  preferences: Preferences,
  depot: Storage = localStorage,
): void {
  try {
    depot.setItem(CLE, JSON.stringify(preferences))
  } catch {
    // Mode privé, quota atteint : l'application marche, sans mémoire.
  }
}
