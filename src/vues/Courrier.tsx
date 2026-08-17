/**
 * Les quatre vues de courrier : mails directs, publicités, newsletters,
 * rappels de formation.
 *
 * Elles partagent la même charpente et ne diffèrent que par ce qu'on peut faire
 * d'un expéditeur. Le geste central du produit est là : depuis un message, poser
 * une règle qui vaudra pour tous les suivants.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bouton,
  Confirmation,
  Icone,
  Modale,
  Selecteur,
  SqueletteLecture,
  SqueletteListe,
  Vide,
} from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { Lecture, ListeMessages } from '../composants/ListeMessages'

import { nouvelleRegle } from '../lib/regles'
import { messageCorps } from '../lib/tauri'
import type {
  ActionRegle,
  CompteConnu,
  CorpsMessage,
  CategorieMessage,
  LibelleGmail,
  MessageAffiche,
  Regle,
} from '../types/backend'

/**
 * Délai avant d'afficher le squelette de lecture, en millisecondes.
 *
 * En deçà, l'attente ne se voit pas : elle ne mérite donc pas d'être annoncée.
 */
const DELAI_SQUELETTE = 220

/** Ce qu'une vue propose de faire d'un expéditeur. */
export interface Proposition {
  libelle: string
  icone: NomIcone
  action: ActionRegle
  /** Catégorie donnée à la règle créée. */
  categorie: Exclude<CategorieMessage, 'humain'>
  /** Phrase de confirmation, à la première personne du produit. */
  effet: (nom: string) => string
}

