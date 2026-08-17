import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Filet } from './composants/Filet.tsx'
import { signalerUneErreur } from './lib/crochets.ts'
import { messageDErreur } from './lib/tauri.ts'

/**
 * Ce que le filet ne peut pas voir.
 *
 * Un composant qui lève pendant son rendu est rattrapé par [`Filet`]. Une
 * promesse rejetée sans `catch`, ou une exception dans un gestionnaire
 * d'événement, ne l'est pas : React ne les traverse pas. Elles ne laissaient
 * donc aucune trace — ni à l'écran, ni dans le journal de l'application, qui
 * est écrit par Rust et ignore tout de ce qui se passe dans le webview.
 *
 * On les fait remonter comme n'importe quelle erreur : une notification. Elle
 * n'explique pas tout, mais elle dit qu'il s'est passé quelque chose, ce qui
 * est déjà infiniment mieux qu'une fenêtre qui ne réagit plus sans raison.
 */
function surveillerLesErreursNonRattrapees() {
  window.addEventListener('error', (e) => {
    console.error('erreur non rattrapée', e.error ?? e.message)
    signalerUneErreur(`Erreur inattendue : ${e.message}`)
  })

  window.addEventListener('unhandledrejection', (e) => {
    console.error('promesse rejetée sans traitement', e.reason)
    signalerUneErreur(`Erreur inattendue : ${messageDErreur(e.reason)}`)
  })
}

surveillerLesErreursNonRattrapees()

// Le filet enveloppe l'application entière, et non telle ou telle vue : une
// exception levée n'importe où démonte l'arbre depuis la racine, et c'est donc
// à la racine qu'il faut être pour en rester quelque chose à l'écran.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Filet>
      <App />
    </Filet>
  </StrictMode>,
)
