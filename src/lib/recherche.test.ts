import { describe, expect, it } from 'vitest'
import { chercher, normaliser } from './recherche'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

function message(
  id: string,
  champs: Partial<MessageAffiche> = {},
): MessageAffiche {
  return {
    id,
    nom: 'Karim Belhadj',
    adresse: 'karim@atelier-nord.fr',
    destinataires: [],
    copies: [],
    sujet: 'Devis atelier',
    extrait: 'Je t’envoie la version corrigée.',
    date: null,
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@gmail.com',
    ...champs,
  }
}

const sansCorps = new Map<string, CorpsMessage>()

describe('normaliser', () => {
  it('ôte les accents et la casse', () => {
    // Chercher « reunion » doit trouver « Réunion » : punir qui tape vite
    // rendrait la recherche inutilisable.
    expect(normaliser('Réunion')).toBe('reunion')
    expect(normaliser('ÉCOLE')).toBe('ecole')
    expect(normaliser('à côté')).toBe('a cote')
  })
})

describe('chercher', () => {
  it('ne rend rien sur une requête vide', () => {
    expect(chercher([message('m1')], '', sansCorps)).toEqual([])
    expect(chercher([message('m1')], '   ', sansCorps)).toEqual([])
  })

  it('trouve par nom d’expéditeur', () => {
    const t = chercher([message('m1')], 'belhadj', sansCorps)

    expect(t).toHaveLength(1)
    expect(t[0]!.ou).toBe('expediteur')
  })

  it('trouve par adresse', () => {
    const t = chercher([message('m1')], 'atelier-nord', sansCorps)

    expect(t[0]!.ou).toBe('expediteur')
  })

  it('trouve par sujet', () => {
    const t = chercher([message('m1')], 'devis', sansCorps)

    expect(t[0]!.ou).toBe('sujet')
  })

  it('trouve dans le corps quand il est en mémoire', () => {
    const corps = new Map<string, CorpsMessage>([
      ['m1', { html: null, texte: 'Rendez-vous mardi à la scierie.', pieces: [] }],
    ])

    const t = chercher([message('m1')], 'scierie', corps)

    expect(t).toHaveLength(1)
    expect(t[0]!.ou).toBe('contenu')
  })

  it('trouve malgré les accents, dans les deux sens', () => {
    const m = message('m1', { sujet: 'Réunion de rentrée' })

    expect(chercher([m], 'reunion', sansCorps)).toHaveLength(1)
    expect(chercher([m], 'Réunion', sansCorps)).toHaveLength(1)
  })

  it('ne compte un message qu’une fois', () => {
    // « atelier » est dans l'adresse et dans le sujet : deux entrées pour le
    // même message donneraient une liste qui se répète.
    const t = chercher([message('m1')], 'atelier', sansCorps)

    expect(t).toHaveLength(1)
  })

  it('préfère l’expéditeur au sujet dans l’explication', () => {
    const t = chercher([message('m1')], 'atelier', sansCorps)

    expect(t[0]!.ou).toBe('expediteur')
  })

  it('garde l’ordre des messages reçus', () => {
    const liste = [
      message('recent', { sujet: 'devis A' }),
      message('ancien', { sujet: 'devis B' }),
    ]

    const t = chercher(liste, 'devis', sansCorps)

    expect(t.map((x) => x.message.id)).toEqual(['recent', 'ancien'])
  })

  it('cherche dans toutes les vues, pas seulement une', () => {
    const liste = [
      message('m1', { categorie: 'humain', sujet: 'facture' }),
      message('m2', { categorie: 'publicite', sujet: 'facture promo' }),
      message('m3', { categorie: 'newsletter', sujet: 'facture hebdo' }),
    ]

    expect(chercher(liste, 'facture', sansCorps)).toHaveLength(3)
  })
})
