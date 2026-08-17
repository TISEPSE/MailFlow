import { describe, expect, it } from 'vitest'
import {
  RAYON_D_ACCROCHE,
  SURFACE,
  TUILE,
  aligner,
  borner,
  cibleSousLaTuile,
  completer,
  distance,
  placeLibre,
  repartir,
} from './table'
import type { Pose } from './table'
import type { MessageAffiche, Tableau } from '../types/backend'

function message(id: string, libelles: string[] = []): MessageAffiche {
  return {
    id,
    nom: 'Karim',
    adresse: 'karim@atelier.fr',
    destinataires: [],
    copies: [],
    sujet: `Sujet ${id}`,
    extrait: '',
    date: '2026-08-14T10:00:00Z',
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@gmail.com',
    libelles,
  }
}

describe('les bords de la table', () => {
  it('retient une tuile poussée hors du bord gauche', () => {
    // Sur une table sans bord, on perd ses affaires : une tuile lâchée dans le
    // vide serait introuvable, et rien à l'écran ne dirait où elle est allée.
    const retenue = borner({ x: -500, y: -500 }, TUILE.largeur, TUILE.hauteur)

    expect(retenue.x).toBeGreaterThan(0)
    expect(retenue.y).toBeGreaterThan(0)
  })

  it('retient une tuile poussée au-delà du bord droit, tuile entière', () => {
    // Borner sur le coin ne suffirait pas : la tuile dépasserait de sa propre
    // largeur, et sa moitié droite serait illisible.
    const retenue = borner({ x: 99_999, y: 99_999 }, TUILE.largeur, TUILE.hauteur)

    expect(retenue.x + TUILE.largeur).toBeLessThanOrEqual(SURFACE.largeur)
    expect(retenue.y + TUILE.hauteur).toBeLessThanOrEqual(SURFACE.hauteur)
  })

  it('laisse en place ce qui est déjà dans les limites', () => {
    expect(borner({ x: 300, y: 200 }, TUILE.largeur, TUILE.hauteur)).toEqual({
      x: 300,
      y: 200,
    })
  })
})

describe('former un tas en lâchant une tuile sur une autre', () => {
  const poses: Pose[] = [
    { id: 'a', position: { x: 100, y: 100 } },
    { id: 'b', position: { x: 400, y: 100 } },
  ]

  it('reconnaît la tuile visée quand la dépose est proche', () => {
    expect(cibleSousLaTuile({ x: 110, y: 108 }, poses, 'c')?.id).toBe('a')
  })

  it('ne fait pas de tas avec une tuile simplement voisine', () => {
    // Sans ce seuil, poser proprement deux tuiles côte à côte deviendrait
    // impossible : elles se colleraient l'une à l'autre à chaque fois.
    expect(cibleSousLaTuile({ x: 100 + RAYON_D_ACCROCHE + 1, y: 100 }, poses, 'c')).toBeNull()
  })

  it('choisit la plus proche, et non la première rencontrée', () => {
    // Lâcher entre deux objets doit donner un résultat qu'un œil peut vérifier.
    const entreLesDeux = { x: 340, y: 100 }

    expect(cibleSousLaTuile(entreLesDeux, poses, 'c')?.id).toBe('b')
  })

  it("ignore la tuile qu'on est en train de déplacer", () => {
    // Sans cela, une tuile déposée sur place formerait un tas avec elle-même.
    expect(cibleSousLaTuile({ x: 100, y: 100 }, poses, 'a')).toBeNull()
  })
})

describe("placer ce qui n'a pas encore de place", () => {
  it('ne pose jamais deux objets au même endroit', () => {
    // Deux tuiles superposées, c'est un tas que personne n'a fait.
    const posees: { x: number; y: number }[] = []

    for (let rang = 0; rang < 30; rang++) {
      const place = placeLibre(posees, rang)
      for (const deja of posees) {
        expect(distance(deja, place)).toBeGreaterThanOrEqual(RAYON_D_ACCROCHE)
      }
      posees.push(place)
    }
  })

  it("reste dans les limites de la table même après beaucoup d'objets", () => {
    const posees: { x: number; y: number }[] = []

    for (let rang = 0; rang < 200; rang++) {
      const place = placeLibre(posees, rang)
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.x + TUILE.largeur).toBeLessThanOrEqual(SURFACE.largeur)
      expect(place.y + TUILE.hauteur).toBeLessThanOrEqual(SURFACE.hauteur)
      posees.push(place)
    }
  })
})

