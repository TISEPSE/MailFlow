/**
 * Le carnet d'adresses, et ce qu'on en propose à la frappe.
 *
 * # D'où il vient
 *
 * De Google, et de rien d'autre : c'est le carnet que l'utilisateur voit dans
 * Gmail, plus les adresses que Google retient de lui-même quand on écrit à
 * quelqu'un. Le backend le relève et le range ; ce module ne fait que le
 * traverser.
 *
 * Il se déduisait autrefois des messages sous la main, expéditeurs compris.
 * C'était gratuit en autorisations, mais toute personne ayant écrit une fois
 * entrait dans les suggestions — un robot d'expédition proposé comme
 * destinataire d'un message qu'on rédige.
 *
 * # Comment il classe
 *
 * Taper une adresse de mémoire est le moyen le plus sûr de se tromper d'une
 * lettre, et un message parti à côté ne revient pas. Ce qui aide vraiment,
 * c'est que la bonne proposition soit **en premier** : une liste de huit noms
 * dans le désordre oblige à la lire en entier. D'où le classement par qualité
 * de correspondance, puis, à égalité, par origine — quelqu'un qu'on a
 * délibérément enregistré passe avant une adresse que Google a retenue seule.
 */
import { HORS_JEU, normaliser, rangDeCorrespondance } from './recherche'
import type { Connaissance, Contact } from '../types/backend'

/** En dessous, la liste serait toute la boîte : on ne propose rien. */
export const MINIMUM_POUR_PROPOSER = 1

/** Au-delà, la liste cesse d'aider et commence à cacher le champ de saisie. */
const PLAFOND = 8

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
  const texte = saisie.trim()
  if (texte.length < MINIMUM_POUR_PROPOSER) {
    return []
  }

  const retenues = new Set(deja.map((a) => a.trim().toLowerCase()))
  const q = normaliser(texte)

  return (
    carnet
      .filter((c) => !retenues.has(c.adresse))
      .map((c) => ({
        c,
        r: Math.min(
          rangDeCorrespondance(q, c.nom),
          rangDeCorrespondance(q, c.adresse),
        ),
      }))
      .filter(({ r }) => r < HORS_JEU)
      // Le rang d'abord, l'origine ensuite : une correspondance en début de nom
      // passe avant un contact enregistré qui ne correspond qu'au milieu de son
      // adresse.
      .sort(
        (a, b) =>
          a.r - b.r ||
          Number(a.c.origine !== 'carnet') - Number(b.c.origine !== 'carnet'),
      )
      .slice(0, PLAFOND)
      .map(({ c }) => c)
  )
}

/** Ce qu'on affiche pour une connaissance, sur une ligne de proposition. */
export function etiquette(c: Connaissance): string {
  return c.nom ? `${c.nom} <${c.adresse}>` : c.adresse
}

/** Le type du backend, pour les tests et les appelants. */
export type { Connaissance, Contact }
