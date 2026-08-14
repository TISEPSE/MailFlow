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
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  proposition?: Proposition
  regles: Regle[]
  onCreerRegle: (regle: Regle) => Promise<void>
  sombre: boolean
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
      await onCreerRegle({
        // L'identifiant doit être stable et unique ; l'adresse le garantit et
        // reste lisible dans `regles.json`, que l'utilisateur avancé peut ouvrir.
        id: `rule_${choisi.adresse.replace(/[^a-z0-9]+/gi, '_')}`,
        expediteur: choisi.adresse,
        nom_affichage: choisi.nom,
        categorie: proposition.categorie,
        action: proposition.action,
        active: true,
        date_ajout: new Date().toISOString().slice(0, 10),
        ...(proposition.action === 'archiver_automatique'
          ? { frequence: 'tous_les_vendredis' as const, heure_execution: '18:00' }
          : {}),
      })
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
        onSelect={setSelection}
      />
      <Lecture
        message={choisi}
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
