import { describe, expect, it } from 'vitest'
import {
  decompteDuGroupe,
  grouperNewsletters,
  identiteExpediteur,
  ligneLocale,
  resserrerSujet,
} from './newsletters'
import type { GroupeNewsletters } from './newsletters'
import type { MessageAffiche } from '../types/backend'

function message(
  adresse: string,
  sujet: string,
  date: string | null = '2026-08-14T10:00:00Z',
  nom = adresse,
): MessageAffiche {
  return {
    id: `${adresse}|${sujet}|${date}`,
    nom,
    adresse,
    destinataires: [],
    copies: [],
    sujet,
    extrait: '',
    date,
    nonLu: false,
    categorie: 'newsletter',
    compte: 'moi@gmail.com',
  }
}

/** Premier groupe, ou échec net : un test qui n'en produit aucun ment. */
function premierGroupe(messages: MessageAffiche[]): GroupeNewsletters {
  const groupe = grouperNewsletters(messages)[0]
  if (!groupe) throw new Error('aucun groupe produit')
  return groupe
}

describe('identiteExpediteur', () => {
  it("rassemble les adresses d'une même publication", () => {
    // Le cas qui motive tout le module : un journal écrit depuis plusieurs
    // adresses, et sans regroupement il occupe trois cartes.
    const identites = [
      'news@lemonde.fr',
      'alerte@lemonde.fr',
      'matinale@news.lemonde.fr',
    ].map(identiteExpediteur)

    expect(new Set(identites).size).toBe(1)
  })

  it('ne confond pas deux personnes chez le même fournisseur', () => {
    // Sans cette exception, une carte « gmail.com » avalerait des expéditeurs
    // sans aucun rapport entre eux.
    expect(identiteExpediteur('alice@gmail.com')).not.toBe(
      identiteExpediteur('bob@gmail.com'),
    )
  })

  it('garde le nom de domaine sous un suffixe en deux temps', () => {
    // `co.uk` regrouperait tout le Royaume-Uni sous une seule carte.
    expect(identiteExpediteur('news@boutique.exemple.co.uk')).toBe('exemple.co.uk')
  })

  it('ignore la casse et les espaces', () => {
    expect(identiteExpediteur('  News@LeMonde.FR ')).toBe('lemonde.fr')
  })

  it("rend quelque chose d'utilisable sur une adresse malformée", () => {
    // L'adresse vient d'un en-tête écrit par un tiers : elle n'a pas à être
    // valide, et ne doit surtout pas faire tomber la page.
    expect(identiteExpediteur('pas-une-adresse')).toBe('pas-une-adresse')
    expect(identiteExpediteur('vide@')).toBe('vide@')
    expect(identiteExpediteur('')).toBe('')
  })
})

describe('resserrerSujet', () => {
  it("retire l'étiquette en tête", () => {
    expect(resserrerSujet('[Newsletter] Ce que change la réforme')).toBe(
      'Ce que change la réforme',
    )
  })

  it("retire la mention d'édition", () => {
    expect(resserrerSujet('Édition du 12 mars — Les retraites')).toBe('Les retraites')
  })

  it('retire la numérotation', () => {
    expect(resserrerSujet('La Matinale n°42 : le climat')).toBe('La Matinale : le climat')
    expect(resserrerSujet('Récap #17 du marché')).toBe('Récap du marché')
  })

  it('retire la date collée en fin de sujet', () => {
    expect(resserrerSujet('Les nouveautés — 12 mars 2026')).toBe('Les nouveautés')
  })

  it('ne laisse jamais un tiret orphelin', () => {
    expect(resserrerSujet('— Les retraites —')).toBe('Les retraites')
  })

  it("rend l'original quand il ne resterait rien", () => {
    // Mieux vaut une mention d'édition qu'une carte sans titre.
    expect(resserrerSujet('Édition du 12 mars')).not.toBe('')
  })

  it('ne mange pas le début du sujet quand la mention ne porte pas de date', () => {
    // Une première version consommait « les deux mots suivants » sans regarder
    // ce qu'ils étaient : « les » disparaissait avec la mention d'édition.
    expect(resserrerSujet('Édition du jour : les retraites')).toContain('les retraites')
  })

  it("ne touche pas à un sujet qui n'a rien à retirer", () => {
    expect(resserrerSujet('Ce que change la réforme des retraites')).toBe(
      'Ce que change la réforme des retraites',
    )
  })
})

