/**
 * La table des archives.
 *
 * # L'idée
 *
 * Une surface où chaque message archivé est une tuile qu'on attrape et qu'on
 * pose où l'on veut. Lâcher une tuile sur une autre forme un **tas** ; le tas
 * se nomme, se déplie, se replie.
 *
 * # La règle qui rend l'idée acceptable
 *
 * **Un tas est un libellé Gmail.** Le nommer crée le libellé, y déposer une
 * tuile pose le libellé sur le message. Le rangement se retrouve donc dans
 * Gmail, sur le téléphone, et survit à la disparition de MailFlow.
 *
 * Seule la **disposition** — où les choses sont posées sur la table — reste
 * locale, dans `tableau.json`. Perdre ce fichier fait perdre une mise en page,
 * jamais un classement. Un tableau blanc dont le contenu n'existerait que dans
 * une application est un tableau blanc qu'on perd.
 *
 * # Ce qui donne la sensation du geste
 *
 * Quatre choses, toutes obtenues sans bibliothèque :
 *
 * 1. **Pointer Events** plutôt que l'API HTML5 `dragstart`, qui impose son
 *    image fantôme et ses saccades. On suit le doigt à la milliseconde.
 * 2. **`translate3d` seul** pendant le déplacement, jamais `top`/`left` : la
 *    tuile reste sur sa propre couche et rien n'est repeint.
 * 3. **Un ressort à la dépose**, pas une transition linéaire. C'est le
 *    dépassement puis le retour qui donnent la matière.
 * 4. **La capture du pointeur**, sans quoi une main rapide « lâche » la tuile
 *    dès qu'elle sort de son cadre.
 *
 * # Ce qui n'est pas fait, délibérément
 *
 * Pas de zoom infini ni de défilement sans limite. Sur une table sans bord, on
 * perd ses affaires : la surface est plus grande que l'écran, mais finie, et un
 * bouton réaligne tout en grille.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent as PointerEventReact } from 'react'
import { Bouton, Icone, Modale, Vide } from '../composants/base'
import { SURFACE, TAS, TUILE, aligner, borner, cibleSousLaTuile, completer, repartir } from '../lib/table'
import type { Pose } from '../lib/table'
import { heureCourte, initiales, palette, ton } from '../lib/presentation'
import type { LibelleGmail, MessageAffiche, Position, Tableau } from '../types/backend'

/** Ce que la table sait faire, et qui vient de la page qui l'accueille. */
export interface GestesDeLaTable {
  /** Pose un libellé sur un message : le dépôt sur un tas. */
  onDeposer: (message: string, libelle: string) => Promise<void>
  /** Retire un libellé : la sortie d'un tas. */
  onSortir: (message: string, libelle: string) => Promise<void>
  /** Crée un libellé et rend la liste à jour. */
  onCreerLibelle: (nom: string) => Promise<LibelleGmail[]>
  /** Ouvre un message en lecture. */
  onOuvrir: (message: MessageAffiche) => void
  /** Relève à nouveau les archives chez Gmail. */
  onRelever: () => void
  onErreur: (message: string) => void
}

