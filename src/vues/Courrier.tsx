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
  Etiquette,
  Icone,
  SqueletteLecture,
  SqueletteListe,
  Vide,
} from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { Lecture, ListeMessages } from '../composants/ListeMessages'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
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
  sombre,
  logos,
  onOuvrir,
  onSignalerSpam,
  onRepondre,
  onRanger,
  libelles,
  chargement,
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  proposition?: Proposition
  regles: Regle[]
  onCreerRegle: (regle: Regle) => Promise<void>
  sombre: boolean
  logos: Record<string, string>
  /** Ouvrir un message le marque comme lu chez Gmail. */
  onOuvrir: (id: string) => void
  /** Absent pour les vues où le signalement n'a pas de sens. */
  onSignalerSpam?: (id: string) => void
  /** Absents hors des mails directs, où répondre n'aurait pas de sens. */
  onRepondre?: (message: MessageAffiche) => void
  onRanger?: (id: string, libelle?: string) => void
  libelles?: LibelleGmail[]
  /** Vrai tant que le premier relevé n'a pas abouti. */
  chargement?: boolean
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const choisi = messages.find((m) => m.id === selection) ?? messages[0]
  const [corps, setCorps] = useState<CorpsMessage | null>(null)
  const [chargementCorps, setChargementCorps] = useState(false)

  const idAffiche = choisi?.id
  useEffect(() => {
    if (!idAffiche) return

    // Un identifiant témoin : quand l'utilisateur enchaîne les messages, la
    // réponse d'une lecture abandonnée ne doit pas s'afficher sous un autre
    // en-tête.
    let courant = true
    setCorps(null)
    setChargementCorps(true)

    messageCorps(idAffiche)
      .then((c) => courant && setCorps(c))
      .catch(() => courant && setCorps(null))
      .finally(() => courant && setChargementCorps(false))

    return () => {
      courant = false
    }
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

  const [encre, fond] = ton(choisi.categorie, sombre)

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
      />
      <Lecture
        message={choisi}
        corps={corps}
        chargement={chargementCorps}
        logos={logos}
        actions={
          <>
            <Etiquette
              texte={LIBELLE_CATEGORIE[choisi.categorie]}
              fond={fond}
              couleur={encre}
            />

            {onRepondre && onRanger && (
              <BarreDeReponse
                message={choisi}
                libelles={libelles ?? []}
                enCours={enCours}
                onRepondre={onRepondre}
                onRanger={onRanger}
              />
            )}

            {onSignalerSpam ? (
              <Bouton
                variante="principal"
                icone="report"
                onClick={() => onSignalerSpam(choisi.id)}
                disabled={enCours}
              >
                Signaler comme spam
              </Bouton>
            ) : (
              proposition &&
              choisi.adresse &&
              !regleExistante && (
                <Bouton
                  variante="principal"
                  icone={proposition.icone}
                  onClick={() => void poser()}
                  disabled={enCours}
                >
                  {enCours ? 'Enregistrement…' : proposition.libelle}
                </Bouton>
              )
            )}

            {regleExistante && (
              <span
                className="inline-flex items-center gap-1.5 text-[12px]"
                style={{ color: 'var(--accent-fg)' }}
              >
                <Icone nom="bolt" taille={15} rempli />
                Une règle vise déjà cet expéditeur.
              </span>
            )}

            {proposition && !regleExistante && (
              <span
                className="w-full text-[12px]"
                style={{ color: 'var(--sub)' }}
              >
                {proposition.effet(choisi.nom)}
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
 * Le choix du libellé se fait avant de ranger, pas après : l'utilisateur voit
 * où le message va partir au moment où il décide, plutôt que de l'apprendre par
 * un message de confirmation.
 */
function BarreDeReponse({
  message,
  libelles,
  enCours,
  onRepondre,
  onRanger,
}: {
  message: MessageAffiche
  libelles: LibelleGmail[]
  enCours: boolean
  onRepondre: (message: MessageAffiche) => void
  onRanger: (id: string, libelle?: string) => void
}) {
  const [destination, setDestination] = useState('')

  return (
    <>
      <Bouton
        variante="principal"
        icone="reply"
        onClick={() => onRepondre(message)}
        disabled={enCours}
      >
        Répondre
      </Bouton>

      <Bouton
        icone="archive"
        onClick={() => onRanger(message.id, destination || undefined)}
        disabled={enCours}
      >
        Archiver
      </Bouton>

      {libelles.length > 0 && (
        <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--sub)' }}>
          dans
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            aria-label="Libellé de destination"
            className="bouton bouton-neutre rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ color: 'var(--fg)' }}
          >
            <option value="">Aucun libellé</option>
            {libelles.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
