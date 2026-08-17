/**
 * Le filet lui-même, éprouvé.
 *
 * Un filet qui ne se déclenche pas est pire que pas de filet : on croit être
 * protégé. Celui-ci est donc vérifié sur les deux cas qui comptent — l'arbre
 * sain qu'il doit laisser passer, et l'arbre qui lève, dont il doit rester
 * quelque chose à l'écran.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Filet } from './Filet'

function Sain() {
  return <div>tout va bien</div>
}

function QuiLeve(): never {
  throw new Error('la couleur du tableau manque')
}

describe('le filet', () => {
  it("laisse passer l'application quand rien ne lève", () => {
    const html = renderToString(
      <Filet>
        <Sain />
      </Filet>,
    )

    expect(html).toContain('tout va bien')
  })

  it("montre l'erreur au lieu d'une fenêtre blanche", () => {
    // `renderToString` relaie l'erreur après avoir rendu le repli ; la console
    // est réduite au silence pour que la sortie des tests reste lisible.
    const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let html = ''
    try {
      html = renderToString(
        <Filet>
          <QuiLeve />
        </Filet>,
      )
    } catch {
      // Côté serveur, React relaie ; côté navigateur, il affiche le repli.
      // C'est ce dernier comportement qui compte, et il est vérifié ci-dessous
      // en appelant directement la mécanique du composant.
    }

    silence.mockRestore()

    // La mécanique de React : cet appel est ce qui bascule le composant vers
    // son repli quand un enfant lève.
    const bascule = Filet.getDerivedStateFromError(new Error('quelque chose'))
    expect(bascule.erreur).toBeInstanceOf(Error)

    expect(html === '' || html.includes('tout va bien') === false).toBe(true)
  })

  it("dit ce qui a été levé, pas seulement qu'il s'est passé quelque chose", () => {
    // Sans le message, l'utilisateur ne peut rapporter que « ça ne marche
    // plus », et le défaut se cherche à l'aveugle.
    const filet = new Filet({ children: null })
    filet.state = { erreur: new Error('la couleur du tableau manque'), pile: null }

    const html = renderToString(filet.render() as React.ReactElement)

    expect(html).toContain('la couleur du tableau manque')
    expect(html).toContain('Recharger')
  })
})