export function Archives({
  archives,
  libelles,
  tableau,
  onTableau,
  sombre,
  enCours,
  gestes,
}: {
  archives: MessageAffiche[]
  libelles: LibelleGmail[]
  tableau: Tableau
  /** Appelée à chaque dépose : c'est elle qui écrit `tableau.json`. */
  onTableau: (tableau: Tableau) => void
  sombre: boolean
  enCours: boolean
  gestes: GestesDeLaTable
}) {
  const [deplie, setDeplie] = useState<string | null>(null)
  const [aNommer, setANommer] = useState<{ message: string; sur: string } | null>(null)

  const nomsDesLibelles = useMemo(
    () => new Map(libelles.map((l) => [l.id, l.nom])),
    [libelles],
  )

  const { parTas, seuls } = useMemo(
    () => repartir(archives, new Set(nomsDesLibelles.keys())),
    [archives, nomsDesLibelles],
  )

  // Seuls les libellés qui portent réellement une archive font un tas. Un
  // libellé créé pour la boîte de réception n'a rien à faire sur cette table.
  const tasVivants = useMemo(() => [...parTas.keys()], [parTas])

  // La disposition complétée : ce qui a une place la garde, ce qui vient
  // d'arriver en reçoit une. Sans cela, un message relevé depuis la dernière
  // ouverture s'afficherait au coin supérieur gauche, sous tous les autres.
  const dispose = useMemo(
    () =>
      completer(
        tableau,
        tasVivants,
        seuls.map((m) => m.id),
      ),
    [tableau, tasVivants, seuls],
  )

  /** Tout ce qui est posé, pour savoir ce qu'on survole en lâchant. */
  const poses: Pose[] = useMemo(
    () => [
      ...tasVivants.map((id) => ({ id, position: dispose.tas[id] ?? { x: 0, y: 0 } })),
      ...seuls.map((m) => ({ id: m.id, position: dispose.messages[m.id] ?? { x: 0, y: 0 } })),
    ],
    [tasVivants, seuls, dispose],
  )

  /** Déplace un objet et enregistre la nouvelle disposition. */
  const poser = useCallback(
    (id: string, position: Position, estUnTas: boolean) => {
      const suivant: Tableau = {
        tas: { ...dispose.tas },
        messages: { ...dispose.messages },
      }

      if (estUnTas) suivant.tas[id] = position
      else suivant.messages[id] = position

      onTableau(suivant)
    },
    [dispose, onTableau],
  )

  /**
   * Ce qui se passe quand une tuile est lâchée.
   *
   * Trois issues, et l'ordre compte : on regarde d'abord si elle atterrit sur
   * quelque chose, parce que c'est le geste porteur de sens. Le simple
   * déplacement est ce qui reste quand rien n'a été visé.
   */
  const lacher = useCallback(
    (message: MessageAffiche, position: Position) => {
      const cible = cibleSousLaTuile(position, poses, message.id)

      if (!cible) {
        poser(message.id, position, false)
        return
      }

      // Lâchée sur un tas : le message y entre.
      if (nomsDesLibelles.has(cible.id)) {
        void gestes.onDeposer(message.id, cible.id).catch((e) => gestes.onErreur(String(e)))
        return
      }

      // Lâchée sur une autre tuile : il faut un nom, donc un libellé à créer.
      // On ne le devine pas — un tas nommé « Karim, Devis » que personne n'a
      // choisi serait plus difficile à défaire qu'à faire.
      setANommer({ message: message.id, sur: cible.id })
    },
    [poses, poser, nomsDesLibelles, gestes],
  )

  const [accent] = ton('archive', sombre)

  if (archives.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <BarreDeTable
          tas={tasVivants.length}
          seuls={0}
          enCours={enCours}
          onRelever={gestes.onRelever}
          onAligner={() => undefined}
        />
        <Vide
          icone="archive"
          titre="Aucune archive"
          detail="Les messages que vous archivez depuis les autres pages viendront se poser ici. Vous pourrez alors les grouper en tas, et chaque tas sera un libellé retrouvé dans Gmail."
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarreDeTable
        tas={tasVivants.length}
        seuls={seuls.length}
        enCours={enCours}
        onRelever={gestes.onRelever}
        onAligner={() =>
          onTableau(
            aligner(
              tasVivants,
              seuls.map((m) => m.id),
            ),
          )
        }
      />

      {/* La surface défile dans les deux sens, et elle a une fin. */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ background: 'var(--sunk)' }}>
        <div
          className="relative"
          style={{
            width: SURFACE.largeur,
            height: SURFACE.hauteur,
            // Une trame légère : sans repère, on ne sait plus si l'on a
            // déplacé la tuile ou la table.
            backgroundImage:
              'radial-gradient(circle, color-mix(in srgb, var(--sub) 22%, transparent) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        >
          {tasVivants.map((id) => (
            <TasPose
              key={id}
              nom={nomsDesLibelles.get(id) ?? 'Sans nom'}
              messages={parTas.get(id) ?? []}
              position={dispose.tas[id] ?? { x: 0, y: 0 }}
              accent={accent}
              ouvert={deplie === id}
              onBasculer={() => setDeplie((d) => (d === id ? null : id))}
              onDeplacer={(p) => poser(id, p, true)}
              onOuvrirMessage={gestes.onOuvrir}
              onSortir={(message) =>
                void gestes.onSortir(message, id).catch((e) => gestes.onErreur(String(e)))
              }
            />
          ))}

          {seuls.map((message) => (
            <TuilePosee
              key={message.id}
              message={message}
              position={dispose.messages[message.id] ?? { x: 0, y: 0 }}
              onLacher={(p) => lacher(message, p)}
              onOuvrir={() => gestes.onOuvrir(message)}
            />
          ))}
        </div>
      </div>

      {aNommer && (
        <NommerLeTas
          onAnnuler={() => setANommer(null)}
          onValider={async (nom) => {
            const cible = aNommer
            setANommer(null)
            try {
              const aJour = await gestes.onCreerLibelle(nom)
              const cree = aJour.find((l) => l.nom === nom)
              if (!cree) return

              // Les deux messages entrent dans le tas : celui qu'on a lâché, et
              // celui sur lequel on l'a lâché. Ne poser le libellé que sur le
              // premier laisserait un tas à un seul élément, à côté d'une tuile
              // isolée — c'est-à-dire exactement ce qu'on voulait réunir.
              await gestes.onDeposer(cible.sur, cree.id)
              await gestes.onDeposer(cible.message, cree.id)
            } catch (e) {
              gestes.onErreur(String(e))
            }
          }}
        />
      )}
    </div>
  )
}

/** L'en-tête de la page : ce qu'il y a sur la table, et les deux gestes globaux. */
function BarreDeTable({
  tas,
  seuls,
  enCours,
  onRelever,
  onAligner,
}: {
  tas: number
  seuls: number
  enCours: boolean
  onRelever: () => void
  onAligner: () => void
}) {
  return (
    <div
      className="flex flex-none items-center gap-3 border-b px-6 py-3"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] font-semibold tracking-tight">Archives</div>
        <div className="pt-0.5 text-[0.75rem]" style={{ color: 'var(--sub)' }}>
          {tas === 0 && seuls === 0
            ? 'Rien sur la table'
            : `${decompte(tas, 'tas', 'tas')} · ${decompte(seuls, 'message seul', 'messages seuls')}`}
          {' — '}
          posez une tuile sur une autre pour en faire un tas.
        </div>
      </div>

      <Bouton onClick={onAligner} titre="Réaligner tout en grille">
        Tout ranger
      </Bouton>
      <Bouton
        icone="refresh"
        variante="principal"
        onClick={onRelever}
        enAttente={enCours}
        disabled={enCours}
      >
        Relever
      </Bouton>
    </div>
  )
}

