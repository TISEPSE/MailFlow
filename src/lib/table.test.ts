import { describe, expect, it } from 'vitest'
import {
  SURFACE,
  TAS,
  TUILE,
  aligner,
  borner,
  centre,
  cibleSousLaTuile,
  completer,
  contient,
  placeLibre,
  repartir,
  seChevauchent,
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

describe('la géométrie du recouvrement', () => {
  it("prend le centre de l'objet, et non son coin", () => {
    expect(centre({ x: 0, y: 0 }, TUILE)).toEqual({
      x: TUILE.largeur / 2,
      y: TUILE.hauteur / 2,
    })
  })

  it('ne voit pas un point posé juste à côté', () => {
    expect(contient({ x: 0, y: 0 }, TUILE, { x: TUILE.largeur + 1, y: 10 })).toBe(false)
  })

  it('deux objets qui se touchent bord à bord ne se chevauchent pas', () => {
    // Le cas limite qui décide si l'on peut ranger serré : à un pixel près,
    // c'est la différence entre une table dense et une table qui repousse.
    expect(seChevauchent({ x: 0, y: 0 }, TUILE, { x: TUILE.largeur, y: 0 }, TUILE)).toBe(
      false,
    )
    expect(
      seChevauchent({ x: 0, y: 0 }, TUILE, { x: TUILE.largeur - 1, y: 0 }, TUILE),
    ).toBe(true)
  })
})

describe('former un tas en lâchant une tuile sur une autre', () => {
  const poses: Pose[] = [
    { id: 'a', position: { x: 100, y: 100 }, taille: TUILE },
    { id: 'b', position: { x: 400, y: 100 }, taille: TUILE },
  ]

  it('reconnaît la tuile visée quand on la couvre', () => {
    // Lâchée presque au même endroit : le centre de la tuile tombe en plein
    // milieu de « a ».
    expect(cibleSousLaTuile({ x: 110, y: 108 }, poses, 'c')?.id).toBe('a')
  })

  it('laisse poser deux tuiles côte à côte sans les coller', () => {
    // C'est le cœur du reproche : la règle précédente fusionnait tout ce qui
    // passait à moins de 96 pixels, si bien qu'on ne pouvait pas poser deux
    // tuiles voisines. À dix pixels du bord droit de « a », ce sont deux objets
    // distincts, et ils doivent le rester.
    const seule = [poses[0]!]

    expect(cibleSousLaTuile({ x: 100 + TUILE.largeur + 10, y: 100 }, seule, 'c')).toBeNull()
  })

  it('laisse poser une tuile juste sous une autre, ce qui était impossible', () => {
    // Une tuile fait 96 pixels de haut, exactement l'ancien rayon : deux tuiles
    // superposées verticalement fusionnaient donc toujours.
    const seule = [poses[0]!]

    expect(cibleSousLaTuile({ x: 100, y: 100 + TUILE.hauteur + 4 }, seule, 'c')).toBeNull()
  })

  it('choisit celle dont on couvre le mieux le centre', () => {
    // Deux tuiles qui se recouvrent déjà : le centre lâché tombe dans les deux,
    // et il faut que le résultat soit celui que l'œil désigne — la plus proche.
    const empilees: Pose[] = [
      { id: 'gauche', position: { x: 100, y: 100 }, taille: TUILE },
      { id: 'droite', position: { x: 180, y: 100 }, taille: TUILE },
    ]

    // Centre en (284, 148) : dans les deux, mais au milieu exact de « droite ».
    expect(cibleSousLaTuile({ x: 180, y: 100 }, empilees, 'c')?.id).toBe('droite')
  })

  it("ignore la tuile qu'on est en train de déplacer", () => {
    // Sans cela, une tuile déposée sur place formerait un tas avec elle-même.
    expect(cibleSousLaTuile({ x: 100, y: 100 }, poses, 'a')).toBeNull()
  })

  it("tient compte de la hauteur réelle d'un tas, plus courte qu'une tuile", () => {
    // Un tas ne montre qu'un titre : viser sous son bord inférieur, c'est viser
    // la table, pas le tas.
    const tas: Pose[] = [{ id: 't', position: { x: 100, y: 100 }, taille: TAS }]

    expect(cibleSousLaTuile({ x: 100, y: 60 }, tas, 'c')?.id).toBe('t')
    expect(cibleSousLaTuile({ x: 100, y: 130 }, tas, 'c')).toBeNull()
  })
})

describe("placer ce qui n'a pas encore de place", () => {
  it('ne pose jamais deux objets au même endroit', () => {
    // Deux tuiles superposées, c'est un tas que personne n'a fait.
    const posees: { x: number; y: number }[] = []

    for (let rang = 0; rang < 30; rang++) {
      const place = placeLibre(posees, rang)
      for (const deja of posees) {
        expect(seChevauchent(deja, TUILE, place, TUILE)).toBe(false)
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
        expect(seChevauchent(toutes[i]!, TUILE, toutes[j]!, TUILE)).toBe(false)
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
