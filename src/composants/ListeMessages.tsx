/**
 * Liste de messages, partagée par les vues Mails directs, Publicités,
 * Newsletters et Formations.
 *
 * Elle n'affiche que ce que le backend transmet : nom, adresse, sujet, extrait,
 * date. Pas de corps de message — c'est du HTML écrit par un inconnu, et il ne
 * traversera l'IPC que le jour où une `iframe` en bac à sable saura l'afficher.
 */
import { useState } from 'react'
import {
  HAUTEUR_LIGNE,
  Icone,
  LARGEUR_LISTE,
  Pastille,
  SqueletteLecture,
} from './base'
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
      className="flex flex-none flex-col overflow-y-auto border-r"
      // `--sunk` plutôt que `--side` : c'est ce fond qui fait le gris des
      // messages lus, et il doit se distinguer du blanc d'un message non lu
      // autant que de la barre latérale, qui le jouxte.
      style={{
        width: LARGEUR_LISTE,
        background: 'var(--sunk)',
        borderColor: 'var(--line)',
      }}
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
            className="tuile relative flex flex-none items-center gap-2.5 overflow-hidden border-b px-3 text-left"
            // Aucun fond en style en ligne : il l'emporterait sur les règles de
            // survol et de sélection, qui sont dans la feuille de styles.
            //
            // La hauteur est fixe et partagée avec l'en-tête de lecture : un
            // sujet court et un sujet long donnaient sinon des tuiles de
            // hauteurs différentes, et le trait de la première ne tombait sur
            // rien.
            style={{ borderColor: 'var(--line)', height: HAUTEUR_LIGNE }}
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
  attente = false,
  actions,
  logos,
  onCopier,
}: {
  message: MessageAffiche | null
  corps: CorpsMessage | null
  /** Vrai quand l'attente dure assez pour mériter un squelette. */
  chargement: boolean
  /** Vrai dès qu'une lecture est en cours, squelette ou non. */
  attente?: boolean
  actions?: React.ReactNode
  logos: Record<string, string>
  /** Appelé après avoir copié une adresse, pour l'annoncer. */
  onCopier?: (adresse: string) => void
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        className="selectionnable flex min-w-0 flex-none flex-col justify-center overflow-hidden border-b px-6"
        // Même hauteur qu'une tuile : les deux traits se répondent alors d'un
        // panneau à l'autre, au lieu de se manquer de quelques pixels.
        style={{ borderColor: 'var(--line)', height: HAUTEUR_LIGNE }}
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

        {/* Le nom seul sur cette ligne : elle a une hauteur fixe, et une
            adresse entière n'y tiendrait pas sans être coupée. Les adresses
            sont plus bas, où elles ont la place de passer à la ligne. */}
        <div className="mt-1.5 flex items-center gap-2 pl-[40px]">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
            {message.nom}
          </span>
          {actions && (
            <span className="flex flex-none items-center gap-2">{actions}</span>
          )}
        </div>
      </div>

      <Destinataires message={message} onCopier={onCopier} />

      <Corps
        message={message}
        corps={corps}
        chargement={chargement}
        attente={attente}
      />
    </div>
  )
}

/**
 * Qui a écrit, à qui, et qui est en copie.
 *
 * Les adresses sont montrées en entier et passent à la ligne plutôt que d'être
 * coupées : une adresse à moitié affichée ne sert à rien, ni pour reconnaître
 * un correspondant, ni pour la recopier. Le bloc défile au-delà de quelques
 * lignes, ce qui arrive sur les envois groupés.
 */
