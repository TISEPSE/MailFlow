/**
 * Ce que la fenêtre de rédaction affiche d'emblée.
 *
 * Fonctions pures, éprouvées ici : un transfert mal composé n'envoie pas un
 * message légèrement bancal, il envoie à quelqu'un d'autre le mauvais contenu.
 */
import type { CorpsMessage, MessageAffiche } from '../types/backend'
import { autresQueMoi } from './reponse'

/** Ce dont un message en cours d'écriture est fait. */
export interface Brouillon {
  destinataires: string
  copies: string
  sujet: string
  corps: string
  /** Le message auquel celui-ci répond, s'il y en a un. */
  reponse?: ReferenceReponse
}

/**
 * De quoi rattacher une réponse à sa conversation.
 *
 * Les trois valeurs vont ensemble : les deux premières font les en-têtes
 * `In-Reply-To` et `References`, la troisième dit à Gmail sous quelle
 * conversation ranger. Google exige leur cohérence, et refuse un `threadId`
 * que les en-têtes ne désignent pas.
 */
export interface ReferenceReponse {
  messageId: string
  references: string
  threadId: string
}

/** Une fenêtre de rédaction vierge. */
export function brouillonVierge(): Brouillon {
  return { destinataires: '', copies: '', sujet: '', corps: '' }
}

/** Un fichier que l'utilisateur a joint au message qu'il écrit. */
export interface PieceChoisie {
  nom: string
  typeMime: string
  /** Poids du fichier, en octets. */
  taille: number
  /** Contenu, en base64 standard. */
  contenu: string
}

/**
 * Poids total des fichiers joints au-delà duquel Gmail refuse le message.
 *
 * Miroir de `gmail::redaction::POIDS_MAX_PIECES`. Vérifié ici aussi parce que
 * c'est ici qu'on peut le dire au moment où le fichier est choisi, plutôt
 * qu'au moment d'envoyer.
 */
export const POIDS_MAX_PIECES = 25 * 1024 * 1024

/**
 * Ajoute des fichiers à ceux déjà joints.
 *
 * Rend la nouvelle liste et, s'il y en a, les noms des fichiers écartés parce
 * qu'ils feraient dépasser la limite. Les fichiers sont pris dans l'ordre :
 * un fichier trop lourd n'empêche pas le suivant, plus léger, de passer.
 *
 * Un fichier déjà joint — même nom, même poids — n'est pas ajouté deux fois :
 * le sélecteur du système laisse rechoisir le même, et l'envoyer en double
 * n'est jamais ce qu'on voulait.
 */
export function joindre<P extends PieceChoisie>(
  deja: readonly P[],
  nouvelles: readonly P[],
): { pieces: P[]; refusees: string[] } {
  const pieces = [...deja]
  const refusees: string[] = []
  let poids = deja.reduce((somme, p) => somme + p.taille, 0)

  for (const piece of nouvelles) {
    if (pieces.some((p) => p.nom === piece.nom && p.taille === piece.taille)) continue

    if (poids + piece.taille > POIDS_MAX_PIECES) {
      refusees.push(piece.nom)
      continue
    }

    pieces.push(piece)
    poids += piece.taille
  }

  return { pieces, refusees }
}

/**
 * Découpe une saisie d'adresses en adresses.
 *
 * Virgule, point-virgule et retour à la ligne séparent : ce sont les trois
 * façons dont on colle une liste depuis ailleurs. Les vides sont retirés, pour
 * qu'une virgule finale ne compte pas pour un destinataire.
 *
 * La validité, elle, se juge côté Rust — c'est lui qui compose le message.
 */
export function decouperAdresses(saisie: string): string[] {
  return saisie
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter(Boolean)
}