describe('grouperNewsletters', () => {
  it('fait une carte par publication, pas par adresse', () => {
    const groupes = grouperNewsletters([
      message('news@lemonde.fr', 'A'),
      message('alerte@lemonde.fr', 'B'),
      message('contact@ouigo-news.com', 'C'),
    ])

    expect(groupes).toHaveLength(2)
    expect(groupes.map((g) => g.messages.length).sort()).toEqual([1, 2])
  })

  it('range les numéros du plus récent au plus ancien', () => {
    const groupe = premierGroupe([
      message('news@lemonde.fr', 'ancien', '2026-08-10T08:00:00Z'),
      message('news@lemonde.fr', 'récent', '2026-08-14T08:00:00Z'),
    ])

    expect(groupe.messages.map((m) => m.sujet)).toEqual(['récent', 'ancien'])
  })

  it("ouvre la page sur la publication qui vient d'écrire", () => {
    const groupe = premierGroupe([
      message('a@ancien.fr', 'x', '2026-08-01T08:00:00Z'),
      message('b@recent.fr', 'y', '2026-08-14T08:00:00Z'),
    ])

    expect(groupe.adresse).toBe('b@recent.fr')
  })

  it('affiche le groupe sous le dernier nom que la publication se donne', () => {
    const groupe = premierGroupe([
      message('news@lemonde.fr', 'x', '2026-08-01T08:00:00Z', 'Ancien nom'),
      message('alerte@lemonde.fr', 'y', '2026-08-14T08:00:00Z', 'Nouveau nom'),
    ])

    expect(groupe.nom).toBe('Nouveau nom')
  })

  it('supporte une date absente ou illisible sans perdre le message', () => {
    const groupe = premierGroupe([
      message('news@lemonde.fr', 'sans date', null),
      message('news@lemonde.fr', 'date cassée', 'pas une date'),
      message('news@lemonde.fr', 'datée', '2026-08-14T08:00:00Z'),
    ])

    expect(groupe.messages).toHaveLength(3)
    expect(groupe.messages[0].sujet).toBe('datée')
  })

  it('ne rend aucun groupe sur une liste vide', () => {
    expect(grouperNewsletters([])).toEqual([])
  })
})

describe('ligneLocale et decompteDuGroupe', () => {
  it('reprend le sujet resserré du numéro montré', () => {
    // La carte peut montrer un autre numéro que le plus récent : la ligne
    // décrit celui qui est à l'écran, pas la tête de pile.
    const groupe = premierGroupe([
      message('news@lemonde.fr', '[Newsletter] Les retraites', '2026-08-14T08:00:00Z'),
      message('news@lemonde.fr', 'Édition du 12 mars — Le climat', '2026-08-01T08:00:00Z'),
    ])

    const [tete, suivant] = groupe.messages
    if (!suivant) throw new Error('le groupe devait porter deux numéros')

    expect(ligneLocale(tete)).toBe('Les retraites')
    expect(ligneLocale(suivant)).toBe('Le climat')
  })

  it('ne laisse pas une carte sans titre', () => {
    const groupe = premierGroupe([message('news@lemonde.fr', '')])
    expect(ligneLocale(groupe.messages[0])).toBe('(sans objet)')
  })

  it('ne compte que lorsqu\'il y a plusieurs numéros', () => {
    const seul = premierGroupe([message('a@x.fr', 'x')])
    expect(decompteDuGroupe(seul)).toBe('')

    const plusieurs = premierGroupe([
      message('a@x.fr', 'x', '2026-08-14T08:00:00Z'),
      message('a@x.fr', 'y', '2026-08-13T08:00:00Z'),
    ])
    expect(decompteDuGroupe(plusieurs)).toBe('2 numéros')
  })
})
