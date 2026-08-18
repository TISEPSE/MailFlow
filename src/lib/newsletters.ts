/**
 * Regroupement des newsletters par expéditeur.
 *
 * Une publication écrit rarement depuis une seule adresse : Le Monde envoie
 * depuis `news@`, `alerte@`, `matinale@`. Vues à plat, ces adresses font trois
 * cartes pour un seul journal, et la page se remplit de doublons apparents.
 * Elles sont donc rassemblées sous l'organisation qui les émet.
 *
 * # Pourquoi ici et non côté Rust
 *
 * Ce fichier ne contient aucune logique sensible : il réordonne des messages
 * déjà relevés, déjà classés et déjà désinfectés par le backend. Il doit en
 * revanche réagir à l'instant où l'utilisateur archive ou supprime une
 * newsletter — un aller-retour vers Rust ferait clignoter la page pour un
 * calcul qui tient en quelques microsecondes.
 *
 * Le résumé par un modèle de langage, lui, reste côté Rust : c'est lui qui
 * parle au réseau, et c'est lui qui décide ce qui a le droit d'en sortir.
 */

import type { MessageAffiche, RapportResumes, Resume } from '../types/backend'

/**
 * Fournisseurs de courrier grand public.
 *
 * Deux inconnus qui écrivent depuis `gmail.com` n'ont rien à voir l'un avec
 * l'autre. Sur ces domaines-là, le regroupement se fait donc sur l'adresse
 * entière — sans quoi une carte « gmail.com » avalerait des expéditeurs sans
 * aucun rapport, ce qui est exactement l'inverse du but recherché.
 */
const FOURNISSEURS_GENERIQUES = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.fr',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'sfr.fr',
  'laposte.net',
  'bbox.fr',
])

/**
 * Segments qui ne sont jamais le nom d'une organisation.
 *
 * `exemple.co.uk` doit se réduire à `exemple.co.uk` et non à `co.uk`, qui
 * regrouperait tout le Royaume-Uni sous une seule carte.
 */
const SUFFIXES_COMPOSES = new Set(['co', 'com', 'net', 'org', 'gouv', 'asso', 'edu', 'ac'])

/**
 * Ce qui identifie l'émetteur d'une newsletter.
 *
 * Le domaine d'organisation en temps normal, pour que `news@lemonde.fr` et
 * `alerte@news.lemonde.fr` se retrouvent ensemble ; l'adresse entière sur les
 * fournisseurs grand public, où le domaine ne dit rien de qui écrit.
 */
export function identiteExpediteur(adresse: string): string {
  const propre = adresse.trim().toLowerCase()
  const coupure = propre.lastIndexOf('@')
  if (coupure < 0) return propre

  const domaine = propre.slice(coupure + 1)
  if (!domaine) return propre
  if (FOURNISSEURS_GENERIQUES.has(domaine)) return propre

  const parts = domaine.split('.').filter(Boolean)
  if (parts.length <= 2) return domaine

  // `news.lemonde.fr` → `lemonde.fr`, mais `boutique.exemple.co.uk` →
  // `exemple.co.uk` : l'avant-dernier segment trahit un suffixe en deux temps.
  const gardes = SUFFIXES_COMPOSES.has(parts.at(-2) ?? '') ? 3 : 2
  return parts.slice(-gardes).join('.')
}

/**
 * Motifs d'édition qu'on retire du sujet.
 *
 * Une newsletter numérote et date ses envois. « Édition du 12 mars » occupe la
 * place de ce que le numéro raconte, et la même mention revient sur chaque
 * carte du groupe — elle n'apprend donc rien qui distingue un numéro d'un
 * autre. La date, elle, est déjà à droite de la carte.
 */
const MOIS =
  'janvier|f(?:é|e)vrier|mars|avril|mai|juin|juillet|ao(?:û|u)t|septembre|octobre|novembre|d(?:é|e)cembre'

/**
 * Une date écrite comme les newsletters l'écrivent : « 12 mars », « 1er
 * février 2026 », « 12/03 », « 12.03.2026 ».
 *
 * Reconnue explicitement plutôt qu'approchée par « les deux mots suivants » :
 * une consommation aveugle mangeait le début du vrai sujet dès que la mention
 * ne portait pas de date — « Édition du jour : les retraites » y perdait
 * « les ».
 */
const DATE = `(?:\\d{1,2}(?:er)?\\s+(?:${MOIS})(?:\\s+\\d{2,4})?|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?)`

/** Début de sujet ou séparateur — remplace `\b`, aveugle aux accents. */
const AVANT = '(?:^|[\\s\\-–—:|·])'

