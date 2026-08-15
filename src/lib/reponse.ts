/**
 * Composition d'une reponse a partir d'un message recu.
 *
 * Ici plutot que dans `App` : c'est la seule regle de ce lot qu'on puisse se
 * tromper en ecrivant, et la seule qu'un test attrape sans lancer l'interface.
 */
import type { MessageAffiche } from '../types/backend'

/**
 * Qui mettre en copie d'un « Repondre a tous ».
 *
 * Tous les destinataires du message d'origine, sauf deux : l'expediteur, qui
 * est deja le destinataire principal de la reponse, et vous-meme — se repondre
 * en copie est le travers classique de ce bouton.
 *
 * Les adresses sont comparees en minuscules et dedoublonnees : une meme
 * personne figurant a la fois en destinataire et en copie ne doit recevoir
 * qu'un exemplaire.
 */
export function autresQueMoi(m: MessageAffiche, moi?: string | null): string[] {
  const exclure = new Set(
    [m.adresse, moi]
      .filter((a): a is string => Boolean(a))
      .map((a) => a.toLowerCase()),
  )

  const vues = new Set<string>()
  const retenues: string[] = []

  for (const contact of [...m.destinataires, ...m.copies]) {
    const adresse = contact.adresse.trim().toLowerCase()
    if (!adresse || exclure.has(adresse) || vues.has(adresse)) continue
    vues.add(adresse)
    retenues.push(adresse)
  }

  return retenues
}
