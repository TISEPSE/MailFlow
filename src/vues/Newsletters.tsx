/**
 * Newsletters : la seule vue qui ne soit pas une liste.
 *
 * Une newsletter ne se lit pas comme un message : on la parcourt, on retient
 * deux lignes, on passe. La liste plus panneau de lecture des autres vues
 * obligeait à ouvrir chacune pour savoir si elle valait la peine. Ici tout se
 * voit d'un coup — une synthèse en tête, puis une carte par publication.
 *
 * # Les résumés
 *
 * Ils viennent d'un modèle de langage, et aucun fournisseur n'est encore
 * branché. La mise en page les prévoit tout de même à leur place définitive :
 * le bloc existe et dit franchement que la fonctionnalité est à venir, plutôt
 * que d'inventer un résumé ou de laisser un trou qu'il faudrait recomposer plus
 * tard. Voir `src-tauri/src/llm/mod.rs`, qui déclare déjà les deux formes
 * attendues — la synthèse du jour et le résumé d'une newsletter.
 */
import { useMemo, useState } from 'react'
import {
  Bouton,
  Confirmation,
  Icone,
  Modale,
  Pastille,
  SqueletteListe,
  Vide,
} from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import { messageCorps } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'
import { CorpsIsole } from '../composants/ListeMessages'

/** Étiquette qui montre tout, toujours en tête des filtres. */
const TOUTES = 'Tous'

export function Newsletters({
  messages,
  vide,
  logos,
  onOuvrir,
  onSupprimer,
  onArchiver,
  corpsConnus,
  onCorpsCharge,
  chargement,
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  logos: Record<string, string>
  onOuvrir: (id: string) => void
  onSupprimer: (id: string) => void
  onArchiver: (id: string) => void
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  chargement?: boolean
}) {
  const [filtre, setFiltre] = useState(TOUTES)
  const [ouvert, setOuvert] = useState<MessageAffiche | null>(null)

  // Les étiquettes viendront des résumés. Tant qu'aucun modèle ne tourne, il
  // n'y en a qu'une, et la barre de filtres se réduit à elle.
  const etiquettes = useMemo(() => [TOUTES], [])

  const visibles = filtre === TOUTES ? messages : messages

  if (chargement) return <SqueletteListe lignes={4} />
  if (!messages.length) return <Vide {...vide} />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-6">
        <Synthese messages={messages} logos={logos} />

        <Filtres
          etiquettes={etiquettes}
          choisie={filtre}
          onChoisir={setFiltre}
        />

        {/* Deux colonnes : une carte de newsletter tient dans la moitié d'un
            écran, et deux de front font voir la journée d'un coup. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibles.map((m, i) => (
            <Carte
              key={m.id}
              message={m}
              rang={i}
              logos={logos}
              onVoir={() => {
                setOuvert(m)
                onOuvrir(m.id)
              }}
              onArchiver={() => onArchiver(m.id)}
              onSupprimer={() => onSupprimer(m.id)}
            />
          ))}
        </div>
      </div>

      {ouvert && (
        <LecteurEnGrand
          message={ouvert}
          corps={corpsConnus.get(ouvert.id) ?? null}
          onCorpsCharge={onCorpsCharge}
          onFermer={() => setOuvert(null)}
        />
      )}
    </div>
  )
}

/**
 * Bandeau de synthèse.
 *
 * Il tiendra les trois points du jour, tirés de l'ensemble des newsletters.
 * Sans modèle branché, il dit ce qu'il sait déjà — combien sont arrivées, et de
 * qui — plutôt que de rester vide en attendant.
 */
function Synthese({
  messages,
  logos,
}: {
  messages: MessageAffiche[]
  logos: Record<string, string>
}) {
  const sources = [...new Map(messages.map((m) => [m.adresse, m])).values()].slice(0, 6)
  const derniere = messages[0]?.date

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'var(--accent-soft)' }}
      >
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: 'var(--accent)' }}
        >
          <Icone nom="auto_awesome" taille="1.125rem" rempli style={{ color: '#FFFFFF' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-semibold tracking-tight">
            Synthèse du jour
          </span>
          <span className="block text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
            {messages.length} newsletter{messages.length > 1 ? 's' : ''}
            {derniere ? ` — dernière à ${heureCourte(derniere)}` : ''}
          </span>
        </span>
        <span className="flex flex-none items-center gap-1">
          <span className="pr-1 text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
            Sources
          </span>
          {sources.map((m, i) => {
            const [fond, encre] = palette(i)
            return (
              <Pastille
                key={m.adresse}
                texte={initiales(m.nom)}
                taille="1.375rem"
                fond={fond}
                couleur={encre}
                logo={logos[domaineDe(m.adresse)]}
              />
            )
          })}
        </span>
      </div>

      <AVenir
        texte="La synthèse du jour résumera ces newsletters en trois points. Elle attend qu'un moteur de résumé soit branché."
        centre
      />
    </div>
  )
}

