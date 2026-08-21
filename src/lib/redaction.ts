/**
 * Ce que la fenêtre de rédaction affiche d'emblée.
 *
 * Fonctions pures, éprouvées ici : un transfert mal composé n'envoie pas un
 * message légèrement bancal, il envoie à quelqu'un d'autre le mauvais contenu.
 */
import type { CorpsMessage, MessageAffiche } from '../types/backend'

/** Ce dont un message en cours d'écriture est fait. */
export interface Brouillon {
  destinataires: string
  copies: string
  sujet: string
  corps: string
}

/** Une fenêtre de rédaction vierge. */
export function brouillonVierge(): Brouillon {
  return { destinataires: '', copies: '', sujet: '', corps: '' }
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
