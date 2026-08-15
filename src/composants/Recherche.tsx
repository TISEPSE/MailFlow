/**
 * Recherche, en fenêtre plutôt qu'en barre.
 *
 * Une barre permanente coûte une bande de hauteur sur chaque page, pour un
 * geste occasionnel. La fenêtre s'ouvre au raccourci, prend l'écran le temps
 * de chercher, et rend sa place.
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
  onFermer,
}: {
  messages: readonly MessageAffiche[]
  corps: ReadonlyMap<string, CorpsMessage>
  logos: Record<string, string>
  sombre: boolean
  /** Va au message : change de vue et l'y sélectionne. */
  onOuvrir: (message: MessageAffiche) => void
  onFermer: () => void
}) {
  const [q, setQ] = useState('')
  const cadre = useRef<HTMLDivElement>(null)
  const champ = useRef<HTMLInputElement>(null)

  const resultats = useMemo(
    () => chercher(messages, q, corps).slice(0, 40),
    [messages, q, corps],
  )

  useEffect(() => {
    champ.current?.focus()
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer()
    }
    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  }, [onFermer])

  const ouvert = q.trim().length > 0

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFermer()
      }}
      // Vers le haut : la fenêtre s'ouvre au tiers de l'écran, là où l'œil
      // arrive naturellement, plutôt qu'au centre exact d'où la liste
      // descendrait hors du cadre.
      className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[12vh]"
      // Même fond que les autres fenêtres : deux flous différents pour deux
      // fenêtres de la même application se remarquent, et rien ne le justifie.
      style={{
        background: 'rgb(0 0 0 / 40%)',
        backdropFilter: 'blur(10px) saturate(120%)',
      }}
    >
    <div
      ref={cadre}
      role="dialog"
      aria-modal="true"
      aria-label="Rechercher dans tous les messages"
      className="apparait relative w-full max-w-2xl overflow-hidden rounded-2xl border"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--line)',
        boxShadow: '0 24px 64px rgb(0 0 0 / 28%)',
      }}
    >
      <div
        className="flex h-14 items-center gap-3 border-b px-4"
        style={{ borderColor: ouvert ? 'var(--line)' : 'transparent' }}
      >
        <Icone nom="search" taille={20} style={{ color: 'var(--sub)' }} />
        <input
          ref={champ}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un message, un expéditeur, une phrase…"
          aria-label="Rechercher dans tous les messages"
          className="selectionnable min-w-0 flex-1 bg-transparent text-[15px] outline-none"
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

      {ouvert ? (
        <div>
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
                      onFermer()
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
      ) : (
        <p className="px-4 py-6 text-center text-[12.5px]" style={{ color: 'var(--sub)' }}>
          Cherchez un expéditeur, un sujet, une phrase — dans toutes les pages à
          la fois. <kbd>Échap</kbd> pour fermer.
        </p>
      )}
    </div>
    </div>
  )
}
