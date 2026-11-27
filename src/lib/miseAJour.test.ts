/**
 * Le suivi du téléchargement d'une mise à jour, et l'ordre des gestes : on ne
 * relance l'application qu'une fois l'installation terminée.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

const relaunch = vi.fn(async () => {})
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }))

const { installer, raisonDeLEchec } = await import('./miseAJour')

function fausseMiseAJour(evenements: DownloadEvent[], echec?: Error): Update {
  return {
    version: '9.9.9',
    downloadAndInstall: async (suivre?: (e: DownloadEvent) => void) => {
      for (const e of evenements) suivre?.(e)
      if (echec) throw echec
    },
  } as unknown as Update
}

describe('installer', () => {
  it('rend la progression en fraction, puis relance', async () => {
    relaunch.mockClear()
    const fractions: (number | null)[] = []
    await installer(
      fausseMiseAJour([
        { event: 'Started', data: { contentLength: 200 } },
        { event: 'Progress', data: { chunkLength: 50 } },
        { event: 'Progress', data: { chunkLength: 150 } },
        { event: 'Finished' },
      ]),
      (f) => fractions.push(f),
    )
    expect(fractions).toEqual([0, 0.25, 1, 1])
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('dit « taille inconnue » quand le serveur ne la donne pas', async () => {
    const fractions: (number | null)[] = []
    await installer(
      fausseMiseAJour([
        { event: 'Started', data: {} },
        { event: 'Progress', data: { chunkLength: 10 } },
      ]),
      (f) => fractions.push(f),
    )
    expect(fractions).toEqual([null, null])
  })

  it('ne relance pas une application dont la mise à jour a échoué', async () => {
    relaunch.mockClear()
    await expect(
      installer(fausseMiseAJour([], new Error('signature invalide')), () => {}),
    ).rejects.toThrow('signature invalide')
    expect(relaunch).not.toHaveBeenCalled()
  })
})

describe('raisonDeLEchec', () => {
  it("distingue une release sans latest.json d'une coupure réseau", () => {
    expect(raisonDeLEchec('Could not fetch a valid release JSON from the remote')).toBe(
      'sansFichier',
    )
    expect(raisonDeLEchec(new Error('error sending request for url'))).toBe('reseau')
  })
})
