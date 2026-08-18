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
 */
import { useEffect, useRef, useState } from 'react'
import { Modale } from './base'
import { CorpsIsole, PiecesJointes } from './ListeMessages'
import { messageCorps } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

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
  const [charge, setCharge] = useState(corps)

  // Le rappel est tenu dans une référence, et non dans les dépendances de
  // l'effet. Les pages le passent en fonction anonyme, si bien qu'il change
  // d'identité à chaque rendu du parent : dans les dépendances, il relançait
  // l'appel réseau à chaque fois, pour le même message.
  const signaler = useRef(onCorpsCharge)
  signaler.current = onCorpsCharge

  // `useEffect` et non `useMemo` : c'est un effet de bord, et React n'appelle
  // pas la fonction de nettoyage d'un `useMemo` — la garde `courant` ne servait
  // donc à rien, et une fenêtre refermée avant la fin de l'appel écrivait dans
  // un composant démonté.
  useEffect(() => {
    if (corps) {
      setCharge(corps)
      return
    }

    let courant = true
    messageCorps(message.id)
      .then((c) => {
        if (!courant) return
        setCharge(c)
        signaler.current(message.id, c)
      })
      .catch(() => undefined)

    return () => {
      courant = false
    }
  }, [message.id, corps])

  return (
    <Modale
      large
      sansRembourrage
      titre={message.sujet || '(sans objet)'}
      sous={`${message.nom} · ${message.adresse}`}
      onFermer={onFermer}
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Le cadre du message prend la hauteur de son contenu : c'est donc ici
            que le défilement doit vivre. Sur la même feuille blanche que le
            message lui-même, sans quoi une bande de fenêtre apparaîtrait
            au-dessous d'une lettre courte. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={charge?.html ? { background: '#FFFFFF' } : undefined}
        >
          <CorpsIsole corps={charge} extrait={message.extrait} />
          {/* Les fichiers joints appartiennent à la lettre : la fenêtre qui
              montrait le texte mais taisait le planning attaché n'en montrait
              pas la moitié. */}
          <PiecesJointes
            message={message.id}
            pieces={charge?.pieces ?? []}
            surPapier={Boolean(charge?.html)}
          />
        </div>

        {/* Les gestes en pied, hors de la feuille : sur le papier blanc du
            message ils passeraient pour un bouton de l'expéditeur. */}
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