function Destinataires({
  message,
  onCopier,
}: {
  message: MessageAffiche
  onCopier?: (adresse: string) => void
}) {
  // Ouvert par défaut : c'est l'information qu'on est venu chercher. Le repli
  // est là pour les messages sans intérêt de ce côté, et pour rendre de la
  // hauteur au corps quand la fenêtre est basse. Le choix vaut pour la
  // session : le refaire à chaque message serait pire que le panneau lui-même.
  const [ouvert, setOuvert] = useState(true)

  const lignes: { role: string; contacts: { nom: string; adresse: string }[] }[] = [
    { role: 'De', contacts: [{ nom: message.nom, adresse: message.adresse }] },
    { role: 'À', contacts: message.destinataires },
    { role: 'Copie', contacts: message.copies },
  ].filter((l) => l.contacts.some((c) => c.adresse))

  const total = message.destinataires.length + message.copies.length

  return (
    <div
      className="relative flex flex-none flex-col border-b"
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
        title={ouvert ? 'Masquer les destinataires' : 'Afficher les destinataires'}
        className="survolable absolute top-1.5 right-3 z-10 flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-semibold"
        style={{ color: 'var(--sub)' }}
      >
        {!ouvert && total > 0 && (
          <span>
            {total} destinataire{total > 1 ? 's' : ''}
          </span>
        )}
        <Icone
          nom="expand_more"
          taille={15}
          style={{
            transform: ouvert ? 'rotate(180deg)' : undefined,
            transition: 'transform 160ms ease',
          }}
        />
      </button>

      {!ouvert ? (
        // Replié, le panneau garde la ligne « De » : savoir qui écrit reste
        // utile même quand on ne veut pas la liste entière.
        <div className="flex items-baseline gap-2 py-2.5 pr-28 pl-6">
          <span
            className="w-[42px] flex-none text-right text-[11px] font-semibold"
            style={{ color: 'var(--sub)' }}
          >
            De
          </span>
          <AdresseCopiable
            contact={{ nom: message.nom, adresse: message.adresse }}
            onCopier={onCopier}
          />
        </div>
      ) : (
        <div className="flex max-h-28 flex-col gap-1 overflow-y-auto py-2.5 pr-28 pl-6">
      {lignes.map(({ role, contacts }) => (
        <div key={role} className="flex items-baseline gap-2">
          <span
            className="w-[42px] flex-none text-right text-[11px] font-semibold"
            style={{ color: 'var(--sub)' }}
          >
            {role}
          </span>
          {/* `flex-wrap` et non `truncate` : c'est tout l'objet de ce bloc. */}
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
            {contacts
              .filter((c) => c.adresse)
              .map((c) => (
                <AdresseCopiable key={c.adresse} contact={c} onCopier={onCopier} />
              ))}
          </span>
        </div>
      ))}
        </div>
      )}
    </div>
  )
}

/** Une adresse entière, que le clic recopie dans le presse-papiers. */
function AdresseCopiable({
  contact,
  onCopier,
}: {
  contact: { nom: string; adresse: string }
  onCopier?: (adresse: string) => void
}) {
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(contact.adresse)
      onCopier?.(contact.adresse)
    } catch {
      // Presse-papiers refusé par le système : mieux vaut ne rien annoncer que
      // de prétendre avoir copié.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copier()}
      title={`Copier ${contact.adresse}`}
      className="adresse inline-flex max-w-full items-baseline gap-1.5 text-left"
    >
      {contact.nom && contact.nom !== contact.adresse && (
        <span className="text-[12px] font-medium">{contact.nom}</span>
      )}
      {/* `.valeur` porte le survol : c'est l'adresse qu'on copie, et elle
          seule doit s'allumer. `break-all` la fait continuer à la ligne
          suivante plutôt que déborder du cadre. */}
      <span
        className="valeur font-mono text-[11px] break-all"
        style={{ color: 'var(--sub)' }}
      >
        {contact.adresse}
      </span>
    </button>
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
  attente,
}: {
  message: MessageAffiche
  corps: CorpsMessage | null
  chargement: boolean
  attente: boolean
}) {
  if (chargement) {
    return <SqueletteLecture />
  }

  // Lecture en cours, mais trop brève pour qu'on l'annonce : un fond vide le
  // temps de quelques images. Afficher l'extrait ici le ferait apparaître puis
  // remplacer aussitôt par le vrai corps — un clignotement de plus.
  if (attente) {
    return <div className="min-h-0 flex-1" />
  }

  if (corps?.html) {
    return (
      <iframe
        title="Contenu du message"
        // Bac à sable strict, sans `allow-scripts` : rien ne s'exécute. Le
        // clic sur un lien navigue le cadre lui-même — le journal a montré
        // qu'une fenêtre surgissante, elle, n'atteignait jamais le backend.
        // Cette navigation-ci est annulée côté Rust, qui ouvre l'adresse dans
        // le navigateur du système.
        sandbox=""
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
<style>
  html { background: #ffffff; }
  body {
    margin: 0; padding: 20px 24px;
    /* Un message bâti sur un tableau large défile ici, au lieu d'élargir le
       cadre et de pousser toute l'application hors de la fenêtre. */
    overflow-x: auto;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    color: #1d1d1f; overflow-wrap: break-word;
  }
  img, table { max-width: 100%; }
  img { height: auto; }
  a { color: #2f6bff; }
</style></head><body>${html}</body></html>`
}
