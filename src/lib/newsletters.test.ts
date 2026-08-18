import { describe, expect, it } from 'vitest'
import type { RapportResumes } from '../types/backend'
import {
  decompteDuGroupe,
  etiquettesUtiles,
  filtrerParEtiquette,
  grouperNewsletters,
  memeEtiquette,
  identiteExpediteur,
  ligneLocale,
  resserrerSujet,
  phraseDuRapport,
} from './newsletters'
import type { GroupeNewsletters } from './newsletters'
import type { MessageAffiche, Resume } from '../types/backend'

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
    libelles: [],
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
    expect(decompteDuGroupe(plusieurs)).toBe('2 mails')
  })
})

describe("ce que le bouton « Analyser » annonce", () => {
  const rapport = (partiel: Partial<RapportResumes>): RapportResumes => ({
    disponibles: 0,
    total: 0,
    enFile: 0,
    ...partiel,
  })

  it("promet que personne n'aura rien à recliquer", () => {
    const [texte, erreur] = phraseDuRapport(rapport({ total: 30, enFile: 27 }))

    expect(erreur).toBe(false)
    expect(texte).toContain('27 publications mises en file')
    expect(texte).toContain('toutes seules')
  })

  it("ne crie pas au secours quand tout était déjà fait", () => {
    const [texte, erreur] = phraseDuRapport(rapport({ disponibles: 8, total: 8 }))

    expect(erreur).toBe(false)
    expect(texte).toContain('déjà résumées')
  })

  it("accorde le singulier, qui se lit vite", () => {
    const [texte] = phraseDuRapport(rapport({ total: 1, enFile: 1 }))
    expect(texte).toContain('1 publication mise en file')
  })

  it("dit toujours quelque chose, même sans rien à faire", () => {
    for (const r of [rapport({}), rapport({ total: 3, disponibles: 1 })]) {
      const [texte, erreur] = phraseDuRapport(r)
      expect(texte.length).toBeGreaterThan(0)
      expect(erreur).toBe(false)
    }
  })

  // Un quota atteint n'est pas une panne : c'est une attente, et la file s'en
  // charge. Rien de ce que cette phrase annonce ne mérite du rouge.
  it('ne montre jamais de rouge', () => {
    const cas = [
      rapport({ total: 30, enFile: 27 }),
      rapport({ total: 8, disponibles: 8 }),
      rapport({ total: 3, disponibles: 1 }),
    ]
    expect(cas.map((r) => phraseDuRapport(r)[1])).toEqual([false, false, false])
  })
})

describe('le filtre par étiquette', () => {
  const groupes = () =>
    grouperNewsletters([
      message('news@lemonde.fr', 'Budget', '2026-08-14T08:00:00Z'),
      message('news@lemonde.fr', 'Climat', '2026-08-13T08:00:00Z'),
      message('bonjour@tech.io', 'Puces', '2026-08-12T08:00:00Z'),
    ])

  /** Les résumés du modèle, rangés sous l'identifiant de chaque numéro. */
  const resumes = (): Record<string, Resume> => ({
    [message('news@lemonde.fr', 'Budget', '2026-08-14T08:00:00Z').id]: {
      texte: 'Le budget',
      hashtags: ['Économie'],
    },
    [message('news@lemonde.fr', 'Climat', '2026-08-13T08:00:00Z').id]: {
      texte: 'Le climat',
      hashtags: ['Climat'],
    },
    [message('bonjour@tech.io', 'Puces', '2026-08-12T08:00:00Z').id]: {
      texte: 'Les puces',
      hashtags: ['IA', 'Tech'],
    },
  })

  it('tient la même étiquette écrite de trois façons', () => {
    expect(memeEtiquette('Économie', 'economie')).toBe(true)
    expect(memeEtiquette('#ÉCONOMIE', ' économie ')).toBe(true)
    expect(memeEtiquette('Économie', 'Écologie')).toBe(false)
  })

  it('ne filtre rien sans étiquette choisie', () => {
    expect(filtrerParEtiquette(groupes(), resumes(), null)).toHaveLength(2)
  })

  it('retient une publication dès que l’un de ses numéros porte le mot', () => {
    // « Climat » ne vit que sur le second numéro du Monde ; la carte montre la
    // pile entière, elle doit donc rester.
    const retenus = filtrerParEtiquette(groupes(), resumes(), 'climat')
    expect(retenus.map((g) => g.nom)).toEqual(['news@lemonde.fr'])
  })

  it('ne propose pas une étiquette qui viderait la page', () => {
    const utiles = etiquettesUtiles(
      ['IA', 'Économie', 'Cyclisme'],
      groupes(),
      resumes(),
    )

    expect(utiles).toEqual(['IA', 'Économie'])
  })

  it('ne propose pas deux fois le même mot sous deux graphies', () => {
    expect(etiquettesUtiles(['IA', '#ia', 'Ia'], groupes(), resumes())).toEqual(['IA'])
  })

  it('ne propose rien quand aucun résumé n’est encore là', () => {
    expect(etiquettesUtiles(['IA'], groupes(), undefined)).toEqual([])
  })
})
