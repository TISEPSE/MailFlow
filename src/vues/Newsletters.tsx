/**
 * Newsletters : la seule vue qui ne soit pas une liste.
 *
 * Une newsletter ne se lit pas comme un message : on la parcourt, on retient
 * deux lignes, on passe. La liste plus panneau de lecture des autres vues
 * obligeait à ouvrir chacune pour savoir si elle valait la peine. Ici tout se
 * voit d'un coup — une synthèse en tête, puis une carte par publication.
 *
 * # Une carte par publication, pas par message
 *
 * Un journal écrit depuis plusieurs adresses et plusieurs fois par semaine.
 * À plat, il occupait autant de cartes qu'il avait envoyé de numéros, et la
 * page se remplissait de doublons apparents. Les numéros d'un même émetteur
 * sont donc empilés : une carte, une cascade derrière elle, et le détail au
 * clic. Voir `lib/newsletters.ts`.
 *
 * # Les résumés
 *
 * La ligne sous le nom de l'émetteur est composée sur la machine, à partir du
 * sujet du dernier numéro. Quand un modèle de langage sera branché, sa phrase
 * prendra exactement cette place — même emplacement, même hauteur — de sorte
 * que la page ne bouge pas d'un pixel selon qu'il est là ou non. C'est ce qui
 * rend l'IA réellement optionnelle plutôt que promise.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Bouton,
  Confirmation,
  Icone,
  Pastille,
  SqueletteListe,
  Vide,
} from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import {
  decompteDuGroupe,
  etiquettesUtiles,
  filtrerParEtiquette,
  grouperNewsletters,
  ligneLocale,
  resserrerSujet,
  type GroupeNewsletters,
} from '../lib/newsletters'
import type { Avancement } from '../lib/tauri'
import type {
  CorpsMessage,
  MessageAffiche,
  Resume,
  SyntheseDuJour,
} from '../types/backend'
import { LecteurEnGrand } from '../composants/LecteurEnGrand'

/**
 * Durée minimale de l'attente affichée, en millisecondes.
 *
 * Gemini répond parfois en deux cents millisecondes. Les bandes apparaissaient
 * alors et disparaissaient dans le même battement de cil : le résultat changeait
 * sous les yeux sans que rien n'ait expliqué pourquoi, et l'on doutait d'avoir
 * cliqué.
 *
 * Deux secondes ne sont pas une lenteur ajoutée : l'appel part immédiatement et
 * rien ne l'attend. C'est l'**affichage** de l'attente qui a un plancher, le
 * temps qu'un mouvement soit lisible.
 */
const ATTENTE_VISIBLE = 2000

