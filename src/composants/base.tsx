/**
 * Briques visuelles partagées par les cinq vues.
 *
 * Elles portent les jetons de surface (`--card`, `--line`, `--sub`…) plutôt que
 * des couleurs littérales : c'est ce qui permet au thème et à la couleur
 * d'accent de basculer sans que chaque vue ait à s'en occuper.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { BOITE, GLYPHES, GLYPHES_PLEINS, MARGE_ENCRE, type NomIcone } from './glyphes'

/**
 * Icône, dessinée en SVG.
 *
 * Pas une police : deux tentatives ont montré qu'une police d'icônes découpée
 * cesse d'afficher ses glyphes sans lever la moindre erreur — d'abord des noms
 * en toutes lettres, puis des espaces vides. Un tracé ne dépend de rien.
 *
 * `rempli` demande la variante pleine, extraite de l'axe variable `FILL`. Elle
 * sert à marquer l'élément actif : une icône qui se remplit se distingue même
 * quand la couleur ne suffit pas. Neuf icônes sur trente et une sont identiques
 * dans les deux variantes ; pour celles-là, `rempli` ne change rien, faute de
 * dessin plein dans la police.
 */
export function Icone({
  nom,
  taille = '1.125rem',
  className = '',
  style,
  rempli = false,
  compenser = false,
  tourne = false,
}: {
  nom: NomIcone
  /** Longueur CSS relative, jamais un nombre de pixels — le type l'interdit,
   *  et ce n'est pas un caprice. Une icône figée en pixels à côté d'un texte
   *  qui, lui, suit la taille de police du système finit forcément décalée :
   *  c'est l'origine de tous les défauts d'alignement rencontrés jusqu'ici.
   *  `'1.15em'` la lie au texte voisin, `'1rem'` au réglage général. */
  taille?: string
  className?: string
  style?: CSSProperties
  rempli?: boolean
  /** Retranche le blanc interne du dessin, pour un centrage optique. */
  compenser?: boolean
  /** Fait tourner l'icône : signale une attente en cours. */
  tourne?: boolean
}) {
  const trace = (rempli ? GLYPHES_PLEINS[nom] : undefined) ?? GLYPHES[nom]

  // Deux corrections, toutes deux mesurées.
  //
  // À l'horizontale : la croix « close » laissait quatre pixels de plus à
  // gauche que le libellé n'en laissait à droite. Les boîtes étaient pourtant
  // symétriques — c'est le blanc *dans* le dessin qui décalait l'ensemble.
  //
  // À la verticale : une icône est plus haute que les capitales du texte
  // qu'elle accompagne, et déborde donc sous la ligne de base. Centrer les
  // boîtes ne suffit pas ; l'œil lit un décalage vers le bas. Un léger
  // relèvement la ramène dans la bande des capitales.
  // La compensation s'exprime en proportion de l'icône, donc dans la même
  // unité qu'elle : un `calc` suit la taille au lieu de la figer.
  const marge = compenser ? `calc(${taille} * ${-MARGE_ENCRE[nom]})` : undefined

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={BOITE}
      width={taille}
      height={taille}
      className={`inline-block flex-none ${tourne ? 'mouvement-utile tourne ' : ''}${className}`}
      style={{
        fill: 'currentColor',
        marginInline: marge,
        // Aligne l'icône sur les capitales du texte quand elle est posée dans
        // le fil du texte plutôt que dans une rangée flex.
        //
        // C'est là qu'était le défaut d'alignement, et il est bien plus gros
        // que celui qu'on cherchait ailleurs : une boîte en ligne repose sur
        // la *ligne de base*, si bien qu'une icône d'une fois et demie la
        // hauteur du texte dépasse largement au-dessus des capitales — mesuré
        // à 3,9 px, quand les rangées flex se disputaient un quart de pixel.
        //
        //   vertical-align   écart icône / capitales
        //   défaut           −3,88 px
        //   −0,20 em         −1,38 px
        //   −0,25 em         −0,62 px
        //   −0,30 em         −0,12 px  ← retenu
        //   −0,35 em         +0,62 px
        //
        // Sans effet sur les rangées flex : `vertical-align` ne s'applique pas
        // à un enfant de conteneur flex. La même valeur sert donc partout, et
        // il n'y a plus deux façons d'aligner une icône selon son entourage.
        verticalAlign: '-0.3em',
        ...style,
      }}
    >
      <path d={trace} />
    </svg>
  )
}

