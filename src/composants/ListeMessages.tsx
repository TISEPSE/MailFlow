/**
 * Liste de messages, partagée par les vues Mails directs, Publicités,
 * Newsletters et Formations.
 *
 * Elle n'affiche que ce que le backend transmet : nom, adresse, sujet, extrait,
 * date. Pas de corps de message — c'est du HTML écrit par un inconnu, et il ne
 * traversera l'IPC que le jour où une `iframe` en bac à sable saura l'afficher.
 */
import { Icone, Pastille } from './base'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import type { MessageAffiche } from '../types/backend'

export function ListeMessages({
  messages,
  selection,
  onSelect,
  logos,
}: {
  messages: MessageAffiche[]
  selection: string | null
  onSelect: (id: string) => void
  logos: Record<string, string>
}) {
  return (
    <div
      className="flex w-[368px] flex-none flex-col overflow-y-auto border-r"
      // `--sunk` plutôt que `--side` : c'est ce fond qui fait le gris des
      // messages lus, et il doit se distinguer du blanc d'un message non lu
      // autant que de la barre latérale, qui le jouxte.
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      {messages.map((m, i) => {
        const [fond, encre] = palette(i)
        const choisi = m.id === selection
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-current={choisi}
            className="tuile flex items-start gap-3 border-b px-4 py-3 text-left"
            style={
              // Un fond en style en ligne l'emporterait sur la règle de survol :
              // il n'est donc posé que pour les tuiles qui doivent rester
              // blanches quoi qu'il arrive.
              choisi || m.nonLu
                ? { background: 'var(--card)', borderColor: 'var(--line)' }
                : { borderColor: 'var(--line)' }
            }
          >
            <span
              className="mt-2 h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: m.nonLu ? 'var(--accent)' : 'transparent' }}
            />
            <Pastille
              texte={initiales(m.nom)}
              fond={fond}
              couleur={encre}
              logo={logos[domaineDe(m.adresse)]}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-[13.5px]"
                  style={{ fontWeight: m.nonLu ? 600 : 500 }}
                >
                  {m.nom}
                </span>
                <span
                  className="flex-none font-mono text-[10.5px]"
                  style={{ color: 'var(--sub)' }}
                >
                  {heureCourte(m.date)}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] font-medium">
                {m.sujet || '(sans objet)'}
              </span>
              <span
                className="mt-0.5 block truncate text-[12px]"
                style={{ color: 'var(--sub)' }}
              >
                {m.extrait}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Panneau de lecture.
 *
 * Il montre l'en-tête et l'extrait, et dit explicitement pourquoi le corps
 * manque. Un panneau vide sans explication passerait pour un défaut.
 */
export function Lecture({
  message,
  actions,
  logos,
}: {
  message: MessageAffiche | null
  actions?: React.ReactNode
  logos: Record<string, string>
}) {
  if (!message) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-[13px]"
        style={{ color: 'var(--sub)' }}
      >
        Sélectionnez un message.
      </div>
    )
  }

  const [fond, encre] = palette(0)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="selectionnable mx-auto w-full max-w-2xl px-9 py-8">
        <h2 className="text-[19px] font-semibold tracking-tight">
          {message.sujet || '(sans objet)'}
        </h2>

        <div className="mt-4 flex items-center gap-3">
          <Pastille
            texte={initiales(message.nom)}
            taille={36}
            fond={fond}
            couleur={encre}
            logo={logos[domaineDe(message.adresse)]}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">{message.nom}</div>
            <div className="font-mono text-[11px]" style={{ color: 'var(--sub)' }}>
              {message.adresse}
            </div>
          </div>
          <div className="flex-none text-[12px]" style={{ color: 'var(--sub)' }}>
            {heureCourte(message.date)}
          </div>
        </div>

        <p className="mt-6 text-[13.5px] leading-relaxed">{message.extrait}</p>

        <div
          className="mt-5 flex items-start gap-2.5 rounded-xl border p-3.5"
          style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
        >
          <Icone nom="shield" taille={17} style={{ color: 'var(--sub)' }} />
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--sub)' }}>
            Seul l'extrait fourni par Gmail est affiché. Le corps d'un e-mail est
            du HTML écrit par un tiers : il ne sera affiché que dans un cadre
            isolé, qui reste à construire.
          </p>
        </div>

        {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}
