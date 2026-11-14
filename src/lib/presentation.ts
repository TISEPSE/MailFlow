/**
 * Mise en forme partagée par les vues.
 *
 * Rien ici ne décide : ce sont des conversions d'affichage. Les couleurs de
 * catégorie et les pastilles sont cosmétiques, et le nom affiché d'un
 * expéditeur ne sert jamais à comparer une adresse — voir `normaliser_adresse`
 * côté Rust.
 */
import type { CategorieMessage, MessageAffiche } from '../types/backend'

/** Palette des pastilles, assignée par position dans la liste. */
const PALETTE: readonly (readonly [string, string])[] = [
  ['#DCE6FF', '#2455CC'],
  ['#E4DDFA', '#5B45B8'],
  ['#FDE3DC', '#B3502F'],
  ['#DDEFE2', '#25714A'],
  ['#FBE8C6', '#8A6414'],
  ['#E6E6EC', '#4A4A55'],
]

export function palette(index: number): readonly [string, string] {
  // `PALETTE` n'est jamais vide : l'index resultant existe toujours.
  return PALETTE[Math.abs(index) % PALETTE.length] ?? PALETTE[0]!
}

/** Ce qui porte une couleur dans la barre de navigation. */
export type Teintable = CategorieMessage | 'regle' | 'archive' | 'envoye'

/** Couleurs par catégorie : [texte, fond].
 *
 *  Le type couvre *toutes* les entrées de la barre : une entrée sans ton
 *  rendait `TONS[…]` indéfini, et lire `.clair` dessus faisait disparaître
 *  l'application entière derrière un écran blanc. */
export const TONS: Record<
  Teintable,
  { clair: readonly [string, string]; sombre: readonly [string, string] }
> = {
  humain: { clair: ['#4A4A55', '#E6E6EC'], sombre: ['#B9B9C4', '#2E2E38'] },
  publicite: { clair: ['#B3502F', '#FDE3DC'], sombre: ['#E9814F', '#3A2622'] },
  newsletter: { clair: ['#2455CC', '#DCE6FF'], sombre: ['#7FA5FF', '#23304F'] },
  formation: { clair: ['#25714A', '#DDEFE2'], sombre: ['#4FC98A', '#1F3229'] },
  regle: { clair: ['#5B45B8', '#E4DDFA'], sombre: ['#B08CFF', '#2C2540'] },
  // Un brun de papier : la table des archives est du rangement, pas de
  // l'urgence, et sa couleur ne doit rien réclamer.
  archive: { clair: ['#7A5A33', '#F2E7D8'], sombre: ['#D3AB73', '#332A20'] },
  // Un bleu-vert éteint : les messages envoyés sont une page qu'on relit, pas
  // une pile qui attend. Rien n'y est à faire, donc rien n'y doit clignoter.
  envoye: { clair: ['#2A6478', '#DCEDF3'], sombre: ['#73B6CC', '#1E2E35'] },
}

export function ton(quoi: Teintable, sombre: boolean): readonly [string, string] {
  // Le repli n'est pas une précaution de style : sans lui, une entrée de
  // navigation ajoutée sans ton fait planter le rendu de toute l'application,
  // et l'écran devient blanc sans le moindre message. Une couleur neutre vaut
  // mieux que ça.
  const teintes = TONS[quoi] ?? TONS.humain
  return sombre ? teintes.sombre : teintes.clair
}