/**
 * Le texte d'un message, tel qu'on peut le citer dans un transfert.
 *
 * Le texte brut est préféré au HTML quand Gmail rend les deux : c'est déjà la
 * version que l'expéditeur destinait aux clients sans mise en forme, et elle se
 * relit toujours mieux qu'un HTML dépouillé à la main.
 *
 * À défaut, le HTML est réduit à son texte. Le résultat est approximatif — un
 * message bâti sur un tableau de mise en page s'y lit mal — mais il part dans
 * une fenêtre que l'utilisateur relit avant d'envoyer, et il vaut mieux qu'un
 * transfert vide.
 */
export function texteCitable(corps: CorpsMessage | null, extrait: string): string {
  if (corps?.texte?.trim()) return corps.texte
  if (corps?.html) return texteDuHtml(corps.html)
  return extrait
}

/** Balises dont le contenu n'est pas du texte à lire. */
const BALISES_MUETTES = /<(script|style|head)\b[\s\S]*?<\/\1>/gi

/** Balises qui marquent une fin de ligne quand on retire le balisage. */
const SAUTS = /<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi

/** Les entités qu'un message français contient réellement. */
const ENTITES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&eacute;': 'é',
  '&egrave;': 'è',
  '&agrave;': 'à',
  '&ccedil;': 'ç',
  '&ocirc;': 'ô',
  '&ecirc;': 'ê',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&rsquo;': '’',
}

/**
 * Réduit du HTML à son texte.
 *
 * Volontairement grossier : le HTML est déjà désinfecté côté Rust, il ne s'agit
 * pas de s'en défendre mais de le rendre lisible. Une bibliothèque complète
 * pour ce seul usage serait un poids sans contrepartie.
 */
function texteDuHtml(html: string): string {
  return (
    html
      .replace(BALISES_MUETTES, '')
      .replace(SAUTS, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITES[e.toLowerCase()] ?? e)
      // Trois lignes vides ou plus sont un artefact du balisage, jamais une
      // intention de l'expéditeur.
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  )
}

/** Une date d'en-tête, en français, ou une chaîne vide si elle manque. */
function dateLisible(date: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('fr-FR', {
        dateStyle: 'long',
        timeStyle: 'short',
      })
}

/**
 * Le brouillon d'un transfert : objet préfixé, corps cité sous ses en-têtes.
 *
 * Les destinataires restent vides — c'est la seule chose que le transfert ne
 * peut pas deviner, et c'est aussi le champ où une erreur coûte le plus cher.
 *
 * Les pièces jointes ne suivent pas, et la ligne qui le dit fait partie du
 * corps plutôt que d'un bandeau : elle part avec le message, donc le
 * destinataire sait lui aussi qu'il manque quelque chose. Un avertissement
 * affiché seulement chez l'expéditeur se lit une fois et s'oublie aussitôt.
 */
export function brouillonDeTransfert(
  message: MessageAffiche,
  corps: CorpsMessage | null,
): Brouillon {
  const entetes = [
    `De : ${message.nom ? `${message.nom} <${message.adresse}>` : message.adresse}`,
    dateLisible(message.date) && `Date : ${dateLisible(message.date)}`,
    `Objet : ${message.sujet || '(sans objet)'}`,
    message.destinataires.length > 0 &&
      `À : ${message.destinataires.map((d) => d.adresse).join(', ')}`,
  ].filter(Boolean)

  const pieces = corps?.pieces ?? []
  const mention =
    pieces.length > 0
      ? `\n\n[${pieces.length} fichier${pieces.length > 1 ? 's' : ''} joint${
          pieces.length > 1 ? 's' : ''
        } au message d'origine, non repris ici : ${pieces
          .map((p) => p.nom)
          .join(', ')}]`
      : ''

  return {
    destinataires: '',
    copies: '',
    sujet: prefixerTransfert(message.sujet),
    corps: [
      '',
      '',
      '---------- Message transféré ----------',
      ...entetes,
      '',
      texteCitable(corps, message.extrait),
    ].join('\n') + mention,
  }
}

/**
 * `Tr : ` devant l'objet, une seule fois.
 *
 * Miroir de `gmail::redaction::objet_de_transfert`. Écrit des deux côtés parce
 * que l'un compose le message et l'autre le montre avant l'envoi : ce que
 * l'utilisateur relit doit être ce qui partira.
 */