export function Courrier({
  messages,
  vide,
  proposition,
  regles,
  onCreerRegle,
  logos,
  onOuvrir,
  corpsConnus,
  onCorpsCharge,
  onSupprimer,
  onCopier,
  onRepondre,
  onRanger,
  onCreerLibelle,
  libelles,
  chargement,
  comptes,
  vise,
  onVise,
}: {
  messages: MessageAffiche[]
  vide: {
    icone: NomIcone
    titre: string
    detail: string
    /** Geste proposé quand la vue ne se remplit pas d'elle-même. */
    action?: { libelle: string; icone?: NomIcone; onClick: () => void }
  }
  proposition?: Proposition
  /** Règles de chaque boîte, indexées par adresse de compte.
   *
   *  Indexées et non mises bout à bout : sous « Tous les comptes », une règle
   *  posée dans une boîte ne dit rien du message d'une autre, et proposer d'en
   *  créer une là où elle existe déjà — ou l'inverse — serait faux. */
  regles: Record<string, Regle[]>
  onCreerRegle: (compte: string, regle: Regle) => Promise<void>
  logos: Record<string, string>
  /** Ouvrir un message le marque comme lu chez Gmail. */
  onOuvrir: (id: string) => void
  /** Corps déjà chargés, tenus par `App` pour survivre au changement de vue. */
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  /** Présent partout : tout message peut aller à la corbeille. */
  onSupprimer: (id: string) => void
  /** Annonce la copie d'une adresse dans le presse-papiers. */
  onCopier?: (adresse: string) => void
  /** Absents hors des mails directs, où répondre n'aurait pas de sens. */
  onRepondre?: (message: MessageAffiche, tous?: boolean) => void
  onRanger?: (id: string, libelle?: string) => void
  onCreerLibelle?: (nom: string) => Promise<void>
  libelles?: LibelleGmail[]
  /** Vrai tant que le premier relevé n'a pas abouti. */
  chargement?: boolean
  /** Renseignés dans la vue mélangée seulement. */
  comptes?: readonly CompteConnu[]
  /** Message désigné par la recherche, à ouvrir sans attendre un clic. */
  vise?: string | null
  /** Prévient que la désignation a été honorée, pour qu'elle ne se répète pas. */
  onVise?: () => void
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  /** Messages cochés pour un geste groupé. Vide la plupart du temps. */
  const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set())

  /** Geste groupé en attente de confirmation. */
  const [groupeAConfirmer, setGroupeAConfirmer] = useState<
    'archiver' | 'supprimer' | null
  >(null)

  const basculer = useCallback((id: string) => {
    setCoches((avant) => {
      const apres = new Set(avant)
      if (!apres.delete(id)) apres.add(id)
      return apres
    })
  }, [])

  const viderLaSelection = useCallback(() => setCoches(new Set()), [])

  // Une coche qui désigne un message disparu n'a plus de sens : après une
  // suppression, la sélection est purgée de ce qui n'est plus là, sans quoi la
  // barre annoncerait un nombre que rien ne justifie.
  useEffect(() => {
    setCoches((avant) => {
      if (avant.size === 0) return avant
      const presents = new Set(messages.map((m) => m.id))
      const apres = new Set([...avant].filter((id) => presents.has(id)))
      return apres.size === avant.size ? avant : apres
    })
  }, [messages])

  // Ctrl+A coche tout, Échap vide la sélection.
  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      // Jamais dans un champ de saisie : Ctrl+A y sélectionne le texte, et le
      // détourner casserait la recherche et les formulaires de règles.
      const cible = e.target
      if (
        cible instanceof HTMLElement &&
        (cible.isContentEditable ||
          cible instanceof HTMLInputElement ||
          cible instanceof HTMLTextAreaElement)
      ) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setCoches(new Set(messages.map((m) => m.id)))
        return
      }

      if (e.key === 'Escape') viderLaSelection()
    }

    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  }, [messages, viderLaSelection])

  /** Message dont la suppression attend confirmation.
   *
   *  Le message entier et non son identifiant : la fenêtre nomme l'expéditeur,
   *  et « Supprimer ce message ? » sans sujet oblige à se souvenir de ce qu'on
   *  visait. */
  const [aSupprimer, setASupprimer] = useState<MessageAffiche | null>(null)

  // La recherche désigne un message : la vue l'ouvre, puis rend la main. Sans
  // ce second temps, la sélection resterait clouée dessus et l'on ne pourrait
  // plus en ouvrir un autre.
  useEffect(() => {
    if (!vise) return
    setSelection(vise)
    onVise?.()
  }, [vise, onVise])

  const choisi = messages.find((m) => m.id === selection) ?? messages[0]

  /** Deux états distincts : une lecture est en cours, et il faut le montrer.
   *  Le second suit le premier de `DELAI_SQUELETTE`. */
  const [attenteCorps, setAttenteCorps] = useState(false)
  const [chargementCorps, setChargementCorps] = useState(false)

  const idAffiche = choisi?.id
  const corps = idAffiche ? (corpsConnus.get(idAffiche) ?? null) : null

  useEffect(() => {
    // Déjà en mémoire : ni appel réseau, ni squelette. C'est tout l'objet du
    // cache — revenir sur un message retéléchargeait ses images à chaque fois.
    if (!idAffiche || corpsConnus.has(idAffiche)) {
      setAttenteCorps(false)
      setChargementCorps(false)
      return
    }

    // Un témoin d'actualité : quand l'utilisateur enchaîne les messages, la
    // réponse d'une lecture abandonnée ne doit pas s'afficher sous un autre
    // en-tête.
    let courant = true
    setAttenteCorps(true)

    // Le squelette attend. Les corps étant préchargés au démarrage, la lecture
    // dure quelques dizaines de millisecondes : le squelette n'avait que le
    // temps d'apparaître et de disparaître, ce qui se lit comme un
    // clignotement, pas comme une attente. Passé ce délai, l'attente est réelle
    // et mérite d'être montrée.
    const minuteur = window.setTimeout(() => {
      if (courant) setChargementCorps(true)
    }, DELAI_SQUELETTE)

    messageCorps(idAffiche)
      .then((c) => courant && onCorpsCharge(idAffiche, c))
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(minuteur)
        if (!courant) return
        setAttenteCorps(false)
        setChargementCorps(false)
      })

    return () => {
      courant = false
      window.clearTimeout(minuteur)
    }
    // `corpsConnus` volontairement absent : son changement vient de cet effet
    // même, et le relancer dessus le ferait tourner en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idAffiche])
  if (chargement) {
    return (
      <div className="flex min-h-0 flex-1">
        <SqueletteListe />
        <SqueletteLecture />
      </div>
    )
  }
  if (!choisi) return <Vide {...vide} />
  const regleExistante = (regles[choisi.compte] ?? []).find(
    (r) => r.expediteur.toLowerCase() === choisi.adresse,
  )

  const poser = async () => {
    if (!proposition || !choisi.adresse) return
    setEnCours(true)
    try {
      await onCreerRegle(
        choisi.compte,
        nouvelleRegle({
          adresse: choisi.adresse,
          nom: choisi.nom,
          categorie: proposition.categorie,
          action: proposition.action,
        }),
      )
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ListeMessages
        messages={messages}
        selection={choisi.id}
        onSelect={(id) => {
          setSelection(id)
          onOuvrir(id)
        }}
        logos={logos}
        comptes={comptes}
        coches={coches}
        onBasculer={basculer}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {coches.size > 0 && (
          <BarreSelection
            nombre={coches.size}
            archivable={Boolean(onRanger)}
            onArchiver={() => setGroupeAConfirmer('archiver')}
            onSupprimer={() => setGroupeAConfirmer('supprimer')}
            onAnnuler={viderLaSelection}
          />
        )}
        <Lecture
        message={choisi}
        corps={corps}
        chargement={chargementCorps}
        attente={attenteCorps}
        logos={logos}
        onCopier={onCopier}
        actions={
          <>
            {onRepondre && onRanger && (
              <BarreDeReponse
                message={choisi}
                libelles={libelles ?? []}
                enCours={enCours}
                onRepondre={onRepondre}
                onRanger={onRanger}
                onCreerLibelle={onCreerLibelle ?? (async () => {})}
              />
            )}

            {proposition && choisi.adresse && !regleExistante && (
              <Bouton
                compact
                variante="principal"
                icone={proposition.icone}
                onClick={() => void poser()}
                disabled={enCours}
                titre={proposition.effet(choisi.nom)}
              >
                {enCours ? 'Enregistrement…' : proposition.libelle}
              </Bouton>
            )}

            {/* Archiver sans classer.
                `BarreDeReponse` porte déjà ce geste sur les mails directs, avec
                le choix d'un libellé. Ailleurs — le triage, les publicités —
                elle n'a pas lieu d'être, et la page n'offrait alors que la
                corbeille : jeter était le seul moyen de vider sa boîte. Or une
                publicité qu'on veut garder sans la lire se range, elle ne se
                jette pas. */}
            {onRanger && !onRepondre && (
              <Bouton
                compact
                variante="principal"
                icone="archive"
                onClick={() => onRanger(choisi.id)}
                disabled={enCours}
                titre="Le mail quitte la boîte de réception et rejoint la table des archives. Rien n'est supprimé."
              >
                Archiver
              </Bouton>
            )}

            {/* Partout, y compris sur les mails directs : le geste du bouton
                Supprimer de Gmail, corbeille comprise. */}
            <Bouton
              compact
              variante="danger"
              icone="delete"
              onClick={() => setASupprimer(choisi)}
              disabled={enCours}
              titre="Mettre à la corbeille — récupérable 30 jours"
            >
              Supprimer
            </Bouton>

            {aSupprimer && (
              <Confirmation
                titre="Mettre ce message à la corbeille ?"
                sous={`De ${aSupprimer.nom} — « ${aSupprimer.sujet || 'sans objet'} ». Gmail le garde trente jours, puis l'efface.`}
                libelle="Supprimer"
                variante="danger"
                icone="delete"
                enCours={enCours}
                onConfirmer={() => {
                  const id = aSupprimer.id
                  setASupprimer(null)
                  onSupprimer(id)
                }}
                onAnnuler={() => setASupprimer(null)}
              />
            )}

            {regleExistante && (
              <span
                className="inline-flex items-center gap-1.5 text-[0.75rem]"
                style={{ color: 'var(--accent-fg)' }}
              >
                <Icone nom="bolt" taille="0.9375rem" rempli />
                Une règle vise déjà cet expéditeur.
              </span>
            )}

          </>
        }
        />
      </div>

      {groupeAConfirmer && (
        <Confirmation
          titre={
            groupeAConfirmer === 'supprimer'
              ? `Mettre ${coches.size} message${coches.size > 1 ? 's' : ''} à la corbeille ?`
              : `Archiver ${coches.size} message${coches.size > 1 ? 's' : ''} ?`
          }
          sous={
            groupeAConfirmer === 'supprimer'
              ? 'Gmail les garde trente jours, puis les efface.'
              : "Ils quittent la boîte de réception ; rien n'est supprimé."
          }
          libelle={groupeAConfirmer === 'supprimer' ? 'Supprimer' : 'Archiver'}
          variante={groupeAConfirmer === 'supprimer' ? 'danger' : 'principal'}
          icone={groupeAConfirmer === 'supprimer' ? 'delete' : 'archive'}
          onConfirmer={() => {
            const geste = groupeAConfirmer
            const vises = [...coches]
            setGroupeAConfirmer(null)
            viderLaSelection()
            for (const id of vises) {
              if (geste === 'supprimer') onSupprimer(id)
              else onRanger?.(id)
            }
          }}
          onAnnuler={() => setGroupeAConfirmer(null)}
        />
      )}
    </div>
  )
}

