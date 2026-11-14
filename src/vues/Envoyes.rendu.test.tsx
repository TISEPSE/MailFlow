/**
 * Le rendu de la page des messages envoyés, éprouvé sans interface.
 *
 * `renderToString` exécute le corps de chaque composant : il lève exactement là
 * où l'application lèverait. C'est ce qui attrape une page qui vide la fenêtre
 * entière, et que les tests de fonctions pures ne peuvent pas voir.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Envoyes } from './Envoyes'
import type { MessageAffiche } from '../types/backend'

// Le panneau des adresses lit les préférences dans le `localStorage`, que
// l'environnement node de la suite n'a pas. Doublé ici plutôt que rendu
// facultatif côté production : dans le webview de Tauri, il existe toujours.
beforeAll(() => {
  const memoire = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (c: string) => memoire.get(c) ?? null,
      setItem: (c: string, v: string) => void memoire.set(c, v),
      removeItem: (c: string) => void memoire.delete(c),
      clear: () => memoire.clear(),
      key: () => null,
      length: 0,
    },
  })
})

function message(id: string, destinataires: { nom: string; adresse: string }[]): MessageAffiche {
  return {
    id,
    nom: 'Moi',
    adresse: 'moi@gmail.com',
    destinataires,
    copies: [],
    sujet: `Sujet ${id}`,
    extrait: 'Un extrait.',
    date: '2026-08-14T10:00:00Z',
    nonLu: false,
    categorie: 'humain',
    compte: 'moi@gmail.com',
    libelles: [],
  }
}

function rendre(envoyes: MessageAffiche[], chargement = false) {
  return renderToString(
    <Envoyes
      envoyes={envoyes}
      logos={{}}
      corpsConnus={new Map()}
      onCorpsCharge={() => {}}
      onTransferer={() => {}}
      onRelever={() => {}}
      chargement={chargement}
    />,
  )
}

describe('Envoyes', () => {
  it('nomme le destinataire, et non soi-même', () => {
    // L'expéditeur est toujours soi : une page qui le montrerait afficherait
    // cent fois le même nom, et aucune ligne ne se distinguerait d'une autre.
    const html = rendre([message('m1', [{ nom: 'Alice', adresse: 'alice@exemple.fr' }])])

    expect(html).toContain('Alice')
  })

  it('compte les autres destinataires sans les nommer', () => {
    const html = rendre([
      message('m1', [
        { nom: 'Alice', adresse: 'alice@exemple.fr' },
        { nom: 'Bob', adresse: 'bob@exemple.fr' },
        { nom: 'Chloé', adresse: 'chloe@exemple.fr' },
      ]),
    ])

    expect(html).toContain('Alice')
    expect(html).toContain('+2')
  })

  it('propose de relever quand la page est vide', () => {
    // Rien n'est gardé sur le disque : la page arrive vide au premier affichage
    // et doit dire quoi faire, sinon elle se lit comme une panne.
    const html = rendre([])

    expect(html).toContain('Aucun message envoyé')
  })

  it('montre un squelette pendant le relevé', () => {
    const html = rendre([], true)

    expect(html).not.toContain('Aucun message envoyé')
  })

  it("laisse transférer un message qu'on a envoyé", () => {
    // Le geste utile sur cette page : renvoyer une lettre à quelqu'un d'autre,
    // ou se la renvoyer pour la reprendre.
    const html = rendre([message('m1', [{ nom: 'Alice', adresse: 'alice@exemple.fr' }])])

    expect(html).toContain('Transférer')
  })
})
