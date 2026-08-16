/**
 * Crochets d'état extraits d'`App.tsx`.
 *
 * `App` portait vingt-deux états dans un seul composant. Ce n'était pas un
 * problème de vitesse — la boîte est plafonnée à soixante messages, et rien de
 * ce que React retrace là ne se mesure. C'était un problème de sûreté : c'est
 * dans ce fichier qu'est né l'écran blanc, une couleur manquante dans un tableau
 * faisant tomber toute l'application au montage.
 *
 * Chaque crochet réunit ici les états qui vont ensemble, et rien d'autre. Le
 * comportement est inchangé — ces fonctions ont été déplacées, pas réécrites.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Toast } from '../composants/base'
import { logosExpediteurs } from './tauri'
import { DEFAUTS, ecrirePreferences, lirePreferences } from './preferences'
import type { MessageAffiche } from '../types/backend'

/** Combien de temps un message passager reste à l'écran. */
const DUREE_TOAST = 3400

/**
 * Messages passagers, empilés en haut à droite.
 *
 * Une liste et non un seul : deux actions rapprochées doivent se voir toutes les
 * deux, au lieu que la seconde efface la première.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const retirer = useCallback((id: number) => {
    setToasts((liste) => liste.filter((t) => t.id !== id))
  }, [])

  const annoncer = useCallback(
    (texte: string, erreur = false) => {
      const id = Date.now() + Math.random()
      setToasts((liste) => [...liste, { id, texte, erreur }])
      // La barre de décompte prévient la sortie et déclenche le retrait ; ce
      // minuteur n'est qu'un filet, pour le cas où l'animation ne se joue pas
      // — fenêtre en arrière-plan, animations coupées par le système.
      window.setTimeout(() => retirer(id), DUREE_TOAST)
    },
    [retirer],
  )

  return { toasts, annoncer, retirer }
}

/**
 * Préférences, relues au montage et réécrites à chaque changement.
 *
 * Relues une fois montées et non au calcul de l'état initial : `localStorage`
 * n'est pas disponible à ce moment-là, et l'application doit s'afficher même
 * sans dépôt.
 */
export function usePreferences() {
  const [prefs, setPrefs] = useState(DEFAUTS)

  useEffect(() => setPrefs(lirePreferences()), [])

  const regler = useCallback((champs: Partial<typeof DEFAUTS>) => {
    setPrefs((p) => {
      const suivant = { ...p, ...champs }
      ecrirePreferences(suivant)
      return suivant
    })
  }, [])

  return { prefs, regler }
}

/**
 * Logos des expéditeurs, indexés par domaine.
 *
 * Cumulatifs : les logos déjà trouvés sont conservés d'un relevé à l'autre, et
 * un échec ne vide rien. Un expéditeur sans logo affiche ses initiales, ce qui
 * est le cas normal et non un pis-aller.
 */
export function useLogos() {
  const [logos, setLogos] = useState<Record<string, string>>({})

  const chercher = useCallback((messages: readonly MessageAffiche[]) => {
    const adresses = [...new Set(messages.map((m) => m.adresse))].filter(Boolean)
    logosExpediteurs(adresses)
      .then((trouves) => setLogos((connus) => ({ ...connus, ...trouves })))
      .catch(() => undefined)
  }, [])

  return { logos, chercher }
}