/**
 * Barre du geste groupé, au-dessus de la lecture.
 *
 * Elle n'apparaît que lorsqu'au moins un message est coché, et se retire dès
 * que la sélection est vidée : une barre permanente coûterait une bande de
 * hauteur à tout le monde pour un geste que la plupart ne feront jamais.
 *
 * Elle rappelle le raccourci plutôt que de le laisser deviner — un Ctrl+clic
 * qui n'annonce pas Ctrl+A ne se découvre pas.
 */
function BarreSelection({
  nombre,
  archivable,
  onArchiver,
  onSupprimer,
  onAnnuler,
}: {
  nombre: number
  archivable: boolean
  onArchiver: () => void
  onSupprimer: () => void
  onAnnuler: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-none items-center gap-2 border-b px-4 py-2"
      style={{ background: 'var(--accent-soft)', borderColor: 'var(--line)' }}
    >
      <Icone nom="check_circle" taille="1rem" rempli style={{ color: 'var(--accent)' }} />
      <span className="text-[0.8125rem] font-semibold">
        {nombre} message{nombre > 1 ? 's' : ''} sélectionné{nombre > 1 ? 's' : ''}
      </span>
      <span className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
        Ctrl+clic pour en ajouter, Ctrl+A pour tout prendre
      </span>

      <span className="flex flex-1 items-center justify-end gap-2">
        {archivable && (
          <Bouton compact variante="principal" icone="archive" onClick={onArchiver}>
            Archiver
          </Bouton>
        )}
        <Bouton compact variante="danger" icone="delete" onClick={onSupprimer}>
          Supprimer
        </Bouton>
        <Bouton compact icone="close" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </span>
    </div>
  )
}

