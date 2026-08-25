import type { ReactNode } from 'react'
import { Icone } from '../../composants/base'
import type { NomIcone } from '../../composants/glyphes'

export function Reglage({
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
    <div className="flex items-center gap-3.5 px-4.5 py-3.5">
      <div className="flex flex-none items-center justify-center text-[var(--sub)]">
        <Icone nom={icone} taille="1.125rem" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.875rem] font-medium text-[var(--fg)]">{titre}</div>
        <div className="truncate pt-0.5 text-[0.75rem]" style={{ color: 'var(--sub)' }}>
          {detail}
        </div>
      </div>
      {children}
    </div>
  )
}

export function Statut({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 text-[0.8125rem] leading-none font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille="1.0625rem" rempli />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}

export function BoutonTexte({
  children,
  onClick,
  couleur,
}: {
  children: ReactNode
  onClick: () => void
  couleur?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bouton flex-none rounded-full px-2 py-0.5 text-[0.6875rem] font-medium"
      style={{ color: couleur ?? 'var(--fg)' }}
    >
      {children}
    </button>
  )
}

export function BoutonCarte({
  children,
  onClick,
  disabled = false,
  principal = false,
  icone,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  principal?: boolean
  icone?: NomIcone
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`bouton ${principal ? 'bouton-principal' : 'bouton-neutre'} inline-flex h-8.5 flex-none items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-medium`}
    >
      {icone && <Icone nom={icone} taille="1rem" />}
      <span>{children}</span>
    </button>
  )
}
