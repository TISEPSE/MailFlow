/**
 * Le rendu de la table, éprouvé sans interface.
 *
 * Un composant qui lève au montage vide toute la fenêtre : React démonte
 * l'arbre entier et il ne reste rien à l'écran, sans le moindre message. C'est
 * arrivé, et rien dans les tests de géométrie ne pouvait l'attraper — ils
 * éprouvaient les calculs, pas le rendu.
 *
 * `renderToString` suffit : il exécute le corps de chaque composant, donc il
 * lève exactement là où l'application levait.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Archives } from './Archives'
import type { GestesDeLaTable } from './Archives'
import type { LibelleGmail, MessageAffiche, Tableau } from '../types/backend'

function message(id: string, libelles: string[] = []): MessageAffiche {
  return {
    id,
    nom: 'Karim',
    adresse: 'karim@atelier.fr',
    destinataires: [],
    copies: [],
    sujet: `Sujet ${id}`,
    extrait: '',
    date: '2026-08-14T10:00:00Z',
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@gmail.com',
    libelles,
  }
}

const gestes: GestesDeLaTable = {
  onDeposer: async () => undefined,
  onSortir: async () => undefined,
  onCreerLibelle: async () => [],
  onDefaireLeTas: async () => undefined,
  onTasVide: async () => undefined,
  onSupprimer: async () => undefined,
  onRetirer: async () => undefined,
  onLu: () => undefined,
  onRelever: () => undefined,
  onErreur: () => undefined,
}

const vide: Tableau = { tas: {}, messages: {} }

function rendre(
  archives: MessageAffiche[],
  libelles: LibelleGmail[] = [],
  tableau: Tableau = vide,
  melange = false,
) {
  return renderToString(
    <Archives
      archives={archives}
      libelles={libelles}
      compte="moi@gmail.com"
      tableau={tableau}
      onTableau={() => undefined}
      sombre={false}
      melange={melange}
      corpsConnus={new Map()}
      onCorpsCharge={() => undefined}
      gestes={gestes}
    />,
  )
}

describe('la table se rend sans lever', () => {
  it('sur une table vide', () => {
    expect(() => rendre([])).not.toThrow()
  })

  it('avec des tuiles isolées', () => {
    const html = rendre([message('m1'), message('m2')])

    expect(html).toContain('Sujet m1')
  })

  it('avec un tas', () => {
    const html = rendre(
      [message('m1', ['Label_1']), message('m2', ['Label_1'])],
      [{ id: 'Label_1', nom: 'Factures' }],
    )

    expect(html).toContain('Factures')
  })

  it("avec un libellé que Gmail ne connaît plus", () => {
    expect(() =>
      rendre([message('m1', ['Label_disparu'])], [{ id: 'Label_1', nom: 'Factures' }]),
    ).not.toThrow()
  })

  it('avec une disposition qui parle de choses effacées', () => {
    // Le fichier de disposition survit aux messages : il nomme forcément, un
    // jour, des identifiants qui n'existent plus.
    const ancienne: Tableau = {
      tas: { Label_parti: { x: 10, y: 10 } },
      messages: { m_parti: { x: 20, y: 20 } },
    }

    expect(() => rendre([message('m1')], [], ancienne)).not.toThrow()
  })

  it("invite à choisir un compte sous la vue mélangée", () => {
    // La table est cloisonnée par compte jusque dans son fichier de
    // disposition : mélangée, la moitié de ses gestes échouerait en silence.
    const html = rendre([message('m1')], [], vide, true)

    expect(html).toContain('Choisissez un compte')
    expect(html).not.toContain('Sujet m1')
  })

  it('offre de supprimer chaque tuile', () => {
    // Le geste est caché tant que la tuile n'est pas survolée : sans ce test,
    // une règle CSS mal nommée le rendrait invisible pour toujours sans que
    // rien ne le signale.
    const html = rendre([message('m1')])

    expect(html).toContain('Supprimer « Sujet m1 »')
    expect(html).toContain('geste-de-tuile')
  })

  it("avec un relevé écrit avant que les libellés n'existent", () => {
    // Le champ est arrivé après coup : un cache antérieur n'en a pas, et le
    // JSON rendu par Rust ne le portera pas non plus.
    const ancien = { ...message('m1') } as Partial<MessageAffiche>
    delete ancien.libelles

    expect(() => rendre([ancien as MessageAffiche])).not.toThrow()
  })
})