describe('compléter une disposition existante', () => {
  const posee: Tableau = {
    tas: { Label_1: { x: 500, y: 300 } },
    messages: { m1: { x: 700, y: 400 } },
  }

  it('ne déplace pas ce qui a déjà sa place', () => {
    // Rouvrir la page ne doit pas redistribuer la table : c'est justement ce
    // que l'utilisateur a pris la peine de disposer.
    const complet = completer(posee, ['Label_1'], ['m1'])

    expect(complet.tas.Label_1).toEqual({ x: 500, y: 300 })
    expect(complet.messages.m1).toEqual({ x: 700, y: 400 })
  })

  it('donne une place au message arrivé depuis la dernière ouverture', () => {
    // Sans cela il s'afficherait au coin supérieur gauche, sous les autres.
    const complet = completer(posee, ['Label_1'], ['m1', 'nouveau'])

    expect(complet.messages.nouveau).toBeDefined()
    expect(complet.messages.nouveau).not.toEqual(complet.messages.m1)
  })

  it("ne laisse rien du tableau d'origine derrière lui", () => {
    const complet = completer({ tas: {}, messages: {} }, ['Label_9'], ['m9'])

    expect(Object.keys(complet.tas)).toEqual(['Label_9'])
    expect(Object.keys(complet.messages)).toEqual(['m9'])
  })
})

describe('tout ranger', () => {
  it('aligne les tas avant les tuiles isolées', () => {
    // Un tas porte plusieurs messages : le retrouver compte davantage.
    const range = aligner(['Label_1', 'Label_2'], ['m1', 'm2'])

    const premierTas = range.tas.Label_1
    const premierMessage = range.messages.m1
    expect(premierTas).toBeDefined()
    expect(premierMessage).toBeDefined()
    expect(premierTas!.y).toBeLessThanOrEqual(premierMessage!.y)
  })

  it('ne superpose rien', () => {
    const range = aligner(['Label_1', 'Label_2'], ['m1', 'm2', 'm3'])
    const toutes = [...Object.values(range.tas), ...Object.values(range.messages)]

    for (let i = 0; i < toutes.length; i++) {
      for (let j = i + 1; j < toutes.length; j++) {
        expect(distance(toutes[i]!, toutes[j]!)).toBeGreaterThanOrEqual(RAYON_D_ACCROCHE)
      }
    }
  })
})

describe('répartir les archives entre les tas', () => {
  const connus = new Set(['Label_1', 'Label_2'])

  it('met sur la table ce qui ne porte aucun libellé', () => {
    const { parTas, seuls } = repartir([message('m1')], connus)

    expect(seuls.map((m) => m.id)).toEqual(['m1'])
    expect(parTas.size).toBe(0)
  })

  it('montre un message dans chacun de ses tas', () => {
    // Gmail autorise plusieurs libellés. Chercher un message dans « Factures »
    // et ne pas l'y trouver parce qu'il porte aussi « 2026 » serait la pire
    // des surprises.
    const { parTas, seuls } = repartir([message('m1', ['Label_1', 'Label_2'])], connus)

    expect(parTas.get('Label_1')?.map((m) => m.id)).toEqual(['m1'])
    expect(parTas.get('Label_2')?.map((m) => m.id)).toEqual(['m1'])
    expect(seuls).toEqual([])
  })

  it('ignore un libellé que Gmail ne connaît plus', () => {
    // Supprimé depuis le téléphone entre deux relevés : il ne doit pas faire
    // apparaître un tas sans nom.
    const { parTas, seuls } = repartir([message('m1', ['Label_efface'])], connus)

    expect(parTas.size).toBe(0)
    expect(seuls.map((m) => m.id)).toEqual(['m1'])
  })

  it('groupe plusieurs messages sous le même libellé', () => {
    const { parTas } = repartir(
      [message('m1', ['Label_1']), message('m2', ['Label_1'])],
      connus,
    )

    expect(parTas.get('Label_1')?.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})