const MOTIFS_D_EDITION: RegExp[] = [
  // Étiquettes en tête : [Newsletter], (Infolettre), 【…】
  /^\s*[[({【][^\])}】]{0,40}[\])}】]\s*/u,
  // « Édition du 12 mars », « Newsletter du 12/03 », « La lettre du 3 février »
  new RegExp(`${AVANT}(?:é|e)dition\\s+(?:du\\s+)?${DATE}`, 'giu'),
  new RegExp(`${AVANT}(?:newsletter|infolettre|lettre)\\s+d[eu]\\s+${DATE}`, 'giu'),
  // Numérotation : n°42, N° 42, #42
  /[nN]\s*[°º]\s*\d+/gu,
  /(?:^|\s)#\d+\b/gu,
  // Date posée en fin de sujet, souvent derrière un tiret.
  new RegExp(`[\\s\\-–—:|·]*${DATE}\\s*$`, 'u'),
]

/** Ponctuation de liaison laissée en bord de sujet après un retrait. */
const BORDS_INUTILES = /^[\s\-–—:|·,.]+|[\s\-–—:|·,]+$/gu

/**
 * Ramène un sujet à ce qu'il raconte vraiment.
 *
 * Rend une chaîne vide plutôt qu'un résidu de ponctuation quand il ne reste
 * rien : l'appelant sait alors qu'il n'a pas de titre à afficher, au lieu de
 * poser un tiret orphelin sur la carte.
 */
export function resserrerSujet(sujet: string): string {
  let texte = sujet
  for (const motif of MOTIFS_D_EDITION) texte = texte.replace(motif, ' ')

  texte = texte.replace(/\s+/gu, ' ').replace(BORDS_INUTILES, '')

  // Un sujet entièrement fait de mentions d'édition perd tout : on rend alors
  // l'original nettoyé de ses seuls espaces, qui vaut mieux que rien.
  return texte || sujet.trim()
}

/**
 * Une liste dont le premier élément existe, garanti par le type.
 *
 * Un groupe naît toujours d'un message : il ne peut pas être vide. Le dire au
 * compilateur évite d'avoir à mentir avec un `!` à chaque lecture du numéro le
 * plus récent — un `!` qui, le jour où l'invariant tomberait, laisserait la
 * page s'effondrer en silence.
 */
type ListeNonVide<T> = [T, ...T[]]

/** Un émetteur et tous ses numéros, du plus récent au plus ancien. */
export interface GroupeNewsletters {
  /** Identité de l'émetteur — sert de clé React, jamais affichée. */
  cle: string
  /** Nom et adresse repris du numéro le plus récent. */
  nom: string
  adresse: string
  /** Trié du plus récent au plus ancien. */
  messages: ListeNonVide<MessageAffiche>
}