/** Barre d'étiquettes thématiques. */
function Filtres({
  etiquettes,
  choisie,
  onChoisir,
}: {
  etiquettes: string[]
  choisie: string
  onChoisir: (e: string) => void
}) {
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Filtrer par thème">
      <Icone nom="tag" taille="0.9375rem" style={{ color: 'var(--sub)' }} />
      {etiquettes.map((e) => (
        <button
          key={e}
          type="button"
          role="tab"
          aria-selected={e === choisie}
          onClick={() => onChoisir(e)}
          className="segment inline-flex h-[1.875rem] items-center rounded-full px-3.5 text-[0.75rem] font-semibold"
        >
          {e}
        </button>
      ))}
      {etiquettes.length === 1 && (
        <span className="pl-1 text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
          Les thèmes viendront des résumés.
        </span>
      )}
    </div>
  )
}

/** Carte d'une newsletter. */
function Carte({
  message,
  rang,
  logos,
  onVoir,
  onArchiver,
  onSupprimer,
}: {
  message: MessageAffiche
  rang: number
  logos: Record<string, string>
  onVoir: () => void
  onArchiver: () => void
  onSupprimer: () => void
}) {
  const [fond, encre] = palette(rang)

  /** Geste en attente de confirmation, ou `null`.
   *
   *  Les deux boutons font disparaître la carte de la page. Rien n'est perdu —
   *  la corbeille garde trente jours, l'archive ne détruit rien — mais un clic
   *  de travers coûterait d'aller rechercher le message dans Gmail. */
  const [aConfirmer, setAConfirmer] = useState<'archiver' | 'supprimer' | null>(null)

  return (
    <div
      className="carte-survolable flex flex-col overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <Pastille
          texte={initiales(message.nom)}
          taille="2.125rem"
          fond={fond}
          couleur={encre}
          logo={logos[domaineDe(message.adresse)]}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.875rem] font-semibold tracking-tight">
            {message.nom}
          </span>
          <span
            className="block truncate font-mono text-[0.6562rem]"
            style={{ color: 'var(--sub)' }}
          >
            {message.adresse}
          </span>
        </span>
        <span
          className="flex flex-none items-center gap-1 text-[0.6875rem]"
          style={{ color: 'var(--sub)' }}
        >
          <Icone nom="schedule" taille="0.75rem" />
          {heureCourte(message.date)}
        </span>
      </div>

      <div className="px-4 pt-3">
        <div
          className="mb-1.5 flex items-center gap-1.5 text-[0.6562rem] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--accent-fg)' }}
        >
          <Icone nom="auto_awesome" taille="0.75rem" rempli />
          Résumé IA
        </div>
        <AVenir texte="Le résumé de cette newsletter est une fonctionnalité à venir." />
        {/* L'extrait de Gmail, à défaut du résumé : ce n'en est pas un, mais
            c'est ce que le message dit de lui-même, et c'est mieux que rien. */}
        <p
          className="mt-2 line-clamp-3 text-[0.7812rem] leading-relaxed"
          style={{ color: 'var(--sub)' }}
        >
          {message.extrait}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2 px-4 py-3.5">
        <Bouton icone="open_in_full" onClick={onVoir}>
          Voir le mail
        </Bouton>
        <Bouton
          variante="principal"
          icone="archive"
          onClick={() => setAConfirmer('archiver')}
          titre="Le message quitte la boîte de réception. Rien n'est supprimé."
        >
          Garder &amp; archiver
        </Bouton>
        <Bouton
          variante="danger"
          icone="delete"
          onClick={() => setAConfirmer('supprimer')}
          titre="Mettre à la corbeille — récupérable 30 jours"
        >
          Supprimer
        </Bouton>
      </div>

      {aConfirmer && (
        <Confirmation
          titre={
            aConfirmer === 'supprimer'
              ? 'Mettre cette newsletter à la corbeille ?'
              : 'Archiver cette newsletter ?'
          }
          sous={
            aConfirmer === 'supprimer'
              ? `De ${message.nom} — « ${message.sujet || 'sans objet'} ». Gmail la garde trente jours, puis l'efface.`
              : `De ${message.nom} — « ${message.sujet || 'sans objet'} ». Elle quitte la boîte de réception ; rien n'est supprimé.`
          }
          libelle={aConfirmer === 'supprimer' ? 'Supprimer' : 'Archiver'}
          variante={aConfirmer === 'supprimer' ? 'danger' : 'principal'}
          icone={aConfirmer === 'supprimer' ? 'delete' : 'archive'}
          onConfirmer={() => {
            const geste = aConfirmer
            setAConfirmer(null)
            if (geste === 'supprimer') onSupprimer()
            else onArchiver()
          }}
          onAnnuler={() => setAConfirmer(null)}
        />
      )}
    </div>
  )
}

