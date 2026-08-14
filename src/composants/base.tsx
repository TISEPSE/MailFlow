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
  taille = 18,
  className = '',
  style,
  rempli = false,
  compenser = false,
  tourne = false,
}: {
  nom: NomIcone
  taille?: number
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
  const marge = compenser ? -Math.round(taille * MARGE_ENCRE[nom]) : 0
  const releve = compenser ? Math.max(1, Math.round(taille * 0.07)) : 0

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={BOITE}
      width={taille}
      height={taille}
      className={`inline-block flex-none ${tourne ? 'tourne ' : ''}${className}`}
      style={{
        fill: 'currentColor',
        marginInline: marge || undefined,
        // Une translation ne déplace rien dans la mise en page, contrairement
        // à une marge : les libellés restent où ils sont. Elle cède la place à
        // la rotation, qui a besoin du même canal.
        transform: !tourne && releve ? `translateY(-${releve}px)` : undefined,
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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-8"
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
        className="apparait my-auto w-full max-w-lg rounded-2xl border"
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

        {/* Défilement interne : les suggestions d'adresse débordaient de la
            fenêtre au lieu de la faire défiler. */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

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
      className="flex w-[368px] flex-none flex-col overflow-hidden border-r"
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
      aria-hidden
    >
      {Array.from({ length: lignes }, (_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="mt-2 h-1.5 w-1.5 flex-none" />
          <span className="squelette h-[30px] w-[30px] flex-none rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <span className="squelette h-3 w-1/2" />
            <span className="squelette h-3 w-4/5" />
            <span className="squelette h-3 w-2/3" />
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
        className="flex-none border-b px-7 pt-4 pb-3"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className="squelette block h-5 w-3/5" />
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="squelette h-[30px] w-[30px] flex-none rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="squelette h-3 w-40" />
            <span className="squelette h-3 w-60" />
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-9 py-6">
        {[92, 78, 85, 60, 70].map((largeur, i) => (
          <span key={i} className="squelette h-3.5" style={{ width: `${largeur}%` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * Barre de progression du préchargement.
 *
 * Chiffrée autant que dessinée : une barre seule ne dit pas si l'attente sera
 * de trois secondes ou d'une minute, alors que « 12 sur 48 » le laisse estimer.
 */
export function Progression({ faits, total }: { faits: number; total: number }) {
  const part = total > 0 ? Math.min(100, Math.round((faits / total) * 100)) : 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <div className="text-sm font-semibold">Préparation de votre boîte…</div>
      <div
        role="progressbar"
        aria-valuenow={faits}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Chargement des messages"
        className="h-1.5 w-64 overflow-hidden rounded-full"
        style={{ background: 'var(--faint)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${part}%`,
            background: 'var(--accent)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
      <div className="font-mono text-[12px]" style={{ color: 'var(--sub)' }}>
        {faits} sur {total}
      </div>
      <p className="max-w-sm text-center text-[12.5px]" style={{ color: 'var(--sub)' }}>
        Les messages sont chargés une fois pour toutes. Ils resteront
        instantanés jusqu'au prochain redémarrage de l'ordinateur.
      </p>
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
  enAttente = false,
  className = '',
}: {
  children: ReactNode
  onClick: () => void
  variante?: 'principal' | 'secondaire' | 'discret' | 'danger'
  icone?: NomIcone
  disabled?: boolean
  titre?: string
  /** Fait tourner l'icône tant que l'action n'a pas rendu la main. */
  enAttente?: boolean
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
      className={`bouton ${teintes[variante]} inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs leading-none font-semibold whitespace-nowrap ${className}`}
    >
      {icone && <Icone nom={icone} taille={14} compenser tourne={enAttente} />}
      {children}
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
        className="bouton bouton-neutre flex w-full items-center gap-2 rounded-xl px-3.5 py-3 text-left text-[13px] leading-5 font-semibold"
      >
        <span className="min-w-0 flex-1 truncate">{choisi?.texte}</span>
        <Icone
          nom="expand_more"
          taille={17}
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
                className="survolable flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium"
                style={actif ? { background: 'var(--faint)' } : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{v.texte}</span>
                {actif && (
                  <Icone
                    nom="check_circle"
                    taille={15}
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
