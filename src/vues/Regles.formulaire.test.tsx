/**
 * Le formulaire de règle, éprouvé seul.
 *
 * Par le formulaire et non par la page : celle-ci ne le rend que fenêtre
 * ouverte, et `renderToString` n'ouvre rien. Un test passant par la page
 * vérifierait l'absence de ce qui n'a jamais été rendu — il resterait vert quoi
 * qu'il arrive, ce qui est pire que pas de test.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { FormulaireAjout } from './Regles'
import type { Regle } from '../types/backend'

function regle(action: Regle['action']): Regle {
  return {
    id: 'rule_x',
    expediteur: 'promo@offres-tech.fr',
    nom_affichage: 'offres-tech.fr',
    categorie: 'publicite',
    action,
    active: true,
    date_ajout: '2026-08-22',
  }
}

/** Rend le formulaire ouvert sur une règle qui porte cette action. */
function rendre(action: Regle['action']): string {
  return renderToString(
    <FormulaireAjout
      depuis={regle(action)}
      comptes={['moi@exemple.fr']}
      expediteurs={[]}
      libelles={[]}
      sombre={false}
      onAnnuler={() => {}}
      onValider={async () => {}}
    />,
  )
}

describe('formulaire de règle', () => {
  it("ne demande pas la catégorie quand la règle archive", () => {
    // La catégorie nomme la page de MailFlow où les messages se rangent. Un
    // message archivé ne s'arrête dans aucune page : la question n'a pas de
    // réponse utile.
    const html = rendre('archiver_automatique')

    expect(html).not.toContain('Catégorie de la règle')
    // Ce qui reste propre à l'archivage, lui, doit être là.
    expect(html).toContain('Quand la règle archive')
    expect(html).toContain('Libellé de destination')
  })

  it('la demande pour les autres actions', () => {
    // « Classer seulement » ne fait même que ça : ranger dans une page.
    for (const action of ['classer_seulement', 'supprimer_toujours'] as const) {
      expect(rendre(action)).toContain('Catégorie de la règle')
    }
  })

  it("n'écrit rien sous « Immédiatement »", () => {
    // La phrase qui s'y trouvait répétait son propre intitulé.
    expect(rendre('archiver_automatique')).not.toContain(
      'quittent la boîte dès que MailFlow les voit',
    )
  })

  it("dit quand l'archivage a lieu dès qu'une heure est en jeu", () => {
    // Là, il y a une vraie question : à quel moment exactement ?
    const programmee: Regle = {
      ...regle('archiver_automatique'),
      frequence: 'vendredi',
      heure_execution: '18:00',
    }

    const html = renderToString(
      <FormulaireAjout
        depuis={programmee}
        comptes={['moi@exemple.fr']}
        expediteurs={[]}
        libelles={[]}
        sombre={false}
        onAnnuler={() => {}}
        onValider={async () => {}}
      />,
    )

    expect(html).toContain("L&#x27;archivage a lieu au premier relevé")
  })
})
