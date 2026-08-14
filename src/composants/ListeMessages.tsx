/**
 * Liste de messages, partagée par les vues Mails directs, Publicités,
 * Newsletters et Formations.
 *
 * Elle n'affiche que ce que le backend transmet : nom, adresse, sujet, extrait,
 * date. Pas de corps de message — c'est du HTML écrit par un inconnu, et il ne
 * traversera l'IPC que le jour où une `iframe` en bac à sable saura l'afficher.
 */
import { Icone, Pastille, SqueletteLecture } from './base'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

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
      className="flex w-[352px] flex-none flex-col overflow-y-auto border-r"
      // `--sunk` plutôt que `--side` : c'est ce fond qui fait le gris des
      // messages lus, et il doit se distinguer du blanc d'un message non lu
      // autant que de la barre latérale, qui le jouxte.
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      {messages.map((m, i) => {
        const [fond, encre] = palette(i)
        const choisi = m.id === selection
        const neuf = m.nonLu
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-current={choisi}
            data-neuf={neuf}
            className="tuile relative flex items-center gap-2.5 border-b py-2.5 pr-3 pl-3 text-left"
            // Aucun fond en style en ligne : il l'emporterait sur les règles de
            // survol et de sélection, qui sont dans la feuille de styles.
            style={{ borderColor: 'var(--line)' }}
          >
            {/* La pastille de non-lu passe en repère absolu : en colonne, elle
                coûtait une vingtaine de pixels à toutes les tuiles, y compris
                aux messages lus qui n'en ont pas l'usage. */}
            {neuf && (
              <span
                className="absolute top-1/2 left-[3px] h-1.5 w-1.5 -translate-y-1/2 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
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
                  style={{ fontWeight: neuf ? 600 : 500 }}
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
 * Il montre l'en-tête puis le corps du message, affiché dans un cadre isolé.
 */
export function Lecture({
  message,
  corps,
  chargement,
  actions,
  logos,
}: {
  message: MessageAffiche | null
  corps: CorpsMessage | null
  chargement: boolean
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="selectionnable flex-none border-b px-6 py-2.5"
        style={{ borderColor: 'var(--line)' }}
      >
        {/* Deux lignes plutôt que trois blocs empilés : chaque ligne gagnée en
            hauteur est une ligne de message affichée en plus. */}
        <div className="flex items-center gap-2.5">
          <Pastille
            texte={initiales(message.nom)}
            taille={30}
            fond={fond}
            couleur={encre}
            logo={logos[domaineDe(message.adresse)]}
          />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
            {message.sujet || '(sans objet)'}
          </h2>
          <span className="flex-none text-[12px]" style={{ color: 'var(--sub)' }}>
            {heureCourte(message.date)}
          </span>
        </div>

        {/* Sans retour à la ligne : c'est l'adresse qui se tronque, pas le
            bouton qui descend d'un cran. Elle figure de toute façon aussi dans
            la tuile de gauche. */}
        <div className="mt-1.5 flex items-center gap-2 pl-[40px]">
          <span className="flex-none text-[12.5px] font-semibold">
            {message.nom}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px]"
            style={{ color: 'var(--sub)' }}
          >
            {message.adresse}
          </span>
          {actions}
        </div>
      </div>

      <Corps message={message} corps={corps} chargement={chargement} />
    </div>
  )
}

/**
 * Corps du message.
 *
 * Le HTML de l'expéditeur va dans une `iframe` déclarée `sandbox` sans
 * `allow-scripts` : le navigateur refuse alors d'exécuter le moindre script,
 * quoi que contienne le document. C'est une garantie du moteur, pas une
 * promesse de notre part — c'est ce qui rend l'affichage acceptable.
 */
function Corps({
  message,
  corps,
  chargement,
}: {
  message: MessageAffiche
  corps: CorpsMessage | null
  chargement: boolean
}) {
  if (chargement) {
    return <SqueletteLecture />
  }

  if (corps?.html) {
    return (
      <iframe
        title="Contenu du message"
        // `allow-popups` sans `allow-scripts` : le cadre peut demander
        // l'ouverture d'un lien, jamais exécuter de code. C'est le backend qui
        // décide ensuite d'ouvrir l'adresse dans le navigateur du système.
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={documentIsole(corps.html)}
        className="min-h-0 w-full flex-1"
        style={{ border: 0, background: '#FFFFFF' }}
      />
    )
  }

  const texte = corps?.texte ?? message.extrait

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-9 py-6">
        <pre className="selectionnable font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap">
          {texte}
        </pre>
      </div>
      {!corps?.texte && <Avertissement />}
    </div>
  )
}

/** Dit pourquoi le message paraît tronqué, plutôt que de laisser croire à un bug. */
function Avertissement() {
  return (
    <div
      className="flex flex-none items-start gap-2.5 border-t px-9 py-3"
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      <Icone nom="shield" taille={16} style={{ color: 'var(--sub)' }} />
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--sub)' }}>
        Seul l'extrait fourni par Gmail est disponible pour ce message.
      </p>
    </div>
  )
}

/**
 * Enveloppe le HTML de l'expéditeur dans un document minimal.
 *
 * La politique de sécurité déclarée ici s'ajoute à celle de l'application, dont
 * le cadre hérite : `default-src 'none'` interdit toute requête sortante, ce qui
 * neutralise au passage les pixels de suivi.
 *
 * Le fond reste blanc même en thème sombre : ces messages sont écrits pour du
 * papier blanc, et les recolorer rendrait illisible tout ce qui fixe sa propre
 * couleur de texte.
 */
function documentIsole(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<base target="_blank">
<style>
  html { background: #ffffff; }
  body {
    margin: 0; padding: 20px 24px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    color: #1d1d1f; overflow-wrap: break-word;
  }
  img, table { max-width: 100%; }
  img { height: auto; }
  a { color: #2f6bff; }
</style></head><body>${html}</body></html>`
}
