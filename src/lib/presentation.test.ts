import { describe, expect, it } from 'vitest'
import { heureCourte, initiales } from './presentation'

/** Repère fixe : jeudi 14 août 2026, 10 h 00 locales. */
const MAINTENANT = new Date(2026, 7, 14, 10, 0, 0)

function le(annee: number, mois: number, jour: number, h = 0, min = 0) {
  return new Date(annee, mois - 1, jour, h, min).toISOString()
}

describe('heureCourte', () => {
  it("donne l'heure pour un message du jour", () => {
    // Ce qui intéresse sur un message de ce matin, c'est l'heure.
    expect(heureCourte(le(2026, 8, 14, 9, 12), MAINTENANT)).toBe('09:12')
  })

  it('dit « hier » plutôt qu’une date', () => {
    expect(heureCourte(le(2026, 8, 13, 18, 30), MAINTENANT)).toBe('hier')
  })

  it('donne le jour de la semaine dans les six derniers jours', () => {
    // Lundi 10 août 2026.
    expect(heureCourte(le(2026, 8, 10, 8, 15), MAINTENANT)).toBe('lun.')
  })

  it('donne le jour et le mois au-delà', () => {
    expect(heureCourte(le(2026, 7, 29, 8, 15), MAINTENANT)).toBe('29 juil.')
  })

  it("ajoute l'année quand le message est d'une autre année", () => {
    // Sans elle, « 12 déc. » serait ambigu.
    expect(heureCourte(le(2025, 12, 12), MAINTENANT)).toBe('12 déc. 2025')
  })

  it('rend une chaîne vide plutôt que « Invalid Date »', () => {
    expect(heureCourte(null, MAINTENANT)).toBe('')
    expect(heureCourte('pas-une-date', MAINTENANT)).toBe('')
  })
})

describe('initiales', () => {
  it('prend la première lettre de deux mots', () => {
    expect(initiales('Karim Belhadj')).toBe('KB')
    expect(initiales('Les Échos Matin')).toBe('LÉ')
  })

  it("se contente d'un mot", () => {
    expect(initiales('Maman')).toBe('MA')
    expect(initiales('promo')).toBe('PR')
  })

  it('ne rend jamais de chaîne vide', () => {
    // Une pastille vide ressemblerait à un défaut d'affichage.
    expect(initiales('')).toBe('?')
    expect(initiales('   ')).toBe('?')
  })

  it('traite la ponctuation comme une separation de mots', () => {
    // Meme regle que pour un nom compose : deux tokens, deux initiales.
    expect(initiales('offres-tech.fr')).toBe('OT')
    expect(initiales('Jean-Pierre Dupont')).toBe('JP')
  })
})
