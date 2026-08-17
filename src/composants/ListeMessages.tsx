/**
 * Liste de messages, partagée par les vues Mails directs, Publicités,
 * Newsletters et Formations.
 *
 * Elle n'affiche que ce que le backend transmet : nom, adresse, sujet, extrait,
 * date. Pas de corps de message — c'est du HTML écrit par un inconnu, et il ne
 * traversera l'IPC que le jour où une `iframe` en bac à sable saura l'afficher.
 */
import { useEffect, useRef, useState } from 'react'
import {
  HAUTEUR_LIGNE,
  Icone,
  LARGEUR_LISTE,
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
import { signalerUneErreur } from '../lib/crochets'
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
          {texte}
        </pre>
      </div>
      {!corps?.texte && <Avertissement />}
    </>
  )
}

/** Hauteur de départ, le temps que le document se charge et se mesure. */
const HAUTEUR_INITIALE = 320

/**
 * Le cadre qui porte le HTML de l'expéditeur, ajusté à la hauteur du document.
 *
 * # Sur le bac à sable
 *
 * `allow-scripts` reste absent : rien ne s'exécute là-dedans, et c'est une
 * garantie du moteur, pas une promesse de notre part.
 *
 * `allow-same-origin` a en revanche été ajouté, et c'est un choix qui mérite
 * son paragraphe. Il est nécessaire pour lire la hauteur du document : sans
 * lui, le cadre a une origine opaque et `contentDocument` est inaccessible, si
 * bien qu'aucun code ne peut savoir quelle place le message occupe. Or c'est
 * cette mesure qui permet de poser les fichiers joints juste après la lettre,
 * plutôt qu'au fond de la fenêtre.
 *
 * Ce que `allow-same-origin` ouvrirait — l'accès au contexte de l'application —
 * ne s'atteint que par du code. Trois verrous indépendants l'interdisent ici :
 *
 * 1. `allow-scripts` est absent, donc le moteur refuse d'exécuter quoi que ce
 *    soit dans ce document — il le journalise de lui-même ;
 * 2. le document déclare sa propre politique `default-src 'none'`, dont
 *    `script-src` hérite — voir [`documentIsole`] ;
 * 3. la politique de l'application n'autorise que ses propres scripts.
 *
 * Le HTML est par ailleurs déjà désinfecté côté Rust. Le danger classique de
 * `allow-same-origin` — un script du cadre qui retire lui-même l'attribut
 * `sandbox` — suppose précisément ce que ces trois verrous rendent impossible.
 *
 * # Sur la mesure
 *
 * Le cadre est **replié à zéro avant chaque lecture**. Sans cela, le document
 * déclare toujours au moins la hauteur du cadre qui le porte : la mesure ne
 * peut alors que croître, jamais redescendre, et une lettre de trois lignes
 * héritait de la hauteur laissée par la précédente. C'est ce qui produisait ces
 * grandes étendues blanches avec les pièces jointes tout en bas.
 */
