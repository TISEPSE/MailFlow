import { useCallback, useEffect, useState } from 'react'
import {
  appHealth,
  gmailSynchroniser,
  googleConnecter,
  googleDeconnecter,
  messageDErreur,
} from './lib/tauri'
import { resumerRapport } from './lib/rapport'
import type { EtatApplication, RapportExecution } from './types/backend'

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
  const [enCours, setEnCours] = useState(false)
  const [rapport, setRapport] = useState<RapportExecution | null>(null)

  const rafraichir = useCallback(
    () => appHealth().then(setEtat).catch((e) => setErreur(messageDErreur(e))),
    [],
  )

  useEffect(() => {
    void rafraichir()
  }, [rafraichir])

  /**
   * Le parcours Google se déroule dans le navigateur : la promesse peut rester
   * en attente plusieurs minutes. L'état `enCours` évite qu'un second clic
   * n'ouvre une deuxième tentative — le backend refuserait, mais autant ne pas
   * l'y amener.
   */
  async function lancer(action: () => Promise<void>) {
    setEnCours(true)
    setErreur(null)
    setRapport(null)
    try {
      await action()
    } catch (e) {
      setErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
      await rafraichir()
    }
  }

  async function synchroniser() {
    setEnCours(true)
    setErreur(null)
    setRapport(null)
    try {
      setRapport(await gmailSynchroniser())
    } catch (e) {
      setErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
      await rafraichir()
    }
  }

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

      {etat && (
        <div className="flex flex-col gap-3">
          {!etat.clientGoogleConfigure && (
            <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
              L'identifiant client Google n'est pas renseigné. La marche à suivre
              est décrite dans <code>docs/connexion-google.md</code>.
            </p>
          )}

          {!etat.trousseauDisponible && (
            <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
              Aucun trousseau de mots de passe n'est joignable. MailFlow ne
              pourrait pas conserver votre connexion.
            </p>
          )}

          {etat.compteConnecte ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void synchroniser()}
                disabled={enCours}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {enCours ? 'Synchronisation…' : 'Appliquer mes règles'}
              </button>
              <button
                type="button"
                onClick={() => void lancer(googleDeconnecter)}
                disabled={enCours}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
              >
                Déconnecter mon compte Gmail
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void lancer(googleConnecter)}
              disabled={enCours || !etat.clientGoogleConfigure || !etat.trousseauDisponible}
              className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {enCours
                ? 'En attente de votre accord…'
                : 'Connecter mon compte Gmail'}
            </button>
          )}

          {enCours && !etat.compteConnecte && (
            <p className="text-sm text-neutral-500">
              Votre navigateur s'est ouvert sur la page de connexion Google.
              Revenez ici une fois votre accord donné.
            </p>
          )}

          {rapport && (
            <p className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-900">
              {resumerRapport(rapport)}
            </p>
          )}

          {etat.compteConnecte && etat.nombreDeRegles === 0 && (
            <p className="text-sm text-neutral-500">
              Aucune règle n'est encore définie : la synchronisation n'aura rien à
              faire. Les vues de création arriveront ensuite.
            </p>
          )}
        </div>
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