/**
 * Répondre et ranger, pour les mails directs.
 *
 * « Répondre » ouvre le client de courrier du système : MailFlow n'a pas — et
 * ne demande pas — le droit d'envoyer du courrier au nom de l'utilisateur.
 *
 * « Archiver » ouvre une fenêtre plutôt que d'agir aussitôt. Archiver, c'est
 * faire disparaître un message de la boîte : mieux vaut dire où il va avant
 * qu'après.
 */
function BarreDeReponse({
  message,
  libelles,
  enCours,
  onRepondre,
  onRanger,
  onCreerLibelle,
}: {
  message: MessageAffiche
  libelles: LibelleGmail[]
  enCours: boolean
  onRepondre: (message: MessageAffiche, tous?: boolean) => void
  onRanger: (id: string, libelle?: string) => void
  onCreerLibelle: (nom: string) => Promise<void>
}) {
  const [rangement, setRangement] = useState(false)

  // « Répondre à tous » n'a de sens qu'à plusieurs. Sur un message adressé à
  // vous seul, les deux boutons feraient exactement la même chose.
  const aPlusieurs =
    message.destinataires.length + message.copies.length > 1

  return (
    <>
      <Bouton
        compact
        variante="principal"
        icone="reply"
        onClick={() => onRepondre(message)}
        disabled={enCours}
      >
        Répondre
      </Bouton>

      {aPlusieurs && (
        <Bouton
          compact
          icone="reply_all"
          onClick={() => onRepondre(message, true)}
          disabled={enCours}
          titre="Répondre à l'expéditeur et à tous les destinataires"
        >
          Répondre à tous
        </Bouton>
      )}

      <Bouton
        compact
        icone="archive"
        onClick={() => setRangement(true)}
        disabled={enCours}
      >
        Archiver
      </Bouton>

      {rangement && (
        <Modale
          titre="Archiver ce message"
          sous="Il quittera la boîte de réception. Rien n'est supprimé."
          onFermer={() => setRangement(false)}
        >
          <ChoixDeRangement
            libelles={libelles}
            enCours={enCours}
            onCreerLibelle={onCreerLibelle}
            onValider={(libelle) => {
              setRangement(false)
              onRanger(message.id, libelle)
            }}
            onAnnuler={() => setRangement(false)}
          />
        </Modale>
      )}
    </>
  )
}

