/**
 * Recherche dans les messages deja charges.
 *
 * Sans reseau, et c'est le choix : les messages sont tous en memoire, corps
 * compris, et un filtrage local repond a la frappe. Un aller-retour chez Gmail
 * aurait cherche plus loin, mais avec une attente a chaque lettre tapee.
 */
import type { CorpsMessage, MessageAffiche } from '../types/backend'

/** Un message trouve, et pourquoi. */
export interface Trouvaille {
  message: MessageAffiche
  /** Ce qui a repondu a la recherche : sert a l'expliquer dans la liste. */
  ou: 'expediteur' | 'sujet' | 'contenu'
}

/**
 * Prepare une chaine pour la comparaison.
 *
 * Les accents sont otes : chercher « reunion » doit trouver « réunion », faute
 * de quoi la recherche punit qui tape vite. `NFD` separe la lettre de son
 * accent, et la plage `̀-ͯ` couvre les diacritiques combinants.
 */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Filtre les messages sur une requete.
 *
 * L'ordre des resultats suit celui des messages — le plus recent d'abord — et
 * non une note de pertinence : sur une boite de soixante messages, la date est
 * un meilleur guide qu'un score que personne ne peut prevoir.
 */
/**
 * À quel point une chaîne répond à ce qu'on a tapé.
 *
 * Trois rangs, du plus sûr au plus douteux, et [`HORS_JEU`] pour « pas du
 * tout ». Le classement compte autant que le filtrage : une liste de dix
 * propositions dans le désordre oblige à la lire en entier, c'est-à-dire à
 * faire soi-même le travail qu'elle prétend éviter.
 *
 * - `0` — la chaîne **commence** par ce qu'on a tapé.
 * - `1` — un de ses mots commence par ce qu'on a tapé. « rennes » pour « re »,
 *   mais pas « no-reply ».
 * - `2` — ça se trouve quelque part au milieu.
 *
 * `requete` est attendue déjà normalisée : la fonction est appelée une fois par
 * candidat, et normaliser la même requête à chaque tour serait du travail
 * refait pour rien.
 *
 * Écrite ici plutôt que dans un champ de saisie : deux champs s'en servent —
 * l'adresse d'une règle et les destinataires d'un message — et deux copies
 * auraient fini par se comporter différemment sans que personne ne le veuille.
 */
export const HORS_JEU = 99

export function rangDeCorrespondance(requete: string, texte: string): number {
  const t = normaliser(texte)
  if (t.startsWith(requete)) return 0

  const echappee = requete.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`(^|[\\s.@_-])${echappee}`).test(t)) return 1

  return t.includes(requete) ? 2 : HORS_JEU
}

export function chercher(
  messages: readonly MessageAffiche[],
  requete: string,
  corps: ReadonlyMap<string, CorpsMessage>,
): Trouvaille[] {
  const q = normaliser(requete.trim())
  if (!q) return []

  const trouvailles: Trouvaille[] = []

  for (const message of messages) {
    if (
      normaliser(message.nom).includes(q) ||
      normaliser(message.adresse).includes(q)
    ) {
      trouvailles.push({ message, ou: 'expediteur' })
      continue
    }

    if (normaliser(message.sujet).includes(q)) {
      trouvailles.push({ message, ou: 'sujet' })
      continue
    }

    // Le corps en dernier : c'est la correspondance la moins parlante, et la
    // plus couteuse a expliquer dans la liste.
    const contenu = corps.get(message.id)
    const texte = [message.extrait, contenu?.texte ?? '', contenu?.html ?? ''].join(' ')

    if (normaliser(texte).includes(q)) {
      trouvailles.push({ message, ou: 'contenu' })
    }
  }

  return trouvailles
}
