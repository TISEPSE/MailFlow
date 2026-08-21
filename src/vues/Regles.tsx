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
 *
 * # Une règle appartient à un compte
 *
 * Une même adresse peut mériter deux sorts selon la boîte qui la reçoit : la
 * lettre d'information qu'on archive côté personnel, on la lit côté
 * professionnel. La page montre donc les règles du compte affiché, et celles de
 * tous les comptes à la fois sous « Tous les comptes » — chacune étiquetée de la
 * boîte qu'elle concerne, faute de quoi on ne saurait pas laquelle on modifie.
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
import {
  FREQUENCES_REGLE,
  HEURE_PAR_DEFAUT,
  LIBELLE_FREQUENCE,
  adresseValide,
  nouvelleRegle,
  phrase,
} from '../lib/regles'
import type {
  ActionRegle,
  Categorie,
  FrequenceRegle,
  LibelleGmail,
  MessageAffiche,
  Regle,
} from '../types/backend'

/** Une règle et la boîte à laquelle elle appartient. */
export interface RegleDuCompte {
  compte: string
  regle: Regle
}

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

/** Les mêmes tables à l'envers, pour rouvrir une règle sur ses propres choix.
 *
 *  Écrites une fois pour toutes et non maintenues à la main : une entrée
 *  oubliée ici rouvrirait la règle sur un réglage qui n'est pas le sien, et le
 *  formulaire l'enregistrerait tel quel. */
const NOM_CATEGORIE = Object.fromEntries(
  Object.entries(CATEGORIE_ONGLET).map(([nom, cat]) => [cat, nom]),
) as Record<Categorie, (typeof CATEGORIES)[number]>

const NOM_ACTION = Object.fromEntries(
  Object.entries(ACTION).map(([nom, act]) => [act, nom]),
) as Record<ActionRegle, LibelleAction>

/** L'action absente du formulaire retombe sur la plus proche : une règle posée
 *  à la main dans le fichier ne doit pas ouvrir un formulaire vide. */
