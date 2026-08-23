import { describe, expect, it } from 'vitest'
import { etiquette, proposer } from './contacts'
import type { Connaissance, OrigineContact } from '../types/backend'

/** Une entrée du carnet, telle que le backend la rend. */
function connaissance(
  nom: string,
  adresse: string,
  origine: OrigineContact = 'carnet',
  photo: string | null = null,
): Connaissance {
  return { adresse, nom, photo, origine }
}

describe('proposer', () => {
  const repertoire: Connaissance[] = [
    connaissance('Alice Martin', 'alice@exemple.fr'),
    connaissance('Bob Dupont', 'bob@autre.fr'),
    connaissance('Chloé Alix', 'chloe@exemple.fr'),
  ]

  it('ne propose rien sur un champ vide tant qu on n a pas tape', () => {
    expect(proposer(repertoire, '')).toEqual([])
  })

  it('propose dès une seule lettre tapée', () => {
    expect(proposer(repertoire, 'a').map((c) => c.adresse)).toContain(
      'alice@exemple.fr',
    )
  })

  it('classe le début de nom avant une correspondance au milieu', () => {
    // « Alice Martin » commence par « al » ; « Chloé Alix » la porte au milieu.
    expect(proposer(repertoire, 'al')[0]?.adresse).toBe('alice@exemple.fr')
  })

  it('cherche aussi dans le domaine', () => {
    expect(proposer(repertoire, 'autre').map((c) => c.adresse)).toEqual([
      'bob@autre.fr',
    ])
  })

  it('ignore les accents et la casse', () => {
    expect(proposer(repertoire, 'CHLOE').map((c) => c.adresse)).toEqual([
      'chloe@exemple.fr',
    ])
  })

  it('ne repropose pas une adresse déjà retenue', () => {
    // Sinon on la met deux fois sans s'en apercevoir.
    expect(
      proposer(repertoire, 'al', ['Alice@Exemple.fr']).map((c) => c.adresse),
    ).not.toContain('alice@exemple.fr')
  })

  it('départage par origine à correspondance égale', () => {
    // Deux adresses correspondent aussi bien l'une que l'autre : celle que
    // l'utilisateur a enregistrée doit passer devant celle que Google a
    // retenue toute seule.
    const carnet = [
      connaissance('Martin Autre', 'martin@autre.fr', 'autre'),
      connaissance('Martin Carnet', 'martin@carnet.fr', 'carnet'),
    ]

    expect(proposer(carnet, 'martin')[0]?.adresse).toBe('martin@carnet.fr')
  })

  it('ne propose jamais plus de huit entrées', () => {
    // Au-delà, la liste couvre le champ qu'on est en train de remplir.
    const foule = Array.from({ length: 20 }, (_, i) =>
      connaissance(`Martin ${i}`, `martin${i}@exemple.fr`),
    )

    expect(proposer(foule, 'martin')).toHaveLength(8)
  })
})

describe('etiquette', () => {
  it('donne le nom et l adresse quand le nom est connu', () => {
    expect(etiquette(connaissance('Alice Martin', 'alice@exemple.fr'))).toBe(
      'Alice Martin <alice@exemple.fr>',
    )
  })

  it('donne la seule adresse pour un contact sans nom', () => {
    // C'est le cas des « autres contacts » : Google n'en connaît que l'adresse,
    // et l'écrire deux fois ne renseignerait personne.
    expect(etiquette(connaissance('', 'baceva1993@gmail.com', 'autre'))).toBe(
      'baceva1993@gmail.com',
    )
  })
})
