/**
 * Repérage des adresses dans du texte brut.
 *
 * # Pourquoi ce module existe
 *
 * Un message sans HTML s'affiche tel quel, dans un bloc préformaté. Les
 * adresses qu'il contient y sont du texte et rien d'autre : pas de main de
 * curseur, pas de soulignement, aucun clic possible. Or c'est le format des
 * messages transactionnels — confirmations, liens de connexion à usage unique,
 * suivis de commande — c'est-à-dire précisément ceux dont on vient chercher le
 * lien.
 *
 * # Ce que ce module ne fait pas
 *
 * Il ne valide pas les adresses. Le contrôle qui compte est en Rust
 * (`sortie_autorisee`), et il ne bouge pas d'ici : ce texte vient d'un e-mail,
 * donc de n'importe qui, et la décision de confier une adresse au système
 * d'exploitation n'appartient pas au frontend.
 */

/**
 * Un morceau de texte, tel qu'il doit être rendu.
 *
 * Une union plutôt qu'un balisage : rendre du HTML construit à partir du texte
 * d'un expéditeur ouvrirait une injection là où il n'y en avait pas.
 */
export type Morceau =
  | { genre: 'texte'; contenu: string }
  | { genre: 'lien'; contenu: string; adresse: string }

/**
 * Ce qui ressemble à une adresse dans du texte.
 *
 * `www.` sans schéma est reconnu parce que les gens l'écrivent ainsi et que les
 * messages le reprennent ; le schéma est ajouté au moment de l'ouverture, pas
 * gardé dans le texte affiché — l'utilisateur doit lire ce que l'expéditeur a
 * écrit, pas ce que nous en avons déduit.
 *
 * La classe de caractères s'arrête volontairement avant les guillemets, les
 * chevrons et les espaces : ce sont les délimiteurs qu'un texte emploie autour
 * d'une adresse.
 */
const ADRESSE = /(?:https?:\/\/|www\.)[^\s<>"'`)\]}]+/gi

/**
 * Ponctuation qui termine une phrase et non une adresse.
 *
 * `https://exemple.fr/page.` se lit avec un point final ; le garder mènerait à
 * une adresse fausse. La parenthèse et le crochet fermants sont là pour
 * « (voir https://exemple.fr) », qui est la façon normale de citer un lien.
 *
 * Le retrait est répété : « (voir https://exemple.fr). » en porte deux.
 */
const PONCTUATION_FINALE = /[.,;:!?)\]}»]+$/

/**
 * Découpe un texte en morceaux, adresses reconnues.
 *
 * Fonction pure : c'est elle qu'on éprouve, pas le rendu. Une découpe fausse se
 * voit ici, sur une chaîne, plutôt que dans un message qu'il faudrait retrouver.
 */
export function decouperLesLiens(texte: string): Morceau[] {
  const morceaux: Morceau[] = []
  let curseur = 0

  // `matchAll` sur une expression globale : l'état de l'expression est repris à
  // chaque appel, et une expression globale partagée entre deux appels reprend
  // là où elle s'était arrêtée. `matchAll` en fait une copie, ce qui évite ce
  // piège classique.
  for (const trouve of texte.matchAll(ADRESSE)) {
    const debut = trouve.index
    let brut = trouve[0]

    // La ponctuation finale appartient à la phrase, pas à l'adresse.
    const propre = brut.replace(PONCTUATION_FINALE, '')

    // Une adresse entièrement mangée par le retrait n'en était pas une.
    if (!propre || propre === 'www.' || /^https?:\/\/$/i.test(propre)) continue

    brut = propre

    if (debut > curseur) {
      morceaux.push({ genre: 'texte', contenu: texte.slice(curseur, debut) })
    }

    morceaux.push({
      genre: 'lien',
      contenu: brut,
      // Le schéma manquant est ajouté ici et nulle part ailleurs : le texte
      // affiché reste celui de l'expéditeur.
      adresse: /^www\./i.test(brut) ? `https://${brut}` : brut,
    })

    curseur = debut + brut.length
  }

  if (curseur < texte.length) {
    morceaux.push({ genre: 'texte', contenu: texte.slice(curseur) })
  }

  return morceaux
}
