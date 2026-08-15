/**
 * Corbeille.
 *
 * Elle existe pour une raison précise : « Supprimer » ne détruit rien, et
 * l'affirmer ne suffit pas. Tant qu'on ne peut pas voir ce qui s'y trouve ni
 * l'en ressortir sans passer par Gmail, la réversibilité reste une promesse.
 *
 * Même charpente que les vues de courrier — liste à gauche, lecture à droite —
 * plutôt qu'une présentation à elle : c'est la même chose qu'on regarde, et
 * deux mises en page pour un même objet obligent à réapprendre.
 *
 * Rien n'est mis en cache ici, contrairement à la boîte : on ouvre cette page
 * précisément pour vérifier son état, et un contenu périmé y serait plus gênant
 * qu'une seconde d'attente.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bouton, Icone, SqueletteLecture, SqueletteListe, Vide } from '../composants/base'
import { Lecture, ListeMessages } from '../composants/ListeMessages'
import { corbeilleLister, messageCorps, messageDErreur, messageRestaurer } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

export function Corbeille({
  logos,
  onErreur,
  onAnnonce,
  corpsConnus,
  onCorpsCharge,
}: {
  logos: Record<string, string>
  onErreur: (message: string) => void
  onAnnonce: (message: string) => void
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
}) {
  const [messages, setMessages] = useState<MessageAffiche[] | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)

  const relever = useCallback(async () => {
    try {
      setMessages(await corbeilleLister())
    } catch (e) {
      onErreur(messageDErreur(e))
      setMessages([])
    }
  }, [onErreur])

  useEffect(() => {
    void relever()
  }, [relever])

  const choisi = messages?.find((m) => m.id === selection) ?? messages?.[0] ?? null
  const corps = choisi ? (corpsConnus.get(choisi.id) ?? null) : null

  useEffect(() => {
    if (!choisi || corpsConnus.has(choisi.id)) return
    let courant = true
    messageCorps(choisi.id)
      .then((c) => courant && onCorpsCharge(choisi.id, c))
      .catch(() => undefined)
    return () => {
      courant = false
    }
    // `corpsConnus` volontairement absent : son changement vient de cet effet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choisi?.id])

  const restaurer = async (m: MessageAffiche) => {
    setEnCours(m.id)
    try {
      await messageRestaurer(m.id)
      // Retiré sans attendre un nouveau relevé : le message est sous les yeux
      // de l'utilisateur, et le voir rester donnerait l'impression que le clic
      // n'a pas porté.
      setMessages((liste) => (liste ?? []).filter((x) => x.id !== m.id))
      onAnnonce(`Message de ${m.nom} restauré.`)
    } catch (e) {
      onErreur(messageDErreur(e))
    } finally {
      setEnCours(null)
    }
  }

  if (messages === null) {
    return (
      <div className="flex min-h-0 flex-1">
        <SqueletteListe />
        <SqueletteLecture />
      </div>
    )
  }

  if (!messages.length) {
    return (
      <Vide
        icone="delete"
        titre="La corbeille est vide"
        detail="Les messages supprimés atterrissent ici. Gmail les garde trente jours avant de les effacer pour de bon."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ListeMessages
        messages={messages}
        selection={choisi?.id ?? null}
        onSelect={setSelection}
        logos={logos}
      />
      <Lecture
        message={choisi}
        corps={corps}
        chargement={false}
        logos={logos}
        actions={
          choisi && (
            <>
              <span
                className="flex items-center gap-1.5 text-[12px]"
                style={{ color: 'var(--sub)' }}
              >
                <Icone nom="schedule" taille="1.15em" className="icone-bouton" />
                Effacé par Gmail sous 30 jours
              </span>
              <Bouton
                compact
                variante="principal"
                icone="undo"
                enAttente={enCours === choisi.id}
                disabled={enCours !== null}
                onClick={() => void restaurer(choisi)}
                titre="Remettre ce message dans la boîte de réception"
              >
                Restaurer
              </Bouton>
            </>
          )
        }
      />
    </div>
  )
}
