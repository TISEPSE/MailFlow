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
  Modale,
  Selecteur,
  Etiquette,
  Icone,
  Interrupteur,
  Segments,
  Vide,
} from '../composants/base'
import { ChampAdresse } from '../composants/ChampAdresse'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { adresseValide, nouvelleRegle, phrase } from '../lib/regles'
import type {
  ActionRegle,
  Categorie,
  LibelleGmail,
  MessageAffiche,
  Regle,
} from '../types/backend'

const ONGLETS = [
  'Toutes',
  'Mails directs',
  'Publicités',
  'Newsletters',
  'Formations',
] as const
type Onglet = (typeof ONGLETS)[number]

const CATEGORIE_ONGLET: Record<Exclude<Onglet, 'Toutes'>, Categorie> = {
  'Mails directs': 'humain',
  Publicités: 'publicite',
  Newsletters: 'newsletter',
  Formations: 'formation',
}

/** Les quatre destinations possibles d'une règle.
 *
 *  « Mails directs » en fait partie : c'est ce qui permet de ramener dans la
 *  correspondance un expéditeur que le classement automatique range ailleurs —
 *  une adresse `no-reply` qui écrit pourtant vraiment. */
const CATEGORIES = [
  'Mails directs',
  'Publicités',
  'Newsletters',
  'Formations',
] as const

/**
 * Les trois actions proposées ici.
 *
 * « Classer seulement » vient en premier : c'est la seule qui ne change rien
 * dans Gmail, et c'est elle qui permet de remplir « Rappels de formations » —
 * une vue que rien ne devine, et que l'archivage viderait aussitôt.
 *
 * `generer_resume_et_archiver` est volontairement absente : le module de résumé
 * n'existe pas, et une règle qui promet un résumé archiverait sans résumer.
 */
const ACTIONS = ['Classer seulement', 'Archiver', 'Mettre à la corbeille'] as const
type LibelleAction = (typeof ACTIONS)[number]

const ACTION: Record<LibelleAction, ActionRegle> = {
  'Classer seulement': 'classer_seulement',
  Archiver: 'archiver_automatique',
  'Mettre à la corbeille': 'supprimer_toujours',
}

/**
 * Action proposée d'emblée pour une catégorie.
 *
 * Une formation se range pour être lue ; une publicité se range pour ne plus
 * l'être. Le réglage par défaut suit cette intention, et reste modifiable.
 */
