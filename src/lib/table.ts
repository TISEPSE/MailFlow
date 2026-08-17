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

/** Encombrement d'un objet posé. */
export interface Taille {
  largeur: number
  hauteur: number
}

/** Le point qui décide : le centre de ce qu'on tient. */
export function centre(p: Position, taille: Taille): Position {
  return { x: p.x + taille.largeur / 2, y: p.y + taille.hauteur / 2 }
}

/** Vrai quand un point tombe à l'intérieur d'un objet posé. */
export function contient(coin: Position, taille: Taille, point: Position): boolean {
  return (
    point.x >= coin.x &&
    point.x <= coin.x + taille.largeur &&
    point.y >= coin.y &&
    point.y <= coin.y + taille.hauteur
  )
}

/**
 * Vrai quand deux objets posés se recouvrent, même d'un pixel.
 *
 * Sert au placement automatique, où deux objets superposés seraient lus comme
 * un tas que personne n'a fait.
 */
export function seChevauchent(
  a: Position,
  tailleA: Taille,
  b: Position,
  tailleB: Taille,
): boolean {
  return (
    a.x < b.x + tailleB.largeur &&
    b.x < a.x + tailleA.largeur &&
    a.y < b.y + tailleB.hauteur &&
    b.y < a.y + tailleA.hauteur
  )
}

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
  /** Un tas est plus court qu'une tuile : il ne montre qu'un titre. */
  taille: Taille
}

/**
 * Ce qui se trouve sous une tuile qu'on vient de lâcher, s'il y a quelque chose.
 *
 * # La règle, et pourquoi ce n'est plus une distance
 *
 * Un tas se forme quand le **centre** de la tuile lâchée tombe **à l'intérieur**
 * d'un autre objet. Autrement dit : il faut couvrir sa cible.
 *
 * La règle précédente comparait les coins supérieurs gauche à un rayon de
 * 96 pixels. Comme une tuile fait justement 96 pixels de haut, **deux tuiles ne
 * pouvaient pas se poser l'une sous l'autre** : elles fusionnaient. La table
 * paraissait alors magnétique, comme si les places étaient décidées d'avance —
 * ce qui était le cas, sans que rien ne le dise.
 *
 * Un recouvrement se voit ; un rayon invisible ne se voit pas. C'est la seule
 * raison de ce changement : une règle qu'un œil peut vérifier avant de lâcher.
 *
 * Rend le plus proche quand plusieurs conviennent — lâcher au croisement de deux
 * objets doit rester prévisible.
 */
export function cibleSousLaTuile(
  lachee: Position,
  candidats: Pose[],
  soiMeme: string,
  taille: Taille = TUILE,
): Pose | null {
  const point = centre(lachee, taille)

  let meilleure: Pose | null = null
  let meilleureDistance = Infinity

  for (const candidat of candidats) {
    if (candidat.id === soiMeme) continue
    if (!contient(candidat.position, candidat.taille, point)) continue

    const d = distance(point, centre(candidat.position, candidat.taille))
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
    // Un chevauchement, et non plus un rayon : le rayon écartait les objets
    // bien au-delà de ce qu'il fallait pour qu'ils ne se cachent pas, et
    // étalait la disposition initiale sur toute la table.
    const libre = occupees.every((p) => !seChevauchent(p, TUILE, bornee, TUILE))
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
 * Les archives du compte qu'on regarde, et d'aucun autre.
 *
 * # Ce qu'elle protège
 *
 * Le changement de compte vide déjà l'état, mais la liste des archives avait
 * justement été oubliée dans cette remise à zéro pendant des semaines, sans que
 * rien ne le signale : on voyait les archives d'un compte sous l'identité de
 * l'autre. Un filtre au moment de l'affichage rend l'oubli sans conséquence —
 * chaque message porte le compte qui l'a reçu, il suffit de le lire.
 *
 * # Ce qui l'a rendue nuisible
 *
 * Écrite en ligne dans `App`, elle recevait `compteAffiche` — un état qui ne
 * dit **pas** quel compte on regarde, mais si l'on a basculé à la main. Il vaut
 * `null` au démarrage, la comparaison ne gardait donc rien, et la table
 * paraissait vide alors que le message archivé était bien là.
 *
 * D'où cette fonction, et son test : un compte inconnu **ne vide pas la
 * table**. Il ne peut rien mélanger — on n'en connaît qu'un — et cacher ce que
 * l'utilisateur vient d'archiver est un défaut bien pire que celui qu'on
 * cherchait à prévenir.
 */
export function archivesDuCompte(
  archives: readonly MessageAffiche[],
  compte: string | null,
): MessageAffiche[] {
  if (!compte) return [...archives]
  return archives.filter((m) => m.compte === compte)
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
    //
    // Le repli sur une liste vide n'est pas une politesse : le champ est
    // arrivé après coup, et un relevé rangé par une version antérieure n'en a
    // pas. Lire `.filter` sur `undefined` lève, et une exception levée pendant
    // un rendu démonte l'arbre entier — la fenêtre devient blanche, sans un
    // mot. Le type promet un tableau ; le disque, lui, ne promet rien.
    const siens = (message.libelles ?? []).filter((l) => libellesConnus.has(l))

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