function nomAction(action: ActionRegle): LibelleAction {
  return NOM_ACTION[action] ?? 'Archiver'
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
  comptes,
  onBasculer,
  onSupprimer,
  onCreerRegle,
  onModifierRegle,
  expediteurs,
  libelles,
  sombre,
}: {
  regles: RegleDuCompte[]
  /** Comptes où une règle peut naître. Le premier est proposé d'emblée.
   *
   *  Plus d'un signifie qu'on regarde « Tous les comptes » : chaque règle porte
   *  alors le nom de sa boîte, et le formulaire demande laquelle viser. */
  comptes: string[]
  onBasculer: (compte: string, id: string) => Promise<void>
  onSupprimer: (compte: string, id: string) => Promise<void>
  onCreerRegle: (compte: string, regle: Regle) => Promise<void>
  onModifierRegle: (compte: string, id: string, regle: Regle) => Promise<void>
  /** Expéditeurs de la boîte, proposés à la saisie. */
  expediteurs: MessageAffiche[]
  libelles: LibelleGmail[]
  sombre: boolean
}) {
  const [onglet, setOnglet] = useState<Onglet>('Toutes')
  const [recherche, setRecherche] = useState('')
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)
  /** Ce que la fenêtre est en train de faire.
   *
   *  `null` : fermée. `'ajout'` : une règle neuve. Une règle : celle qu'on
   *  modifie. Un seul état plutôt que deux booléens, pour qu'ouvrir l'un ferme
   *  l'autre sans qu'on ait à y penser. */
  const [fenetre, setFenetre] = useState<'ajout' | RegleDuCompte | null>(null)
  const enEdition = fenetre !== null && fenetre !== 'ajout' ? fenetre : undefined

  /** Plus d'une boîte à l'écran : il faut dire de laquelle on parle. */
  const multiCompte = comptes.length > 1

  const fermer = () => setFenetre(null)

  const q = recherche.trim().toLowerCase()
  const visibles = regles
    .filter(
      ({ regle }) =>
        onglet === 'Toutes' || regle.categorie === CATEGORIE_ONGLET[onglet],
    )
    .filter(
      ({ regle, compte }) =>
        !q ||
        regle.expediteur.toLowerCase().includes(q) ||
        regle.nom_affichage.toLowerCase().includes(q) ||
        compte.toLowerCase().includes(q),
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex flex-none items-stretch gap-4 border-b px-8 py-4"
        style={{ borderColor: 'var(--line)' }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 py-2"
          style={{ background: 'var(--sunk)' }}
        >
          <Icone nom="search" taille="1.125rem" style={{ color: 'var(--sub)' }} />
          <input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une règle par nom ou adresse"
            aria-label="Rechercher une règle"
            className="champ-de-saisie selectionnable min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--sub)]"
            style={{ color: 'var(--fg)' }}
          />
        </div>

        <Bouton
          variante="principal"
          icone="playlist_add_check"
          onClick={() => setFenetre('ajout')}
        >
          Ajouter une règle
        </Bouton>

        <div
          role="tablist"
          aria-label="Filtrer par catégorie"
          className="flex flex-none items-center gap-1 self-center rounded-full p-1"
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
                className={`segment inline-flex h-8 items-center justify-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap transition-all ${
                  actif ? 'font-semibold' : ''
                }`}
              >
                <span>{o}</span>
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
              ? "Les règles se créent depuis les vues Publicités, Newsletters et Formations. Ouvrez un message et dites ce qu'il faut faire des suivants, ou utilisez « Ajouter une règle » ci-dessus."
              : 'Aucune règle ne correspond à ce filtre.'
          }
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="flex flex-col gap-2">
            {visibles.map(({ compte, regle: r }) => {
              const [encre, fond] = ton(r.categorie, sombre)
              const confirme = aConfirmer === r.id
              return (
                <div
                  key={`${compte}/${r.id}`}
                  className="carte-survolable flex items-center gap-3.5 rounded-xl border px-4 py-3.5"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--line)',
                    boxShadow: 'var(--shadow)',
                  }}
                >
                  <Interrupteur
                    actif={r.active}
                    onChange={() => void onBasculer(compte, r.id)}
                    libelle={`Activer la règle : ${phrase(r)}`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Etiquette
                        texte={LIBELLE_CATEGORIE[r.categorie]}
                        fond={fond}
                        couleur={encre}
                      />
                      {multiCompte && (
                        <span
                          className="min-w-0 truncate font-mono text-[0.6562rem]"
                          style={{ color: 'var(--accent-fg)' }}
                          title={`Règle du compte ${compte}`}
                        >
                          {compte}
                        </span>
                      )}
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
                          void onSupprimer(compte, r.id)
                        }}
                      >
                        Oui
                      </Bouton>
                      <Bouton onClick={() => setAConfirmer(null)}>Non</Bouton>
                    </div>
                  ) : (
                    <div className="flex flex-none items-center gap-1">
                      {/* Modifier plutôt que supprimer puis refaire : une règle
                          se corrige souvent sur un seul point — une adresse trop
                          étroite, une action qu'on regrette — et tout ressaisir
                          pour si peu est une punition. */}
                      <button
                        type="button"
                        onClick={() => setFenetre({ compte, regle: r })}
                        aria-label={`Modifier la règle : ${phrase(r)}`}
                        title="Modifier"
                        className="bouton bouton-icone h-8 w-8 flex-none rounded-full"
                      >
                        <Icone nom="edit" taille="1.125rem" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setAConfirmer(r.id)}
                        aria-label={`Supprimer la règle : ${phrase(r)}`}
                        title="Supprimer"
                        className="bouton bouton-icone h-8 w-8 flex-none rounded-full"
                      >
                        <Icone nom="delete" taille="1.125rem" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {fenetre !== null && (
        <Modale
          titre={enEdition ? 'Modifier la règle' : 'Ajouter une règle'}
          sous={
            enEdition
              ? `Le changement vaut pour ${enEdition.compte} seulement ; les messages déjà triés restent où ils sont.`
              : 'Elle vaudra pour tous les messages à venir de cet expéditeur, dans la boîte choisie.'
          }
          onFermer={fermer}
        >
          <FormulaireAjout
            // La clé force un formulaire neuf d'une règle à l'autre : sans
            // elle, React garderait l'état de la précédente et rouvrirait la
            // suivante sur les choix de sa voisine.
            key={enEdition?.regle.id ?? 'ajout'}
            depuis={enEdition?.regle}
            comptes={comptes}
            compteDepart={enEdition?.compte}
            expediteurs={expediteurs}
            libelles={libelles}
            sombre={sombre}
            onAnnuler={fermer}
            onValider={async (compte, regle) => {
              if (enEdition) await onModifierRegle(enEdition.compte, enEdition.regle.id, regle)
              else await onCreerRegle(compte, regle)
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
  comptes,
  compteDepart,
  expediteurs,
  libelles,
  sombre,
  depuis,
}: {
  onValider: (compte: string, regle: Regle) => Promise<void>
  onAnnuler: () => void
  /** Boîtes où la règle peut naître. */
  comptes: string[]
  /** Boîte de la règle qu'on modifie ; à défaut, la première proposée. */
  compteDepart?: string
  expediteurs: MessageAffiche[]
  libelles: LibelleGmail[]
  sombre: boolean
  /** Règle à modifier. Absente, le formulaire en crée une. */
  depuis?: Regle
}) {
  const depart = depuis ? NOM_CATEGORIE[depuis.categorie] : ('Publicités' as const)

  const [compte, setCompte] = useState(compteDepart ?? comptes[0] ?? '')
  const [adresse, setAdresse] = useState(depuis?.expediteur ?? '')
  const [categorie, setCategorie] = useState<(typeof CATEGORIES)[number]>(depart)
  // Une règle relue a déjà ses choix : les redeviner reviendrait à les défaire
  // sous les yeux de qui vient l'ouvrir pour n'y changer qu'une chose.
  const [choisiParDefaut, setChoisiParDefaut] = useState(!depuis)
  const [actionChoisie, setActionChoisie] = useState(Boolean(depuis))
  const [libelleAction, setLibelleAction] = useState<LibelleAction>(
    depuis ? nomAction(depuis.action) : actionParDefaut(depart),
  )
  const [destination, setDestination] = useState(depuis?.libelle ?? '')
  /** `''` vaut « Immédiatement » : la règle n'a alors aucune fréquence. */
  const [frequence, setFrequence] = useState<FrequenceRegle | ''>(depuis?.frequence ?? '')
  const [heure, setHeure] = useState(depuis?.heure_execution ?? HEURE_PAR_DEFAUT)
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
      // `''` — « Immédiatement » — ne pose aucune fréquence : la règle agit
      // alors dès que le message est vu, ce qui est le comportement historique.
      frequence: frequence || undefined,
      heure: frequence ? heure : undefined,
    }),
    // Une règle modifiée garde son identifiant et sa date : c'est la même
    // règle, corrigée. En changer ferait apparaître une nouvelle venue et
    // laisserait l'ancienne derrière.
    ...(depuis ? { id: depuis.id, date_ajout: depuis.date_ajout } : {}),
    // La destination n'a de sens que pour un archivage : une règle qui met à la
    // corbeille avec un libellé promettrait un rangement qui n'aura pas lieu.
    ...(archive && destination ? { libelle: destination } : {}),
  }

  const enregistrer = async () => {
    if (!valide || !compte || enCours) return
    setEnCours(true)
    try {
      await onValider(compte, regle)
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
      {/* La boîte d'abord : tout ce qui suit ne vaudra que pour elle. Absente
          du formulaire de modification — déplacer une règle d'un compte à
          l'autre, c'est en supprimer une et en créer une autre, pas la
          corriger. */}
      {comptes.length > 1 && !depuis && (
        <Champ titre="Dans la boîte">
          <Selecteur
            valeurs={comptes.map((c) => ({ valeur: c, texte: c }))}
            valeur={compte}
            onChange={setCompte}
            libelle="Compte concerné par la règle"
            className="w-full"
          />
        </Champ>
      )}

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

      {/* La programmation n'apparaît que pour un archivage : une mise à la
          corbeille différée promettrait un délai de grâce qui n'existe pas, et
          « Classer seulement » ne touche à rien chez Gmail.

          Le moteur savait déjà tenir un jour et une heure ; rien dans
          l'interface ne permettait de les choisir, et toute règle neuve partait
          en douce sur « vendredi 18 h ». Les deux champs sont donc autant une
          fonctionnalité qu'un aveu. */}
      {archive && (
        <Champ titre="Quand archiver">
          <div className="flex items-center gap-2">
            <Selecteur
              valeurs={[
                { valeur: '', texte: 'Immédiatement' },
                ...FREQUENCES_REGLE.map((f) => ({
                  valeur: f,
                  texte: LIBELLE_FREQUENCE[f],
                })),
              ]}
              valeur={frequence}
              onChange={(v) => setFrequence(v as FrequenceRegle | '')}
              libelle="Quand la règle archive"
              className="min-w-0 flex-1"
            />

            {/* L'heure n'apparaît qu'une fois la cadence choisie : proposer
                « à quelle heure » sous « Immédiatement » serait une question
                sans réponse possible. */}
            {frequence && (
              <label className="flex flex-none items-center gap-2">
                <span className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
                  à
                </span>
                <input
                  type="time"
                  value={heure}
                  onChange={(e) => setHeure(e.target.value || HEURE_PAR_DEFAUT)}
                  aria-label="Heure de l'archivage"
                  className="champ-de-saisie selectionnable rounded-xl border px-3 py-2 text-xs outline-none"
                  style={{
                    background: 'var(--sunk)',
                    borderColor: 'var(--line)',
                    color: 'var(--fg)',
                  }}
                />
              </label>
            )}
          </div>
          <p className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
            {frequence
              ? "L'archivage a lieu au premier relevé qui suit l'heure dite."
              : 'Les messages quittent la boîte dès que MailFlow les voit.'}
          </p>
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
          <Bouton
            type="submit"
            variante="principal"
            disabled={!valide || !compte || enCours}
          >
            {enCours ? 'Enregistrement…' : 'Enregistrer la règle'}
          </Bouton>
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
