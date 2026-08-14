/**
 * Vue « Règles automatiques ».
 *
 * C'est la seule page où l'utilisateur voit d'un coup tout ce que MailFlow fait
 * en son nom. Chaque règle y est écrite en une phrase, parce qu'un tableau de
 * champs techniques ne dit pas ce qui va se passer.
 *
 * L'ajout se fait aussi ici. Ailleurs, une règle naît d'un message qu'on a sous
 * les yeux ; ici, l'utilisateur tape l'adresse — c'est le seul moyen de viser un
 * expéditeur dont aucun message n'est présentement dans la boîte.
 */
import { useState } from 'react'
import {
  Bouton,
  EnTete,
  Etiquette,
  Icone,
  Interrupteur,
  Segments,
  Vide,
} from '../composants/base'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { adresseValide, nouvelleRegle, phrase } from '../lib/regles'
import type { ActionRegle, Categorie, Regle } from '../types/backend'

const ONGLETS = ['Toutes', 'Publicités', 'Newsletters', 'Formations'] as const
type Onglet = (typeof ONGLETS)[number]

const CATEGORIE_ONGLET: Record<Exclude<Onglet, 'Toutes'>, Categorie> = {
  Publicités: 'publicite',
  Newsletters: 'newsletter',
  Formations: 'formation',
}

const CATEGORIES = ['Publicités', 'Newsletters', 'Formations'] as const

/**
 * Les deux seules actions proposées ici.
 *
 * `generer_resume_et_archiver` est volontairement absente : le module de résumé
 * n'existe pas, et une règle qui promet un résumé archiverait sans résumer.
 */
const ACTIONS = ['Archiver', 'Mettre à la corbeille'] as const
type LibelleAction = (typeof ACTIONS)[number]

const ACTION: Record<LibelleAction, ActionRegle> = {
  Archiver: 'archiver_automatique',
  'Mettre à la corbeille': 'supprimer_toujours',
}

export function Regles({
  regles,
  onBasculer,
  onSupprimer,
  onCreerRegle,
  sombre,
}: {
  regles: Regle[]
  onBasculer: (id: string) => Promise<void>
  onSupprimer: (id: string) => Promise<void>
  onCreerRegle: (regle: Regle) => Promise<void>
  sombre: boolean
}) {
  const [onglet, setOnglet] = useState<Onglet>('Toutes')
  const [recherche, setRecherche] = useState('')
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)
  const [formulaireOuvert, setFormulaireOuvert] = useState(false)

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
      <EnTete titre="Règles automatiques" sous={decompte(regles.length)}>
        <button
          type="button"
          onClick={() => setFormulaireOuvert((o) => !o)}
          aria-expanded={formulaireOuvert}
          className="inline-flex flex-none items-center gap-2.5 rounded-xl px-5 py-3 text-[14px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)', color: '#FFFFFF' }}
        >
          <Icone nom={formulaireOuvert ? 'close' : 'playlist_add_check'} taille={19} rempli />
          {formulaireOuvert ? 'Fermer' : 'Ajouter une règle'}
        </button>
      </EnTete>

      {formulaireOuvert && (
        <FormulaireAjout
          onAnnuler={() => setFormulaireOuvert(false)}
          onValider={async (regle) => {
            await onCreerRegle(regle)
            setFormulaireOuvert(false)
          }}
        />
      )}

      <div
        className="flex flex-none items-center gap-4 border-b px-8 py-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-4 py-3"
          style={{ background: 'var(--sunk)' }}
        >
          <Icone nom="search" taille={18} style={{ color: 'var(--sub)' }} />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une règle par nom ou adresse"
            aria-label="Rechercher une règle"
            className="selectionnable min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--fg)' }}
          />
        </div>

        <div
          role="tablist"
          aria-label="Filtrer par catégorie"
          className="flex flex-none gap-1 rounded-xl p-1.5"
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
                className="rounded-lg px-5 py-2 text-[13.5px] font-semibold whitespace-nowrap transition-colors"
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
              ? "Les règles se créent depuis les vues Publicités, Newsletters et Formations — ouvrez un message, et dites ce qu'il faut faire des suivants — ou avec « Ajouter une règle » ci-dessus."
              : 'Aucune règle ne correspond à ce filtre.'
          }
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-2">
            {visibles.map((r) => {
              const [encre, fond] = ton(r.categorie, sombre)
              const confirme = aConfirmer === r.id
              return (
                <div
                  key={r.id}
                  className="carte-survolable flex items-center gap-3.5 rounded-xl border px-4 py-3.5"
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

/** « 5 règles enregistrées… » — au singulier quand il n'y en a qu'une. */
function decompte(n: number): string {
  if (n === 0) return "Aucune règle enregistrée pour l'instant."
  const s = n > 1 ? 's' : ''
  return `${n} règle${s} enregistrée${s} dans MailFlow. Tout est modifiable ici.`
}

/**
 * Formulaire d'ajout.
 *
 * Il affiche la phrase que la règle produira, avant d'enregistrer : c'est la
 * seule manière pour l'utilisateur de vérifier qu'il a demandé ce qu'il croit.
 */
function FormulaireAjout({
  onValider,
  onAnnuler,
}: {
  onValider: (regle: Regle) => Promise<void>
  onAnnuler: () => void
}) {
  const [adresse, setAdresse] = useState('')
  const [categorie, setCategorie] = useState<(typeof CATEGORIES)[number]>('Publicités')
  const [libelleAction, setLibelleAction] = useState<LibelleAction>('Archiver')
  const [enCours, setEnCours] = useState(false)

  const valide = adresseValide(adresse)
  const regle = nouvelleRegle({
    adresse: valide ? adresse : 'exemple@domaine.fr',
    categorie: CATEGORIE_ONGLET[categorie],
    action: ACTION[libelleAction],
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enregistrer()
      }}
      className="flex flex-none flex-col gap-4 border-b px-8 py-5"
      style={{ borderColor: 'var(--line)', background: 'var(--sunk)' }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold">Adresse de l'expéditeur</span>
        <input
          type="text"
          value={adresse}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="promo@offres-tech.fr"
          autoFocus
          className="selectionnable rounded-xl border px-4 py-2.5 font-mono text-[13px] outline-none"
          style={{ background: 'var(--card)', borderColor: 'var(--line)', color: 'var(--fg)' }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-6">
        <Champ titre="Catégorie">
          <Segments
            valeurs={CATEGORIES}
            valeur={categorie}
            onChange={setCategorie}
            libelle="Catégorie de la règle"
          />
        </Champ>

        <Champ titre="Action">
          <Segments
            valeurs={ACTIONS}
            valeur={libelleAction}
            onChange={setLibelleAction}
            libelle="Action de la règle"
          />
        </Champ>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="min-w-0 flex-1 text-[13px]"
          style={{ color: valide ? 'var(--fg)' : 'var(--sub)' }}
        >
          {valide
            ? phrase(regle)
            : 'Saisissez une adresse complète pour voir ce que la règle fera.'}
        </div>
        <button
          type="submit"
          disabled={!valide || enCours}
          className="inline-flex flex-none items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#FFFFFF' }}
        >
          Enregistrer la règle
        </button>
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
      </div>
    </form>
  )
}

function Champ({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold">{titre}</span>
      {children}
    </div>
  )
}