/**
 * Pastille d'expéditeur : son logo s'il en a un, ses initiales sinon.
 *
 * Gmail ne fournit aucun avatar ; le logo vient du domaine de l'expéditeur.
 * Les initiales restent le cas normal, pas un pis-aller.
 */
export function Pastille({
  texte,
  taille = '1.875rem',
  fond,
  couleur,
  logo,
}: {
  texte: string
  /** Longueur CSS relative — jamais de pixels : voir `Icone`. */
  taille?: string
  fond: string
  couleur: string
  logo?: string
}) {
  if (logo) {
    // `cover` plutôt que `contain` : le logo occupe tout le disque, comme les
    // initiales qu'il remplace. Une icône de site est carrée, le recadrage ne
    // rogne donc rien en pratique.
    return (
      <img
        src={logo}
        alt=""
        className="flex-none rounded-full object-cover"
        style={{ width: taille, height: taille, background: fond }}
      />
    )
  }

  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-semibold"
      style={{
        width: taille,
        height: taille,
        background: fond,
        color: couleur,
        // Les initiales tiennent 38 % du disque quelle que soit sa taille : un
        // rapport, pas une valeur, sinon elles ne suivent plus dès que la
        // pastille change de gabarit.
        fontSize: `calc(${taille} * 0.38)`,
      }}
    >
      {/* Une note précédente affirmait ici, mesures à l'appui, que les
          initiales tombaient à moins d'un demi-pixel du centre. Elle était
          fausse : la mesure avait été faite dans Chrome, qui ne choisit pas la
          même fonte de repli que le moteur de l'application. Photographiées
          dans WebKitGTK, et sur une capture de l'application elle-même, elles
          sont trois pixels et demi au-dessus du centre d'un disque de soixante.
          Voir `.texte-optique`. */}
      <span className="texte-optique">{texte}</span>
    </div>
  )
}

/**
 * Interrupteur.
 *
 * Un vrai `<button role="switch">` plutôt qu'un `<div>` cliquable : il se
 * déclenche au clavier et son état est annoncé.
 */
export function Interrupteur({
  actif,
  onChange,
  libelle,
  disabled = false,
  grand = false,
}: {
  actif: boolean
  onChange: () => void
  libelle: string
  disabled?: boolean
  /** Taille des pages de réglages, où l'interrupteur est le sujet de la ligne. */
  grand?: boolean
}) {
  // En rem, comme le reste : l'interrupteur grandit avec le texte des réglages
  // au lieu de rétrécir à côté de lui.
  const [large, haut, bille] = grand ? [2.875, 1.6875, 1.3125] : [2.5, 1.4375, 1.0625]
  const rem = (v: number) => `${v}rem`
  const marge = rem((haut - bille) / 2)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={disabled}
      onClick={onChange}
      className="relative flex-none rounded-full transition-colors disabled:opacity-40"
      style={{
        width: rem(large),
        height: rem(haut),
        background: actif ? 'var(--accent)' : 'var(--piste)',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{
          width: rem(bille),
          height: rem(bille),
          top: marge,
          left: actif ? rem(large - bille - (haut - bille) / 2) : marge,
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
        }}
      />
    </button>
  )
}

/**
 * Sélecteur segmenté, pour les choix courts et mutuellement exclusifs.
 *
 * Hauteur explicite et contenu centré par la mise en page : le rembourrage
 * seul laissait le texte flotter au-dessus du milieu, jambages compris. Le
 * survol distingue le segment visé — trois libellés côte à côte qui ne
 * réagissent à rien ne disent pas où l'on est.
 *
 * Les couleurs vivent dans `.segment`, jamais en style en ligne : un style en
 * ligne l'emporte sur toute règle de feuille, et le survol n'aurait alors
 * aucune couleur à poser.
 */
