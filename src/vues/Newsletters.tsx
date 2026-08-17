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
import { useEffect, useMemo, useRef, useState } from 'react'
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
  grouperNewsletters,
  ligneLocale,
  resserrerSujet,
  type GroupeNewsletters,
} from '../lib/newsletters'
import { messageDErreur, resumeDuMessage, type Avancement } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche, Resume } from '../types/backend'
import { LecteurEnGrand } from '../composants/LecteurEnGrand'

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
}) {
  const [ouvert, setOuvert] = useState<MessageAffiche | null>(null)

  const groupes = useMemo(() => grouperNewsletters(messages), [messages])

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
          analyseEnCours={Boolean(avancementResumes)}
        />

        {avancementResumes && (
          <BandeResumes
            avancement={avancementResumes}
            onArreter={onArreterResumes}
          />
        )}

        {/* Deux colonnes : une carte tient dans la moitié d'un écran, et deux
            de front font voir la journée d'un coup. Les cartes s'alignent en
            haut — une pile dépliée ne doit pas étirer sa voisine. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {groupes.map((groupe, i) => (
            <CarteGroupe
              key={groupe.cle}
              groupe={groupe}
              rang={i}
              logos={logos}
              onVoir={(m) => {
                setOuvert(m)
                onOuvrir(m.id)
              }}
              onArchiver={onArchiver}
              onSupprimer={onSupprimer}
              resumes={resumes}
            />
          ))}
        </div>
      </div>

      {ouvert && (
        <LecteurEnGrand
          message={ouvert}
          corps={corpsConnus.get(ouvert.id) ?? null}
          onCorpsCharge={onCorpsCharge}
          onFermer={() => setOuvert(null)}
          actions={<ResumerCeNumero id={ouvert.id} />}
        />
      )}
    </div>
  )
}

/**
 * Le résumé d'un numéro précis, payé à la demande.
 *
 * # L'exception, et pourquoi elle est un bouton
 *
 * Les cartes portent un résumé de **publication** : un appel par émetteur au
 * lieu d'un par numéro, ce qui divise la dépense par quatre. Ce résumé-là
 * répond à « est-ce que je lis cette publication », et c'est la bonne question
 * neuf fois sur dix.
 *
 * Reste la dixième : un titre intrigue, on veut savoir ce que dit **ce**
 * numéro. Le faire pour tous par précaution reviendrait à repayer ce qu'on
 * vient d'économiser ; le proposer ici le fait payer à qui le demande, une
 * fois, et le résumé est ensuite gardé sur le disque.
 *
 * Son échec se dit, contrairement à la production de masse qui se tait : c'est
 * un geste explicite, et un geste explicite sans retour passe pour une panne.
 */
function ResumerCeNumero({ id }: { id: string }) {
  const [etat, setEtat] = useState<'repos' | 'en-cours'>('repos')
  const [resume, setResume] = useState<Resume | null>(null)
  const [echec, setEchec] = useState<string | null>(null)

  if (resume) {
    return (
      <p
        className="selectionnable min-w-0 flex-1 text-left text-[0.8125rem] leading-relaxed"
        style={{ color: 'var(--fg)' }}
      >
        {resume.texte}
      </p>
    )
  }

  return (
    <>
      {echec && (
        <span className="min-w-0 flex-1 text-left text-[0.75rem]" style={{ color: 'var(--sub)' }}>
          {echec}
        </span>
      )}
      <Bouton
        icone="auto_awesome"
        enAttente={etat === 'en-cours'}
        disabled={etat === 'en-cours'}
        onClick={() => {
          setEtat('en-cours')
          setEchec(null)
          resumeDuMessage(id)
            .then(setResume)
            .catch((e) => setEchec(messageDErreur(e)))
            .finally(() => setEtat('repos'))
        }}
      >
        Résumer ce numéro
      </Bouton>
    </>
  )
}

/**
 * Bandeau de synthèse.
 *
 * Il compte les publications plutôt que les messages : quinze numéros de trois
 * journaux, ce sont trois choses à lire, pas quinze. Sa phrase est composée
 * localement ; le modèle la remplacera sans déplacer quoi que ce soit.
 */
function Synthese({
  groupes,
  logos,
  onAnalyser,
  analyseEnCours,
}: {
  groupes: GroupeNewsletters[]
  logos: Record<string, string>
  /** Relance l'analyse à la main. Absent quand la page ne sait pas la faire. */
  onAnalyser?: () => void
  analyseEnCours: boolean
}) {
  const sources = groupes.slice(0, 6)
  const numeros = groupes.reduce((n, g) => n + g.messages.length, 0)
  const derniere = groupes[0]?.messages[0]?.date

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
            {groupes.length} publication{groupes.length > 1 ? 's' : ''}
            {numeros > groupes.length ? `, ${numeros} numéros` : ''}
          </span>
          <span className="block text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
            {derniere ? `Dernier reçu à ${heureCourte(derniere)}` : 'En attente du relevé'}
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
        {onAnalyser && (
          <span className="flex-none pl-2">
            <Bouton
              compact
              icone="auto_awesome"
              onClick={onAnalyser}
              enAttente={analyseEnCours}
              disabled={analyseEnCours}
              titre="Faire résumer les newsletters qui ne le sont pas encore"
            >
              Analyser
            </Bouton>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Bande d'avancement des résumés.
 *
 * Elle informe sans retenir : la page reste utilisable pendant que la troisième
 * phase tourne, et la bande disparaît d'elle-même quand elle a fini. Le bouton
 * d'arrêt est réel — le drapeau est lu entre deux messages côté Rust — mais il
 * ne coupe pas l'appel en vol, qui a déjà coûté son quota.
 */
function BandeResumes({
  avancement,
  onArreter,
}: {
  avancement: Avancement
  onArreter?: () => void
}) {
  const part = avancement.total ? (avancement.faits / avancement.total) * 100 : 0

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border px-4 py-3"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <Icone nom="auto_awesome" taille="1rem" rempli style={{ color: 'var(--accent)' }} />
      <span className="flex-none text-[0.8125rem] font-semibold">
        Résumés — {avancement.faits} sur {avancement.total}
      </span>
      <span
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--sunk)' }}
      >
        <span
          className="block h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${part}%`, background: 'var(--accent)' }}
        />
      </span>
      {onArreter && (
        <Bouton compact icone="close" onClick={onArreter}>
          Arrêter
        </Bouton>
      )}
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
  resumes,
}: {
  groupe: GroupeNewsletters
  rang: number
  logos: Record<string, string>
  onVoir: (m: MessageAffiche) => void
  onArchiver: (id: string) => void
  onSupprimer: (id: string) => void
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

      <div
        className="carte-survolable relative flex flex-col overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
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
          <p className="text-[0.8125rem] leading-relaxed font-medium">
            {resumes?.[courant.id]?.texte ?? ligneLocale(courant)}
          </p>
          <p
            className="mt-1 line-clamp-2 text-[0.7812rem] leading-relaxed"
            style={{ color: 'var(--sub)' }}
          >
            {courant.extrait}
          </p>

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
                  title="Archiver ce numéro"
                  aria-label="Archiver ce numéro"
                  className="bouton bouton-icone flex-none rounded-md p-1"
                >
                  <Icone nom="archive" taille="0.875rem" />
                </button>
                <button
                  type="button"
                  onClick={() => onSupprimer(m.id)}
                  title="Mettre ce numéro à la corbeille"
                  aria-label="Mettre ce numéro à la corbeille"
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
                ? `Les ${nombre} numéros quittent la boîte de réception. Rien n'est supprimé.`
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
                ? `Mettre les ${nombre} numéros à la corbeille ?`
                : 'Mettre cette newsletter à la corbeille ?'
              : nombre > 1
                ? `Archiver les ${nombre} numéros ?`
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

