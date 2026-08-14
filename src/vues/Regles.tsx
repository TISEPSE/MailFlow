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
  Modale,
  Selecteur,
  Etiquette,
  Icone,
  Interrupteur,
  Segments,
  Vide,
} from '../composants/base'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { adresseValide, nouvelleRegle, phrase } from '../lib/regles'
import type {
  ActionRegle,
  Categorie,
  LibelleGmail,
  MessageAffiche,
  Regle,
} from '../types/backend'

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
  expediteurs,
  libelles,
  sombre,
}: {
  regles: Regle[]
  onBasculer: (id: string) => Promise<void>
  onSupprimer: (id: string) => Promise<void>
  onCreerRegle: (regle: Regle) => Promise<void>
  /** Expéditeurs de la boîte, proposés à la saisie. */
  expediteurs: MessageAffiche[]
  libelles: LibelleGmail[]
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
          onClick={() => setFormulaireOuvert(true)}
          aria-haspopup="dialog"
          className="bouton bouton-principal inline-flex h-9 flex-none items-center justify-center gap-2 rounded-lg px-4 text-[13px] leading-none font-semibold"
        >
          <Icone nom="playlist_add_check" taille={15} rempli compenser />
          Ajouter une règle
        </button>
      </EnTete>


      <div
        className="flex flex-none items-center gap-4 border-b px-8 py-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <div
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3.5"
          style={{ background: 'var(--sunk)' }}
        >
          {/* Sans `compenser` : le relèvement optique vise l'alignement sur des
              capitales, pas le centrage dans un champ de saisie. */}
          <Icone nom="search" taille={17} style={{ color: 'var(--sub)' }} />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une règle par nom ou adresse"
            aria-label="Rechercher une règle"
            className="selectionnable min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
            style={{ color: 'var(--fg)' }}
          />
        </div>

        <div
          role="tablist"
          aria-label="Filtrer par catégorie"
          className="flex h-10 flex-none items-center gap-1 rounded-xl px-1"
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
                className="flex h-8 items-center rounded-lg px-4 text-[13px] leading-none font-semibold whitespace-nowrap transition-colors"
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
                      className="bouton bouton-icone flex-none rounded-lg p-1.5"
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

      {formulaireOuvert && (
        <Modale
          titre="Ajouter une règle"
          sous="Elle vaudra pour tous les messages à venir de cet expéditeur."
          onFermer={() => setFormulaireOuvert(false)}
        >
          <FormulaireAjout
            expediteurs={expediteurs}
            libelles={libelles}
            onAnnuler={() => setFormulaireOuvert(false)}
            onValider={async (regle) => {
              await onCreerRegle(regle)
              setFormulaireOuvert(false)
            }}
          />
        </Modale>
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
  expediteurs,
  libelles,
}: {
  onValider: (regle: Regle) => Promise<void>
  onAnnuler: () => void
  expediteurs: MessageAffiche[]
  libelles: LibelleGmail[]
}) {
  const [adresse, setAdresse] = useState('')
  const [categorie, setCategorie] = useState<(typeof CATEGORIES)[number]>('Publicités')
  const [libelleAction, setLibelleAction] = useState<LibelleAction>('Archiver')
  const [destination, setDestination] = useState('')
  const [enCours, setEnCours] = useState(false)

  const valide = adresseValide(adresse)
  const archive = ACTION[libelleAction] === 'archiver_automatique'

  const regle = {
    ...nouvelleRegle({
      adresse: valide ? adresse : 'exemple@domaine.fr',
      categorie: CATEGORIE_ONGLET[categorie],
      action: ACTION[libelleAction],
    }),
    // La destination n'a de sens que pour un archivage : une règle qui met à la
    // corbeille avec un libellé promettrait un rangement qui n'aura pas lieu.
    ...(archive && destination ? { libelle: destination } : {}),
  }

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
      className="flex flex-col gap-4"
    >
      <ChampAdresse adresse={adresse} onChange={setAdresse} expediteurs={expediteurs} />

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

      {archive && (
        <Champ titre="Ranger sous">
          <Selecteur
            valeurs={[
              { valeur: '', texte: 'Aucun libellé — simplement archiver' },
              ...libelles.map((l) => ({ valeur: l.id, texte: l.nom })),
            ]}
            valeur={destination}
            onChange={setDestination}
            libelle="Libellé de destination"
            className="w-full"
          />
        </Champ>
      )}

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
          className="bouton bouton-principal inline-flex h-9 flex-none items-center justify-center gap-2 rounded-lg px-4 text-[13px] leading-none font-semibold"
        >
          Enregistrer la règle
        </button>
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
      </div>
    </form>
  )
}

/**
 * Saisie de l'adresse, avec les expéditeurs de la boîte en suggestion.
 *
 * Taper une adresse de mémoire est le moyen le plus sûr de se tromper d'une
 * lettre — et une règle qui vise une adresse inexistante ne se déclenche jamais
 * sans rien dire. Les propositions viennent des messages réellement reçus.
 */
function ChampAdresse({
  adresse,
  onChange,
  expediteurs,
}: {
  adresse: string
  onChange: (v: string) => void
  expediteurs: MessageAffiche[]
}) {
  const [ouvert, setOuvert] = useState(false)

  const q = adresse.trim().toLowerCase()
  const propositions = Array.from(
    new Map(
      expediteurs
        .filter((m) => m.adresse)
        .filter(
          (m) =>
            !q ||
            m.adresse.toLowerCase().includes(q) ||
            m.nom.toLowerCase().includes(q),
        )
        .map((m) => [m.adresse, m] as const),
    ).values(),
  ).slice(0, 6)

  const montrer = ouvert && propositions.length > 0 && propositions[0]?.adresse !== q

  return (
    <label className="relative flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold">Adresse de l'expéditeur</span>
      <input
        type="text"
        value={adresse}
        onChange={(e) => {
          onChange(e.target.value)
          setOuvert(true)
        }}
        onFocus={() => setOuvert(true)}
        // `blur` est retardé : sans ce délai, la liste disparaîtrait avant que
        // le clic sur une proposition n'ait le temps d'aboutir.
        onBlur={() => window.setTimeout(() => setOuvert(false), 120)}
        placeholder="promo@offres-tech.fr"
        autoFocus
        autoComplete="off"
        className="selectionnable h-11 rounded-xl border px-4 font-mono text-[13px] outline-none"
        style={{ background: 'var(--sunk)', borderColor: 'var(--line)', color: 'var(--fg)' }}
      />

      {montrer && (
        <div
          className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-xl border p-1"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: '0 12px 32px rgb(0 0 0 / 22%)',
          }}
        >
          {propositions.map((m) => (
            <button
              key={m.adresse}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(m.adresse)
                setOuvert(false)
              }}
              className="survolable flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left"
            >
              <span className="truncate text-[12.5px] font-semibold">{m.nom}</span>
              <span
                className="truncate font-mono text-[11px]"
                style={{ color: 'var(--sub)' }}
              >
                {m.adresse}
              </span>
            </button>
          ))}
        </div>
      )}
    </label>
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
