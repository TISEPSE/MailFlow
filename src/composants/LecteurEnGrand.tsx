/**
 * Le message d'origine, en grand, dans une fenêtre.
 *
 * # Pourquoi il vit ici et non dans une vue
 *
 * Il a d'abord été écrit pour les newsletters, où l'on parcourt des cartes et
 * où « Voir le mail » est le geste qui sort du résumé. La table des archives a
 * exactement le même besoin, pour une raison différente : une tuile ne montre
 * qu'un expéditeur et un objet, et l'ouvrir ne peut pas renvoyer vers une liste
 * — un message archivé n'est plus dans la boîte de réception, il n'y a donc
 * aucune liste où le montrer.
 *
 * En écrire un second aurait donné deux fenêtres qui divergent : l'une qui
 * afficherait les pièces jointes et l'autre non, l'une qui saurait charger le
 * corps manquant et l'autre non. C'est déjà arrivé une fois sur ce projet.
 *
 * # Ce qu'il fait
 *
 * Le fond de l'application s'estompe et se floute derrière : le message occupe
 * l'écran le temps qu'on le lise, et la page reste à sa place quand on referme.
 * Le corps passe par la même `iframe` en bac à sable qu'ailleurs — rien ne
 * s'exécute, quoi que contienne le message.
 *
 * # Sur l'attente
 *
 * Le corps n'est pas toujours là quand la fenêtre s'ouvre : il faut souvent
 * aller le chercher chez Gmail. Auparavant, cette attente ne se voyait pas —
 * la fenêtre affichait l'extrait de deux lignes fourni par Gmail, ou rien du
 * tout, et l'échec partait dans un `catch` vide. Une fenêtre vide qui ne dit
 * rien est indiscernable d'un message vide : on referme en croyant qu'il n'y a
 * rien à lire, alors que le corps était en route.
 *
 * D'où trois états déclarés plutôt qu'un seul : ce qui charge le dit, ce qui a
 * échoué le dit aussi et propose de recommencer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bouton, Icone, Modale, SqueletteLettre } from './base'
import { CorpsIsole, PiecesJointes } from './ListeMessages'
import { messageCorps, messageDErreur } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

/**
 * Délai avant que le squelette n'apparaisse.
 *
 * Un corps déjà en cache revient en quelques millisecondes. Montrer le
 * squelette aussitôt le ferait clignoter à chaque ouverture — un défaut
 * d'affichage là où il n'y avait aucune attente à signaler.
 */
const AVANT_LE_SQUELETTE = 150

/** Ce que la fenêtre est en train de faire du corps du message. */
type Etat =
  | { quoi: 'charge'; corps: CorpsMessage }
  | { quoi: 'chargement' }
  | { quoi: 'echec'; raison: string }

export function LecteurEnGrand({
  message,
  corps,
  onCorpsCharge,
  onFermer,
  actions,
}: {
  message: MessageAffiche
  corps: CorpsMessage | null
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  onFermer: () => void
  /** Gestes propres à la page qui l'ouvre, posés en pied de fenêtre. */
  actions?: React.ReactNode
}) {
  const [etat, setEtat] = useState<Etat>(
    corps ? { quoi: 'charge', corps } : { quoi: 'chargement' },
  )

  /** Change à chaque tentative : c'est ce qui relance l'effet sur « Réessayer ». */
  const [essai, setEssai] = useState(0)

  /** Vrai une fois le délai de grâce écoulé, jamais avant. */
  const [attenteVisible, setAttenteVisible] = useState(false)

  const signaler = useRef(onCorpsCharge)
  signaler.current = onCorpsCharge

  useEffect(() => {
    if (corps) {
      setEtat({ quoi: 'charge', corps })
      return
    }

    let courant = true
    setEtat({ quoi: 'chargement' })
    setAttenteVisible(false)

    const grace = window.setTimeout(() => {
      if (courant) setAttenteVisible(true)
    }, AVANT_LE_SQUELETTE)

    messageCorps(message.id)
      .then((c) => {
        if (!courant) return
        setEtat({ quoi: 'charge', corps: c })
        signaler.current(message.id, c)
      })
      .catch((e) => {
        // L'échec se dit à l'écran. Il ne se disait nulle part : la fenêtre
        // restait sur l'extrait de Gmail, et l'on ne pouvait pas distinguer un
        // message court d'un corps qui n'était jamais arrivé.
        if (courant) setEtat({ quoi: 'echec', raison: messageDErreur(e) })
      })

    return () => {
      courant = false
      window.clearTimeout(grace)
    }
  }, [message.id, corps, essai])

  const reessayer = useCallback(() => setEssai((n) => n + 1), [])

  return (
    <Modale
      taille="grande"
      sansRembourrage
      titre={message.sujet || '(sans objet)'}
      sous={`${message.nom} · ${message.adresse}`}
      onFermer={onFermer}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={
            etat.quoi === 'charge' && etat.corps.html ? { background: '#FFFFFF' } : undefined
          }
        >
          {etat.quoi === 'charge' ? (
            <>
              <CorpsIsole corps={etat.corps} extrait={message.extrait} />
              <PiecesJointes
                message={message.id}
                pieces={etat.corps.pieces}
                surPapier={Boolean(etat.corps.html)}
              />
            </>
          ) : etat.quoi === 'echec' ? (
            <Echec raison={etat.raison} onReessayer={reessayer} />
          ) : (
            attenteVisible && <SqueletteLettre />
          )}
        </div>

        {actions && (
          <div
            className="flex flex-none items-center justify-end gap-2 border-t px-5 py-3"
            style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
          >
            {actions}
          </div>
        )}
      </div>
    </Modale>
  )
}

/**
 * Ce qui s'affiche quand le corps n'a pas pu être relevé.
 *
 * La raison est celle que le backend a rendue, en clair : elle distingue une
 * coupure réseau d'un compte déconnecté, et c'est cette distinction qui dit s'il
 * sert à quelque chose de réessayer.
 */
function Echec({ raison, onReessayer }: { raison: string; onReessayer: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-9 py-16 text-center">
      <Icone nom="error" taille="1.75rem" style={{ color: 'var(--sub)' }} />
      <p className="text-[0.875rem] font-semibold">Le message n'a pas pu être ouvert.</p>
      <p className="max-w-md text-[0.8125rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
        {raison}
      </p>
      <span className="pt-1">
        <Bouton icone="refresh" onClick={onReessayer}>
          Réessayer
        </Bouton>
      </span>
    </div>
  )
}