export function prefixerTransfert(objet: string): string {
  const propre = objet.trim()
  const bas = propre.toLowerCase()

  if (bas.startsWith('tr :') || bas.startsWith('tr:') || bas.startsWith('fwd:')) {
    return propre
  }

  return propre ? `Tr : ${propre}` : 'Tr : (sans objet)'
}

/**
 * Ce que l'utilisateur perdrait si la fenêtre se refermait maintenant.
 *
 * Compare au brouillon de départ plutôt qu'au vide, et la nuance décide du
 * confort de l'application : un transfert s'ouvre pré-rempli, donc un test
 * contre le vide réclamerait confirmation à quelqu'un qui n'a pas encore écrit
 * un mot. Un garde-fou qui se déclenche pour rien s'apprend à cliquer sans
 * lire, et ne garde plus rien.
 *
 * Les espaces ne comptent pas : une tabulation partie en trop n'est pas un
 * message à sauver.
 *
 * `cci` et les pièces jointes sont passés à part parce qu'ils vivent à côté du
 * brouillon dans la fenêtre de rédaction, et non dedans. Une pièce jointe suffit
 * à elle seule : le fichier a demandé d'être choisi, lu et téléversé.
 */
export function brouillonModifie(
  depart: Brouillon,
  courant: Brouillon,
  ajouts: { pieces: number; cci: string },
): boolean {
  if (ajouts.pieces > 0) return true
  if (ajouts.cci.trim()) return true

  // Les quatre champs de texte nommés un par un, et non `keyof Brouillon` : le
  // brouillon porte aussi la référence du fil, qui n'est pas de la saisie et ne
  // bouge jamais pendant la rédaction.
  const champs = ['destinataires', 'copies', 'sujet', 'corps'] as const

  return champs.some((champ) => depart[champ].trim() !== courant[champ].trim())
}

/**
 * Délai d'inaction après lequel le brouillon part chez Gmail, en millisecondes.
 *
 * # Pourquoi il dépend du poids des pièces jointes
 *
 * L'API des brouillons de Gmail n'a pas de mise à jour partielle : chaque
 * enregistrement renvoie le message entier, pièces jointes comprises. Une
 * sauvegarde toutes les trois secondes sur une pièce de vingt mégaoctets
 * saturerait le débit montant pendant toute la rédaction, et la frappe elle-même
 * finirait par s'en ressentir.
 *
 * Trois secondes sans fichier, ou avec des fichiers assez légers pour que leur
 * renvoi ne se remarque pas : on ne perd alors jamais plus que la dernière
 * phrase. Une minute au-delà — et ce qui protège vraiment la lettre dans ce cas
 * n'est pas la minuterie mais la question posée à la fermeture, qui enregistre
 * avant de fermer.
 */
export function delaiDEnregistrement(poidsDesPieces: number): number {
  const LEGER = 256 * 1024
  return poidsDesPieces > LEGER ? 60_000 : 3000
}

/**
 * `Re : ` devant l'objet, une seule fois.
 *
 * Miroir de `gmail::redaction::objet_de_reponse`, écrit des deux côtés pour la
 * raison habituelle : l'un compose le message, l'autre le montre avant l'envoi.
 *
 * Les trois formes rencontrées sont reconnues — la nôtre, l'anglo-saxonne, et
 * celle des clients qui n'espacent pas les deux-points — sans quoi l'objet
 * grossirait d'un « Re : » à chaque aller-retour.
 *
 * `Tr : ` n'en est pas un : répondre à un transfert donne « Re : Tr : … », et
 * c'est juste.
 */
export function prefixerReponse(objet: string): string {
  const propre = objet.trim()
  const bas = propre.toLowerCase()

  if (bas.startsWith('re :') || bas.startsWith('re:')) return propre

  return propre ? `Re : ${propre}` : 'Re : (sans objet)'
}

