import { describe, expect, it } from 'vitest'
import { autresQueMoi } from './reponse'
import type { Contact, MessageAffiche } from '../types/backend'

function contact(adresse: string): Contact {
  return { nom: adresse.split('@')[0] ?? adresse, adresse }
}

function message(destinataires: string[], copies: string[] = []): MessageAffiche {
  return {
    id: 'm1',
    nom: 'Karim',
    adresse: 'karim@atelier.fr',
    destinataires: destinataires.map(contact),
    copies: copies.map(contact),
    sujet: 'Réunion',
    extrait: '',
    date: null,
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@gmail.com',
  }
}

describe('autresQueMoi', () => {
  it('retient les destinataires et les personnes en copie', () => {
    const m = message(['marie@ecole.fr', 'paul@ecole.fr'], ['direction@ecole.fr'])

    expect(autresQueMoi(m, 'moi@ecole.fr')).toEqual([
      'marie@ecole.fr',
      'paul@ecole.fr',
      'direction@ecole.fr',
    ])
  })

  it("écarte l'expéditeur, déjà destinataire principal de la réponse", () => {
    // Gmail remet souvent l'expéditeur dans le `To` d'un fil : l'y laisser lui
    // enverrait deux fois la même réponse.
    const m = message(['karim@atelier.fr', 'marie@ecole.fr'])

    expect(autresQueMoi(m, 'moi@ecole.fr')).toEqual(['marie@ecole.fr'])
  })

  it('écarte votre propre adresse, quelle qu’en soit la casse', () => {
    const m = message(['Moi@Ecole.fr', 'marie@ecole.fr'])

    expect(autresQueMoi(m, 'moi@ecole.fr')).toEqual(['marie@ecole.fr'])
  })

  it('ne retient qu’une fois une personne présente en destinataire et en copie', () => {
    const m = message(['marie@ecole.fr'], ['MARIE@ecole.fr'])

    expect(autresQueMoi(m, 'moi@ecole.fr')).toEqual(['marie@ecole.fr'])
  })

  it('rend une liste vide quand il n’y a personne d’autre', () => {
    // « Répondre à tous » se comporte alors comme « Répondre », sans doublon.
    const m = message(['moi@ecole.fr'])

    expect(autresQueMoi(m, 'moi@ecole.fr')).toEqual([])
  })

  it('fonctionne sans connaître votre adresse', () => {
    // Le profil peut ne pas être encore chargé : mieux vaut une copie de trop
    // qu'un bouton qui ne répond à personne.
    const m = message(['marie@ecole.fr'])

    expect(autresQueMoi(m, null)).toEqual(['marie@ecole.fr'])
  })
})
