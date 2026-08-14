import { describe, expect, it } from 'vitest'
import { DEFAUTS, ecrirePreferences, lirePreferences } from './preferences'

/** Dépôt en mémoire : les tests n'ont pas de `localStorage`. */
function depot(contenu: Record<string, string> = {}): Storage {
  const donnees = new Map(Object.entries(contenu))
  return {
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
    clear: () => donnees.clear(),
    key: (i) => [...donnees.keys()][i] ?? null,
    get length() {
      return donnees.size
    },
  }
}

describe('preferences', () => {
  it('rend les valeurs par défaut sur un dépôt vide', () => {
    expect(lirePreferences(depot())).toEqual(DEFAUTS)
  })

  it('relit ce qui a été écrit', () => {
    const d = depot()
    const choix = { ...DEFAUTS, sombre: true, accent: '#1F7A5A' as const }

    ecrirePreferences(choix, d)

    expect(lirePreferences(d)).toEqual(choix)
  })

  it('ignore un contenu illisible plutôt que de faire échouer l’affichage', () => {
    // Un localStorage édité à la main ne doit pas empêcher l'application de
    // démarrer.
    const d = depot({ 'mailflow.preferences': '{pas du json' })

    expect(lirePreferences(d)).toEqual(DEFAUTS)
  })

  it('retient le repli de la barre latérale', () => {
    // Sans persistance, la barre se rouvrirait à chaque lancement et il
    // faudrait la replier tous les jours.
    const d = depot()
    ecrirePreferences({ ...DEFAUTS, barreRepliee: true }, d)

    expect(lirePreferences(d).barreRepliee).toBe(true)
  })

  it('valide chaque champ séparément', () => {
    // Une version antérieure a pu écrire un champ dans un autre format : les
    // champs encore valides doivent survivre.
    const d = depot({
      'mailflow.preferences': JSON.stringify({
        sombre: true,
        accent: 'rouge',
        frequence: '3 min',
      }),
    })

    const p = lirePreferences(d)
    expect(p.sombre).toBe(true)
    expect(p.accent).toBe(DEFAUTS.accent)
    expect(p.frequence).toBe(DEFAUTS.frequence)
  })

  it('refuse une couleur qui ne soit pas hexadécimale', () => {
    // Elle finirait en style CSS ; une valeur arbitraire n'a rien à y faire.
    const d = depot({
      'mailflow.preferences': JSON.stringify({ accent: 'red; background:url(x)' }),
    })

    expect(lirePreferences(d).accent).toBe(DEFAUTS.accent)
  })

  it('survit à un dépôt en écriture seule refusée', () => {
    const casse = { ...depot(), setItem: () => { throw new Error('quota') } }

    expect(() => ecrirePreferences(DEFAUTS, casse as Storage)).not.toThrow()
  })
})