export function Segments<T extends string>({
  valeurs,
  valeur,
  onChange,
  libelle,
  pleineLargeur = false,
}: {
  valeurs: readonly T[]
  valeur: T
  onChange: (v: T) => void
  libelle: string
  /** Occupe toute la ligne, chaque segment se partageant la largeur. */
  pleineLargeur?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={libelle}
      className={`flex gap-1 rounded-xl p-1.5 ${pleineLargeur ? 'w-full' : 'flex-none'}`}
      style={{ background: 'var(--sunk)' }}
    >
      {valeurs.map((v) => {
        const actif = v === valeur
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => onChange(v)}
            className={`segment inline-flex h-[2.125rem] items-center justify-center rounded-lg px-4 text-[0.8438rem] font-semibold whitespace-nowrap ${
              pleineLargeur ? 'flex-1' : ''
            }`}
          >
            {/* La correction optique manquait ici, et nulle part ailleurs elle
                ne se voit autant : trois segments côte à côte donnent trois
                lignes de texte parallèles, et l'œil compare une bande de
                capitales à un bord arrondi tout proche. Le libellé était haut
                de 0,12 em dans sa pastille — mesuré une fois, jamais appliqué
                ici. Voir `.texte-optique`. */}
            <span className="texte-optique">{v}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Un message passager, tel que l'interface le montre. */
export interface Toast {
  id: number
  texte: string
  erreur: boolean
}

/**
 * Pile de messages passagers, en haut à droite.
 *
 * Ils se superposent à l'interface au lieu de s'y insérer : le bandeau qu'ils
 * remplacent poussait la boîte vers le bas à chaque action, si bien que le
 * message déplaçait ce qu'on était en train de lire.
 *
 * Chacun porte sa barre de décompte. Une disparition annoncée se lit comme une
 * disparition voulue ; sans elle, le message s'évanouit sans prévenir.
 */
export function Toasts({
  toasts,
  onFermer,
}: {
  toasts: readonly Toast[]
  onFermer: (id: number) => void
}) {
  return (
    <div
      // `pointer-events-none` sur la pile, rétabli sur chaque toast : sans
      // cela, la colonne invisible interceptait les clics de ce qu'elle
      // recouvre — ici l'en-tête de lecture et ses boutons d'action.
      className="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast pointer-events-auto overflow-hidden rounded-xl border"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: '0 12px 32px rgb(0 0 0 / 22%)',
          }}
        >
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <Icone
              nom={t.erreur ? 'error' : 'check_circle'}
              taille="1.0625rem"
              rempli
              style={{ color: t.erreur ? '#C2410C' : 'var(--accent-fg)' }}
            />
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-5">{t.texte}</span>
            <button
              type="button"
              onClick={() => onFermer(t.id)}
              aria-label="Fermer le message"
              className="bouton bouton-icone -mt-0.5 flex-none rounded-md p-1"
            >
              <Icone nom="close" taille="0.875rem" />
            </button>
          </div>
          <div className="h-[0.1875rem]" style={{ background: 'var(--faint)' }}>
            <div
              className="toast-decompte h-full"
              style={{ background: t.erreur ? '#C2410C' : 'var(--accent)' }}
              // L'animation est le minuteur : c'est elle qui prévient la fin,
              // et le retrait suit dans `App`.
              onAnimationEnd={() => onFermer(t.id)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Carte de réglage : icône, intitulé, explication, contrôle à droite. */
export function LigneReglage({
  icone,
  titre,
  detail,
  children,
}: {
  icone: NomIcone
  titre: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Icone nom={icone} taille="1.1875rem" style={{ color: 'var(--sub)' }} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.8125rem] font-semibold">{titre}</div>
        <div className="pt-0.5 text-xs" style={{ color: 'var(--sub)' }}>
          {detail}
        </div>
      </div>
      {children}
    </div>
  )
}

/** Regroupement de réglages, avec son titre de section. */
export function Bloc({
  titre,
  children,
}: {
  titre?: string
  children: ReactNode
}) {
  return (
    <>
      {titre && (
        <div
          className="px-1 pt-7 pb-2.5 text-[0.6875rem] font-semibold tracking-wider uppercase"
          style={{ color: 'var(--sub)' }}
        >
          {titre}
        </div>
      )}
      <div
        className="cloisonne overflow-hidden rounded-2xl border"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--line)',
          boxShadow: 'var(--shadow)',
        }}
      >
        {children}
      </div>
    </>
  )
}

/**
 * Fenêtre modale.
 *
 * Un formulaire glissé dans la page pousse tout ce qui suit vers le bas : les
 * règles qu'on voulait consulter disparaissent au moment même où l'on en ajoute
 * une. La fenêtre modale garde la page en place et dit clairement qu'une seule
 * chose est en cours.
 *
 * Trois manières d'en sortir — `Échap`, le fond, le bouton — parce qu'une
 * fenêtre dont on ne sait pas sortir est pire que pas de fenêtre du tout.
 */
/**
 * Demande confirmation avant un geste qu'on ne rattrape pas d'un clic.
 *
 * Supprimer et archiver font tous deux disparaître un message de la boîte. Ils
 * sont récupérables — la corbeille garde trente jours, l'archive ne détruit
 * rien — mais les retrouver demande d'aller dans Gmail et de savoir où
 * chercher. Un clic de travers dans une liste ne doit pas coûter ça.
 *
 * La fenêtre nomme ce qui va disparaître : « Supprimer ce message ? » sans le
 * sujet oblige à se souvenir de ce qu'on visait.
 */
export function Confirmation({
  titre,
  sous,
  libelle,
  variante = 'danger',
  icone,
  enCours = false,
  onConfirmer,
  onAnnuler,
}: {
  titre: string
  sous: string
  /** Ce que fait le bouton, à l'infinitif : « Supprimer », « Archiver ». */
  libelle: string
  variante?: 'principal' | 'danger'
  icone?: NomIcone
  enCours?: boolean
  onConfirmer: () => void
  onAnnuler: () => void
}) {
  return (
    <Modale titre={titre} sous={sous} onFermer={onAnnuler}>
      <div className="flex items-center justify-end gap-2">
        {/* Annuler à gauche et sans accent : c'est le geste sans conséquence,
            il n'a pas à attirer l'œil avant celui qu'on est venu faire. */}
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
        <Bouton variante={variante} icone={icone} onClick={onConfirmer} disabled={enCours}>
          {libelle}
        </Bouton>
      </div>
    </Modale>
  )
}

export function Modale({
  titre,
  sous,
  onFermer,
  children,
  large = false,
  sansRembourrage = false,
}: {
  titre: string
  sous?: string
  onFermer: () => void
  children: ReactNode
  /** Occupe presque tout l'écran : pour lire un message en entier. */
  large?: boolean
  /** Le contenu gère lui-même ses marges — utile à une `iframe`. */
  sansRembourrage?: boolean
}) {
  const cadre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer()
    }
    document.addEventListener('keydown', auClavier)

    // Le focus entre dans la fenêtre : sans cela, la tabulation continuerait de
    // parcourir la page qui est derrière, invisible et inatteignable.
    const rendre = document.activeElement as HTMLElement | null
    cadre.current?.querySelector<HTMLElement>('input, button')?.focus()

    return () => {
      document.removeEventListener('keydown', auClavier)
      rendre?.focus()
    }
  }, [onFermer])

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        // `mousedown` sur le fond seulement : un glissement commencé dans le
        // formulaire et relâché dehors ne doit pas fermer la fenêtre.
        if (e.target === e.currentTarget) onFermer()
      }}
      // Moins de marge autour d'une grande fenêtre : à `p-8`, l'en-tête et les
      // deux bords mangeaient assez de hauteur pour que la fenêtre dépasse de
      // l'écran sur un portable, et c'est alors la page derrière qui se mettait
      // à défiler.
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto ${
        large ? 'p-5' : 'p-8'
      }`}
      style={{
        background: 'rgb(0 0 0 / 40%)',
        // Le flou détache la fenêtre de la page sans l'effacer : on voit encore
        // où l'on est, sans pouvoir lire ce qui est derrière.
        backdropFilter: 'blur(10px) saturate(120%)',
        WebkitBackdropFilter: 'blur(10px) saturate(120%)',
      }}
    >
      <div
        ref={cadre}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        // La variante large prend presque tout l'écran : c'est une fenêtre où
        // l'on *lit* un message entier, et chaque centimètre rendu au texte est
        // une ligne de moins à faire défiler. Les marges du fond restent —
        // collée aux bords, la fenêtre ne se distinguerait plus de la page, et
        // l'on ne saurait plus par où en sortir.
        className={`apparait my-auto w-full rounded-2xl border ${
          large ? 'max-w-[min(1500px,94vw)]' : 'max-w-lg'
        }`}
        style={{
          background: 'var(--card)',
          borderColor: 'var(--line)',
          boxShadow: '0 24px 64px rgb(0 0 0 / 28%)',
        }}
      >
        <div
          className="flex items-start gap-4 border-b px-6 py-5"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.0625rem] font-semibold tracking-tight">{titre}</h2>
            {sous && (
              <p className="pt-1 text-[0.8125rem]" style={{ color: 'var(--sub)' }}>
                {sous}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="bouton bouton-icone flex-none rounded-lg p-2"
          >
            <Icone nom="close" taille="1.0625rem" />
          </button>
        </div>

        {/* Défilement interne : les suggestions d'adresse débordaient de la
            fenêtre au lieu de la faire défiler. */}
        {/* Sans rembourrage, le contenu touche les bords : il doit donc
            reprendre l'arrondi du bas de la fenêtre, sans quoi ses coins
            carrés dépassent de la carte. Le défilement lui est laissé — deux
            barres imbriquées, l'une pour la fenêtre et l'autre pour le
            message, se disputaient la molette. */}
        <div
          className={`${large ? 'h-[82vh]' : 'max-h-[70vh]'} ${
            sansRembourrage
              ? 'overflow-hidden rounded-b-2xl'
              : 'overflow-y-auto px-6 py-5'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Géométrie de la liste de messages.
 *
 * Ces deux valeurs sont partagées par la liste, son squelette et l'en-tête du
 * panneau de lecture. La hauteur surtout : c'est elle qui fait tomber le trait
 * sous la première tuile exactement sur celui qui souligne l'en-tête. Deux
 * réglages séparés dérivaient de quelques pixels, ce qui se voit.
 */
export const LARGEUR_LISTE = 352
export const HAUTEUR_LIGNE = 88

/**
 * Squelette d'une liste de messages.
 *
 * Il reprend la géométrie des tuiles réelles — pastille, deux lignes de texte,
 * mêmes marges. Un squelette approximatif ferait sauter la liste au moment où
 * les messages arrivent, ce qui se remarque davantage qu'une attente franche.
 */
export function SqueletteListe({ lignes = 7 }: { lignes?: number }) {
  return (
    <div
      className="flex flex-none flex-col overflow-hidden border-r"
      style={{
        width: LARGEUR_LISTE,
        background: 'var(--sunk)',
        borderColor: 'var(--line)',
      }}
      aria-hidden
    >
      {Array.from({ length: lignes }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 overflow-hidden border-b px-3"
          style={{ borderColor: 'var(--line)', height: HAUTEUR_LIGNE }}
        >
          <span className="mouvement-utile squelette h-[1.875rem] w-[1.875rem] flex-none rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="mouvement-utile squelette h-3 w-1/2" />
            <span className="mouvement-utile squelette h-3 w-4/5" />
            <span className="mouvement-utile squelette h-3 w-2/3" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Squelette du panneau de lecture. */
export function SqueletteLecture() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden>
      <div
        className="flex flex-none flex-col justify-center gap-2.5 overflow-hidden border-b px-6"
        style={{ borderColor: 'var(--line)', height: HAUTEUR_LIGNE }}
      >
        <div className="flex items-center gap-2.5">
          <span className="mouvement-utile squelette h-[1.875rem] w-[1.875rem] flex-none rounded-full" />
          <span className="mouvement-utile squelette h-4 w-3/5" />
        </div>
        <span className="mouvement-utile squelette ml-[2.5rem] h-3 w-60" />
      </div>
      <div className="flex flex-1 flex-col gap-3 px-9 py-6">
        {[92, 78, 85, 60, 70].map((largeur, i) => (
          <span key={i} className="mouvement-utile squelette h-3.5" style={{ width: `${largeur}%` }} />
        ))}
      </div>
    </div>
  )
}

/** Les attentes que l'écran de chargement annonce. */
export type EtapeChargement = 'releve' | 'corps' | 'resumes' | 'connexion'

const INTITULES: Record<EtapeChargement, string> = {
  releve: 'Relevé de vos messages…',
  corps: 'Préparation de votre boîte…',
  resumes: 'Résumé de vos newsletters…',
  connexion: 'Autorisation en cours dans votre navigateur',
}

/** Ce que l'écran dit sous la barre, selon l'étape. */
const EXPLICATIONS: Record<EtapeChargement, string> = {
  releve:
    'Les messages sont chargés une fois pour toutes. Ils resteront instantanés à la prochaine ouverture.',
  corps:
    'Les messages sont chargés une fois pour toutes. Ils resteront instantanés à la prochaine ouverture.',
  resumes:
    "Vous pouvez continuer à lire votre courrier pendant ce temps : cette étape ne bloque rien.",
  connexion:
    "Terminez la connexion dans l'onglet qui vient de s'ouvrir. MailFlow attend cinq minutes, puis abandonne — vous pourrez relancer.",
}

/**
 * Barre de progression du chargement.
 *
 * Chiffrée autant que dessinée : une barre seule ne dit pas si l'attente sera
 * de trois secondes ou d'une minute, alors que « 12 sur 48 » le laisse estimer.
 *
 * Deux étapes se comptent ici, et non plus une seule : le relevé demande un
 * appel par message, autant que le préchargement des corps. Le laisser muet
 * revenait à afficher une barre qui n'avance pas pendant la moitié de l'attente.
 */
export function Progression({
  faits,
  total,
  etape = 'corps',
}: {
  faits: number
  total: number
  etape?: EtapeChargement
}) {
  // Total inconnu : la bascule de compte affiche cet écran dès le clic, avant
  // même de savoir combien de messages seront à charger. Une barre à zéro
  // laisserait croire que rien ne se passe.
  const indetermine = total <= 0
  const glyphe: NomIcone = etape === 'connexion' ? 'person' : 'inbox'
  const part = indetermine ? 0 : Math.min(100, Math.round((faits / total) * 100))

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10">
      {/* Le halo occupe la place d'un carré vide, pour que rien ne bouge quand
          l'onde s'étend. */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          className="onde absolute inset-0 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        <span
          className="relative flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-soft)' }}
        >
          {/* Le nom est calculé au-dessus, hors de l'attribut :
              `outils/extraire-icones.py` relit les noms dans les sources et
              prendrait la condition elle-même pour une icône à extraire. */}
          <Icone nom={glyphe} taille="2.125rem" style={{ color: 'var(--accent-fg)' }} />
        </span>
      </div>

      <div className="text-[1.25rem] font-semibold tracking-tight">
        {etape === 'connexion' || !indetermine
          ? INTITULES[etape]
          : 'Ouverture de votre boîte…'}
      </div>

      <div className="flex w-80 max-w-full flex-col gap-2">
        <div
          role="progressbar"
          aria-valuenow={indetermine ? undefined : faits}
          aria-valuemin={0}
          aria-valuemax={indetermine ? undefined : total}
          aria-label="Chargement des messages"
          className="h-2 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--faint)' }}
        >
          <div
            className={`h-full rounded-full ${indetermine ? 'mouvement-utile barre-indeterminee' : ''}`}
            style={{
              width: indetermine ? undefined : `${part}%`,
              background: 'var(--accent)',
              transition: indetermine ? undefined : 'width 200ms ease',
            }}
          />
        </div>
        {/* Le décompte, et rien d'autre.
            Tant que le total est inconnu, cette ligne ne portait qu'un
            commentaire — « en attente de Google », « relevé des messages » —
            qui répétait le titre au-dessus et l'explication en dessous sans
            rien apprendre. Une barre qui bouge dit déjà qu'on attend. */}
        {!indetermine && (
          <div
            className="flex items-baseline justify-between font-mono text-[0.7812rem]"
            style={{ color: 'var(--sub)' }}
          >
            <span>{`${faits} sur ${total} message${total > 1 ? 's' : ''}`}</span>
            <span>{`${part} %`}</span>
          </div>
        )}
      </div>

      <p className="max-w-md text-center text-[0.8438rem]" style={{ color: 'var(--sub)' }}>
        {EXPLICATIONS[etape]}
      </p>
    </div>
  )
}

/**
 * État vide : ce n'est pas une erreur, c'est une boîte en ordre.
 *
 * Occupe une page entière, et se dessine en conséquence : à 34 pixels, l'icône
 * se perdait au milieu du vide qu'elle est censée expliquer.
 *
 * `action` sert aux vides qui appellent un geste — « Rappels de formations » ne
 * se remplit que si on l'a demandé, et une page qui l'explique sans offrir le
 * moyen de le faire renvoie l'utilisateur chercher tout seul.
 */
export function Vide({
  icone,
  titre,
  detail,
  action,
}: {
  icone: NomIcone
  titre: string
  detail: string
  action?: { libelle: string; icone?: NomIcone; onClick: () => void }
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <Icone nom={icone} taille="3.25rem" style={{ color: 'var(--sub)', opacity: 0.45 }} />
      <div className="text-[1.1875rem] font-semibold tracking-tight">{titre}</div>
      <div
        className="max-w-md text-[0.9062rem] leading-relaxed"
        style={{ color: 'var(--sub)' }}
      >
        {detail}
      </div>
      {action && (
        <div className="pt-2">
          <Bouton
            variante="principal"
            icone={action.icone}
            // Ce bouton conclut une page entière : à 14 pixels, l'icône
            // paraissait posée à côté du texte plutôt qu'avec lui.
            onClick={action.onClick}
          >
            {action.libelle}
          </Bouton>
        </div>
      )}
    </div>
  )
}

/** Bouton d'action principal ou secondaire. */
export function Bouton({
  children,
  onClick,
  variante = 'secondaire',
  icone,
  disabled = false,
  titre,
  enAttente = false,
  compact = false,
  tailleIcone = '1em',
  className = '',
}: {
  children: ReactNode
  onClick: () => void
  variante?: 'principal' | 'secondaire' | 'discret' | 'danger'
  icone?: NomIcone
  /** En `em` : l'icône suit la taille du texte du bouton, et le suit encore
   *  si l'utilisateur change la taille de police du système.
   *
   *  Une valeur par défaut qui vaut la taille du texte, et non une fois et
   *  demie : à 1,35 em l'icône faisait deux fois la hauteur des capitales et
   *  débordait autant sous la ligne de base qu'au-dessus des majuscules. Elle
   *  était pourtant centrée au dixième de pixel — c'est la taille qui se
   *  voyait, pas le centrage. */
  tailleIcone?: string
  disabled?: boolean
  titre?: string
  /** Fait tourner l'icône tant que l'action n'a pas rendu la main. */
  enAttente?: boolean
  /** Un cran plus bas, pour les barres d'action logées dans un en-tête. */
  compact?: boolean
  /** Pour s'accorder à la hauteur d'un champ voisin. */
  className?: string
}) {
  const teintes: Record<string, string> = {
    principal: 'bouton-principal',
    secondaire: 'bouton-neutre',
    discret: 'bouton-doux',
    danger: 'bouton-danger',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titre}
      className={`bouton ${teintes[variante]} inline-flex ${
        compact ? 'h-8 px-3' : 'h-9 px-3.5'
      } flex-none items-center justify-center gap-1.5 rounded-lg text-xs leading-none font-semibold whitespace-nowrap ${className}`}
    >
      {icone && (
        <Icone
          nom={icone}
          taille={tailleIcone}
          className="icone-bouton"
          tourne={enAttente}
        />
      )}
      <span className="texte-optique">{children}</span>
    </button>
  )
}

/**
 * Liste déroulante.
 *
 * Écrite plutôt qu'empruntée à `<select>` : le menu natif ne se met pas en
 * forme, il ignore le thème sombre et n'a pas les arrondis du reste. Sur une
 * fenêtre où tout est dessiné, il détonne autant qu'il déçoit au clic.
 */
export function Selecteur<T extends string>({
  valeurs,
  valeur,
  onChange,
  libelle,
  className = '',
}: {
  valeurs: readonly { valeur: T; texte: string }[]
  valeur: T
  onChange: (v: T) => void
  libelle: string
  className?: string
}) {
  const [ouvert, setOuvert] = useState(false)
  const cadre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ouvert) return

    const dehors = (e: MouseEvent) => {
      if (!cadre.current?.contains(e.target as Node)) setOuvert(false)
    }
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false)
    }

    // Au tour suivant : sans ce report, le clic qui vient d'ouvrir la liste la
    // refermerait aussitôt.
    const minuteur = window.setTimeout(() => {
      document.addEventListener('mousedown', dehors, true)
    }, 0)
    document.addEventListener('keydown', auClavier)

    return () => {
      window.clearTimeout(minuteur)
      document.removeEventListener('mousedown', dehors, true)
      document.removeEventListener('keydown', auClavier)
    }
  }, [ouvert])

  const choisi = valeurs.find((v) => v.valeur === valeur) ?? valeurs[0]

  return (
    <div ref={cadre} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-label={libelle}
        className="bouton bouton-neutre flex w-full items-center gap-2 rounded-xl px-3.5 py-3 text-left text-[0.8125rem] leading-5 font-semibold"
      >
        <span className="min-w-0 flex-1 truncate">{choisi?.texte}</span>
        <Icone
          nom="expand_more"
          taille="1.0625rem"
          style={{
            color: 'var(--sub)',
            transform: ouvert ? 'rotate(180deg)' : undefined,
            transition: 'transform 160ms ease',
          }}
        />
      </button>

      {ouvert && (
        <div
          role="listbox"
          aria-label={libelle}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border p-1"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: '0 12px 32px rgb(0 0 0 / 22%)',
          }}
        >
          {valeurs.map((v) => {
            const actif = v.valeur === valeur
            return (
              <button
                key={v.valeur}
                type="button"
                role="option"
                aria-selected={actif}
                onClick={() => {
                  onChange(v.valeur)
                  setOuvert(false)
                }}
                className="survolable flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-medium"
                style={actif ? { background: 'var(--faint)' } : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{v.texte}</span>
                {actif && (
                  <Icone
                    nom="check_circle"
                    taille="0.9375rem"
                    rempli
                    style={{ color: 'var(--accent-fg)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Étiquette de catégorie.
 *
 * Même géométrie que `Bouton` — interligne, rembourrage vertical, arrondi —
 * parce qu'elle se tient juste à côté de lui dans le panneau de lecture. Deux
 * hauteurs différentes se voient immédiatement sur une même ligne.
 */
export function Etiquette({
  texte,
  fond,
  couleur,
}: {
  texte: string
  fond: string
  couleur: string
}) {
  return (
    <span
      className="inline-flex flex-none items-center rounded-lg px-3 py-2 text-xs leading-none font-semibold"
      style={{ background: fond, color: couleur }}
    >
      {texte}
    </span>
  )
}
