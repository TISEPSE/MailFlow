import { describe, expect, it } from 'vitest'
import { resumerRapport } from './rapport'

/** Rapport neutre, que chaque test ajuste sur le seul champ qui l'intéresse. */
function rapport(champs: Partial<Parameters<typeof resumerRapport>[0]> = {}) {
  return { archives: 0, misALaCorbeille: 0, echecs: 0, ...champs }
}

describe('resumerRapport', () => {
  it("dit clairement qu'il n'y avait rien à faire", () => {
    // Cas le plus fréquent en usage courant : ne pas laisser l'utilisateur
    // devant un message vide en se demandant si ça a marché.
    expect(resumerRapport(rapport())).toContain('Rien à faire')
  })

  it('accorde au singulier', () => {
    expect(resumerRapport(rapport({ archives: 1 }))).toBe('1 message archivé.')
  })

  it('accorde au pluriel', () => {
    expect(resumerRapport(rapport({ archives: 4 }))).toBe('4 messages archivés.')
  })

  it('accorde aussi la mise à la corbeille', () => {
    expect(resumerRapport(rapport({ misALaCorbeille: 1 }))).toBe(
      '1 message mis à la corbeille.',
    )
    expect(resumerRapport(rapport({ misALaCorbeille: 3 }))).toBe(
      '3 messages mis à la corbeille.',
    )
  })

  it('énumère les deux actions quand les deux ont eu lieu', () => {
    const phrase = resumerRapport(rapport({ archives: 2, misALaCorbeille: 1 }))

    expect(phrase).toContain('2 messages archivés')
    expect(phrase).toContain('1 message mis à la corbeille')
  })

  it('signale les échecs sans les cacher', () => {
    // Un rapport qui tait les échecs laisse croire que tout est passé.
    const phrase = resumerRapport(rapport({ archives: 5, echecs: 2 }))

    expect(phrase).toContain('2 actions')
    expect(phrase).toContain('échoué')
  })

  it("signale les échecs même quand rien d'autre n'a abouti", () => {
    const phrase = resumerRapport(rapport({ echecs: 1 }))

    expect(phrase).toContain('échoué')
    expect(phrase).not.toContain('Rien à faire')
  })
})