/**
 * Bloc « à venir ».
 *
 * Il dit franchement qu'une fonctionnalité manque, à l'endroit exact où elle
 * apparaîtra. Un espace vide se lit comme une panne ; un faux résumé serait
 * pire encore.
 */
function AVenir({ texte, centre = false }: { texte: string; centre?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[0.75rem] ${
        centre ? 'mx-4 my-3.5' : ''
      }`}
      style={{ background: 'var(--sunk)', color: 'var(--sub)' }}
    >
      <Icone nom="hourglass_empty" taille="0.875rem" />
      <span>{texte}</span>
    </div>
  )
}

/**
 * Le message d'origine, en grand.
 *
 * Le fond de l'application s'estompe et se floute derrière : la newsletter
 * occupe l'écran le temps qu'on la lise, et la grille reste à sa place quand on
 * referme. Le corps passe par la même `iframe` en bac à sable qu'ailleurs —
 * rien ne s'exécute, quoi que contienne le message.
 */
function LecteurEnGrand({
  message,
  corps,
  onCorpsCharge,
  onFermer,
}: {
  message: MessageAffiche
  corps: CorpsMessage | null
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  onFermer: () => void
}) {
  const [charge, setCharge] = useState(corps)

  useMemo(() => {
    if (corps) return
    let courant = true
    messageCorps(message.id)
      .then((c) => {
        if (!courant) return
        setCharge(c)
        onCorpsCharge(message.id, c)
      })
      .catch(() => undefined)
    return () => {
      courant = false
    }
  }, [message.id, corps, onCorpsCharge])

  return (
    <Modale
      large
      sansRembourrage
      titre={message.sujet || '(sans objet)'}
      sous={`${message.nom} — ${message.adresse}`}
      onFermer={onFermer}
    >
      <CorpsIsole corps={charge} extrait={message.extrait} />
    </Modale>
  )
}