export function Newsletters({
  messages,
  vide,
  logos,
  onOuvrir,
  onSupprimer,
  onArchiver,
  corpsConnus,
  onCorpsCharge,
  chargement,
  vise,
  onVise,
  resumes,
  avancementResumes,
  onArreterResumes,
  onAnalyser,
  onResumerGroupe,
  synthese,
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  logos: Record<string, string>
  onOuvrir: (id: string) => void
  onSupprimer: (id: string) => void
  onArchiver: (id: string) => void
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  chargement?: boolean
  /** Message désigné par la recherche, à ouvrir sans attendre un clic. */
  vise?: string | null
  /** Prévient que la désignation a été honorée, pour qu'elle ne se répète pas. */
  onVise?: () => void
  /** Résumés déjà produits, par identifiant de message. */
  resumes?: Record<string, Resume>
  /** Avancement de la troisième phase, ou `null` quand elle ne tourne pas. */
  avancementResumes?: Avancement | null
  onArreterResumes?: () => void
  /** Relance l'analyse à la main, sans attendre un redémarrage. */
  onAnalyser?: () => void
  /** Résume une seule publication — un appel, décidé depuis sa carte. */
  onResumerGroupe?: (groupe: GroupeNewsletters) => Promise<void>
  /**
   * Ce que la journée a apporté, en trois points au plus.
   *
   * Absente tant qu'aucune clé n'est posée : le bandeau garde alors exactement
   * l'allure qu'il a toujours eue, décompte et pastilles, sans corps ni
   * étiquettes. La page ne bouge pas d'un pixel selon que l'IA est là ou non.
   */
  synthese?: SyntheseDuJour | null
}) {
  const [ouvert, setOuvert] = useState<MessageAffiche | null>(null)

  /** La publication dont le résumé est en vol, pour n'animer que sa carte. */
  const [enCoursDeResume, setEnCoursDeResume] = useState<string | null>(null)

  const resumerCeGroupe = async (groupe: GroupeNewsletters) => {
    if (!onResumerGroupe || enCoursDeResume) return
    setEnCoursDeResume(groupe.cle)

    const depart = Date.now()
    try {
      await onResumerGroupe(groupe)
    } finally {
      const reste = ATTENTE_VISIBLE - (Date.now() - depart)
      if (reste > 0) await new Promise((suite) => setTimeout(suite, reste))
      setEnCoursDeResume(null)
    }
  }

  const groupes = useMemo(() => grouperNewsletters(messages), [messages])

  /** Étiquette qui filtre la grille, ou `null` pour « Tous ». */
  const [etiquette, setEtiquette] = useState<string | null>(null)

  const etiquettes = useMemo(
    () => etiquettesUtiles(synthese?.hashtags ?? [], groupes, resumes),
    [synthese, groupes, resumes],
  )

  const affiches = useMemo(
    () => filtrerParEtiquette(groupes, resumes, etiquette),
    [groupes, resumes, etiquette],
  )

  // Une étiquette cesse d'être proposée dès que la dernière publication qui la
  // portait est archivée. Sans cet oubli, le filtre resterait actif sur un mot
  // devenu invisible et la page paraîtrait vide sans qu'aucune pastille
  // n'explique pourquoi.
  useEffect(() => {
    if (etiquette && !etiquettes.includes(etiquette)) setEtiquette(null)
  }, [etiquette, etiquettes])

  // La recherche désigne une newsletter : elle s'ouvre en grand, comme sur les
  // autres pages. Sans ce raccord, un résultat de recherche portant sur une
  // newsletter changeait bien de page mais n'ouvrait rien — la carte était
  // quelque part dans la grille, à retrouver à l'œil.
  useEffect(() => {
    if (!vise) return
    const cible = messages.find((m) => m.id === vise)
    if (cible) {
      setOuvert(cible)
      onOuvrir(cible.id)
    }
    onVise?.()
  }, [vise, messages, onOuvrir, onVise])

  if (chargement) return <SqueletteListe lignes={4} />
  if (!messages.length) return <Vide {...vide} />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-6">
        <Synthese
          groupes={groupes}
          logos={logos}
          onAnalyser={onAnalyser}
          avancement={avancementResumes ?? null}
          onArreter={onArreterResumes}
          synthese={synthese ?? null}
          etiquettes={etiquettes}
          etiquette={etiquette}
          onEtiquette={setEtiquette}
        />

        {/* Deux colonnes : une carte tient dans la moitié d'un écran, et deux
            de front font voir la journée d'un coup.

            En mosaïque et non en rangées : les cartes n'ont pas la même
            hauteur — un résumé de trois lignes contre un de six, une pile
            dépliée contre un numéro seul — et une grille en rangées laissait
            sous la plus courte un trou de la hauteur de sa voisine. Chaque
            carte occupe ici le nombre de rangs de quatre pixels qu'elle
            mesure vraiment, et la suivante se pose juste dessous. */}
        <div
          className="grid grid-cols-1 gap-x-4 lg:grid-cols-2"
          style={{ gridAutoRows: `${PAS_MOSAIQUE}px` }}
        >
          {affiches.map((groupe) => (
            <Cellule key={groupe.cle}>
            <CarteGroupe
              groupe={groupe}
              // Le rang vient de la liste entière, et non de la liste filtrée :
              // une carte doit garder sa couleur quand une étiquette en retire
              // d'autres, sinon toute la grille change de teinte à chaque clic
              // et l'on croit voir d'autres publications.
              rang={groupes.indexOf(groupe)}
              logos={logos}
              onVoir={(m) => {
                setOuvert(m)
                onOuvrir(m.id)
              }}
              onArchiver={onArchiver}
              onSupprimer={onSupprimer}
              onResumer={onResumerGroupe && (() => void resumerCeGroupe(groupe))}
              // Pendant une analyse d'ensemble, les publications qui n'ont pas
              // encore de résumé respirent : le nombre de cartes qui bougent
              // décroît à mesure que le travail avance, ce qui dit l'avancement
              // là où il se passe plutôt qu'au sommet de la page.
              resumeEnCours={
                enCoursDeResume === groupe.cle ||
                (Boolean(avancementResumes) && !resumes?.[groupe.messages[0]?.id ?? ''])
              }
              resumes={resumes}
            />
            </Cellule>
          ))}
        </div>
      </div>

      {ouvert && (
        <LecteurEnGrand
          message={ouvert}
          corps={corpsConnus.get(ouvert.id) ?? null}
          onCorpsCharge={onCorpsCharge}
          onFermer={() => setOuvert(null)}
        />
      )}
    </div>
  )
}

