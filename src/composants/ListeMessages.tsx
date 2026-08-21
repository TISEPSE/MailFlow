/**
 * Liste de messages, partagée par les vues Mails directs, Publicités,
 * Newsletters et Formations.
 *
 * Elle n'affiche que ce que le backend transmet : nom, adresse, sujet, extrait,
 * date. Pas de corps de message — c'est du HTML écrit par un inconnu, et il ne
 * traversera l'IPC que le jour où une `iframe` en bac à sable saura l'afficher.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HAUTEUR_LIGNE,
  Icone,
  Pastille,
  SqueletteLecture,
} from './base'
import {
  couleurDuCompte,
  domaineDe,
  heureCourte,
  initiales,
  palette,
  poids,
} from '../lib/presentation'
import { ApercuPieceJointe } from './ApercuPieceJointe'
import { lienOuvrir, messageDErreur, pieceJointeVignette } from '../lib/tauri'
import { convertFileSrc } from '@tauri-apps/api/core'
import { signalerUneErreur } from '../lib/crochets'
import { decouperLesLiens } from '../lib/liens'
import { lirePreferences } from '../lib/preferences'
import type {
  CompteConnu,
  CorpsMessage,
  MessageAffiche,
  PieceJointe,
} from '../types/backend'

export function ListeMessages({
  messages,
  selection,
  onSelect,
  logos,
  comptes,
  coches,
  onBasculer,
}: {
  messages: MessageAffiche[]
  selection: string | null
  onSelect: (id: string) => void
  logos: Record<string, string>
  /** Renseignés dans la vue mélangée seulement : chaque tuile porte alors la
   *  photo du compte qui a reçu le message. */
  comptes?: readonly CompteConnu[]
  /** Messages cochés pour un geste groupé. Vide la plupart du temps. */
  coches?: ReadonlySet<string>
  /** Coche ou décoche un message. Absent quand la vue ne le permet pas. */
  onBasculer?: (id: string) => void
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {messages.map((m, i) => {
        const [fond, encre] = palette(i)
        const choisi = m.id === selection
        const neuf = m.nonLu
        const teinteDuCompte = comptes
          ? couleurDuCompte(
              m.compte,
              comptes.map((c) => c.adresse),
            )
          : null
        const compteRecepteur = comptes?.find((c) => c.adresse === m.compte)
        const coche = coches?.has(m.id) ?? false
        return (
          <button
            key={m.id}
            type="button"
            // Ctrl (ou Cmd) coche au lieu d'ouvrir : c'est le geste attendu
            // partout pour désigner plusieurs éléments, et il n'entre pas en
            // conflit avec la lecture, qui reste le clic simple.
            onClick={(e) => {
              if ((e.ctrlKey || e.metaKey) && onBasculer) {
                onBasculer(m.id)
                return
              }
              onSelect(m.id)
            }}
            aria-current={choisi}
            data-neuf={neuf}
            data-coche={coche || undefined}
            className="tuile relative flex flex-none items-center gap-2.5 overflow-hidden border-b px-3 text-left"
            // Aucun fond en style en ligne : il l'emporterait sur les règles de
            // survol et de sélection, qui sont dans la feuille de styles.
            //
            // La hauteur est fixe et partagée avec l'en-tête de lecture : un
            // sujet court et un sujet long donnaient sinon des tuiles de
            // hauteurs différentes, et le trait de la première ne tombait sur
            // rien.
            // Pas de liseré de couleur en vue mélangée : la pastille du compte,
            // en haut à droite de la tuile, suffit à dire d'où vient le
            // message. Deux repères pour une même information encombraient la
            // colonne sans rien apprendre de plus.
            //
            // Le seul liseré qui subsiste marque la coche, et il est passager :
            // il disparaît dès que la sélection est vidée.
            style={{
              borderColor: 'var(--line)',
              height: HAUTEUR_LIGNE,
              boxShadow: coche ? 'inset 3px 0 0 0 var(--accent)' : undefined,
            }}
          >
            {/* La pastille de non-lu passe en repère absolu : en colonne, elle
                coûtait une vingtaine de pixels à toutes les tuiles, y compris
                aux messages lus qui n'en ont pas l'usage. */}
            {neuf && (
              <span
                className="absolute top-1/2 left-[0.1875rem] h-1.5 w-1.5 -translate-y-1/2 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
            {/* La pastille cède la place à une coche : c'est le repère le plus
                lisible, et il occupe exactement la même surface, si bien que
                rien ne se déplace quand on coche. */}
            {coche ? (
              <span className="flex flex-none items-center justify-center">
                <Icone
                  nom="check_circle"
                  taille="1.875rem"
                  rempli
                  style={{ color: 'var(--accent)' }}
                />
              </span>
            ) : (
              <Pastille
                texte={initiales(m.nom)}
                fond={fond}
                couleur={encre}
                logo={logos[domaineDe(m.adresse)]}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-[0.8438rem]"
                  style={{ fontWeight: neuf ? 600 : 500 }}
                >
                  {m.nom}
                </span>
                {teinteDuCompte && (
                  // La photo du compte plutôt que son adresse en toutes
                  // lettres : elle se reconnaît d'un coup d'œil et ne mange
                  // pas la ligne du nom, qui est l'information principale.
                  // L'adresse reste en infobulle pour lever un doute.
                  <span
                    className="flex flex-none items-center justify-center rounded-full"
                    style={{
                      width: 18,
                      height: 18,
                      background: teinteDuCompte[0],
                      // Un anneau de la couleur du compte : la photo Google est
                      // ronde et neutre, et deux comptes se ressemblent vite.
                      // C'est désormais le seul repère de couleur de la tuile.
                      boxShadow: `0 0 0 1.5px ${teinteDuCompte[1]}`,
                    }}
                    title={`Reçu sur ${m.compte}`}
                  >
                    {compteRecepteur?.photo ? (
                      <img
                        src={compteRecepteur.photo}
                        alt=""
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className="text-[0.5312rem] font-bold"
                        style={{ color: teinteDuCompte[1] }}
                      >
                        {initiales(m.compte)}
                      </span>
                    )}
                  </span>
                )}
                <span
                  className="flex-none font-mono text-[0.6562rem]"
                  style={{ color: 'var(--sub)' }}
                >
                  {heureCourte(m.date)}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[0.7812rem] font-medium">
                {m.sujet || '(sans objet)'}
              </span>
              <span
                className="mt-0.5 block truncate text-[0.75rem]"
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
        className="flex flex-1 items-center justify-center text-[0.8125rem]"
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
            taille="1.875rem"
            fond={fond}
            couleur={encre}
            logo={logos[domaineDe(message.adresse)]}
          />
          <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-tight">
            {message.sujet || '(sans objet)'}
          </h2>
          <span className="flex-none text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            {heureCourte(message.date)}
          </span>
        </div>

        {/* Le nom seul sur cette ligne : elle a une hauteur fixe, et une
            adresse entière n'y tiendrait pas sans être coupée. Les adresses
            sont plus bas, où elles ont la place de passer à la ligne. */}
        <div className="mt-1.5 flex items-center gap-2 pl-[2.5rem]">
          <span className="min-w-0 flex-1 truncate text-[0.7812rem] font-semibold">
            {message.nom}
          </span>
          {actions && (
            <span className="flex flex-none items-center gap-2">{actions}</span>
          )}
        </div>
      </div>

      {/* `key` sur l'identifiant du message : chaque message rouvre le panneau
          selon le réglage des Paramètres, au lieu d'hériter du repli décidé
          sur le message précédent. C'est ce que veut dire « afficher les
          destinataires dépliés » — le choix vaut pour chaque mail, pas pour la
          première lecture de la session. */}
      <Destinataires key={message.id} message={message} onCopier={onCopier} />

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
  // L'état de départ vient des Paramètres, et il est repris **à chaque
  // message** : l'appelant remonte ce composant en le clefant sur
  // l'identifiant. Replier le panneau sur un message ne décide donc rien pour
  // le suivant — sans quoi le réglage n'aurait servi qu'à la première lecture
  // de la session.
  //
  // La préférence est lue directement, et non reçue en cascade depuis
  // l'application : la traverser sur trois étages pour un booléen coûte plus
  // cher qu'une lecture, et une lecture différée ferait clignoter le panneau à
  // l'ouverture.
  const [ouvert, setOuvert] = useState(() => lirePreferences().destinatairesDeplies)

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
        className="survolable absolute top-1.5 right-3 z-10 flex h-6 items-center gap-1 rounded-md px-2 text-[0.6875rem] font-semibold"
        style={{ color: 'var(--sub)' }}
      >
        {!ouvert && total > 0 && (
          <span>
            {total} destinataire{total > 1 ? 's' : ''}
          </span>
        )}
        <Icone
          nom="expand_more"
          taille="0.9375rem"
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
            className="w-[2.625rem] flex-none text-right text-[0.6875rem] font-semibold"
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
            className="w-[2.625rem] flex-none text-right text-[0.6875rem] font-semibold"
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
        <span className="text-[0.75rem] font-medium">{contact.nom}</span>
      )}
      {/* `.valeur` porte le survol : c'est l'adresse qu'on copie, et elle
          seule doit s'allumer. `break-all` la fait continuer à la ligne
          suivante plutôt que déborder du cadre. */}
      <span
        className="valeur font-mono text-[0.6875rem] break-all"
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

  // Un message écrit en HTML s'affiche sur une feuille blanche, comme il a été
  // conçu. Les fichiers joints tiennent sur la même feuille, à sa suite : ils
  // appartiennent à la lettre, pas au cadre de l'application.
  const surPapier = Boolean(corps?.html)

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      style={surPapier ? { background: '#FFFFFF' } : undefined}
    >
      <CorpsIsole corps={corps} extrait={message.extrait} />
      <PiecesJointes
        message={message.id}
        pieces={corps?.pieces ?? []}
        surPapier={surPapier}
      />
    </div>
  )
}

/**
 * Les fichiers joints, sous l'en-tête du message.
 *
 * # Des vignettes, pas une liste de noms
 *
 * Un nom de fichier ne dit rien : `5919.jpg` ne se distingue de `5917.jpg` par
 * rien du tout. Les images se montrent donc, et l'on reconnaît d'un coup d'œil
 * ce qu'on a reçu — c'est ce que fait Gmail, pour la même raison.
 *
 * Chaque vignette est fabriquée côté Rust à partir des seuls pixels du fichier,
 * puis rangée sur le disque avec le corps du message : une photo pèse plusieurs
 * mégaoctets qu'on ne retéléchargera pas à chaque ouverture. Voir
 * `commands::piece_jointe_vignette`.
 *
 * Ce qui n'est pas une image — un PDF, un document — garde une pastille de nom
 * de fichier : plus honnête qu'une illustration générique qui ferait croire à
 * un aperçu.
 *
 * # Voir, garder, ouvrir
 *
 * Un clic ouvre l'aperçu ; l'enregistrement est un second geste, dans la
 * fenêtre. C'est l'ordre naturel — on regarde d'abord, on décide ensuite — et
 * il évite d'encombrer le dossier de téléchargement pour une facture qu'on
 * voulait seulement lire.
 *
 * Rien n'est jamais **ouvert** : ouvrir un fichier venu d'un e-mail reviendrait
 * à laisser un expéditeur choisir quel programme démarre sur la machine.
 */
export function PiecesJointes({
  message,
  pieces,
  surPapier,
}: {
  message: string
  pieces: readonly PieceJointe[]
  /** Vrai quand le message s'affiche sur la feuille blanche. */
  surPapier: boolean
}) {
  const [ouverte, setOuverte] = useState<PieceJointe | null>(null)
  const [enregistrees, setEnregistrees] = useState<Record<string, string>>({})

  if (pieces.length === 0) return null

  const teintes = surPapier ? PAPIER : ECRAN

  return (
    <div
      className="flex flex-col gap-2.5 border-t px-9 py-4"
      style={{ background: teintes.fond, borderColor: teintes.trait }}
    >
      <div className="flex items-center gap-2">
        <Icone nom="attach_file" taille="1rem" style={{ color: teintes.discret }} />
        <span
          className="text-[0.8125rem] font-semibold"
          style={{ color: teintes.encre }}
        >
          {pieces.length === 1 ? '1 pièce jointe' : `${pieces.length} pièces jointes`}
        </span>
        {Object.keys(enregistrees).length > 0 && (
          <span className="text-[0.75rem]" style={{ color: teintes.discret }}>
            • enregistrée dans vos téléchargements
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {pieces.map((p) => (
          <Jointe
            key={p.id}
            message={message}
            piece={p}
            teintes={teintes}
            enregistree={Boolean(enregistrees[p.id])}
            onOuvrir={() => setOuverte(p)}
          />
        ))}
      </div>

      {ouverte && (
        <ApercuPieceJointe
          message={message}
          piece={ouverte}
          onFermer={() => setOuverte(null)}
          onEnregistree={(chemin) =>
            setEnregistrees((connues) => ({ ...connues, [ouverte.id]: chemin }))
          }
        />
      )}
    </div>
  )
}

/**
 * Deux jeux de couleurs, pour deux fonds.
 *
 * Un message écrit en HTML s'affiche sur une feuille blanche, quel que soit le
 * thème de l'application — ces lettres sont conçues pour du papier, et les
 * recolorer rendrait illisible tout ce qui fixe sa propre couleur de texte. Ce
 * qui les accompagne doit tenir sur la même feuille : une bande sombre au pied
 * d'une page blanche se lit comme un morceau de l'application posé par-dessus
 * le courrier, et non comme la suite du message.
 *
 * Les valeurs sont écrites en clair et non prises aux variables du thème,
 * précisément parce qu'elles ne doivent pas suivre le thème.
 */
const PAPIER = {
  fond: '#FFFFFF',
  trait: '#E8EAED',
  encre: '#202124',
  discret: '#5F6368',
  creux: '#F1F3F4',
  bordure: '#DADCE0',
} as const

/** Un message sans HTML reste dans le décor de l'application. */
const ECRAN = {
  fond: 'var(--card)',
  trait: 'var(--line)',
  encre: 'var(--fg)',
  discret: 'var(--sub)',
  creux: 'var(--sunk)',
  bordure: 'var(--line)',
} as const

type Teintes = typeof PAPIER | typeof ECRAN

/** Largeur d'une vignette. Trois tiennent de front dans le panneau de lecture. */
const LARGEUR_VIGNETTE = '11.5rem'

/**
 * Une pièce jointe, avec sa vignette quand c'en est une image.
 *
 * La vignette est demandée à l'affichage, pas au survol ni au clic : sans elle
 * la carte reste un rectangle gris, et un rectangle gris ne dit rien de plus
 * qu'un nom de fichier.
 */
function Jointe({
  message,
  piece,
  teintes,
  enregistree,
  onOuvrir,
}: {
  message: string
  piece: PieceJointe
  teintes: Teintes
  enregistree: boolean
  onOuvrir: () => void
}) {
  /** `undefined` tant qu'on cherche, `null` quand il n'y a pas d'image. */
  const [vignette, setVignette] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let abandonne = false

    // Le type annoncé vient de l'expéditeur : il ne sert qu'à décider si la
    // demande vaut la peine. C'est le backend qui tranche, sur les octets.
    if (!piece.typeMime.toLowerCase().startsWith('image/')) {
      setVignette(null)
      return
    }

    void pieceJointeVignette(message, piece.id)
      .then((png) => {
        if (!abandonne) setVignette(png)
      })
      .catch((e) => {
        console.error('vignette indisponible', e)
        if (!abandonne) setVignette(null)
      })

    return () => {
      abandonne = true
    }
  }, [message, piece.id, piece.typeMime])

  return (
    <button
      type="button"
      onClick={onOuvrir}
      title={`Afficher ${piece.nom}`}
      style={{ width: LARGEUR_VIGNETTE, borderColor: teintes.bordure }}
      className="flex flex-col overflow-hidden rounded-xl border text-left transition-shadow hover:shadow-md"
    >
      <span
        className="flex h-24 items-center justify-center overflow-hidden"
        style={{ background: teintes.creux }}
      >
        {vignette ? (
          <img
            src={`data:image/png;base64,${vignette}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <Icone
            nom={vignette === undefined ? 'progress_activity' : 'description'}
            taille="1.5rem"
            tourne={vignette === undefined}
            style={{ color: teintes.discret }}
          />
        )}
      </span>

      <span
        className="flex items-center gap-1.5 px-2.5 py-2"
        style={{ background: teintes.fond }}
      >
        <Icone
          nom={enregistree ? 'check_circle' : 'visibility'}
          taille="0.9375rem"
          rempli={enregistree}
          style={{ color: enregistree ? 'var(--accent-fg)' : teintes.discret }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[0.75rem] font-semibold"
            style={{ color: teintes.encre }}
          >
            {piece.nom}
          </span>
          <span className="block text-[0.6875rem]" style={{ color: teintes.discret }}>
            {poids(piece.taille)}
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * Le contenu d'un message, isolé du reste de l'application.
 *
 * Partagé par le panneau de lecture et la fenêtre en grand des newsletters :
 * le bac à sable est la pièce qui rend l'affichage acceptable, et il ne doit
 * exister qu'en un seul exemplaire.
 *
 * Le cadre prend la hauteur de son contenu et **ne défile pas lui-même** :
 * c'est le conteneur appelant qui défile. Sans quoi ce qui suit le message —
 * les fichiers joints — se retrouverait plaqué au bas de la fenêtre, à
 * plusieurs centimètres d'une lettre de trois lignes.
 */
export function CorpsIsole({
  corps,
  extrait,
}: {
  corps: CorpsMessage | null
  /** Montré quand Gmail n'a rendu ni HTML ni texte. */
  extrait: string
}) {
  if (corps?.html) {
    return <CadreIsole html={corps.html} />
  }

  const texte = corps?.texte ?? extrait

  return (
    <>
      <div className="px-9 py-6">
        <pre className="selectionnable font-sans text-[0.8438rem] leading-relaxed whitespace-pre-wrap">
          <TexteAvecLiens texte={texte} />
        </pre>
      </div>
      {!corps?.texte && <Avertissement />}
    </>
  )
}

/**
 * Du texte brut dont les adresses sont cliquables.
 *
 * Un message sans HTML s'affichait tel quel : les adresses y étaient du texte
 * mort, et il fallait les recopier à la main dans un navigateur. C'est le
 * format des confirmations de commande et des liens de connexion à usage
 * unique — précisément les messages dont on vient chercher le lien.
 *
 * Le clic passe par le même chemin que dans le HTML : `lienOuvrir`, donc la
 * commande Rust, donc la liste blanche de schémas. Rien n'est décidé ici.
 */
function TexteAvecLiens({ texte }: { texte: string }) {
  const morceaux = useMemo(() => decouperLesLiens(texte), [texte])

  return (
    <>
      {morceaux.map((morceau, i) =>
        morceau.genre === 'texte' ? (
          <span key={i}>{morceau.contenu}</span>
        ) : (
          <a
            key={i}
            href={morceau.adresse}
            onClick={(e) => {
              // Sans cela, le webview quitterait l'application pour le site.
              e.preventDefault()
              void lienOuvrir(morceau.adresse).catch((erreur) =>
                signalerUneErreur(messageDErreur(erreur)),
              )
            }}
            className="underline decoration-1 underline-offset-2"
            style={{ color: 'var(--accent-fg)' }}
          >
            {morceau.contenu}
          </a>
        ),
      )}
    </>
  )
}

/** Hauteur de départ, le temps que le document se charge et se mesure. */
const HAUTEUR_INITIALE = 320

/**
 * Adresse du cadre, servie par le protocole de `cadre.rs`.
 *
 * `convertFileSrc` donne la forme que la plateforme attend :
 * `mailflow-corps://localhost/...` partout, `http://mailflow-corps.localhost/...`
 * sous Windows et Android. L'écrire à la main marcherait sur cette machine et
 * nulle part ailleurs.
 */
function adresseDuCadre(): string {
  // `convertFileSrc` lit `window.__TAURI_INTERNALS__`. Les tests de rendu du
  // projet passent par `renderToString`, qui n'a pas de fenêtre : calculer
  // l'adresse au chargement du module faisait tomber tout fichier qui importe
  // celui-ci, y compris ceux qui n'affichent jamais de cadre.
  if (typeof window === 'undefined') return ''
  return convertFileSrc('cadre.html', 'mailflow-corps')
}

/** Ce que le cadre sait dire à l'application. */
type MessageDuCadre =
  | { type: 'mailflow:pret' }
  | { type: 'mailflow:hauteur'; hauteur: number }
  | { type: 'mailflow:lien'; adresse: string }

/**
 * Le cadre qui porte le HTML de l'expéditeur, ajusté à la hauteur du document.
 *
 * # Pourquoi il ne s'agit plus d'un `srcdoc`
 *
 * Le corps était posé par `srcdoc` dans un bac à sable sans `allow-scripts`.
 * Rien ne s'y exécutait, ce qui était la garantie voulue — mais **un clic sur
 * un lien n'y produisait rien non plus**. Ce n'était pas une maladresse : un
 * document dont le bac à sable a désactivé le script ne se voit servir aucun
 * écouteur d'événement, y compris ceux que l'application y pose de l'extérieur.
 * Une sonde l'a mesuré plutôt que supposé : l'écoute était bien posée, et
 * l'événement qu'on s'envoyait à soi-même dans ce document ne revenait jamais.
 *
 * Le corps est maintenant servi par un protocole à lui, `mailflow-corps://`,
 * qui porte sa propre politique de sécurité — voir `cadre.rs` pour le détail de
 * ce qu'on gagne et de ce qu'on perd. L'essentiel tient en deux points :
 *
 * - le cadre exécute un script, mais **seulement le nôtre** : sa politique
 *   déclare `script-src 'self'`, sans `unsafe-inline`, ce qui refuse aussi bien
 *   une balise `<script>` de l'expéditeur qu'un attribut `onclick` ;
 * - il vit dans une **origine distincte** de celle de l'application, ce qui
 *   n'était pas le cas avant. Son script ne peut ni lire le document de
 *   MailFlow, ni atteindre `frameElement` pour se défaire de son bac à sable.
 *
 * `default-src 'none'` n'a pas bougé : rien ne sort du cadre, et les pixels de
 * suivi restent morts.
 *
 * # Sur la mesure
 *
 * L'origine étant distincte, `contentDocument` n'est plus lisible — et c'est
 * voulu. La hauteur arrive donc par message, mesurée à l'intérieur. Ça vaut
 * mieux que l'ancien procédé, qui repliait le cadre à zéro avant chaque lecture
 * pour contourner le fait qu'un document déclare toujours au moins la hauteur
 * du cadre qui le porte.
 */
function CadreIsole({ html }: { html: string }) {
  const cadre = useRef<HTMLIFrameElement>(null)

  /** Hauteur du document, ou `null` s'il s'est révélé impossible à mesurer. */
  const [hauteur, setHauteur] = useState<number | null>(HAUTEUR_INITIALE)

  /** Le HTML courant, lu par l'écoute sans qu'elle ait à se reposer. */
  const corps = useRef(html)
  corps.current = html

  /** Vrai dès que le cadre a annoncé qu'il écoute. */
  const pret = useRef(false)

  useEffect(() => {
    const element = cadre.current
    if (!element) return

    let vivant = true

    const ecouter = (evenement: MessageEvent) => {
      // Le cadre est en origine opaque pour ce qui nous concerne : c'est la
      // source qui l'identifie, pas l'origine. Sans ce test, n'importe quel
      // autre cadre de la page pourrait faire ouvrir une adresse.
      if (!vivant || evenement.source !== element.contentWindow) return

      const message = evenement.data as MessageDuCadre | null
      if (!message || typeof message !== 'object') return

      switch (message.type) {
        case 'mailflow:pret':
          pret.current = true
          element.contentWindow?.postMessage(
            { type: 'mailflow:corps', html: corps.current },
            '*',
          )
          break

        case 'mailflow:hauteur':
          if (typeof message.hauteur === 'number' && message.hauteur > 0) {
            setHauteur(message.hauteur)
          }
          break

        case 'mailflow:lien':
          if (typeof message.adresse !== 'string') break
          // L'échec se dit à l'écran. Il ne se disait qu'à la console, et un
          // lien qui n'ouvrait rien restait indistinguable d'un lien mort.
          void lienOuvrir(message.adresse).catch((e) =>
            signalerUneErreur(messageDErreur(e)),
          )
          break
      }
    }

    /**
     * Le corps est aussi envoyé au chargement du cadre, et pas seulement à son
     * signal.
     *
     * Le signal part quand le script du cadre s'exécute — ce qui peut arriver
     * **avant** que React n'ait posé cette écoute, le protocole répondant sans
     * passer par le réseau. Le signal se perdait alors, et le message restait
     * vide pour toujours. L'événement `load`, lui, arrive après l'exécution des
     * scripts différés : à ce moment, le cadre écoute à coup sûr.
     *
     * Envoyer deux fois est sans conséquence : le cadre réécrit le même corps.
     */
    const alimenter = () => {
      if (!vivant) return
      pret.current = true
      element.contentWindow?.postMessage(
        { type: 'mailflow:corps', html: corps.current },
        '*',
      )
    }

    window.addEventListener('message', ecouter)
    element.addEventListener('load', alimenter)

    return () => {
      vivant = false
      pret.current = false
      window.removeEventListener('message', ecouter)
      element.removeEventListener('load', alimenter)
    }
  }, [])

  // Changer de message sans recharger le cadre : le script est déjà en place,
  // il suffit de lui donner le nouveau corps. Recharger ferait clignoter un
  // document blanc entre deux lettres.
  useEffect(() => {
    if (!pret.current) return
    cadre.current?.contentWindow?.postMessage(
      { type: 'mailflow:corps', html },
      '*',
    )
  }, [html])

  return (
    <iframe
      ref={cadre}
      title="Contenu du message"
      // `allow-scripts` pour notre seul script — la politique du document
      // refuse tous les autres. `allow-same-origin` garde au cadre son origine
      // `mailflow-corps://`, qui n'est pas celle de l'application : la
      // combinaison n'est dangereuse que lorsque les deux origines coïncident,
      // ce qui n'est justement plus le cas.
      sandbox="allow-scripts allow-same-origin"
      src={adresseDuCadre()}
      scrolling={hauteur === null ? 'auto' : 'no'}
      className="w-full"
      style={{
        border: 0,
        background: '#FFFFFF',
        height: hauteur === null ? '100%' : `${hauteur}px`,
      }}
    />
  )
}

/** Dit pourquoi le message paraît tronqué, plutôt que de laisser croire à un bug. */
function Avertissement() {
  return (
    <div
      className="flex flex-none items-start gap-2.5 border-t px-9 py-3"
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      <Icone nom="shield" taille="1rem" style={{ color: 'var(--sub)' }} />
      <p className="text-[0.75rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
        Seul l'extrait fourni par Gmail est disponible pour ce message.
      </p>
    </div>
  )
}