/**
 * Un rang stable pour une adresse, qui sert à lui choisir sa couleur.
 *
 * `palette` attend un index, pas une adresse : ailleurs c'est le rang du
 * compte qui le fournit. Ici il n'y a pas de liste où se ranger, donc on dérive
 * le rang de l'adresse elle-même. Peu importe lequel — ce qui compte est qu'un
 * même expéditeur garde sa couleur d'une ouverture à l'autre.
 */
function rangDeLAdresse(adresse: string): number {
  let somme = 0
  for (const caractere of adresse.toLowerCase()) {
    somme = (somme * 31 + caractere.charCodeAt(0)) % 100_000
  }
  return somme
}

/** « 1 tas », « 3 tas » — le singulier compte quand on lit vite. */
function decompte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n > 1 ? pluriel : singulier}`
}

/**
 * Le glissement, isolé du reste.
 *
 * Rend ce qu'il faut poser sur l'élément et le décalage courant. La position
 * n'est écrite qu'à la dépose : la suivre dans l'état de React à chaque
 * mouvement ferait retracer toute la table soixante fois par seconde.
 */
function useGlissement(
  depart: Position,
  taille: { largeur: number; hauteur: number },
  onLacher: (position: Position) => void,
) {
  const noeud = useRef<HTMLDivElement>(null)
  const saisie = useRef<{ x: number; y: number } | null>(null)
  const [attrape, setAttrape] = useState(false)

  /** Vrai dès que le pointeur a bougé assez pour que ce soit un glissement. */
  const aBouge = useRef(false)

  const surPointerDown = (e: PointerEventReact<HTMLDivElement>) => {
    // Bouton principal seulement : un clic droit ouvre le menu du système.
    if (e.button !== 0) return

    saisie.current = { x: e.clientX, y: e.clientY }
    aBouge.current = false
    setAttrape(true)

    // Sans la capture, une main rapide « lâche » la tuile dès que le pointeur
    // sort de son cadre, et l'objet reste collé au curseur.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const surPointerMove = (e: PointerEventReact<HTMLDivElement>) => {
    const debut = saisie.current
    const element = noeud.current
    if (!debut || !element) return

    const dx = e.clientX - debut.x
    const dy = e.clientY - debut.y

    // Trois pixels de seuil : sans lui, un clic un peu appuyé compterait comme
    // un déplacement, et ouvrir un message deviendrait un coup de chance.
    if (!aBouge.current && Math.hypot(dx, dy) < 3) return
    aBouge.current = true

    // `translate3d` seul : la tuile reste sur sa couche, rien n'est repeint.
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`
  }

  const surPointerUp = (e: PointerEventReact<HTMLDivElement>) => {
    const debut = saisie.current
    const element = noeud.current
    saisie.current = null
    setAttrape(false)

    if (!debut || !element) return
    element.style.transform = ''

    if (!aBouge.current) return

    const arrivee = borner(
      {
        x: depart.x + (e.clientX - debut.x),
        y: depart.y + (e.clientY - debut.y),
      },
      taille.largeur,
      taille.hauteur,
    )

    onLacher(arrivee)
  }

  return {
    noeud,
    attrape,
    /** Vrai quand le geste était un déplacement, pas un clic. */
    aGlisse: () => aBouge.current,
    poignee: {
      onPointerDown: surPointerDown,
      onPointerMove: surPointerMove,
      onPointerUp: surPointerUp,
      onPointerCancel: surPointerUp,
    },
  }
}

