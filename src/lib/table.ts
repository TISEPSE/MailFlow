/**
 * La géométrie de la table des archives, sans React ni DOM.
 *
 * Tout ce qui décide — où une tuile atterrit, ce qui forme un tas, comment
 * s'aligne une table en désordre — vit ici, en fonctions pures. C'est la partie
 * où une erreur se voit tout de suite à l'écran mais se corrige difficilement
 * en la regardant : mieux vaut pouvoir l'éprouver sans souris.
 */

import type { MessageAffiche, Position, Tableau } from '../types/backend'

/** Taille d'une tuile sur la table, en pixels. */
export const TUILE = { largeur: 208, hauteur: 96 } as const

/** Taille d'un tas replié. Plus court qu'une tuile : il ne montre qu'un titre. */
export const TAS = { largeur: 208, hauteur: 76 } as const

/**
 * Étendue de la table.
 *
 * Finie, et c'est délibéré : sur une surface sans bord, on perd ses affaires.
 * Plus grande que l'écran pour qu'on puisse étaler, assez petite pour qu'un
 * défilement d'un bout à l'autre reste une seconde d'attention.
 */
export const SURFACE = { largeur: 2400, hauteur: 1600 } as const

/** Marge intérieure, pour qu'une tuile ne colle jamais au bord. */
const MARGE = 24

/**
 * Distance en deçà de laquelle une tuile lâchée sur une autre forme un tas.
 *
 * Mesurée entre les coins supérieurs gauche, et volontairement inférieure à la
 * largeur d'une tuile : au-delà, deux tuiles simplement voisines se colleraient
 * l'une à l'autre, et poser proprement deviendrait impossible.
 */
export const RAYON_D_ACCROCHE = 96

/** Garde une position dans les limites de la table. */
export function borner(p: Position, largeur: number, hauteur: number): Position {
  return {
    x: Math.min(Math.max(p.x, MARGE), SURFACE.largeur - largeur - MARGE),
    y: Math.min(Math.max(p.y, MARGE), SURFACE.hauteur - hauteur - MARGE),
  }
}

/** Distance entre deux points. */
export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Un objet posé sur la table : une tuile seule, ou un tas. */
export interface Pose {
  id: string
  position: Position
}

/**
 * Ce qui se trouve sous une tuile qu'on vient de lâcher, s'il y a quelque chose.
 *
 * Rend le plus proche, et non le premier trouvé : lâcher entre deux objets doit
 * donner un résultat prévisible, et « le plus proche » est la seule règle qu'un
 * œil puisse vérifier.
 */
export function cibleSousLaTuile(
  lachee: Position,
  candidats: Pose[],
  soiMeme: string,
): Pose | null {
  let meilleure: Pose | null = null
  let meilleureDistance = RAYON_D_ACCROCHE

  for (const candidat of candidats) {
    if (candidat.id === soiMeme) continue

    const d = distance(lachee, candidat.position)
    if (d < meilleureDistance) {
      meilleure = candidat
      meilleureDistance = d
    }
  }

  return meilleure
}

/**
 * Une position libre pour un objet qui n'en a pas encore.
 *
 * Balayage en grille, de gauche à droite puis de haut en bas, en évitant ce qui
 * est déjà posé. Un placement au hasard donnerait parfois deux tuiles
 * superposées — donc un tas que personne n'a fait.
 */
export function placeLibre(occupees: Position[], rang: number): Position {
  const pas = { x: TUILE.largeur + 20, y: TUILE.hauteur + 20 }
  const colonnes = Math.max(1, Math.floor((SURFACE.largeur - MARGE * 2) / pas.x))

  // On part du rang demandé et on avance jusqu'à trouver un creux : sans cette
  // avance, deux objets arrivés dans le même trou s'y empileraient.
  for (let essai = rang; essai < rang + colonnes * 40; essai++) {
    const candidate = {
      x: MARGE + (essai % colonnes) * pas.x,
      y: MARGE + Math.floor(essai / colonnes) * pas.y,
    }

    const bornee = borner(candidate, TUILE.largeur, TUILE.hauteur)
    const libre = occupees.every((p) => distance(p, bornee) >= RAYON_D_ACCROCHE)
    if (libre) return bornee
  }

  return borner({ x: MARGE, y: MARGE }, TUILE.largeur, TUILE.hauteur)
}

/**
 * Réaligne tout en grille, tas d'abord.
 *
 * Le bouton « Tout ranger ». Les tas passent devant parce qu'ils portent
 * plusieurs messages : les retrouver compte davantage qu'une tuile isolée.
 */
export function aligner(tas: string[], messages: string[]): Tableau {
  const range: Tableau = { tas: {}, messages: {} }
  const posees: Position[] = []
  let rang = 0

  for (const id of tas) {
    const place = placeLibre(posees, rang++)
    range.tas[id] = place
    posees.push(place)
  }

  for (const id of messages) {
    const place = placeLibre(posees, rang++)
    range.messages[id] = place
    posees.push(place)
  }

  return range
}

/**
 * Complète une disposition pour tout ce qui n'y figure pas encore.
 *
 * Un message relevé depuis la dernière ouverture n'a pas de position ; sans
 * cela il s'afficherait au coin supérieur gauche, sous tous les autres. Ce qui
 * a déjà une place la garde : rouvrir la page ne redistribue pas la table.
 */
export function completer(
  tableau: Tableau,
  tas: string[],
  messages: string[],
): Tableau {
  const complet: Tableau = { tas: { ...tableau.tas }, messages: { ...tableau.messages } }

  const posees: Position[] = [
    ...Object.values(complet.tas),
    ...Object.values(complet.messages),
  ]

  let rang = 0

  for (const id of tas) {
    if (complet.tas[id]) continue
    const place = placeLibre(posees, rang++)
    complet.tas[id] = place
    posees.push(place)
  }

  for (const id of messages) {
    if (complet.messages[id]) continue
    const place = placeLibre(posees, rang++)
    complet.messages[id] = place
    posees.push(place)
  }

  return complet
}

/**
 * Répartit les archives entre les tas et ce qui reste seul sur la table.
 *
 * Un message peut porter plusieurs libellés — Gmail le permet. Il est alors
 * montré dans **chaque** tas correspondant, plutôt que dans le premier : le
 * chercher dans « Factures » et ne pas l'y trouver parce qu'il porte aussi
 * « 2026 » serait la pire des surprises.
 */
export function repartir(
  archives: MessageAffiche[],
  libellesConnus: Set<string>,
): { parTas: Map<string, MessageAffiche[]>; seuls: MessageAffiche[] } {
  const parTas = new Map<string, MessageAffiche[]>()
  const seuls: MessageAffiche[] = []

  for (const message of archives) {
    // Un libellé que Gmail ne liste plus — supprimé ailleurs entre deux
    // relevés — ne doit pas faire apparaître un tas sans nom.
    const siens = message.libelles.filter((l) => libellesConnus.has(l))

    if (siens.length === 0) {
      seuls.push(message)
      continue
    }

    for (const libelle of siens) {
      const tas = parTas.get(libelle)
      if (tas) tas.push(message)
      else parTas.set(libelle, [message])
    }
  }

  return { parTas, seuls }
}
