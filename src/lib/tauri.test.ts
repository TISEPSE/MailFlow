import { describe, expect, it, vi } from 'vitest'
import { estErreurBackend, messageDErreur } from './tauri'

describe('estErreurBackend', () => {
  it('reconnait la forme serialisee par le backend', () => {
    expect(estErreurBackend({ code: 'ERREUR_GMAIL', message: 'Gmail…' })).toBe(true)
  })

  it('rejette les valeurs qui ne sont pas des erreurs backend', () => {
    expect(estErreurBackend(new Error('boum'))).toBe(false)
    expect(estErreurBackend('chaine')).toBe(false)
    expect(estErreurBackend(null)).toBe(false)
    expect(estErreurBackend({ code: 'ERREUR_GMAIL' })).toBe(false)
  })
})

describe('messageDErreur', () => {
  it('rend le message du backend tel quel', () => {
    const erreur = { code: 'NON_AUTHENTIFIE', message: "Aucun compte Gmail n'est connecte." }
    expect(messageDErreur(erreur)).toBe("Aucun compte Gmail n'est connecte.")
  })

  it("remplace une panne inattendue par un message generique", () => {
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(messageDErreur(new TypeError('undefined is not a function'))).toBe(
      "Une erreur inattendue s'est produite.",
    )

    console_error.mockRestore()
  })

  it("ne laisse pas fuiter le detail d'une panne inattendue", () => {
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message = messageDErreur(new Error('token=secret-abc123'))

    expect(message).not.toContain('secret-abc123')
    console_error.mockRestore()
  })
})
