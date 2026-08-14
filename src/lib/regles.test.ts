import { describe, expect, it } from 'vitest'
import { phrase } from './regles'
import type { Regle } from '../types/backend'

function regle(champs: Partial<Regle> = {}): Regle {
  return {
    id: 'rule_01',
    expediteur: 'promo@offres-tech.fr',
    nom_affichage: 'Offres Tech',
    categorie: 'publicite',
    action: 'supprimer_toujours',
    active: true,
    date_ajout: '2026-08-14',
    ...champs,
  }
}

describe('phrase', () => {
  it('dit ce que fait une suppression', () => {
    expect(phrase(regle())).toBe(
      'Supprimer systématiquement les messages de Offres Tech.',
    )
  })

  it('dit ce que fait un résumé', () => {
    const p = phrase(
      regle({ action: 'generer_resume_et_archiver', nom_affichage: 'TLDR' }),
    )

    expect(p).toContain('Résumer')
    expect(p).toContain('archiver')
    expect(p).toContain('TLDR')
  })

  it("précise le jour et l'heure d'un archivage récurrent", () => {
    // Sans eux, l'utilisateur ne saurait pas quand ça se produit.
    const p = phrase(
      regle({
        action: 'archiver_automatique',
        frequence: 'tous_les_vendredis',
        heure_execution: '18:00',
        nom_affichage: 'OpenClassrooms',
      }),
    )

    expect(p).toContain('vendredis')
    expect(p).toContain('18 h 00')
  })

  it('reste juste quand aucune récurrence n’est définie', () => {
    // Annoncer un vendredi qui n'existe pas serait un mensonge.
    const p = phrase(regle({ action: 'archiver_automatique' }))

    expect(p).not.toContain('vendredi')
    expect(p).toContain('Archiver automatiquement')
  })

  it("retombe sur l'adresse quand le nom affiché manque", () => {
    // Une phrase avec un trou serait pire qu'une adresse technique.
    const p = phrase(regle({ nom_affichage: '' }))

    expect(p).toContain('promo@offres-tech.fr')
  })
})
