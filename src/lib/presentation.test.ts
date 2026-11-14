import { describe, expect, it } from 'vitest'
import {
  heureCourte,
  initiales,
  couleurDuCompte,
  hauteurDuCadre,
  HAUTEUR_CADRE_MAX,
  interlocuteur,
  ton,
  TONS,
  type Teintable,
} from './presentation'
import type { MessageAffiche } from '../types/backend'

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

describe('couleurDuCompte', () => {
  const comptes = ['baptiste@gmail.com', 'pro@educagri.fr', 'asso@exemple.fr']

  it('distingue les comptes de la liste', () => {
    // C'est toute la raison du choix par rang : deux adresses quelconques
    // tombaient trop souvent sur la même teinte, ce qui revenait à ne rien
    // distinguer là où la couleur est la seule marque.
    const teintes = comptes.map((c) => couleurDuCompte(c, comptes)[0])

    expect(new Set(teintes).size).toBe(comptes.length)
  })

  it('rend la même couleur au même compte', () => {
    expect(couleurDuCompte('pro@educagri.fr', comptes)).toEqual(
      couleurDuCompte('pro@educagri.fr', comptes),
    )
  })

  it('ignore la casse', () => {
    expect(couleurDuCompte('Pro@Educagri.fr', comptes)).toEqual(
      couleurDuCompte('pro@educagri.fr', comptes),
    )
  })

  it('donne une couleur à un compte absent de la liste', () => {
    // Un message rangé sous un compte depuis oublié : mieux vaut une couleur
    // de plus qu'un liseré vide.
    expect(couleurDuCompte('parti@ailleurs.fr', comptes)).toBeDefined()
  })
})

describe('ton', () => {
  it('donne une couleur à chaque entrée de la barre de navigation', () => {
    // Le test qui manquait : une entrée avait été ajoutée à la barre sans ton,
    // `TONS[…]` valait donc `undefined`, et lire `.clair` dessus faisait
    // disparaître toute l'application derrière un écran blanc.
    const entrees: Teintable[] = [
      'humain',
      'publicite',
      'newsletter',
      'formation',
      'regle',
      'archive',
      'envoye',
    ]

    for (const e of entrees) {
      expect(ton(e, false), e).toHaveLength(2)
      expect(ton(e, true), e).toHaveLength(2)
    }
  })

  it('porte un ton à elle pour chaque entrée, et non le repli gris', () => {
    // Le test précédent passe même sur une entrée sans ton, puisque `ton` a un
    // repli. C'est voulu — mieux vaut du gris qu'un écran blanc — mais cela en
    // fait un test qui ne peut pas échouer. Celui-ci regarde `TONS` lui-même :
    // une entrée de la barre doit avoir sa couleur, pas celle du voisin.
    for (const e of ['humain', 'publicite', 'newsletter', 'formation', 'regle', 'archive', 'envoye'] as Teintable[]) {
      expect(TONS[e], e).toBeDefined()
    }
  })

  it('rend une couleur neutre plutôt que de planter sur un inconnu', () => {
    // Une entrée ajoutée demain sans ton doit s'afficher en gris, pas effacer
    // l'application.
    expect(ton('inventée' as Teintable, false)).toEqual(ton('humain', false))
  })
})

describe('interlocuteur', () => {
  const message = (partiel: Partial<MessageAffiche> = {}): MessageAffiche => ({
    id: 'm1',
    nom: 'JULES',
    adresse: 'jules@exemple.fr',
    sujet: 'La facture',
    extrait: '',
    date: null,
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@exemple.fr',
    destinataires: [],
    copies: [],
    libelles: [],
    ...partiel,
  })

  it('montre l’expéditeur sur les pages de courrier reçu', () => {
    expect(interlocuteur(message(), 'expediteur')).toEqual({
      nom: 'JULES',
      adresse: 'jules@exemple.fr',
      autres: 0,
    })
  })

  it('montre le destinataire sur la page des messages envoyés', () => {
    // C'est la seule chose qui distingue deux messages envoyés : l'expéditeur,
    // lui, est toujours soi.
    const m = message({ destinataires: [{ nom: 'Alice', adresse: 'alice@exemple.fr' }] })

    expect(interlocuteur(m, 'destinataire')).toEqual({
      nom: 'Alice',
      adresse: 'alice@exemple.fr',
      autres: 0,
    })
  })

  it('compte les autres destinataires sans les nommer', () => {
    // Une ligne de liste n'a pas la place de six adresses, et la première
    // suffit à reconnaître le message. Le compte dit qu'il y en a d'autres.
    const m = message({
      destinataires: [
        { nom: 'Alice', adresse: 'alice@exemple.fr' },
        { nom: 'Bob', adresse: 'bob@exemple.fr' },
      ],
      copies: [{ nom: 'Chloé', adresse: 'chloe@exemple.fr' }],
    })

    expect(interlocuteur(m, 'destinataire').autres).toBe(2)
  })

  it('reste lisible pour un message sans destinataire', () => {
    // Gmail en rend : un message envoyé en copie cachée seule n'a pas d'en-tête
    // « To ». Une ligne vide se lirait comme un défaut d'affichage.
    const vu = interlocuteur(message(), 'destinataire')

    expect(vu.nom).toBe('Destinataire inconnu')
    expect(vu.adresse).toBe('')
  })

  it('prend l’adresse pour nom quand le destinataire n’en donne pas', () => {
    const m = message({ destinataires: [{ nom: '', adresse: 'alice@exemple.fr' }] })

    expect(interlocuteur(m, 'destinataire').nom).toBe('alice@exemple.fr')
  })
})

describe('hauteurDuCadre', () => {
  it('rend la hauteur mesurée quand elle est raisonnable', () => {
    expect(hauteurDuCadre(1200)).toBe(1200)
  })

  it('plafonne une hauteur démesurée', () => {
    // Un corps hostile peut, par CSS seule, créer un élément de plusieurs
    // millions de pixels : le cadre grandissait d'autant et la page devenait
    // impossible à faire défiler.
    expect(hauteurDuCadre(10_000_000)).toBe(HAUTEUR_CADRE_MAX)
  })

  it('ignore une valeur qui n’en est pas une', () => {
    expect(hauteurDuCadre(0)).toBeNull()
    expect(hauteurDuCadre(-5)).toBeNull()
    expect(hauteurDuCadre(Number.NaN)).toBeNull()
    expect(hauteurDuCadre(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
