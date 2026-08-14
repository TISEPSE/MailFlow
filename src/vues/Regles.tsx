/**
 * Vue « Règles automatiques ».
 *
 * C'est la seule page où l'utilisateur voit d'un coup tout ce que MailFlow fait
 * en son nom. Chaque règle y est écrite en une phrase, parce qu'un tableau de
 * champs techniques ne dit pas ce qui va se passer.
 */
import { useState } from 'react'
import { Bouton, Etiquette, Icone, Interrupteur, Vide } from '../composants/base'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { phrase } from '../lib/regles'
import type { Regle } from '../types/backend'

const ONGLETS = ['Toutes', 'Publicités', 'Newsletters', 'Formations'] as const
type Onglet = (typeof ONGLETS)[number]

const CATEGORIE_ONGLET: Record<Exclude<Onglet, 'Toutes'>, Regle['categorie']> = {
  Publicités: 'publicite',
  Newsletters: 'newsletter',
  Formations: 'formation',
}

export function Regles({
  regles,
  onBasculer,
  onSupprimer,
  sombre,
}: {
  regles: Regle[]
  onBasculer: (id: string) => Promise<void>
  onSupprimer: (id: string) => Promise<void>
  sombre: boolean
}) {
  const [onglet, setOnglet] = useState<Onglet>('Toutes')
  const [recherche, setRecherche] = useState('')
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)

  const q = recherche.trim().toLowerCase()
  const visibles = regles
    .filter((r) => onglet === 'Toutes' || r.categorie === CATEGORIE_ONGLET[onglet])
    .filter(
      (r) =>
        !q ||
        r.expediteur.toLowerCase().includes(q) ||
        r.nom_affichage.toLowerCase().includes(q),
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex flex-none items-center gap-3 border-b px-6 py-3"
        style={{ borderColor: 'var(--line)' }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
        >
          <Icone nom="search" taille={17} style={{ color: 'var(--sub)' }} />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une règle par nom ou adresse"
            aria-label="Rechercher une règle"
            className="selectionnable min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--fg)' }}
          />
        </div>

        <div
          role="tablist"
          aria-label="Filtrer par catégorie"
          className="flex flex-none gap-1 rounded-lg p-1"
          style={{ background: 'var(--sunk)' }}
        >
          {ONGLETS.map((o) => {
            const actif = o === onglet
            return (
              <button
                key={o}
                type="button"
                role="tab"
                aria-selected={actif}
                onClick={() => setOnglet(o)}
                className="rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap"
                style={{
                  background: actif ? 'var(--card)' : 'transparent',
                  color: actif ? 'var(--fg)' : 'var(--sub)',
                  boxShadow: actif ? 'var(--shadow)' : 'none',
                }}
              >
                {o}
              </button>
            )
          })}
        </div>
      </div>

      {visibles.length === 0 ? (
        <Vide
          icone="bolt"
          titre={regles.length === 0 ? 'Aucune règle' : 'Aucune règle ici'}
          detail={
            regles.length === 0
              ? "Les règles se créent depuis les vues Publicités, Newsletters et Formations : ouvrez un message, et dites ce qu'il faut faire des suivants."
              : 'Aucune règle ne correspond à ce filtre.'
          }
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col gap-2">
            {visibles.map((r) => {
              const [encre, fond] = ton(r.categorie, sombre)
              const confirme = aConfirmer === r.id
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3.5 rounded-xl border px-4 py-3.5"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--line)',
                    boxShadow: 'var(--shadow)',
                  }}
                >
                  <Interrupteur
                    actif={r.active}
                    onChange={() => void onBasculer(r.id)}
                    libelle={`Activer la règle : ${phrase(r)}`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Etiquette
                        texte={LIBELLE_CATEGORIE[r.categorie]}
                        fond={fond}
                        couleur={encre}
                      />
                      <span
                        className="font-mono text-[10.5px]"
                        style={{ color: 'var(--sub)' }}
                      >
                        ajoutée le {r.date_ajout}
                      </span>
                    </div>
                    <div
                      className="selectionnable mt-1 text-[13.5px]"
                      style={{ color: r.active ? 'var(--fg)' : 'var(--sub)' }}
                    >
                      {phrase(r)}
                    </div>
                  </div>

                  {confirme ? (
                    <div className="flex flex-none items-center gap-2">
                      <span className="text-[12px]" style={{ color: 'var(--sub)' }}>
                        Supprimer cette règle ?
                      </span>
                      <Bouton
                        variante="danger"
                        onClick={() => {
                          setAConfirmer(null)
                          void onSupprimer(r.id)
                        }}
                      >
                        Oui
                      </Bouton>
                      <Bouton onClick={() => setAConfirmer(null)}>Non</Bouton>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAConfirmer(r.id)}
                      aria-label={`Supprimer la règle : ${phrase(r)}`}
                      className="flex-none rounded-lg p-1.5 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--sub)' }}
                    >
                      <Icone nom="delete" taille={18} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