function actionParDefaut(categorie: (typeof CATEGORIES)[number]): LibelleAction {
  // Formations et mails directs se rangent pour être lus ; publicités et
  // newsletters, pour ne plus l'être.
  return categorie === 'Formations' || categorie === 'Mails directs'
    ? 'Classer seulement'
    : 'Archiver'
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

  const fermer = () => setFormulaireOuvert(false)

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
        className="flex flex-none items-stretch gap-4 border-b px-8 py-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3.5 py-2.5"
          style={{ background: 'var(--sunk)' }}
        >
          {/* Sans `compenser` : le relèvement optique vise l'alignement sur des
              capitales, pas le centrage dans un champ de saisie. */}
          <Icone nom="search" taille="1.0625rem" style={{ color: 'var(--sub)' }} />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une règle par nom ou adresse"
            aria-label="Rechercher une règle"
            className="selectionnable min-w-0 flex-1 bg-transparent text-[0.8438rem] leading-5 outline-none"
            style={{ color: 'var(--fg)' }}
          />
        </div>

        <button
          type="button"
          onClick={() => setFormulaireOuvert(true)}
          aria-haspopup="dialog"
          className="bouton bouton-principal inline-flex flex-none items-center justify-center gap-2 self-stretch rounded-xl px-4 text-[0.8125rem] leading-none font-semibold"
        >
          <Icone
            nom="playlist_add_check"
            taille="1.45em"
            rempli
            className="icone-bouton"
          />
          Ajouter une règle
        </button>

        <div
          role="tablist"
          aria-label="Filtrer par catégorie"
          className="flex flex-none items-center gap-1 self-stretch rounded-xl px-1"
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
                className="segment flex h-8 items-center rounded-lg px-4 text-[0.8125rem] leading-none font-semibold whitespace-nowrap"
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
                        className="font-mono text-[0.6562rem]"
                        style={{ color: 'var(--sub)' }}
                      >
                        ajoutée le {r.date_ajout}
                      </span>
                    </div>
                    <div
                      className="selectionnable mt-1 text-[0.8438rem]"
                      style={{ color: r.active ? 'var(--fg)' : 'var(--sub)' }}
                    >
                      {phrase(r)}
                    </div>
                  </div>

                  {confirme ? (
                    <div className="flex flex-none items-center gap-2">
                      <span className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
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
                      <Icone nom="delete" taille="1.125rem" />
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
          onFermer={fermer}
        >
          <FormulaireAjout
            expediteurs={expediteurs}
            libelles={libelles}
            sombre={sombre}
            onAnnuler={fermer}
            onValider={async (regle) => {
              await onCreerRegle(regle)
              fermer()
            }}
          />
        </Modale>
      )}
    </div>
  )
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
  sombre,
}: {
  onValider: (regle: Regle) => Promise<void>
  onAnnuler: () => void
  expediteurs: MessageAffiche[]
  libelles: LibelleGmail[]
  sombre: boolean
}) {
  const depart = 'Publicités' as const

  const [adresse, setAdresse] = useState('')
  const [categorie, setCategorie] = useState<(typeof CATEGORIES)[number]>(depart)
  const [choisiParDefaut, setChoisiParDefaut] = useState(true)
  const [actionChoisie, setActionChoisie] = useState(false)
  const [libelleAction, setLibelleAction] = useState<LibelleAction>(actionParDefaut(depart))
  const [destination, setDestination] = useState('')
  const [enCours, setEnCours] = useState(false)

  /** Change la catégorie, et l'action avec elle tant qu'on n'y a pas touché. */
  const changerCategorie = (v: (typeof CATEGORIES)[number]) => {
    setCategorie(v)
    if (!actionChoisie) setLibelleAction(actionParDefaut(v))
  }

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
      <ChampAdresse
        adresse={adresse}
        expediteurs={expediteurs}
        sombre={sombre}
        categorie={CATEGORIE_ONGLET[categorie]}
        onChange={(v, devinee) => {
          setAdresse(v)
          // La catégorie ne se règle d'elle-même que tant que l'utilisateur n'y
          // a pas touché : lui reprendre son choix serait pire que ne rien
          // deviner.
          if (devinee && choisiParDefaut) {
            const nom = (Object.entries(CATEGORIE_ONGLET) as [
              (typeof CATEGORIES)[number],
              Categorie,
            ][]).find(([, c]) => c === devinee)
            if (nom) changerCategorie(nom[0])
          }
        }}
      />

      {/* L'action d'abord : on décide ce qu'il advient des messages, puis où
          les retrouver. L'ordre inverse faisait choisir une destination avant
          de savoir s'ils y resteraient. */}
      <Champ titre="Action">
        <Segments
          pleineLargeur
          valeurs={ACTIONS}
          valeur={libelleAction}
          onChange={(v) => {
            setLibelleAction(v)
            setActionChoisie(true)
          }}
          libelle="Action de la règle"
        />
      </Champ>

      <Champ titre="Catégorie">
        <Segments
          pleineLargeur
          valeurs={CATEGORIES}
          valeur={categorie}
          onChange={(v) => {
            changerCategorie(v)
            setChoisiParDefaut(false)
          }}
          libelle="Catégorie de la règle"
        />
      </Champ>

      {archive && (
        <Champ titre="Ranger sous">
          <Selecteur
            valeurs={[
              { valeur: '', texte: 'Aucun libellé' },
              ...libelles.map((l) => ({ valeur: l.id, texte: l.nom })),
            ]}
            valeur={destination}
            onChange={setDestination}
            libelle="Libellé de destination"
            className="w-full"
          />
        </Champ>
      )}

      {/* La phrase sur sa propre ligne : coincée à côté des boutons, elle se
          brisait en quatre lignes étroites alors que c'est elle qui dit ce que
          la règle fera. */}
      <div className="flex flex-col gap-3 pt-1">
        <p
          className="text-[0.8125rem] leading-relaxed"
          style={{ color: valide ? 'var(--fg)' : 'var(--sub)' }}
        >
          {valide
            ? phrase(regle)
            : 'Saisissez une adresse complète pour voir ce que la règle fera.'}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Bouton onClick={onAnnuler}>Annuler</Bouton>
          <button
            type="submit"
            disabled={!valide || enCours}
            className="bouton bouton-principal inline-flex h-9 flex-none items-center justify-center gap-2 rounded-lg px-4 text-[0.8125rem] leading-none font-semibold"
          >
            {enCours ? 'Enregistrement…' : 'Enregistrer la règle'}
          </button>
        </div>
      </div>
    </form>
  )
}

function Champ({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.7812rem] font-semibold">{titre}</span>
      {children}
    </div>
  )
}
