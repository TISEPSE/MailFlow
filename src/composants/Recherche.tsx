/**
 * Barre de recherche, en tête de la fenêtre.
 *
 * Elle cherche dans toutes les vues à la fois, et non dans celle qui est
 * ouverte : on se souvient d'un expéditeur, rarement de la case où MailFlow l'a
 * rangé. Chaque résultat dit d'où il vient, ce qui rend le classement lisible
 * au passage.
 *
 * Tout est local — voir `lib/recherche.ts` pour la raison.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icone, Pastille } from './base'
import { chercher } from '../lib/recherche'
import { domaineDe, heureCourte, initiales, palette, ton } from '../lib/presentation'
import type { CategorieMessage, CorpsMessage, MessageAffiche } from '../types/backend'

/** Nom de chaque vue, pour dire d'où vient un résultat. */
const VUES: Record<CategorieMessage, string> = {
  humain: 'Mails directs',
  publicite: 'Publicités',
  newsletter: 'Newsletters',
  formation: 'Formations',
}

const OU: Record<string, string> = {
  expediteur: 'expéditeur',
  sujet: 'sujet',
  contenu: 'contenu',
}

export function Recherche({
  messages,
  corps,
  logos,
  sombre,
  onOuvrir,
}: {
  messages: readonly MessageAffiche[]
  corps: ReadonlyMap<string, CorpsMessage>
  logos: Record<string, string>
  sombre: boolean
  /** Va au message : change de vue et l'y sélectionne. */
  onOuvrir: (message: MessageAffiche) => void
}) {
  const [q, setQ] = useState('')
  const [actif, setActif] = useState(false)
  const cadre = useRef<HTMLDivElement>(null)
  const champ = useRef<HTMLInputElement>(null)

  const resultats = useMemo(
    () => chercher(messages, q, corps).slice(0, 40),
    [messages, q, corps],
  )

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      if (!cadre.current?.contains(e.target as Node)) setActif(false)
    }
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActif(false)
        champ.current?.blur()
        return
      }
      // Le raccourci du système : on cherche sans quitter le clavier.
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        champ.current?.focus()
        setActif(true)
      }
    }
    document.addEventListener('mousedown', dehors)
    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('mousedown', dehors)
      document.removeEventListener('keydown', auClavier)
    }
  }, [])

  const ouvert = actif && q.trim().length > 0

  return (
    <div ref={cadre} className="relative w-full max-w-md">
      <div
        className="flex h-9 items-center gap-2 rounded-xl border px-3"
        style={{
          background: 'var(--sunk)',
          borderColor: ouvert ? 'var(--accent)' : 'var(--line)',
          transition: 'border-color 120ms ease',
        }}
      >
        <Icone nom="search" taille={15} style={{ color: 'var(--sub)' }} />
        <input
          ref={champ}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setActif(true)}
          placeholder="Rechercher un message, un expéditeur, une phrase…"
          aria-label="Rechercher dans tous les messages"
          className="selectionnable min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          style={{ color: 'var(--fg)' }}
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('')
              champ.current?.focus()
            }}
            aria-label="Effacer la recherche"
            className="bouton bouton-icone flex-none rounded-md p-1"
          >
            <Icone nom="close" taille={13} />
          </button>
        )}
      </div>

      {ouvert && (
        <div
          className="menu-apparait absolute top-full right-0 left-0 z-40 mt-2 overflow-hidden rounded-xl border"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: '0 12px 32px rgb(0 0 0 / 22%)',
          }}
        >
          {resultats.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px]" style={{ color: 'var(--sub)' }}>
              Aucun message ne correspond à « {q.trim()} ».
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {resultats.map(({ message, ou }, i) => {
                const [fond, encre] = palette(i)
                const [solide, doux] = ton(message.categorie, sombre)
                return (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => {
                      onOuvrir(message)
                      setActif(false)
                    }}
                    className="survolable flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <Pastille
                      texte={initiales(message.nom)}
                      taille={26}
                      fond={fond}
                      couleur={encre}
                      logo={logos[domaineDe(message.adresse)]}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                          {message.nom}
                        </span>
                        <span
                          className="flex-none font-mono text-[10px]"
                          style={{ color: 'var(--sub)' }}
                        >
                          {heureCourte(message.date)}
                        </span>
                      </span>
                      <span className="block truncate text-[12px]">
                        {message.sujet || '(sans objet)'}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end gap-1">
                      <span
                        className="rounded px-1.5 py-px text-[9.5px] font-semibold"
                        style={{ background: doux, color: solide }}
                      >
                        {VUES[message.categorie]}
                      </span>
                      <span className="text-[9.5px]" style={{ color: 'var(--sub)' }}>
                        dans le {OU[ou]}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
