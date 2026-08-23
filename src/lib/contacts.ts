/**
 * Le carnet d'adresses que MailFlow se constitue tout seul.
 *
 * # D'où il vient
 *
 * De vos messages, et de rien d'autre. Chaque message porte son expéditeur, ses
 * destinataires et ses copies : ce sont, à peu de chose près, les gens avec qui
 * vous avez déjà eu affaire. Rien n'est demandé à Google — l'annuaire de
 * contacts exigerait la People API et une autorisation restreinte de plus, pour
 * un résultat que ces trois champs donnent déjà.
 *
 * # Pourquoi il compte les apparitions
 *
 * Taper une adresse de mémoire est le moyen le plus sûr de se tromper d'une
 * lettre, et un message parti à côté ne revient pas. Ce qui aide vraiment,
 * c'est que la bonne proposition soit **en premier** : une liste de dix noms
 * dans le désordre oblige à la lire en entier. D'où le tri par nombre
 * d'apparitions — les gens avec qui l'on échange souvent remontent d'eux-mêmes,
 * sans qu'on ait à tenir un classement quelque part.
 */
import { HORS_JEU, normaliser, rangDeCorrespondance } from './recherche'
import type { Contact, MessageAffiche } from '../types/backend'

/** Une entrée du carnet. */
export interface Connaissance {
  /** Adresse en minuscules. C'est elle qui identifie. */
  adresse: string
  /** Le nom le plus utile qu'on ait vu pour cette adresse. */
  nom: string
  /** Dans combien de messages elle apparaît. */
  apparitions: number
}

/** Vrai quand la chaîne peut passer pour une adresse. */
function utilisable(adresse: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse.trim())
}

/**
 * Le meilleur des deux noms pour une même adresse.
 *
 * Un nom qui répète l'adresse n'en est pas un : Gmail met l'adresse dans le
 * champ « nom » quand l'expéditeur n'en a pas donné, et l'afficher deux fois
 * sur la même ligne ne renseigne personne.
 */
function meilleurNom(ancien: string, neuf: string, adresse: string): string {
  const vaut = (n: string) =>
    n.trim() && n.trim().toLowerCase() !== adresse ? n.trim() : ''

  return vaut(ancien) || vaut(neuf) || ''
}

/**
 * Construit le carnet à partir des messages sous la main.
 *
 * `moi` est écarté : se proposer soi-même comme destinataire est au mieux du
 * bruit, au pire un message qu'on s'envoie par erreur en croyant l'envoyer à
 * quelqu'un.
 */
export function carnet(
  messages: readonly MessageAffiche[],
  moi: string | null,
): Connaissance[] {
  const propre = moi?.trim().toLowerCase() ?? ''
  const connus = new Map<string, Connaissance>()

  const noter = (nom: string, adresse: string) => {
    const cle = adresse.trim().toLowerCase()
    if (!utilisable(cle) || cle === propre) return

    const deja = connus.get(cle)
    if (deja) {
      deja.apparitions += 1
      deja.nom = meilleurNom(deja.nom, nom, cle)
      return
    }

    connus.set(cle, {
      adresse: cle,
      nom: meilleurNom('', nom, cle),
      apparitions: 1,
    })
  }

  for (const message of messages) {
    noter(message.nom, message.adresse)
    // Le repli sur une liste vide n'est pas une politesse : un relevé rangé par
    // une version antérieure peut ne pas porter ces champs, et lire `for...of`
    // sur `undefined` lève — une exception pendant un rendu démonte l'arbre
    // entier et laisse la fenêtre blanche.
    for (const c of message.destinataires ?? []) noter(c.nom, c.adresse)
    for (const c of message.copies ?? []) noter(c.nom, c.adresse)
  }

  return [...connus.values()].sort(
    (a, b) =>
      b.apparitions - a.apparitions ||
      (a.nom || a.adresse).localeCompare(b.nom || b.adresse, 'fr'),
  )
}

/** Une lettre au minimum avant de proposer, ou liste les plus fréquents si vide. */
export const MINIMUM_POUR_PROPOSER = 1

/** Au-delà, la liste cache le formulaire au lieu de l'aider. */
const PLAFOND = 8

/**
 * Fusionne deux carnets d'adresses en combinant les apparitions et meilleurs noms.
 */
export function fusionnerCarnets(
  premier: readonly Connaissance[],
  second: readonly Connaissance[],
): Connaissance[] {
  const map = new Map<string, Connaissance>()

  for (const c of [...premier, ...second]) {
    const cle = c.adresse.trim().toLowerCase()
    if (!cle) continue
    const deja = map.get(cle)
    if (deja) {
      deja.apparitions += c.apparitions
      deja.nom = meilleurNom(deja.nom, c.nom, cle)
    } else {
      map.set(cle, {
        adresse: cle,
        nom: meilleurNom('', c.nom, cle),
        apparitions: c.apparitions,
      })
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      b.apparitions - a.apparitions ||
      (a.nom || a.adresse).localeCompare(b.nom || b.adresse, 'fr'),
  )
}

/**
 * Les connaissances qui répondent à ce qu'on tape, les meilleures d'abord.
 *
 * Le nom et l'adresse sont interrogés tous les deux, et c'est la meilleure des
 * deux correspondances qui classe : on cherche parfois « dupont », parfois
 * « @exemple.fr ».
 *
 * `deja` retire ce qui est déjà retenu : reproposer une adresse qu'on vient
 * d'ajouter est le meilleur moyen de la mettre deux fois.
 */
export function proposer(
  carnet: readonly Connaissance[],
  saisie: string,
  deja: readonly string[] = [],
): Connaissance[] {
  const retenues = new Set(deja.map((a) => a.trim().toLowerCase()))
  const texte = saisie.trim()

  // Quand le champ est vide, propose les contacts les plus fréquents
  if (!texte) {
    return carnet.filter((c) => !retenues.has(c.adresse)).slice(0, PLAFOND)
  }

  const q = normaliser(texte)

  return carnet
    .filter((c) => !retenues.has(c.adresse))
    .map((c) => ({
      c,
      r: Math.min(rangDeCorrespondance(q, c.nom), rangDeCorrespondance(q, c.adresse)),
    }))
    .filter(({ r }) => r < HORS_JEU)
    // Le rang d'abord, la fréquence ensuite : une correspondance en début de nom
    // passe avant un familier qui ne correspond qu'au milieu de son adresse.
    .sort((a, b) => a.r - b.r || b.c.apparitions - a.c.apparitions)
    .slice(0, PLAFOND)
    .map(({ c }) => c)
}

/** Ce qu'on affiche pour une connaissance, sur une ligne de proposition. */
export function etiquette(c: Connaissance): string {
  return c.nom ? `${c.nom} <${c.adresse}>` : c.adresse
}

/** Le type du backend, pour les tests et les appelants. */
export type { Contact }
