/**
 * Les frappes qui ferment une fenêtre, et celles qu'il faut laisser passer.
 *
 * Fonction pure, et volontairement sans `instanceof` : la suite de tests tourne
 * sans DOM, et une règle de cette importance ne doit pas être la seule chose du
 * projet qu'on ne puisse pas éprouver.
 */

/** Ce qu'on a besoin de savoir de la cible d'une frappe. */
export interface CibleDeFrappe {
  tagName?: string
  isContentEditable?: boolean
}

/**
 * Échap doit-il fermer la fenêtre, vu d'où vient la frappe ?
 *
 * # La panne que cette fonction corrige
 *
 * Sur macOS, la fenêtre de rédaction disparaissait en pleine frappe, et tout ce
 * qui venait d'être écrit avec elle. La cause n'est pas dans MailFlow : Cocoa
 * attribue Échap à la correction automatique et au sélecteur de caractères dans
 * une zone de texte. On appuie dessus en écrivant un accent ou un emoji, le
 * webview reçoit la frappe comme n'importe quelle autre, et la modale se
 * refermait dessus.
 *
 * D'où la règle : une frappe venue d'une zone de texte longue — `textarea` ou
 * contenu éditable — ne ferme rien. C'est là qu'on écrit des paragraphes, donc
 * là que la correction automatique intervient, et là qu'une fermeture coûte
 * cher.
 *
 * Un champ d'une ligne continue de fermer : quitter un formulaire de règle d'un
 * Échap est une habitude acquise, et ce qu'on y perd tient sur une ligne.
 */
export function echapFerme(cible: CibleDeFrappe | null | undefined): boolean {
  if (!cible) return true
  if (cible.isContentEditable) return false
  return cible.tagName !== 'TEXTAREA'
}
