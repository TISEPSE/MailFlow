import { useEffect, useState } from 'react'
import { appHealth, messageDErreur } from './lib/tauri'
import type { EtatApplication } from './types/backend'

/**
 * Écran de diagnostic provisoire.
 *
 * Il n'a pas vocation à rester : il vérifie que la chaîne React → IPC → Rust
 * fonctionne de bout en bout et que le trousseau système est joignable. Les cinq
 * vues du cahier des charges prendront sa place dans `src/views/`.
 */
export default function App() {
  const [etat, setEtat] = useState<EtatApplication | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    appHealth().then(setEtat).catch((e) => setErreur(messageDErreur(e)))
  }, [])

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 p-10 font-sans">
      <header>
        <h1 className="text-2xl font-semibold">MailFlow</h1>
        <p className="text-sm text-neutral-500">Diagnostic du backend</p>
      </header>

      {erreur && (
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-800">{erreur}</p>
      )}

      {!erreur && !etat && (
        <p className="text-sm text-neutral-500">Vérification en cours…</p>
      )}

      {etat && (
        <dl className="divide-y divide-neutral-200 text-sm select-text">
          <Ligne intitule="Version" valeur={etat.version} />
          <Ligne intitule="Plateforme" valeur={etat.plateforme} />
          <Ligne
            intitule="Trousseau système"
            valeur={etat.trousseauDisponible ? 'disponible' : 'indisponible'}
            alerte={!etat.trousseauDisponible}
          />
          <Ligne
            intitule="Client Google"
            valeur={etat.clientGoogleConfigure ? 'configuré' : 'non configuré'}
            alerte={!etat.clientGoogleConfigure}
          />
          <Ligne
            intitule="Compte Gmail"
            valeur={etat.compteConnecte ? 'connecté' : 'non connecté'}
          />
          <Ligne
            intitule="Règles chargées"
            valeur={
              etat.nombreDeRegles === null
                ? 'fichier illisible'
                : String(etat.nombreDeRegles)
            }
            alerte={etat.nombreDeRegles === null}
          />
          <Ligne intitule="Fichier de règles" valeur={etat.cheminRegles} />
        </dl>
      )}
    </main>
  )
}

function Ligne({
  intitule,
  valeur,
  alerte = false,
}: {
  intitule: string
  valeur: string
  alerte?: boolean
}) {
  return (
    <div className="flex justify-between gap-6 py-2">
      <dt className="text-neutral-500">{intitule}</dt>
      <dd
        className={`truncate font-medium ${alerte ? 'text-red-700' : 'text-neutral-900'}`}
        title={valeur}
      >
        {valeur}
      </dd>
    </div>
  )
}
