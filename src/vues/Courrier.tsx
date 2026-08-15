/**
 * Les quatre vues de courrier : mails directs, publicités, newsletters,
 * rappels de formation.
 *
 * Elles partagent la même charpente et ne diffèrent que par ce qu'on peut faire
 * d'un expéditeur. Le geste central du produit est là : depuis un message, poser
 * une règle qui vaudra pour tous les suivants.
 */
import { useEffect, useState } from 'react'
import {
  Bouton,
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
  regles: Regle[]
  onCreerRegle: (regle: Regle) => Promise<void>
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
  comptes?: readonly string[]
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

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
  const regleExistante = regles.find(
    (r) => r.expediteur.toLowerCase() === choisi.adresse,
  )

  const poser = async () => {
    if (!proposition || !choisi.adresse) return
    setEnCours(true)
    try {
      await onCreerRegle(
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
      />
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

            {/* Partout, y compris sur les mails directs : le geste du bouton
                Supprimer de Gmail, corbeille comprise. */}
            <Bouton
              compact
              variante="danger"
              icone="delete"
              tailleIcone={15}
              onClick={() => onSupprimer(choisi.id)}
              disabled={enCours}
              titre="Mettre à la corbeille — récupérable 30 jours"
            >
              Supprimer
            </Bouton>

            {regleExistante && (
              <span
                className="inline-flex items-center gap-1.5 text-[12px]"
                style={{ color: 'var(--accent-fg)' }}
              >
                <Icone nom="bolt" taille={15} rempli />
                Une règle vise déjà cet expéditeur.
              </span>
            )}

          </>
        }
      />
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
        <span className="text-[12.5px] font-semibold">Ranger sous</span>
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
        <span className="text-[12.5px] font-semibold">Ou créer un libellé</span>
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
            className="selectionnable min-w-0 flex-1 rounded-xl border px-3.5 py-3 text-[13px] leading-5 outline-none"
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
        <p className="text-[12px]" style={{ color: 'var(--sub)' }}>
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