/**
 * Le brouillon d'une réponse : destinataire, objet préfixé, message cité.
 *
 * # Ce que cette fonction remplace
 *
 * Répondre ouvrait un `mailto:` dans le client du système, c'est-à-dire Gmail
 * dans un navigateur. MailFlow sait envoyer depuis qu'il a sa fenêtre de
 * rédaction : sortir de l'application pour écrire une réponse n'avait plus de
 * raison d'être.
 *
 * # Le corps
 *
 * Deux lignes vides d'abord, pour qu'on écrive au-dessus de ce qu'on cite. Un
 * brouillon qui s'ouvre au milieu du message d'origine oblige à remonter avant
 * d'écrire un mot.
 *
 * La citation est préfixée de `> `, comme partout ailleurs : c'est ce qui la
 * distingue de la réponse dans un client qui n'affiche pas de mise en forme.
 */
export function brouillonDeReponse(
  message: MessageAffiche,
  corps: CorpsMessage | null,
  moi: string | null,
  tous: boolean,
): Brouillon {
  const cite = texteCitable(corps, message.extrait)
    .split('\n')
    .map((ligne) => (ligne ? `> ${ligne}` : '>'))
    .join('\n')

  const quand = dateLisible(message.date)
  const qui = message.nom || message.adresse
  const attribution = quand ? `Le ${quand}, ${qui} a écrit :` : `${qui} a écrit :`

  return {
    destinataires: message.adresse,
    copies: tous ? autresQueMoi(message, moi).join(', ') : '',
    sujet: prefixerReponse(message.sujet),
    corps: ['', '', attribution, '', cite].join('\n'),
    reponse: referenceDe(corps),
  }
}

/**
 * La référence de fil d'un corps, ou rien s'il n'en porte pas.
 *
 * Un corps rangé par une version antérieure n'a ni `messageId` ni `threadId` :
 * mieux vaut une réponse hors fil qu'un identifiant inventé, que Google
 * refuserait. La commande de lecture redemande d'ailleurs ces corps-là à Gmail,
 * donc le cas ne dure que le temps d'une ouverture.
 */
function referenceDe(corps: CorpsMessage | null): ReferenceReponse | undefined {
  if (!corps?.messageId || !corps.threadId) return undefined

  return {
    messageId: corps.messageId,
    references: corps.references ?? '',
    threadId: corps.threadId,
  }
}

/**
 * Le brouillon qu'ouvre un lien `mailto:` cliqué dans un message.
 *
 * Un tel lien ouvrait le client de courrier du système, donc Gmail dans un
 * navigateur sur la plupart des machines. MailFlow sait écrire : c'est sa
 * fenêtre qui s'ouvre, pré-remplie de ce que le lien transporte.
 *
 * Les valeurs viennent d'un message écrit par un tiers. Elles ne sont que du
 * texte posé dans des champs que l'utilisateur relit avant d'envoyer, et Rust
 * revalide tout à l'envoi. L'objet est tout de même ramené sur une ligne : Rust
 * refuse un retour à la ligne dans un en-tête, et un lien forgé ne doit ni
 * bloquer l'envoi ni y glisser quoi que ce soit.
 */
export function brouillonDepuisMailto(href: string): Brouillon | null {
  const propre = href.trim()
  if (!/^mailto:/i.test(propre)) return null

  const [avant, requete = ''] = propre.slice('mailto:'.length).split('?', 2)
  const parametres = new URLSearchParams(requete)

  const destinataires = decouperAdresses(decoder(avant ?? '')).join(', ')
  if (!destinataires) return null

  const copies = decouperAdresses(parametres.get('cc') ?? '').join(', ')

  return {
    destinataires,
    copies,
    sujet: (parametres.get('subject') ?? '').replace(/[\r\n]+/g, ' ').trim(),
    corps: parametres.get('body') ?? '',
  }
}

/** Décode une portion d'URL sans jamais lever : un lien mal formé reste du texte. */
function decoder(portion: string): string {
  try {
    return decodeURIComponent(portion)
  } catch {
    return portion
  }
}