export const LIBELLE_CATEGORIE: Record<CategorieMessage, string> = {
  humain: 'Direct',
  publicite: 'Publicité',
  newsletter: 'Newsletter',
  formation: 'Formation',
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const MOIS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

/** Minuit du jour d'une date, pour comparer des jours et non des instants. */
function jour(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Date de réception, en une forme aussi courte que possible.
 *
 * Un message de ce matin se lit à l'heure ; un message d'il y a trois mois se
 * lit à la date. Écrire les deux pareil rendrait la colonne illisible.
 */
export function heureCourte(iso: string | null, maintenant = new Date()): string {
  if (!iso) return ''

  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const ecart = (jour(maintenant) - jour(d)) / 86_400_000

  if (ecart === 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (ecart === 1) return 'hier'
  if (ecart > 1 && ecart < 7) return JOURS[d.getDay()] ?? ''

  const base = `${d.getDate()} ${MOIS[d.getMonth()] ?? ''}`
  // Sans l'année, « 12 déc. » d'une autre année serait pris pour un message
  // récent.
  return d.getFullYear() === maintenant.getFullYear()
    ? base
    : `${base} ${d.getFullYear()}`
}

/** Deux lettres pour une pastille, jamais rien. */
export function initiales(nom: string): string {
  const mots = nom
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)

  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0]!.slice(0, 2).toUpperCase()
  return (mots[0]![0]! + mots[1]![0]!).toUpperCase()
}

/** Domaine d'une adresse normalisée, clé de la table des logos. */
export function domaineDe(adresse: string): string {
  return adresse.split('@')[1] ?? ''
}

/**
 * Couleur propre a un compte, dans la vue melangee.
 *
 * Attribuee par rang dans la liste des comptes, et non par empreinte de
 * l'adresse : la palette ne compte que quatre teintes, et deux adresses
 * quelconques y tombent trop souvent sur la meme — ce qui reviendrait a ne
 * rien distinguer, precisement la ou la couleur est la seule marque.
 *
 * Le rang est stable tant que la liste ne bouge pas. Retirer un compte
 * redistribue les couleurs des suivants : rare, et sans consequence.
 */
export function couleurDuCompte(
  adresse: string,
  comptes: readonly string[],
): readonly [string, string] {
  const rang = comptes.findIndex((c) => c.toLowerCase() === adresse.toLowerCase())
  return palette(rang >= 0 ? rang : comptes.length)
}

/** Taille de fichier lisible : « 380 Ko », « 2,4 Mo ».
 *
 *  En unités de mille vingt-quatre, comme le système de fichiers les compte, et
 *  avec la virgule décimale française. */
export function poids(octets: number): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

/**
 * De quel côté du message on regarde.
 *
 * Les pages de courrier reçu montrent qui écrit ; la page des messages envoyés
 * montre à qui l'on a écrit. Sans cette distinction, la page des envoyés
 * affichait soixante fois son propre nom, et aucune ligne ne se distinguait
 * d'une autre.
 */
export type Cote = 'expediteur' | 'destinataire'

/** La personne qu'une ligne de liste nomme. */
export interface Interlocuteur {
  /** Nom affiché, ou l'adresse à défaut. Jamais vide. */
  nom: string
  /** Adresse normalisée, vide s'il n'y en a pas. */
  adresse: string
  /** Combien de personnes de plus figurent sur ce message. */
  autres: number
}

/**
 * Qui nommer pour ce message, vu du côté demandé.
 *
 * Les autres destinataires sont comptés et non nommés : une ligne de liste n'a
 * pas la place de six adresses, et la première suffit à reconnaître le message.
 */
export function interlocuteur(m: MessageAffiche, cote: Cote): Interlocuteur {
  if (cote === 'expediteur') {
    return { nom: m.nom || m.adresse, adresse: m.adresse, autres: 0 }
  }

  const premier = m.destinataires[0]
  const autres = Math.max(0, m.destinataires.length - 1) + m.copies.length

  // Gmail rend de tels messages : une lettre envoyée en copie cachée seule n'a
  // pas d'en-tête « To ». Une ligne vide se lirait comme un défaut d'affichage.
  if (!premier) return { nom: 'Destinataire inconnu', adresse: '', autres }

  return { nom: premier.nom || premier.adresse, adresse: premier.adresse, autres }
}


/**
 * Hauteur au-delà de laquelle le cadre du message cesse de grandir.
 *
 * Le cadre prend la hauteur de son contenu pour que la page défile d'un bloc.
 * Un corps hostile peut, par CSS seule, créer un élément de plusieurs millions
 * de pixels : le cadre grandissait d'autant et la page devenait impossible à
 * parcourir. Au-delà de ce plafond, c'est le cadre qui défile.
 */
export const HAUTEUR_CADRE_MAX = 50_000

/** La hauteur à donner au cadre, ou `null` si la mesure ne vaut rien. */
export function hauteurDuCadre(mesure: number): number | null {
  if (!Number.isFinite(mesure) || mesure <= 0) return null
  return Math.min(mesure, HAUTEUR_CADRE_MAX)
}
