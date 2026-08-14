/**
 * Ajout d'un expéditeur aux rappels de formation.
 *
 * La même fenêtre que celle des règles, réduite à ce qui compte ici : une
 * adresse. La catégorie est connue — c'est la vue où l'on se trouve — et
 * l'action l'est aussi : ranger, sans rien changer dans Gmail. Faire choisir
 * l'une et l'autre reviendrait à poser deux questions dont on a déjà la
 * réponse, avec le risque d'archiver les rappels qu'on voulait lire.
 */
import { useState } from 'react'
import { Bouton, Modale } from './base'
import { ChampAdresse } from './ChampAdresse'
import { adresseValide, nouvelleRegle, phrase } from '../lib/regles'
import type { MessageAffiche, Regle } from '../types/backend'

export function ModaleFormation({
  expediteurs,
  sombre,
  onFermer,
  onValider,
}: {
  expediteurs: MessageAffiche[]
  sombre: boolean
  onFermer: () => void
  onValider: (regle: Regle) => Promise<void>
}) {
  const [adresse, setAdresse] = useState('')
  const [enCours, setEnCours] = useState(false)

  const valide = adresseValide(adresse)
  const connu = expediteurs.find((m) => m.adresse === adresse)

  const regle = nouvelleRegle({
    adresse: valide ? adresse : 'exemple@domaine.fr',
    nom: connu?.nom,
    categorie: 'formation',
    action: 'classer_seulement',
  })

  const enregistrer = async () => {
    if (!valide || enCours) return
    setEnCours(true)
    try {
      await onValider(regle)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modale
      titre="Ajouter un expéditeur"
      sous="Ses messages apparaîtront ici. Rien ne bouge dans Gmail."
      onFermer={onFermer}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enregistrer()
        }}
        className="flex flex-col gap-4"
      >
        <ChampAdresse
          adresse={adresse}
          onChange={(v) => setAdresse(v)}
          expediteurs={expediteurs}
          categorie="formation"
          sombre={sombre}
        />

        <p className="text-[13px]" style={{ color: valide ? 'var(--fg)' : 'var(--sub)' }}>
          {valide
            ? phrase(regle)
            : 'Saisissez une adresse complète, ou choisissez-la dans la liste.'}
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Bouton onClick={onFermer}>Annuler</Bouton>
          <button
            type="submit"
            disabled={!valide || enCours}
            className="bouton bouton-principal inline-flex h-9 flex-none items-center justify-center gap-2 rounded-lg px-4 text-[13px] leading-none font-semibold"
          >
            {enCours ? 'Enregistrement…' : 'Ajouter'}
          </button>
        </div>
      </form>
    </Modale>
  )
}