/**
 * Bandeau de synthèse.
 *
 * Il compte les publications plutôt que les messages : quinze numéros de trois
 * journaux, ce sont trois choses à lire, pas quinze.
 *
 * # Ce que le modèle y ajoute, et ce qu'il n'y change pas
 *
 * Sans clé posée, le bandeau est exactement celui d'avant : l'en-tête, son
 * décompte, ses pastilles. La synthèse ne fait qu'**allonger** la carte vers le
 * bas — un rang par point, puis les étiquettes. Rien ne se déplace, rien ne
 * disparaît ; c'est ce qui rend l'IA optionnelle plutôt que promise.
 *
 * # Les sources sont vérifiées avant d'arriver ici
 *
 * `point.sources` porte des **clés de publication**, traduites côté Rust à
 * partir des rangs rendus par le modèle, tout rang hors bornes ayant été jeté.
 * Une source inventée n'atteint donc jamais l'écran. La clé qui ne retrouve
 * plus sa carte — le numéro vient d'être archivé — est simplement ignorée.
 */
function Synthese({
  groupes,
  logos,
  onAnalyser,
  avancement,
  onArreter,
  synthese,
  etiquettes,
  etiquette,
  onEtiquette,
}: {
  groupes: GroupeNewsletters[]
  logos: Record<string, string>
  /** Relance l'analyse à la main. Absent quand la page ne sait pas la faire. */
  onAnalyser?: () => void
  /** Avancement de l'analyse en cours, ou `null` quand elle ne tourne pas. */
  avancement: Avancement | null
  onArreter?: () => void
  synthese: SyntheseDuJour | null
  /** Celles qui retiennent au moins une publication. Voir `etiquettesUtiles`. */
  etiquettes: string[]
  etiquette: string | null
  onEtiquette: (e: string | null) => void
}) {
  const sources = groupes.slice(0, 6)
  const numeros = groupes.reduce((n, g) => n + g.messages.length, 0)
  const derniere = groupes[0]?.messages[0]?.date

  /** De quoi retrouver la carte d'une source : son nom, son rang, son logo. */
  const parCle = useMemo(
    () => new Map(groupes.map((g, i) => [g.cle, { groupe: g, rang: i } as const])),
    [groupes],
  )

  /**
   * La ligne sous le titre, dans l'ordre de ce qui prime.
   *
   * L'avancement d'abord : pendant une analyse, c'est la seule chose qu'on
   * attend. C'est aussi ce que disait la barre de progression — en chiffres,
   * sans mouvement, et sans promettre une mesure du temps qui reste.
   */
  const sousLigne = avancement
    ? `Résumés — ${avancement.faits} sur ${avancement.total}`
    : synthese
      ? `${synthese.publications} publication${synthese.publications > 1 ? 's' : ''} ` +
        `lue${synthese.publications > 1 ? 's' : ''} ${momentDit(synthese.produiteLe)}`
      : derniere
        ? `Dernier reçu à ${heureCourte(derniere)}`
        : 'En attente du relevé'

  const points = (synthese?.points ?? []).map((point) => ({
    texte: point.texte,
    citees: point.sources
      .map((cle) => parCle.get(cle))
      .filter((v): v is { groupe: GroupeNewsletters; rang: number } => Boolean(v)),
  }))

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'var(--accent-soft)' }}
      >
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: 'var(--accent)' }}
        >
          <Icone nom="auto_awesome" taille="1.125rem" rempli style={{ color: '#FFFFFF' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-semibold tracking-tight">
            {synthese ? (
              'Synthèse du jour'
            ) : (
              <>
                {groupes.length} publication{groupes.length > 1 ? 's' : ''}
                {numeros > groupes.length ? `, ${numeros} mails` : ''}
              </>
            )}
          </span>
          <span className="block text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
            {sousLigne}
          </span>
        </span>
        <span className="flex flex-none items-center gap-1">
          <span className="pr-1 text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
            Sources
          </span>
          {sources.map((g, i) => {
            const [fond, encre] = palette(i)
            return (
              <Pastille
                key={g.cle}
                texte={initiales(g.nom)}
                taille="1.375rem"
                fond={fond}
                couleur={encre}
                logo={logos[domaineDe(g.adresse)]}
              />
            )
          })}
        </span>

        {/* L'analyse se lance au démarrage, mais rien ne permettait de la
            relancer — or la clé se pose souvent *après* le premier lancement,
            et la phase automatique était alors passée depuis longtemps. Ce
            bouton est le seul moyen d'y revenir sans redémarrer. */}
        {/* Le même emplacement pour les deux gestes : arrêter une analyse en
            cours est le seul geste qui ait du sens tant qu'elle tourne, et il
            n'a pas besoin d'une bande à lui pour être atteint. L'arrêt est
            réel — le drapeau est lu entre deux messages côté Rust — mais il ne
            coupe pas l'appel en vol, qui a déjà coûté son quota. */}
        {avancement && onArreter ? (
          <span className="flex-none pl-2">
            <Bouton
              compact
              icone="close"
              onClick={onArreter}
              titre="Arrêter après le résumé en cours"
            >
              Arrêter
            </Bouton>
          </span>
        ) : (
          onAnalyser && (
            <span className="flex-none pl-2">
              <Bouton
                compact
                icone="auto_awesome"
                onClick={onAnalyser}
                enAttente={Boolean(avancement)}
                disabled={Boolean(avancement)}
                titre="Faire résumer les newsletters qui ne le sont pas encore"
              >
                Analyser
              </Bouton>
            </span>
          )
        )}
      </div>

      {/* Un rang par point : d'abord les pastilles des publications d'où il
          vient, puis la phrase, puis leurs noms en clair. Les pastilles disent
          « d'où » d'un coup d'œil ; les noms sont là pour qui veut vérifier —
          une phrase de modèle sans source vérifiable ne vaut pas grand-chose. */}
      {points.length > 0 && (
        <ul>
          {points.map((point, i) => (
            <li
              key={i}
              className="flex items-start gap-3 border-t px-4 py-3"
              style={{ borderColor: 'var(--line)' }}
            >
              {point.citees.length > 0 && (
                <span className="flex flex-none items-center gap-1 pt-px" aria-hidden>
                  {point.citees.map(({ groupe, rang }) => {
                    const [fond, encre] = palette(rang)
                    return (
                      <Pastille
                        key={groupe.cle}
                        texte={initiales(groupe.nom)}
                        taille="1.375rem"
                        fond={fond}
                        couleur={encre}
                        logo={logos[domaineDe(groupe.adresse)]}
                      />
                    )
                  })}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] leading-relaxed font-medium">
                  {point.texte}
                </span>
                {point.citees.length > 0 && (
                  <span
                    className="mt-1 block truncate font-mono text-[0.6562rem]"
                    style={{ color: 'var(--sub)' }}
                  >
                    {point.citees.map(({ groupe }) => groupe.nom).join(' · ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Les étiquettes filtrent la grille. « Tous » vient en premier et reste
          toujours là : sans lui, on ne saurait pas comment revenir en arrière
          une fois un filtre posé. */}
      {etiquettes.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <ChoixEtiquette actif={!etiquette} onClick={() => onEtiquette(null)}>
            Tous
          </ChoixEtiquette>
          {etiquettes.map((e) => (
            <ChoixEtiquette
              key={e}
              actif={etiquette === e}
              onClick={() => onEtiquette(etiquette === e ? null : e)}
            >
              #{e}
            </ChoixEtiquette>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Quand la synthèse a été faite, dit aussi court que possible.
 *
 * `heureCourte` rend « 07:10 » aujourd'hui et « hier » la veille : la
 * préposition ne convient qu'au premier cas, d'où le test sur la forme.
 */
function momentDit(iso: string): string {
  const quand = heureCourte(iso)
  if (!quand) return 'aujourd’hui'
  return /^\d{2}:\d{2}$/u.test(quand) ? `à ${quand}` : quand
}

/** Une pastille d'étiquette, allumée quand elle filtre. */
function ChoixEtiquette({
  actif,
  onClick,
  children,
}: {
  actif: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`inline-flex h-7 items-center rounded-full px-2.5 text-[0.6875rem] font-semibold ${
        actif ? '' : 'pilule-accent'
      }`}
      style={actif ? { background: 'var(--accent)', color: '#FFFFFF' } : undefined}
    >
      <span className="texte-optique">{children}</span>
    </button>
  )
}

/**
 * Pas de la mosaïque, en pixels.
 *
 * Assez fin pour que l'arrondi ne se voie pas — au plus trois pixels d'écart
 * entre la hauteur réelle d'une carte et le nombre de rangs qu'elle occupe — et
 * assez gros pour ne pas fabriquer des milliers de rangs de grille.
 */
const PAS_MOSAIQUE = 4

/** Gouttière verticale entre deux cartes, en pixels. */
const GOUTTIERE_MOSAIQUE = 16

/**
 * Une case de la mosaïque, qui prend exactement la hauteur de son contenu.
 *
 * # Pourquoi ce n'est pas une simple grille
 *
 * Une grille range par rangées : deux cartes côte à côte ouvrent une rangée
 * aussi haute que la plus grande des deux, et la plus courte laisse sous elle
 * un blanc que rien ne vient combler. Le blanc grandit avec l'écart — un résumé
 * de six lignes contre un de deux, une pile dépliée contre un numéro seul.
 *
 * Ici chaque case déclare le nombre de rangs qu'elle occupe, la carte suivante
 * se pose juste dessous, et les colonnes se remplissent indépendamment.
 *
 * # Pourquoi la hauteur est observée, et non mesurée une fois
 *
 * Elle change sous nos pieds, et à des moments que personne ne choisit : un
 * résumé arrive et remplace une ligne par quatre, une pile se déplie, la
 * fenêtre se rétrécit et un titre passe sur deux lignes, ou l'utilisateur
 * change la taille du texte de son système. Une mesure prise au montage aurait
 * été fausse dès la première de ces choses — d'où l'observateur, qui suit.
 */
function Cellule({ children }: { children: ReactNode }) {
  const boite = useRef<HTMLDivElement>(null)
  const [rangs, setRangs] = useState<number | null>(null)

  // `useLayoutEffect` et non `useEffect` : la mesure a lieu avant que le
  // navigateur ne peigne, sinon toutes les cartes se superposeraient sur un
  // rang le temps d'une image.
  useLayoutEffect(() => {
    const element = boite.current
    if (!element) return

    const observateur = new ResizeObserver(() => {
      const hauteur = element.getBoundingClientRect().height
      setRangs(Math.ceil((hauteur + GOUTTIERE_MOSAIQUE) / PAS_MOSAIQUE))
    })
    observateur.observe(element)
    return () => observateur.disconnect()
  }, [])

  return (
    <div style={rangs ? { gridRowEnd: `span ${rangs}` } : undefined}>
      <div ref={boite}>{children}</div>
    </div>
  )
}

/** Feuilles décalées derrière une carte, quand la publication a plusieurs numéros.
 *
 *  Purement décoratif : le décompte est déjà écrit en toutes lettres sur la
 *  carte, un lecteur d'écran n'a que faire de l'illusion de papier. C'est
 *  l'enveloppe qui porte `aria-hidden`, puisque c'est elle qui les groupe. */
function Cascade({ nombre }: { nombre: number }) {
  // Deux feuilles suffisent à dire « il y en a d'autres ». Trois épaisseurs de
  // plus n'ajoutent que du bruit sous la carte.
  const feuilles = Math.min(nombre - 1, 2)

  return (
    <>
      {Array.from({ length: feuilles }, (_, i) => (
        <span
          key={i}
          className="absolute inset-x-0 top-0 h-full rounded-2xl border"
          style={{
            borderColor: 'var(--line)',
            background: 'var(--card)',
            transform: `translate(${(i + 1) * 5}px, ${(i + 1) * 5}px) rotate(${(i + 1) * 0.35}deg)`,
            opacity: 1 - (i + 1) * 0.25,
          }}
        />
      ))}
    </>
  )
}

/** Carte d'une publication : son dernier numéro, et la pile des précédents. */
function CarteGroupe({
  groupe,
  rang,
  logos,
  onVoir,
  onArchiver,
  onSupprimer,
  onResumer,
  resumeEnCours = false,
  resumes,
}: {
  groupe: GroupeNewsletters
  rang: number
  logos: Record<string, string>
  onVoir: (m: MessageAffiche) => void
  onArchiver: (id: string) => void
  onSupprimer: (id: string) => void
  /** Résume cette publication seule — un appel, décidé ici. */
  onResumer?: () => void
  resumeEnCours?: boolean
  resumes?: Record<string, Resume>
}) {
  const [fond, encre] = palette(rang)
  const [deplie, setDeplie] = useState(false)

  /** Numéro montré par la carte, désigné par son identifiant.
   *
   *  Un identifiant et non un rang : archiver un numéro décale les rangs, et la
   *  carte se mettrait alors à montrer son voisin sans que personne ne l'ait
   *  demandé. Un identifiant disparu retombe simplement sur le plus récent. */
  const [visible, setVisible] = useState<string | null>(null)

  /** Geste en attente de confirmation, ou `null`.
   *
   *  Les deux boutons font disparaître la carte de la page. Rien n'est perdu —
   *  la corbeille garde trente jours, l'archive ne détruit rien — mais un clic
   *  de travers coûterait d'aller rechercher les messages dans Gmail. Et le
   *  geste porte ici sur toute la pile, ce qui rend la confirmation d'autant
   *  plus nécessaire. */
  const [aConfirmer, setAConfirmer] = useState<'archiver' | 'supprimer' | null>(null)

  const nombre = groupe.messages.length
  const decompte = decompteDuGroupe(groupe)

  /** Le numéro effectivement à l'écran. */
  const courant = groupe.messages.find((m) => m.id === visible) ?? groupe.messages[0]

  /** Les autres numéros — ceux que la liste dépliée propose encore.
   *
   *  Celui qui est à l'écran en est retiré : le laisser laissait croire qu'il
   *  restait à cliquer, et le clic ne faisait alors rien de visible. */
  const autres = groupe.messages.filter((m) => m.id !== courant.id)

  const contenu = useRef<HTMLDivElement>(null)

  /** Vrai le temps qu'une feuille sorte, pour ignorer les clics pressés. */
  const enTransit = useRef(false)

  /**
   * Fait passer un numéro en tête de la carte.
   *
   * La feuille en place file vers la gauche en s'effaçant, puis la suivante
   * arrive de la droite — le sens du mouvement dit « on avance dans la pile »
   * sans un mot. Le cadre, lui, ne bouge pas : c'est le contenu qui défile,
   * pas la carte, sinon toute la grille tressauterait.
   *
   * Les deux moitiés se **succèdent** au lieu de se superposer : sur une carte
   * étroite, deux textes qui se croisent font illisible une fraction de
   * seconde. D'où l'attente de la fin de la sortie avant de changer d'état.
   */
  const changerDeNumero = (id: string) => {
    if (id === courant.id || enTransit.current) return

    const bloc = contenu.current
    // Le réglage système prime : une animation imposée à qui l'a désactivée
    // est une gêne, et parfois davantage.
    if (!bloc || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(id)
      return
    }

    enTransit.current = true
    const sortie = bloc.animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: 'translateX(-2rem)', opacity: 0 },
      ],
      { duration: 150, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    )

    void sortie.finished
      .catch(() => undefined)
      .finally(() => {
        enTransit.current = false
        setVisible(id)
      })
  }

  const agirSurToute = (geste: 'archiver' | 'supprimer') => {
    for (const m of groupe.messages) {
      if (geste === 'supprimer') onSupprimer(m.id)
      else onArchiver(m.id)
    }
  }

  return (
    // `isolate` crée un contexte d'empilement : sans lui, les feuilles en
    // `z-index` négatif passeraient derrière le fond de la page plutôt que
    // derrière leur seule carte.
    <div className="relative isolate">
      {/* Enveloppe positionnée et calquée sur la carte : les feuilles s'y
          rangent sans changer de place, et son `transform` peut alors être
          animé d'un bloc. Animer chaque feuille écraserait le décalage que
          son style en ligne lui donne. */}
      {nombre > 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: -1 }}
        >
          <Cascade nombre={nombre} />
        </span>
      )}

      {/* L'attente se voit sur la carte elle-même : elle respire, du bord vers
          l'intérieur. Deux bandes tenaient auparavant la place du texte, mais
          une bande qui se remplit se lit comme une barre de progression — elle
          promet un avancement mesuré qu'aucun appel réseau ne peut tenir. Ici
          rien ne prétend mesurer : la carte dit seulement qu'elle travaille, et
          son texte reste lisible pendant ce temps. */}
      <div
        className={`carte-survolable relative flex flex-col overflow-hidden rounded-2xl border ${
          resumeEnCours ? 'carte-en-resume mouvement-utile' : ''
        }`}
        style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
        aria-busy={resumeEnCours}
      >
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <Pastille
            texte={initiales(groupe.nom)}
            taille="2.125rem"
            fond={fond}
            couleur={encre}
            logo={logos[domaineDe(groupe.adresse)]}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.875rem] font-semibold tracking-tight">
              {groupe.nom}
            </span>
            <span
              className="block truncate font-mono text-[0.6562rem]"
              style={{ color: 'var(--sub)' }}
            >
              {groupe.adresse}
            </span>
          </span>
          <span
            className="flex flex-none items-center gap-1 text-[0.6875rem]"
            style={{ color: 'var(--sub)' }}
          >
            <Icone nom="schedule" taille="0.75rem" />
            {courant.date ? heureCourte(courant.date) : ''}
          </span>

          {/* Résumer se demande **ici** : on décide de lire ou non avant
              d'ouvrir, et un bouton logé derrière l'ouverture arriverait après
              la question qu'il devait aider à trancher.

              En icône seule, et dans l'en-tête plutôt que dans la rangée
              d'actions : à quatre boutons, la rangée débordait de la carte et
              « Supprimer » s'y trouvait coupé en deux. Un geste facultatif ne
              doit pas pousser dehors ceux qui ne le sont pas. */}
          {onResumer && !resumes?.[courant.id] && (
            <button
              type="button"
              onClick={onResumer}
              disabled={resumeEnCours}
              title={
                nombre > 1
                  ? `Résume les ${nombre} mails en quelques lignes, en un seul appel`
                  : 'Résume ce mail en quelques lignes'
              }
              aria-label="Résumer cette publication"
              className={`bouton bouton-icone flex-none rounded-md p-1 ${
                resumeEnCours ? 'etincelle-ia mouvement-utile' : ''
              }`}
            >
              <Icone nom="auto_awesome" taille="0.9375rem" rempli={resumeEnCours} />
            </button>
          )}
        </div>

        {/* `key` sur l'identifiant : changer de numéro remonte ce bloc, ce qui
            relance le fondu. Sans lui, React réutiliserait les mêmes nœuds et
            le texte se remplacerait d'un coup, sans qu'on voie qu'il a
            changé — le clic paraîtrait alors n'avoir rien fait. */}
        <div ref={contenu} key={courant.id} className="glisse-entre px-4 pt-3">
          {/* Le résumé du modèle prend exactement la place de la ligne
              composée localement : même emplacement, même hauteur, même
              graisse. La page ne bouge pas d'un pixel selon qu'il est là ou
              non — c'est ce qui rend l'IA réellement optionnelle. */}
          {/* Le résumé, et rien d'autre.
              L'extrait de Gmail vivait juste en dessous, en gris : deux lignes
              qui répétaient en moins bien ce que le résumé dit déjà, et qui
              occupaient la place où il pouvait s'étendre. La consigne du modèle
              a été allongée d'autant. */}
          {resumes?.[courant.id] ? (
            // Ce que le modèle a écrit se distingue de ce que la machine a
            // composé seule. Sans marque, l'utilisateur ne sait pas s'il lit
            // une phrase produite par une IA — donc s'il doit la croire sur
            // parole ou vérifier. L'étincelle est la même que sur le bouton qui
            // l'a demandée : le geste et son résultat portent le même signe.
            <p className="text-[0.8125rem] leading-relaxed font-medium">
              <Icone
                nom="auto_awesome"
                taille="0.8125rem"
                rempli
                className="mr-1 inline-block align-[-0.1em]"
                style={{ color: 'var(--accent)' }}
              />
              {resumes[courant.id]?.texte}
            </p>
          ) : (
            <p className="text-[0.8125rem] leading-relaxed font-medium">
              {ligneLocale(courant)}
            </p>
          )}

          {decompte && (
            <button
              type="button"
              onClick={() => setDeplie(!deplie)}
              aria-expanded={deplie}
              className="pilule-accent mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.6875rem] font-semibold"
            >
              {/* La même flèche retournée, comme au panneau des destinataires :
                  le jeu d'icônes est engendré à partir des noms employés dans
                  le code, et n'en porte donc qu'une seule. */}
              <Icone
                nom="expand_more"
                taille="0.875rem"
                style={{
                  transform: deplie ? 'rotate(180deg)' : undefined,
                  transition: 'transform 160ms ease',
                }}
              />
              {/* Le libellé descend d'un cheveu pour se poser sur l'axe de la
                  flèche : même correction optique qu'aux boutons et aux
                  pastilles, voir `.texte-optique`. */}
              <span className="texte-optique">{deplie ? 'Replier' : decompte}</span>
            </button>
          )}
        </div>

        {autres.length > 0 && (
          // Le dépliage passe par une grille dont l'unique rangée va de `0fr`
          // à `1fr` : la hauteur s'interpole d'elle-même, sans qu'on ait à la
          // mesurer ni à la figer. Une hauteur mesurée en JavaScript se
          // désaccorde dès qu'une ligne change de longueur ; celle-ci suit.
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: deplie ? '1fr' : '0fr' }}
            aria-hidden={!deplie}
          >
            <div className="overflow-hidden">
              {/* Hauteur bornée : une publication qui a écrit trente fois
                  étirait sa carte sur trois écrans et repoussait tout le reste
                  de la grille. Au-delà d'une dizaine de numéros, la liste
                  défile d'elle-même. */}
              <ul
                className="mt-3 flex max-h-[21rem] flex-col overflow-y-auto border-t"
                style={{ borderColor: 'var(--line)' }}
              >
            {autres.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 border-b px-4 py-2 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
              >
                {/* Le clic fait passer ce numéro en tête de la carte plutôt que
                    d'ouvrir la fenêtre de lecture : la pile se feuillette sur
                    place, et « Voir le mail » reste le geste qui sort du
                    résumé. Ouvrir à chaque coup d'œil obligeait à refermer
                    pour en regarder un autre. */}
                <button
                  type="button"
                  onClick={() => changerDeNumero(m.id)}
                  className="survolable min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[0.75rem]"
                  title={m.sujet || '(sans objet)'}
                >
                  {resserrerSujet(m.sujet) || '(sans objet)'}
                </button>
                <span
                  className="flex-none font-mono text-[0.6562rem]"
                  style={{ color: 'var(--sub)' }}
                >
                  {m.date ? heureCourte(m.date) : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onArchiver(m.id)}
                  title="Archiver ce mail"
                  aria-label="Archiver ce mail"
                  className="bouton bouton-icone flex-none rounded-md p-1"
                >
                  <Icone nom="archive" taille="0.875rem" />
                </button>
                <button
                  type="button"
                  onClick={() => onSupprimer(m.id)}
                  title="Mettre ce mail à la corbeille"
                  aria-label="Mettre ce mail à la corbeille"
                  className="bouton bouton-icone flex-none rounded-md p-1"
                >
                  <Icone nom="delete" taille="0.875rem" />
                </button>
              </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 px-4 py-3.5">
          <Bouton icone="open_in_full" onClick={() => onVoir(courant)}>
            Voir le mail
          </Bouton>
          <Bouton
            variante="principal"
            icone="archive"
            onClick={() => setAConfirmer('archiver')}
            titre={
              nombre > 1
                ? `Les ${nombre} mails quittent la boîte de réception. Rien n'est supprimé.`
                : "Le message quitte la boîte de réception. Rien n'est supprimé."
            }
          >
            Garder &amp; archiver
          </Bouton>
          <Bouton
            variante="danger"
            icone="delete"
            onClick={() => setAConfirmer('supprimer')}
            titre="Mettre à la corbeille — récupérable 30 jours"
          >
            Supprimer
          </Bouton>
        </div>
      </div>

      {aConfirmer && (
        <Confirmation
          titre={
            aConfirmer === 'supprimer'
              ? nombre > 1
                ? `Mettre les ${nombre} mails à la corbeille ?`
                : 'Mettre cette newsletter à la corbeille ?'
              : nombre > 1
                ? `Archiver les ${nombre} mails ?`
                : 'Archiver cette newsletter ?'
          }
          sous={
            aConfirmer === 'supprimer'
              ? `De ${groupe.nom}. Gmail les garde trente jours, puis les efface.`
              : `De ${groupe.nom}. Ils quittent la boîte de réception ; rien n'est supprimé.`
          }
          libelle={aConfirmer === 'supprimer' ? 'Supprimer' : 'Archiver'}
          variante={aConfirmer === 'supprimer' ? 'danger' : 'principal'}
          icone={aConfirmer === 'supprimer' ? 'delete' : 'archive'}
          onConfirmer={() => {
            const geste = aConfirmer
            setAConfirmer(null)
            agirSurToute(geste)
          }}
          onAnnuler={() => setAConfirmer(null)}
        />
      )}
    </div>
  )
}

