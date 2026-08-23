import { describe, expect, it } from 'vitest'
import { carnet, etiquette, proposer } from './contacts'
import type { MessageAffiche } from '../types/backend'

function message(partiel: Partial<MessageAffiche>): MessageAffiche {
  return {
    id: 'm',
    nom: '',
    adresse: '',
    sujet: '',
    extrait: '',
    date: null,
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@exemple.fr',
    destinataires: [],
    copies: [],
    libelles: [],
    ...partiel,
  }
}

describe('carnet', () => {
  it("tire les adresses de l'expéditeur, des destinataires et des copies", () => {
    const adresses = carnet(
      [
        message({
          nom: 'Alice',
          adresse: 'alice@exemple.fr',
          destinataires: [{ nom: 'Bob', adresse: 'bob@exemple.fr' }],
          copies: [{ nom: 'Chloé', adresse: 'chloe@exemple.fr' }],
        }),
      ],
      null,
    ).map((c) => c.adresse)

    expect(adresses.sort()).toEqual([
      'alice@exemple.fr',
      'bob@exemple.fr',
      'chloe@exemple.fr',
    ])
  })

  it('ne se propose jamais soi-même comme destinataire', () => {
    // Au mieux du bruit, au pire un message qu'on s'envoie par erreur.
    const c = carnet(
      [
        message({
          nom: 'Alice',
          adresse: 'alice@exemple.fr',
          destinataires: [{ nom: 'Moi', adresse: 'Moi@Exemple.FR' }],
        }),
      ],
      'moi@exemple.fr',
    )

    expect(c.map((x) => x.adresse)).toEqual(['alice@exemple.fr'])
  })

  it('compte les apparitions et fait remonter les familiers', () => {
    const c = carnet(
      [
        message({ nom: 'Rare', adresse: 'rare@exemple.fr' }),
        message({ nom: 'Souvent', adresse: 'souvent@exemple.fr' }),
        message({ nom: 'Souvent', adresse: 'souvent@exemple.fr' }),
        message({ nom: 'Souvent', adresse: 'souvent@exemple.fr' }),
      ],
      null,
    )

    expect(c[0]?.adresse).toBe('souvent@exemple.fr')
    expect(c[0]?.apparitions).toBe(3)
  })

  it('ramène une même adresse écrite différemment à une seule entrée', () => {
    const c = carnet(
      [
        message({ nom: 'Alice', adresse: 'Alice@Exemple.FR' }),
        message({ nom: 'Alice', adresse: 'alice@exemple.fr' }),
      ],
      null,
    )

    expect(c).toHaveLength(1)
    expect(c[0]?.adresse).toBe('alice@exemple.fr')
    expect(c[0]?.apparitions).toBe(2)
  })

  it("n'appelle pas « nom » une adresse recopiée", () => {
    // Gmail met l'adresse dans le champ « nom » quand l'expéditeur n'en donne
    // pas. L'afficher deux fois sur la même ligne ne renseigne personne.
    const [c] = carnet(
      [message({ nom: 'alice@exemple.fr', adresse: 'alice@exemple.fr' })],
      null,
    )

    expect(c?.nom).toBe('')
    expect(c && etiquette(c)).toBe('alice@exemple.fr')
  })

  it('retient le nom dès qu un message en donne un', () => {
    const [c] = carnet(
      [
        message({ nom: '', adresse: 'alice@exemple.fr' }),
        message({ nom: 'Alice Martin', adresse: 'alice@exemple.fr' }),
      ],
      null,
    )

    expect(c?.nom).toBe('Alice Martin')
  })

  it('écarte ce qui ne peut pas être une adresse', () => {
    const c = carnet(
      [message({ nom: 'Vide', adresse: '' }), message({ nom: 'Bancal', adresse: 'pas-une-adresse' })],
      null,
    )

    expect(c).toEqual([])
  })

  it('survit à un relevé sans destinataires ni copies', () => {
    // Ces champs sont arrivés après coup : un relevé rangé par une version
    // antérieure n'en a pas, et une exception ici viderait la fenêtre.
    const brut = { ...message({ nom: 'A', adresse: 'a@exemple.fr' }) }
    delete (brut as { destinataires?: unknown }).destinataires
    delete (brut as { copies?: unknown }).copies

    expect(() => carnet([brut], null)).not.toThrow()
  })
})

describe('proposer', () => {
  const repertoire = carnet(
    [
      message({ nom: 'Alice Martin', adresse: 'alice@exemple.fr' }),
      message({ nom: 'Alice Martin', adresse: 'alice@exemple.fr' }),
      message({ nom: 'Bob Dupont', adresse: 'bob@autre.fr' }),
      message({ nom: 'Chloé Alix', adresse: 'chloe@exemple.fr' }),
    ],
    null,
  )

  it('propose les contacts fréquents sur un champ vide', () => {
    expect(proposer(repertoire, '')).toHaveLength(3)
  })

  it('propose dès une seule lettre', () => {
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
})
