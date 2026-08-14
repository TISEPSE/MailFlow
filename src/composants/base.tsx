/**
 * Briques visuelles partagées par les cinq vues.
 *
 * Elles portent les jetons de surface (`--card`, `--line`, `--sub`…) plutôt que
 * des couleurs littérales : c'est ce qui permet au thème et à la couleur
 * d'accent de basculer sans que chaque vue ait à s'en occuper.
 */
import type { CSSProperties, ReactNode } from 'react'

/** Glyphe Material Symbols. Le `aria-hidden` évite que le lecteur d'écran
 *  prononce le nom de la ligature. */
export function Icone({
  nom,
  taille = 18,
  className = '',
  style,
  rempli = false,
}: {
  nom: string
  taille?: number
  className?: string
  style?: CSSProperties
  rempli?: boolean
}) {
  return (
    <span
      aria-hidden
      className={`material-symbols-rounded ${className}`}
      style={{
        fontSize: taille,
        fontVariationSettings: `'FILL' ${rempli ? 1 : 0}, 'wght' 400, 'opsz' 20`,
        ...style,
      }}
    >
      {nom}
    </span>
  )
}

/** Pastille d'initiales, à défaut d'avatar réel — Gmail n'en fournit pas via
 *  l'API metadata. */
export function Pastille({
  texte,
  taille = 30,
  fond,
  couleur,
}: {
  texte: string
  taille?: number
  fond: string
  couleur: string
}) {
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
}: {
  actif: boolean
  onChange: () => void
  libelle: string
  disabled?: boolean
}) {
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
        width: 40,
        height: 23,
        background: actif ? 'var(--accent)' : 'var(--piste)',
      }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{
          width: 17,
          height: 17,
          top: 3,
          left: actif ? 20 : 3,
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
      className="flex flex-none gap-1 rounded-lg p-1"
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
            className="rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors"
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
  icone: string
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
          className="px-1 pt-6 pb-2 text-[11px] font-semibold tracking-wider uppercase"
          style={{ color: 'var(--sub)' }}
        >
          {titre}
        </div>
      )}
      <div
        className="divide-y overflow-hidden rounded-xl border"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--line)',
          boxShadow: 'var(--shadow)',
          // Tailwind ne connaît pas nos jetons : la couleur des séparateurs
          // internes passe par une variable CSS native.
          ['--tw-divide-opacity' as string]: '1',
        }}
      >
        {children}
      </div>
    </>
  )
}

/** État vide : ce n'est pas une erreur, c'est une boîte en ordre. */
export function Vide({
  icone,
  titre,
  detail,
}: {
  icone: string
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
  icone?: string
  disabled?: boolean
  titre?: string
}) {
  const styles: Record<string, CSSProperties> = {
    principal: { background: 'var(--accent)', color: '#FFFFFF' },
    secondaire: {
      background: 'var(--card)',
      color: 'var(--fg)',
      border: '1px solid var(--line)',
    },
    discret: { background: 'var(--accent-soft)', color: 'var(--accent-fg)' },
    danger: { background: 'transparent', color: '#C2410C' },
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titre}
      className="inline-flex flex-none items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-opacity hover:opacity-85 disabled:opacity-40"
      style={styles[variante]}
    >
      {icone && <Icone nom={icone} taille={15} />}
      {children}
    </button>
  )
}

/** Étiquette de catégorie. */
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
      className="flex-none rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: fond, color: couleur }}
    >
      {texte}
    </span>
  )
}
