/**
 * Ce qu'Échap a le droit de fermer.
 *
 * Le test existe à cause d'une panne signalée sur macOS : la fenêtre de
 * rédaction disparaissait en pleine frappe, et tout ce qui venait d'être écrit
 * avec elle.
 */
import { describe, expect, it } from 'vitest'
import { echapFerme } from './clavier'

describe('echapFerme', () => {
  it('ferme quand la frappe ne vient pas d’une zone de texte', () => {
    expect(echapFerme({ tagName: 'BUTTON', isContentEditable: false })).toBe(true)
    expect(echapFerme({ tagName: 'DIV', isContentEditable: false })).toBe(true)
  })

  it('ne ferme pas depuis une zone de texte longue', () => {
    // Cocoa se sert d'Échap pour congédier la correction automatique et le
    // sélecteur d'emoji. Sur macOS, cette frappe-là arrive en écrivant, et
    // elle emportait le message.
    expect(echapFerme({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(false)
  })

  it('ne ferme pas depuis un contenu éditable', () => {
    expect(echapFerme({ tagName: 'DIV', isContentEditable: true })).toBe(false)
  })

  it('ferme encore depuis un champ d’une ligne', () => {
    // Un formulaire de règle se quitte d'un Échap depuis son champ, et c'est
    // l'habitude acquise. Ce qu'on perd y tient sur une ligne.
    expect(echapFerme({ tagName: 'INPUT', isContentEditable: false })).toBe(true)
  })

  it('ferme quand la frappe ne vise rien', () => {
    expect(echapFerme(null)).toBe(true)
  })
})
