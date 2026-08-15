/**
 * Corbeille.
 *
 * Elle existe pour une raison précise : « Supprimer » ne détruit rien, et
 * l'affirmer ne suffit pas. Tant qu'on ne peut pas voir ce qui s'y trouve ni
 * l'en ressortir sans passer par Gmail, la réversibilité reste une promesse.
 *
 * Rien n'est mis en cache ici, contrairement à la boîte : on ouvre cette page
 * précisément pour vérifier son état, et un contenu périmé y serait plus gênant
 * qu'une seconde d'attente.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bouton, Icone, Pastille, SqueletteListe, Vide } from '../composants/base'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import { corbeilleLister, messageDErreur, messageRestaurer } from '../lib/tauri'
import type { MessageAffiche } from '../types/backend'

export function Corbeille({
  logos,
  onErreur,
  onAnnonce,
}: {
  logos: Record<string, string>
  onErreur: (message: string) => void
  onAnnonce: (message: string) => void
}) {
  const [messages, setMessages] = useState<MessageAffiche[] | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)

  const relever = useCallback(async () => {
    try {
      setMessages(await corbeilleLister())
    } catch (e) {
      onErreur(messageDErreur(e))
      setMessages([])
    }
  }, [onErreur])

  useEffect(() => {
    void relever()
  }, [relever])

  const restaurer = async (m: MessageAffiche) => {
    setEnCours(m.id)
    try {
      await messageRestaurer(m.id)
      // Retiré de la liste sans attendre un nouveau relevé : le message est
      // sous les yeux de l'utilisateur, et le voir rester donnerait
      // l'impression que le clic n'a pas porté.
      setMessages((liste) => (liste ?? []).filter((x) => x.id !== m.id))
      onAnnonce(`Message de ${m.nom} restauré.`)
    } catch (e) {
      onErreur(messageDErreur(e))
    } finally {
      setEnCours(null)
    }
  }

  if (messages === null) return <SqueletteListe lignes={5} />

  if (!messages.length) {
    return (
      <Vide
        icone="delete"
        titre="La corbeille est vide"
        detail="Les messages supprimés atterrissent ici. Gmail les garde trente jours avant de les effacer pour de bon."
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-8 py-6">
        <div
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12.5px]"
          style={{ background: 'var(--sunk)', color: 'var(--sub)' }}
        >
          <Icone nom="schedule" taille={15} />
          <span>
            Gmail garde ces messages <strong>trente jours</strong>, puis les efface
            définitivement. D'ici là, vous pouvez tous les remettre en place.
          </span>
        </div>

        {messages.map((m, i) => {
          const [fond, encre] = palette(i)
          return (
            <div
              key={m.id}
              className="carte-survolable flex items-center gap-3 rounded-xl border px-3.5 py-3"
              style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
            >
              <Pastille
                texte={initiales(m.nom)}
                taille={32}
                fond={fond}
                couleur={encre}
                logo={logos[domaineDe(m.adresse)]}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {m.nom}
                  </span>
                  <span
                    className="flex-none font-mono text-[10.5px]"
                    style={{ color: 'var(--sub)' }}
                  >
                    {heureCourte(m.date)}
                  </span>
                </span>
                <span className="block truncate text-[12.5px]">
                  {m.sujet || '(sans objet)'}
                </span>
                <span className="block truncate text-[12px]" style={{ color: 'var(--sub)' }}>
                  {m.extrait}
                </span>
              </span>
              <Bouton
                icone="undo"
                tailleIcone={15}
                enAttente={enCours === m.id}
                disabled={enCours !== null}
                onClick={() => void restaurer(m)}
                titre="Remettre ce message dans la boîte de réception"
              >
                Restaurer
              </Bouton>
            </div>
          )
        })}
      </div>
    </div>
  )
}
