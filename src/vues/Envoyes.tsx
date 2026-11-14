/**
 * La page des messages envoyés.
 *
 * # Ce qu'elle montre, et pourquoi elle n'est pas une vue de courrier
 *
 * Les quatre pages de courrier classent ce qui arrive : elles proposent de
 * poser une règle sur un expéditeur, et c'est le geste central du produit. Ici,
 * l'expéditeur est toujours soi. Une règle sur soi-même n'a pas de sens, le
 * classement d'arrivée non plus, et les libellés de rangement non plus — on ne
 * range pas ce qu'on vient d'écrire.
 *
 * Reste ce qu'on vient y chercher : relire une lettre partie, et la faire
 * suivre. La page est donc une liste à plat par date, avec le panneau de
 * lecture et le transfert.
 *
 * C'est aussi pourquoi la liste nomme le **destinataire** : l'expéditeur étant
 * toujours le même, une page qui le montrerait afficherait cent fois le même
 * nom et aucune ligne ne se distinguerait d'une autre.
 */
import { useEffect, useState } from 'react'
import {
  Bouton,
  SqueletteLecture,
  SqueletteListe,
  Vide,
} from '../composants/base'
import { Lecture, ListeMessages } from '../composants/ListeMessages'
import { messageCorps } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

/**
 * Délai avant d'afficher le squelette de lecture, en millisecondes.
 *
 * Le même que sur les pages de courrier : en deçà, l'attente ne se voit pas et
 * le squelette ne fait que clignoter.
 */
const DELAI_SQUELETTE = 220

export function Envoyes({
  envoyes,
  logos,
  corpsConnus,
  onCorpsCharge,
  onTransferer,
  onRelever,
  onCopier,
  chargement,
}: {
  envoyes: MessageAffiche[]
  logos: Record<string, string>
  /** Corps déjà chargés, tenus par `App` pour survivre au changement de page. */
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  /** Ouvre la fenêtre de rédaction sur un transfert de ce message. */
  onTransferer: (message: MessageAffiche) => void
  /** Relance le relevé. Proposé quand la page est vide. */
  onRelever: () => void
  /** Annonce la copie d'une adresse dans le presse-papiers. */
  onCopier?: (adresse: string) => void
  /** Vrai tant que le relevé n'a pas abouti. */
  chargement?: boolean
}) {
  const [selection, setSelection] = useState<string | null>(null)

  const choisi = envoyes.find((m) => m.id === selection) ?? envoyes[0]

  /** Deux états distincts : une lecture est en cours, et il faut le montrer.
   *  Le second suit le premier de `DELAI_SQUELETTE`. */
  const [attenteCorps, setAttenteCorps] = useState(false)
  const [chargementCorps, setChargementCorps] = useState(false)

  const idAffiche = choisi?.id
  const corps = idAffiche ? (corpsConnus.get(idAffiche) ?? null) : null

  useEffect(() => {
    // Déjà en mémoire : ni appel réseau, ni squelette.
    if (!idAffiche || corpsConnus.has(idAffiche)) {
      setAttenteCorps(false)
      setChargementCorps(false)
      return
    }

    // Un témoin d'actualité : quand on enchaîne les messages, la réponse d'une
    // lecture abandonnée ne doit pas s'afficher sous un autre en-tête.
    let courant = true
    setAttenteCorps(true)

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

  if (!choisi) {
    return (
      <Vide
        icone="send"
        titre="Aucun message envoyé"
        detail="Rien n'est gardé sur le disque ici : la page interroge Gmail à chaque ouverture. Si vous avez envoyé du courrier depuis ce compte, relevez-le."
        action={{ libelle: 'Relever', icone: 'refresh', onClick: onRelever }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className="flex h-full min-h-0 flex-none flex-col overflow-hidden border-r"
        style={{
          width: 'var(--largeur-liste)',
          background: 'var(--sunk)',
          borderColor: 'var(--line)',
        }}
      >
        <ListeMessages
          messages={envoyes}
          selection={choisi.id}
          onSelect={setSelection}
          logos={logos}
          cote="destinataire"
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Lecture
          message={choisi}
          corps={corps}
          chargement={chargementCorps}
          attente={attenteCorps}
          logos={logos}
          onCopier={onCopier}
          cote="destinataire"
          actions={
            <Bouton
              compact
              icone="forward"
              onClick={() => onTransferer(choisi)}
              titre="Faire suivre ce message à quelqu'un, ou se le renvoyer pour le reprendre. Les fichiers joints ne partent pas avec."
            >
              Transférer
            </Bouton>
          }
        />
      </div>
    </div>
  )
}