function CadreIsole({ html }: { html: string }) {
  const cadre = useRef<HTMLIFrameElement>(null)

  /** Hauteur du document, ou `null` s'il s'est révélé impossible à mesurer. */
  const [hauteur, setHauteur] = useState<number | null>(HAUTEUR_INITIALE)

  useEffect(() => {
    const element = cadre.current
    if (!element) return

    let observateur: ResizeObserver | null = null
    let enMesure = false
    let vivant = true

    /** Document du cadre sur lequel l'écoute des clics est posée, s'il y en a un. */
    let documentEcoute: Document | null = null

    /**
     * Ouvre dans le navigateur du système le lien sur lequel on vient de
     * cliquer.
     *
     * Sans cette interception, un clic ne produisait rien : le cadre n'a ni
     * `allow-scripts` ni `allow-popups`, si bien que le moteur refuse la
     * fenêtre surgissante, et le garde-fou de navigation de l'application ne
     * voit pas les navigations de sous-cadre.
     *
     * L'écoute est posée **depuis l'application**, sur le document du cadre —
     * ce que `allow-same-origin` permet. Aucun script ne s'exécute pour autant
     * *dans* le cadre : les trois verrous décrits plus haut restent en place,
     * et c'est bien du code de l'application qui tourne, pas du code de
     * l'expéditeur.
     *
     * L'attribut est lu tel qu'il est écrit dans le message, et non résolu :
     * Rust doit voir exactement ce que l'expéditeur a mis, et refuser lui-même
     * ce qui n'est pas une adresse absolue de schéma autorisé.
     */
    const surClic = (evenement: Event) => {
      // Surtout pas `instanceof Element` : la cible appartient au document du
      // cadre, donc à un autre realm, avec ses propres constructeurs. Le test
      // serait faux pour *tout* élément du message, et l'interception ne se
      // déclencherait jamais. On reconnaît donc la capacité, pas la classe.
      const cible = evenement.target as {
        closest?: (selecteur: string) => Element | null
      } | null

      const lien = cible?.closest?.('a[href], area[href]')
      if (!lien) return

      // Annulé dans tous les cas : même refusée par Rust, cette navigation ne
      // doit pas emporter le cadre — ni, pire, l'application.
      evenement.preventDefault()

      const adresse = lien.getAttribute('href')?.trim()
      if (!adresse || adresse.startsWith('#')) return

      // L'échec se dit à l'écran. Il ne se disait qu'à la console, et un lien
      // qui n'ouvrait rien restait donc indistinguable d'un lien mort : c'est
      // ce silence qui a fait croire la fonctionnalité absente alors qu'elle
      // était seulement empêchée.
      void lienOuvrir(adresse).catch((e) => signalerUneErreur(messageDErreur(e)))
    }

    const mesurer = (document: Document) => {
      // Le garde-fou empêche la boucle : replier le cadre change la mise en
      // page du document, ce que l'observateur signale aussitôt.
      if (enMesure || !vivant) return
      enMesure = true

      element.style.height = '0px'
      const mesure = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      )
      element.style.height = `${mesure}px`

      enMesure = false
      setHauteur(mesure)
    }

    /** Rend `false` tant que le document n'est pas encore là. */
    const brancher = () => {
      let document: Document | null
      try {
        document = element.contentDocument
      } catch {
        // Le moteur refuse la lecture : le cadre reprend toute la place
        // disponible, comme autrefois, plutôt que de tronquer le message.
        // Seuls les fichiers joints passent alors sous la ligne de flottaison.
        setHauteur(null)
        return true
      }

      // Un document pas encore remplacé par `srcdoc` n'a pas de corps. Ce n'est
      // pas un échec : c'est trop tôt, et l'événement de chargement rappellera.
      if (!document?.body) return false

      document.removeEventListener('click', surClic, true)
      document.addEventListener('click', surClic, true)
      documentEcoute = document

      mesurer(document)
      observateur?.disconnect()
      observateur = new ResizeObserver(() => mesurer(document))
      // Les images arrivent après le chargement du document et changent la
      // hauteur : sans cette observation, une lettre illustrée resterait
      // tronquée à la taille de son seul texte.
      observateur.observe(document.body)
      return true
    }

    element.addEventListener('load', brancher)
    // Le document peut être déjà en place quand l'effet se déclenche : le
    // `srcdoc` d'une chaîne se charge sans passer par le réseau, et
    // l'événement a pu partir avant que React n'écoute.
    brancher()

    return () => {
      vivant = false
      element.removeEventListener('load', brancher)
      documentEcoute?.removeEventListener('click', surClic, true)
      observateur?.disconnect()
    }
  }, [html])

  return (
    <iframe
      ref={cadre}
      title="Contenu du message"
      // Ni `allow-scripts` ni `allow-popups` : rien ne s'exécute ici, et le
      // cadre ne peut pas ouvrir de fenêtre. Le clic sur un lien est donc
      // intercepté par l'application elle-même, qui confie l'adresse à Rust —
      // voir `surClic` plus haut.
      sandbox="allow-same-origin"
      srcDoc={documentIsole(html)}
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
  /* La barre de défilement du message est masquée : le cadre a la sienne, et
     deux barres côte à côte n'en font pas une meilleure. Le contenu défile
     toujours, à la molette comme au clavier. */
  body::-webkit-scrollbar { width: 0; height: 0; }
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
