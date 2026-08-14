/**
 * Les quatre vues de courrier : mails directs, publicités, newsletters,
 * rappels de formation.
 *
 * Elles partagent la même charpente et ne diffèrent que par ce qu'on peut faire
 * d'un expéditeur. Le geste central du produit est là : depuis un message, poser
 * une règle qui vaudra pour tous les suivants.
 */
import { useState } from 'react'
import { Bouton, Etiquette, Icone, Vide } from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { Lecture, ListeMessages } from '../composants/ListeMessages'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { nouvelleRegle } from '../lib/regles'
import type {
  ActionRegle,
  CategorieMessage,
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
  consultes,
  onConsulte,
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  proposition?: Proposition
  regles: Regle[]
  onCreerRegle: (regle: Regle) => Promise<void>
  sombre: boolean
  logos: Record<string, string>
  /** Messages ouverts pendant cette session, tenus par `App` pour qu'ils le
   *  restent d'une vue à l'autre. */
  consultes: ReadonlySet<string>
  onConsulte: (id: string) => void
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const choisi = messages.find((m) => m.id === selection) ?? messages[0]
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
        consultes={consultes}
        messages={messages}
        selection={choisi.id}
        onSelect={(id) => {
          setSelection(id)
          onConsulte(id)
        }}
        logos={logos}
      />
      <Lecture
        message={choisi}
        logos={logos}
        actions={
          <>
            <Etiquette
              texte={LIBELLE_CATEGORIE[choisi.categorie]}
              fond={fond}
              couleur={encre}
            />

            {proposition && choisi.adresse && !regleExistante && (
              <Bouton
                variante="principal"
                icone={proposition.icone}
                onClick={() => void poser()}
                disabled={enCours}
              >
                {enCours ? 'Enregistrement…' : proposition.libelle}
              </Bouton>
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
