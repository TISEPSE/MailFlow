/**
 * Mise en forme partagée par les vues.
 *
 * Rien ici ne décide : ce sont des conversions d'affichage. Les couleurs de
 * catégorie et les pastilles sont cosmétiques, et le nom affiché d'un
 * expéditeur ne sert jamais à comparer une adresse — voir `normaliser_adresse`
 * côté Rust.
 */
import type { CategorieMessage } from '../types/backend'

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
export type Teintable = CategorieMessage | 'regle'

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
