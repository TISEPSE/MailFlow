/**
 * Briques visuelles partagées par les cinq vues.
 *
 * Elles portent les jetons de surface (`--card`, `--line`, `--sub`…) plutôt que
 * des couleurs littérales : c'est ce qui permet au thème et à la couleur
 * d'accent de basculer sans que chaque vue ait à s'en occuper.
 */
import { useEffect, useRef } from 'react'
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
  taille = 18,
  className = '',
  style,
  rempli = false,
  compenser = false,
}: {
  nom: NomIcone
  taille?: number
  className?: string
  style?: CSSProperties
  rempli?: boolean
  /** Retranche le blanc interne du dessin, pour un centrage optique. */
  compenser?: boolean
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
  const marge = compenser ? -Math.round(taille * MARGE_ENCRE[nom]) : 0
  const releve = compenser ? Math.max(1, Math.round(taille * 0.07)) : 0

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={BOITE}
      width={taille}
      height={taille}
      className={`inline-block flex-none ${className}`}
      style={{
        fill: 'currentColor',
        marginInline: marge || undefined,
        // Une translation ne déplace rien dans la mise en page, contrairement
        // à une marge : les libellés restent où ils sont.
        transform: releve ? `translateY(-${releve}px)` : undefined,
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
  taille = 30,
  fond,
  couleur,
  logo,
}: {
  texte: string
  taille?: number
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
        fontSize: taille * 0.38,
      }}
    >
      {texte}
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
  const [large, haut, bille] = grand ? [46, 27, 21] : [40, 23, 17]
  const marge = (haut - bille) / 2

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
        width: large,
        height: haut,
        background: actif ? 'var(--accent)' : 'var(--piste)',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{
          width: bille,
          height: bille,
          top: marge,
          left: actif ? large - bille - marge : marge,
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
        }}
      />
    </button>
  )
}

/** Sélecteur segmenté, pour les choix courts et mutuellement exclusifs. */
export function Segments<T extends string>({
  valeurs,
  valeur,
  onChange,
  libelle,
}: {
  valeurs: readonly T[]
  valeur: T
  onChange: (v: T) => void
  libelle: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={libelle}
      className="flex flex-none gap-1 rounded-xl p-1.5"
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
            className="rounded-lg px-4 py-2 text-[13.5px] leading-none font-semibold whitespace-nowrap transition-colors"
            style={{
              background: actif ? 'var(--card)' : 'transparent',
              color: actif ? 'var(--fg)' : 'var(--sub)',
              boxShadow: actif ? 'var(--shadow)' : 'none',
            }}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

/**
 * En-tête de page : titre, phrase d'explication, actions à droite.
 *
 * Partagé par toutes les vues, pour qu'une page ne puisse pas se retrouver avec
 * deux titres empilés ni avec une typographie qui lui soit propre.
 */
export function EnTete({
  titre,
  sous,
  children,
}: {
  titre: string
  sous: string
  children?: ReactNode
}) {
  return (
    <div
      className="flex flex-none items-start gap-4 border-b px-8 py-6"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-[26px] font-bold tracking-tight">{titre}</h1>
        <p className="pt-1 text-[14px]" style={{ color: 'var(--sub)' }}>
          {sous}
        </p>
      </div>
      {children}
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
      <Icone nom={icone} taille={19} style={{ color: 'var(--sub)' }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{titre}</div>
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
          className="px-1 pt-7 pb-2.5 text-[11px] font-semibold tracking-wider uppercase"
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
export function Modale({
  titre,
  sous,
  onFermer,
  children,
}: {
  titre: string
  sous?: string
  onFermer: () => void
  children: ReactNode
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-8"
      style={{ background: 'rgb(0 0 0 / 45%)' }}
    >
      <div
        ref={cadre}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="mt-[8vh] w-full max-w-lg rounded-2xl border"
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
            <h2 className="text-[17px] font-semibold tracking-tight">{titre}</h2>
            {sous && (
              <p className="pt-1 text-[13px]" style={{ color: 'var(--sub)' }}>
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
            <Icone nom="close" taille={17} />
          </button>
        </div>

        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

/** État vide : ce n'est pas une erreur, c'est une boîte en ordre. */
export function Vide({
  icone,
  titre,
  detail,
}: {
  icone: NomIcone
  titre: string
  detail: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      <Icone nom={icone} taille={34} style={{ color: 'var(--sub)', opacity: 0.5 }} />
      <div className="text-sm font-semibold">{titre}</div>
      <div className="max-w-sm text-[13px]" style={{ color: 'var(--sub)' }}>
        {detail}
      </div>
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
}: {
  children: ReactNode
  onClick: () => void
  variante?: 'principal' | 'secondaire' | 'discret' | 'danger'
  icone?: NomIcone
  disabled?: boolean
  titre?: string
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
      className={`bouton ${teintes[variante]} inline-flex flex-none items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs leading-none font-semibold whitespace-nowrap`}
    >
      {icone && <Icone nom={icone} taille={14} compenser />}
      {children}
    </button>
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