/** Style commun à tout ce qui est posé sur la table. */
function styleDePose(position: Position, attrape: boolean) {
  return {
    left: position.x,
    top: position.y,
    // Ce qu'on tient passe devant, sinon la tuile glisse *sous* sa voisine et
    // l'on croit l'avoir perdue.
    zIndex: attrape ? 30 : 1,
    // Le ressort n'est appliqué qu'au lâcher : pendant le geste, toute
    // transition ferait traîner la tuile derrière le doigt.
    transition: attrape ? 'none' : 'transform 320ms cubic-bezier(0.22, 1.4, 0.36, 1)',
    cursor: attrape ? 'grabbing' : 'grab',
    touchAction: 'none' as const,
  }
}

/** Un message archivé, seul sur la table. */
function TuilePosee({
  message,
  position,
  onLacher,
  onOuvrir,
}: {
  message: MessageAffiche
  position: Position
  onLacher: (position: Position) => void
  onOuvrir: () => void
}) {
  const { noeud, attrape, aGlisse, poignee } = useGlissement(position, TUILE, onLacher)
  const [fond, encre] = palette(rangDeLAdresse(message.adresse))

  return (
    <div
      ref={noeud}
      {...poignee}
      onClick={() => {
        // Un glissement n'ouvre pas le message : sans cette garde, déplacer une
        // tuile ouvrirait le lecteur à chaque fois.
        if (!aGlisse()) onOuvrir()
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOuvrir()
        }
      }}
      className="absolute flex select-none flex-col gap-1.5 rounded-xl border p-3"
      style={{
        ...styleDePose(position, attrape),
        width: TUILE.largeur,
        height: TUILE.hauteur,
        background: 'var(--card)',
        borderColor: 'var(--line)',
        boxShadow: attrape ? '0 18px 40px rgb(0 0 0 / 26%)' : 'var(--shadow)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[0.5625rem] font-bold"
          style={{ background: fond, color: encre }}
        >
          {initiales(message.nom || message.adresse)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold">
          {message.nom || message.adresse}
        </span>
        <span className="flex-none text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
          {heureCourte(message.date)}
        </span>
      </div>

      <div className="line-clamp-2 text-[0.75rem] leading-snug" style={{ color: 'var(--sub)' }}>
        {message.sujet || '(sans objet)'}
      </div>
    </div>
  )
}

/** Un tas : un libellé Gmail, et les archives qui le portent. */
function TasPose({
  nom,
  messages,
  position,
  accent,
  ouvert,
  onBasculer,
  onDeplacer,
  onOuvrirMessage,
  onSortir,
}: {
  nom: string
  messages: MessageAffiche[]
  position: Position
  accent: string
  ouvert: boolean
  onBasculer: () => void
  onDeplacer: (position: Position) => void
  onOuvrirMessage: (message: MessageAffiche) => void
  onSortir: (message: string) => void
}) {
  const { noeud, attrape, aGlisse, poignee } = useGlissement(position, TAS, onDeplacer)

  return (
    <div
      ref={noeud}
      className="absolute select-none"
      style={{
        ...styleDePose(position, attrape),
        width: TAS.largeur,
        zIndex: attrape ? 30 : ouvert ? 20 : 2,
      }}
    >
      {/* Les feuilles derrière : c'est ce qui fait lire « plusieurs » avant
          même d'avoir lu le décompte. Elles ne réagissent pas au pointeur,
          sinon elles voleraient le geste à la carte de tête. */}
      {!ouvert &&
        messages.slice(1, 3).map((m, rang) => (
          <div
            key={m.id}
            aria-hidden
            className="absolute rounded-xl border"
            style={{
              inset: 0,
              height: TAS.hauteur,
              transform: `translate(${(rang + 1) * 5}px, ${(rang + 1) * 5}px) rotate(${(rang + 1) * 0.9}deg)`,
              background: 'var(--card)',
              borderColor: 'var(--line)',
              opacity: 0.75 - rang * 0.25,
              pointerEvents: 'none',
            }}
          />
        ))}

      <div
        {...poignee}
        onClick={() => {
          if (!aGlisse()) onBasculer()
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onBasculer()
          }
        }}
        className="relative flex flex-col justify-center gap-1 rounded-xl border px-3"
        style={{
          height: TAS.hauteur,
          background: 'var(--card)',
          borderColor: attrape ? accent : 'var(--line)',
          boxShadow: attrape ? '0 18px 40px rgb(0 0 0 / 26%)' : 'var(--shadow)',
        }}
      >
        <div className="flex items-center gap-2">
          <Icone nom="rule_folder" taille="1rem" rempli style={{ color: accent }} />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{nom}</span>
          {/* Une seule icône, retournée : la police n'a pas de chevron vers
              le haut, et en inventer un au tracé serait un dessin de plus à
              maintenir pour une rotation qui dit la même chose. */}
          <Icone
            nom="expand_more"
            taille="1rem"
            style={{
              color: 'var(--sub)',
              transform: ouvert ? 'rotate(180deg)' : undefined,
              transition: 'transform 200ms ease',
            }}
          />
        </div>
        <div className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
          {decompte(messages.length, 'message', 'messages')}
        </div>
      </div>

      {/* Déplié en place, avec sa propre barre de défilement : une pile de
          quarante messages ne doit pas couvrir la table entière. */}
      {ouvert && (
        <div
          className="mt-1.5 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border p-1.5"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: '0 18px 40px rgb(0 0 0 / 20%)',
          }}
        >
          {messages.map((m) => (
            <LigneDuTas
              key={m.id}
              message={m}
              onOuvrir={() => onOuvrirMessage(m)}
              onSortir={() => onSortir(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Une archive dans un tas déplié. */
function LigneDuTas({
  message,
  onOuvrir,
  onSortir,
}: {
  message: MessageAffiche
  onOuvrir: () => void
  onSortir: () => void
}) {
  const [fond, encre] = palette(rangDeLAdresse(message.adresse))

  return (
    <div className="ligne-de-tas flex items-center gap-2 rounded-lg px-2 py-1.5">
      <button
        type="button"
        onClick={onOuvrir}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.5rem] font-bold"
          style={{ background: fond, color: encre }}
        >
          {initiales(message.nom || message.adresse)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem]">
          {message.sujet || '(sans objet)'}
        </span>
      </button>

      <button
        type="button"
        onClick={onSortir}
        title="Sortir du tas"
        aria-label={`Sortir « ${message.sujet} » du tas`}
        className="bouton bouton-icone flex-none rounded-md p-1"
      >
        <Icone nom="close" taille="0.8125rem" />
      </button>
    </div>
  )
}

/** Demande le nom du tas qu'on vient de former. */
function NommerLeTas({
  onValider,
  onAnnuler,
}: {
  onValider: (nom: string) => void
  onAnnuler: () => void
}) {
  const [nom, setNom] = useState('')
  const pret = nom.trim().length > 0

  return (
    <Modale
      titre="Nommer ce tas"
      sous="Le tas devient un libellé Gmail : vous le retrouverez sur votre téléphone, et il survivra à MailFlow."
      onFermer={onAnnuler}
    >
      <div className="flex flex-col gap-4">
        <input
          type="text"
          value={nom}
          autoFocus
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pret) onValider(nom.trim())
          }}
          placeholder="Factures, Voyages, Impôts…"
          aria-label="Nom du tas"
          className="texte-optique-champ selectionnable w-full rounded-lg border bg-transparent px-3 text-[0.875rem] outline-none"
          style={{ borderColor: 'var(--line)', color: 'var(--fg)', height: '2.4rem' }}
        />

        <div className="flex items-center justify-end gap-2">
          <Bouton onClick={onAnnuler}>Annuler</Bouton>
          <Bouton
            variante="principal"
            icone="rule_folder"
            disabled={!pret}
            onClick={() => onValider(nom.trim())}
          >
            Créer le tas
          </Bouton>
        </div>
      </div>
    </Modale>
  )
}
