/**
 * Refait les captures d'écran du README à partir du mode démo.
 *
 *     npm run captures
 *
 * Démarre `vite --mode demo`, ouvre Google Chrome sans fenêtre, parcourt les
 * vues et écrit les images dans `docs/captures/`. Chrome doit être installé :
 * le navigateur de Playwright n'est pas téléchargé.
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const PORT = 1421
const ADRESSE = `http://localhost:${PORT}/`
const RACINE = fileURLToPath(new URL('..', import.meta.url))
const SORTIE = fileURLToPath(new URL('../docs/captures/', import.meta.url))

/** Les vues à capturer, et le libellé de la barre latérale qui y mène. */
const VUES = [
  { fichier: 'courrier', lien: 'Mails directs', attendre: 'Nouvelles maquettes du site' },
  { fichier: 'triage', lien: 'Triage & publicités', attendre: 'Maison Verdure' },
  { fichier: 'newsletters', lien: 'Newsletters', attendre: 'La Matinale Tech' },
  { fichier: 'formations', lien: 'Rappels de formations', attendre: 'Académie Pixel' },
  { fichier: 'regles', lien: 'Règles automatiques', attendre: 'Rando Store' },
  { fichier: 'archives', lien: 'Archives', attendre: 'Factures' },
  {
    fichier: 'parametres',
    // Pas dans la barre latérale : les Paramètres s'ouvrent depuis le menu du compte.
    ouvrir: async (page) => {
      await page.getByText('Léa Fontaine', { exact: true }).first().click()
      await page.getByRole('menuitem', { name: /Paramètres/ }).click()
      await page.getByText('Apparence', { exact: true }).first().click()
    },
    attendre: 'accentuation',
  },
]

async function attendreLeServeur() {
  for (let essai = 0; essai < 120; essai++) {
    try {
      const reponse = await fetch(ADRESSE)
      if (reponse.ok) return
    } catch {
      // Pas encore prêt.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`vite ne répond pas sur ${ADRESSE}`)
}

async function capturer(navigateur, { sombre, vues, suffixe }) {
  const contexte = await navigateur.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    locale: 'fr-FR',
  })
  await contexte.addInitScript((sombre) => {
    localStorage.setItem('mailflow.preferences', JSON.stringify({ guideVu: true, sombre }))
  }, sombre)

  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(e.message))
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))

  await page.goto(ADRESSE)
  await page.getByText('Mails directs', { exact: true }).first().waitFor()

  for (const vue of vues) {
    if (vue.ouvrir) await vue.ouvrir(page)
    else await page.getByText(vue.lien, { exact: true }).first().click()
    await page.getByText(vue.attendre).first().waitFor()
    // Les transitions d'entrée et le corps du message dans son cadre isolé.
    await page.waitForTimeout(800)
    const chemin = `${SORTIE}${vue.fichier}${suffixe}.png`
    await page.screenshot({ path: chemin })
    console.log('écrit', chemin.replace(RACINE, ''))
  }

  await contexte.close()
  return erreurs
}

// Le binaire de vite et non `npx vite` : `npx` ne transmet pas l'arrêt au
// serveur qu'il lance, qui resterait sur le port après la dernière capture.
const vite = spawn(
  `${RACINE}node_modules/.bin/vite`,
  ['--mode', 'demo', '--port', String(PORT), '--strictPort'],
  { cwd: RACINE, stdio: 'ignore' },
)

try {
  await mkdir(SORTIE, { recursive: true })
  await attendreLeServeur()
  const navigateur = await chromium.launch({ channel: 'chrome' })
  try {
    const erreurs = [
      ...(await capturer(navigateur, { sombre: false, vues: VUES, suffixe: '' })),
      ...(await capturer(navigateur, {
        sombre: true,
        vues: VUES.filter((v) => ['courrier', 'newsletters'].includes(v.fichier)),
        suffixe: '-sombre',
      })),
    ]
    if (erreurs.length) {
      console.error('Erreurs dans la page :\n' + erreurs.join('\n'))
      process.exitCode = 1
    }
  } finally {
    await navigateur.close()
  }
} finally {
  vite.kill()
}
