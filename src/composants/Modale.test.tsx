/**
 * La fenêtre modale, éprouvée sans interface.
 *
 * Deux choses seulement, mais ce sont celles qui ont cassé.
 *
 * La première : `Modale` passe désormais par un portail vers `document.body`,
 * et `renderToString` refuse les portails. Le rendu serveur doit donc rester
 * possible, sans quoi tous les tests de rendu des vues qui ouvrent une fenêtre
 * s'écrouleraient d'un coup — pour un détail d'environnement de test, pas pour
 * un défaut de l'application.
 *
 * La seconde : le titre et le sous-titre doivent survivre au déplacement. Une
 * fenêtre qui se rend au bon endroit mais vide ne vaut pas mieux qu'une fenêtre
 * mal placée.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Confirmation, Modale } from './base'

describe('Modale', () => {
  it('se rend encore sans document, comme le font les tests de vues', () => {
    const html = renderToString(
      <Modale titre="Archiver ce message" sous="Rien n'est supprimé." onFermer={() => {}}>
        <p>corps</p>
      </Modale>,
    )

    expect(html).toContain('Archiver ce message')
    // `renderToString` échappe l'apostrophe : on cherche donc le texte tel
    // qu'il sort, et non tel qu'il est écrit dans la propriété.
    expect(html).toContain('Rien n&#x27;est supprimé.')
    expect(html).toContain('corps')
  })

  it("porte le rôle et l'étiquette qu'un lecteur d'écran attend", () => {
    const html = renderToString(
      <Modale titre="Ajouter une règle" onFermer={() => {}}>
        <p>corps</p>
      </Modale>,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Ajouter une règle"')
  })

  it('donne à chaque taille sa largeur, et une seule', () => {
    // Une taille et non deux booléens : rien ne doit pouvoir demander « large
    // et moyen » à la fois.
    const largeurs = (['normale', 'moyenne', 'grande'] as const).map((taille) => {
      const html = renderToString(
        <Modale titre="T" taille={taille} onFermer={() => {}}>
          <p>corps</p>
        </Modale>,
      )
      return /class="apparait my-auto w-full rounded-3xl border ([^"]+)"/.exec(html)?.[1]
    })

    expect(largeurs).toEqual(['max-w-2xl', 'max-w-5xl', 'max-w-[min(1500px,94vw)]'])
  })

  it('rend la confirmation avec ses deux gestes', () => {
    const html = renderToString(
      <Confirmation
        titre="Mettre cette newsletter à la corbeille ?"
        sous="Gmail les garde trente jours."
        libelle="Supprimer"
        onConfirmer={() => {}}
        onAnnuler={() => {}}
      />,
    )

    expect(html).toContain('Annuler')
    expect(html).toContain('Supprimer')
  })
})