/** Date d'un message en millisecondes, `0` quand elle manque ou ne se lit pas. */
function instant(m: MessageAffiche): number {
  if (!m.date) return 0
  const t = Date.parse(m.date)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Rassemble les newsletters par émetteur.
 *
 * L'ordre des groupes suit celui de leur numéro le plus récent : la page
 * s'ouvre sur ce qui vient d'arriver, comme n'importe quelle boîte.
 */
export function grouperNewsletters(
  messages: readonly MessageAffiche[],
): GroupeNewsletters[] {
  const par_cle = new Map<string, ListeNonVide<MessageAffiche>>()

  for (const m of messages) {
    const cle = identiteExpediteur(m.adresse)
    const deja = par_cle.get(cle)
    if (deja) deja.push(m)
    else par_cle.set(cle, [m])
  }

  const groupes: GroupeNewsletters[] = []
  for (const [cle, membres] of par_cle) {
    membres.sort((a, b) => instant(b) - instant(a))
    // Le nom du plus récent : une publication qui change d'intitulé doit
    // s'afficher sous le dernier qu'elle s'est donné.
    const tete = membres[0]
    groupes.push({ cle, nom: tete.nom, adresse: tete.adresse, messages: membres })
  }

  groupes.sort((a, b) => instant(b.messages[0]) - instant(a.messages[0]))
  return groupes
}

/**
 * Ce qui s'écrit sous le nom de l'émetteur, à défaut de résumé par un modèle.
 *
 * Composé sur la machine, sans réseau et sans attente : le sujet du numéro,
 * resserré. Quand un modèle sera branché, sa phrase prendra exactement cette
 * place — même emplacement, même hauteur — de sorte que la page ne bouge pas
 * d'un pixel selon qu'il est là ou non.
 *
 * Prend un message et non un groupe : la carte montre le numéro qu'on a
 * choisi dans la pile, pas forcément le plus récent.
 */
export function ligneLocale(message: MessageAffiche): string {
  return resserrerSujet(message.sujet) || '(sans objet)'
}

/** « 4 mails », ou une chaîne vide quand il n'y en a qu'un à montrer.
 *
 *  « Mails » et non « numéros » : le mot venait du vocabulaire de la presse,
 *  et il fallait le traduire mentalement à chaque lecture. Ce qui est empilé
 *  sur cette carte, ce sont des mails. */
export function decompteDuGroupe(groupe: GroupeNewsletters): string {
  const n = groupe.messages.length
  return n > 1 ? `${n} mails` : ''
}

/**
 * Deux étiquettes désignent-elles la même chose ?
 *
 * Le modèle écrit « Économie » un jour, « economie » le lendemain, « ÉCONOMIE »
 * quand il est en verve. Comparées telles quelles, ces trois-là feraient trois
 * pastilles pour un seul sujet, et cliquer sur l'une ne retiendrait pas les
 * mails classés sous les autres.
 *
 * La normalisation retire les accents plutôt que de les traduire un à un :
 * `normalize('NFD')` décompose « é » en « e » suivi d'un accent, qu'on efface.
 */
export function memeEtiquette(a: string, b: string): boolean {
  return normaliserEtiquette(a) === normaliserEtiquette(b)
}

function normaliserEtiquette(e: string): string {
  return e
    .trim()
    .replace(/^#/u, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Les étiquettes portées par les résumés d'un groupe. */
function etiquettesDuGroupe(
  groupe: GroupeNewsletters,
  resumes: Record<string, Resume> | undefined,
): string[] {
  if (!resumes) return []
  return groupe.messages.flatMap((m) => resumes[m.id]?.hashtags ?? [])
}

/**
 * Ne garde que les publications portant l'étiquette choisie.
 *
 * `null` ne filtre rien : c'est « Tous », et non « aucune étiquette ».
 *
 * Une publication est retenue dès que **l'un** de ses numéros porte
 * l'étiquette. La carte montre la pile entière : la retirer parce que le numéro
 * affiché n'a pas le bon mot cacherait un mail qui, lui, l'a.
 */
export function filtrerParEtiquette(
  groupes: GroupeNewsletters[],
  resumes: Record<string, Resume> | undefined,
  etiquette: string | null,
): GroupeNewsletters[] {
  if (!etiquette) return groupes
  return groupes.filter((g) =>
    etiquettesDuGroupe(g, resumes).some((e) => memeEtiquette(e, etiquette)),
  )
}

/**
 * Les étiquettes qu'il vaut la peine de proposer.
 *
 * Celles que la synthèse a rendues, moins celles qui ne retiendraient rien. Une
 * pastille qui vide la page quand on la touche se lit comme une panne : le
 * modèle a très bien pu tirer « Climat » d'un mail qu'on vient d'archiver.
 *
 * Les doublons tombent au passage — voir [`memeEtiquette`] — et la première
 * graphie rencontrée l'emporte, puisque c'est celle que la synthèse affiche.
 */
export function etiquettesUtiles(
  proposees: readonly string[],
  groupes: GroupeNewsletters[],
  resumes: Record<string, Resume> | undefined,
): string[] {
  const retenues: string[] = []

  for (const etiquette of proposees) {
    if (retenues.some((deja) => memeEtiquette(deja, etiquette))) continue
    if (!filtrerParEtiquette(groupes, resumes, etiquette).length) continue
    retenues.push(etiquette.replace(/^#/u, '').trim())
  }

  return retenues
}

/**
 * Ce que le bouton « Analyser » annonce, et s'il faut le dire en rouge.
 *
 * # Pourquoi cette fonction existe
 *
 * Le message était déduit d'une soustraction : « combien de résumés en plus
 * qu'avant ». Vingt-huit publications déjà résumées et deux muettes donnaient
 * zéro de plus — et l'application annonçait « aucun résumé n'a pu être
 * produit » devant vingt-huit résumés en place. Le calcul ne pouvait pas
 * distinguer « rien à faire » de « rien n'a marché ».
 *
 * # Ce qu'elle dit depuis la file d'attente
 *
 * Elle ne raconte plus ce qui est fait, mais ce qui est **engagé** : au moment
 * du clic, rien n'est encore parti. Les résumés arrivent ensuite, un à un, et
 * c'est le bandeau qui suit leur avancée. La phrase doit donc promettre — et
 * surtout dire que personne n'a rien à recliquer, ce qui était toute la
 * demande.
 *
 * Rien ne mérite du rouge ici : un quota atteint n'est pas une panne, c'est une
 * attente, et la file s'en charge.
 */
export function phraseDuRapport(r: RapportResumes): [texte: string, erreur: boolean] {
  if (r.total === 0) return ['Aucune publication à analyser.', false]

  const accord = (n: number, singulier: string, pluriel: string) =>
    `${n} ${n > 1 ? pluriel : singulier}`

  if (r.enFile > 0) {
    return [
      `${accord(r.enFile, 'publication mise en file', 'publications mises en file')} — ` +
        'elles se résument toutes seules, même si le quota impose une pause.',
      false,
    ]
  }

  // Rien n'est parti, et c'est le cas ordinaire d'un second clic : tout était
  // déjà fait. Le dire posément vaut mieux que de se taire — un bouton sans
  // retour donne à croire qu'il est cassé.
  return [
    r.disponibles >= r.total
      ? `${accord(r.total, 'publication est déjà résumée', 'publications sont déjà résumées')}.`
      : 'Rien de neuf à résumer.',
    false,
  ]
}