/** Où ranger le message : nulle part, sous un libellé, ou sous un nouveau. */
function ChoixDeRangement({
  libelles,
  enCours,
  onCreerLibelle,
  onValider,
  onAnnuler,
}: {
  libelles: LibelleGmail[]
  enCours: boolean
  onCreerLibelle: (nom: string) => Promise<void>
  onValider: (libelle?: string) => void
  onAnnuler: () => void
}) {
  const [choix, setChoix] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [creation, setCreation] = useState(false)

  const creer = async () => {
    const nom = nouveau.trim()
    if (!nom || creation) return

    setCreation(true)
    try {
      await onCreerLibelle(nom)
      setNouveau('')
    } finally {
      setCreation(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.7812rem] font-semibold">Ranger sous</span>
        <Selecteur
          valeurs={[
            { valeur: '', texte: 'Aucun libellé' },
            ...libelles.map((l) => ({ valeur: l.id, texte: l.nom })),
          ]}
          valeur={choix}
          onChange={setChoix}
          libelle="Libellé de destination"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.7812rem] font-semibold">Ou créer un libellé</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void creer()
              }
            }}
            placeholder="Factures, Voyages…"
            aria-label="Nom du nouveau libellé"
            className="champ-de-saisie selectionnable min-w-0 flex-1 rounded-xl border px-3.5 py-3 text-[0.8125rem] leading-5 outline-none"
            style={{
              background: 'var(--sunk)',
              borderColor: 'var(--line)',
              color: 'var(--fg)',
            }}
          />
          <Bouton
            onClick={() => void creer()}
            disabled={!nouveau.trim() || creation}
            icone="add"
            className="self-stretch rounded-xl px-4"
          >
            {creation ? 'Création…' : 'Créer'}
          </Bouton>
        </div>
        <p className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
          Le libellé sera créé dans Gmail et vous le retrouverez partout.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
        <Bouton
          variante="principal"
          icone="archive"
          onClick={() => onValider(choix || undefined)}
          disabled={enCours}
        >
          Archiver
        </Bouton>
      </div>
    </div>
  )
}
