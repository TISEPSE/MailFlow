/**
 * Les trois états de la fenêtre de lecture, éprouvés sans interface.
 *
 * `renderToString` n'exécute pas les effets : la fenêtre rendue ici est donc
 * exactement celle de la première image, celle qu'on voit avant que quoi que ce
 * soit n'arrive du backend. C'est précisément l'image qui était fautive — elle
 * montrait l'extrait de Gmail comme s'il était le message.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LecteurEnGrand } from './LecteurEnGrand'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

const MESSAGE: MessageAffiche = {
  id: 'msg_1',
  nom: 'JULES',
  adresse: 'jules@exemple.fr',
  sujet: 'Le numéro de la semaine',
  extrait: 'Un extrait de deux lignes.',
  date: '2026-08-21T10:00:00Z',
  nonLu: true,
  categorie: 'newsletter',
  compte: 'moi@exemple.fr',
  destinataires: [],
  copies: [],
  libelles: [],
}

function corps(html: string | null): CorpsMessage {
  return { html, texte: html ? null : 'Le vrai corps.', pieces: [] }
}

describe('LecteurEnGrand', () => {
  it("n'affiche pas l'extrait à la place du message tant que le corps n'est pas là", () => {
    const html = renderToString(
      <LecteurEnGrand
        message={MESSAGE}
        corps={null}
        onCorpsCharge={() => {}}
        onFermer={() => {}}
      />,
    )

    // L'objet et l'expéditeur restent : ce sont les seules choses qu'on
    // connaisse vraiment à cet instant.
    expect(html).toContain('Le numéro de la semaine')
    expect(html).toContain('jules@exemple.fr')

    // L'extrait, lui, ne doit plus tenir lieu de message. C'est lui qui faisait
    // croire à une lettre de deux lignes.
    expect(html).not.toContain('Un extrait de deux lignes.')
  })

  it('affiche le corps dès qu il est fourni, sans aucune attente', () => {
    const html = renderToString(
      <LecteurEnGrand
        message={MESSAGE}
        corps={corps(null)}
        onCorpsCharge={() => {}}
        onFermer={() => {}}
      />,
    )

    expect(html).toContain('Le vrai corps.')
    expect(html).not.toContain('squelette')
  })

  it('pose les gestes de la page qui l ouvre en pied de fenêtre', () => {
    const html = renderToString(
      <LecteurEnGrand
        message={MESSAGE}
        corps={corps(null)}
        onCorpsCharge={() => {}}
        onFermer={() => {}}
        actions={<button type="button">Transférer</button>}
      />,
    )

    expect(html).toContain('Transférer')
  })
})
