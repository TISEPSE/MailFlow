import { useState } from 'react'
import { Icone } from '../../composants/base'
import { LogoGoogle } from '../../composants/LogoGoogle'
import { initiales } from '../../lib/presentation'
import type { CompteConnu, ProfilCompte } from '../../types/backend'
import { BoutonCarte, BoutonTexte } from './Reglage'

export function CarteCompte({
  melange,
  onMelanger,
  connecte,
  profil,
  accent,
  bloque,
  enCours,
  onConnecter,
  onDeconnecter,
  comptes,
  onBasculer,
  onAjouterCompte,
  onOublierCompte,
}: {
  connecte: boolean
  profil: ProfilCompte | null
  accent: string
  bloque: boolean
  enCours: boolean
  onConnecter: () => void
  onDeconnecter: () => void
  comptes: CompteConnu[]
  onBasculer: (adresse: string) => void
  onAjouterCompte: () => void
  onOublierCompte: (adresse: string) => void
  melange: boolean
  onMelanger: () => void
}) {
  const [listeOuverte, setListeOuverte] = useState(false)
  const autres = comptes.filter((c) => !c.actif)

  return (
    <div
      className="pb-4.5 px-1 relative overflow-hidden transition-all border-b"
      style={{
        borderColor: 'var(--line)',
      }}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <Avatar profil={profil} connecte={connecte} accent={accent} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] font-bold text-[var(--fg)]">
              {profil?.nom ?? (connecte ? 'Compte Google relié' : 'Aucun compte relié')}
            </span>
            {connecte && profil?.photo && <LogoGoogle taille="1rem" />}
          </div>
          <div
            className="selectionnable truncate pt-0.5 text-[0.75rem] font-mono"
            style={{ color: 'var(--sub)' }}
          >
            {connecte
              ? (profil?.adresse ?? 'autorisation conservée dans le trousseau')
              : bloque
                ? 'configuration incomplète, voir le diagnostic ci-dessous'
                : 'MailFlow ne peut rien trier tant qu’aucun compte n’est autorisé'}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          {connecte ? (
            <>
              <BoutonCarte onClick={onDeconnecter} disabled={enCours} icone="logout">
                Déconnecter
              </BoutonCarte>
              <BoutonCarte
                principal
                onClick={() => setListeOuverte((o) => !o)}
                disabled={enCours || bloque}
                icone={listeOuverte ? 'close' : 'person'}
              >
                {listeOuverte ? 'Fermer' : 'Changer de compte'}
              </BoutonCarte>
            </>
          ) : (
            <BoutonCarte
              principal
              onClick={onConnecter}
              disabled={enCours || bloque}
              icone="login"
            >
              Connecter mon compte Gmail
            </BoutonCarte>
          )}
        </div>
      </div>

      {connecte && (
        <div className="deplie w-full" data-ouvert={listeOuverte} aria-hidden={!listeOuverte}>
          <div>
            <ChoixDeCompte
              autres={autres}
              enCours={enCours}
              bloque={bloque}
              onBasculer={(a) => {
                setListeOuverte(false)
                onBasculer(a)
              }}
              onAjouterCompte={() => {
                setListeOuverte(false)
                onAjouterCompte()
              }}
              onOublierCompte={onOublierCompte}
              melange={melange}
              onMelanger={() => {
                setListeOuverte(false)
                onMelanger()
              }}
              plusieurs={comptes.length > 1}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ChoixDeCompte({
  autres,
  enCours,
  bloque,
  onBasculer,
  onAjouterCompte,
  onOublierCompte,
  melange,
  onMelanger,
  plusieurs,
}: {
  autres: CompteConnu[]
  enCours: boolean
  bloque: boolean
  onBasculer: (adresse: string) => void
  onAjouterCompte: () => void
  onOublierCompte: (adresse: string) => void
  melange: boolean
  onMelanger: () => void
  plusieurs: boolean
}) {
  const [aRetirer, setARetirer] = useState<string | null>(null)

  return (
    <div
      className="mt-3 w-full rounded-xl border p-1.5"
      style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
    >
      {plusieurs && (
        <>
          <button
            type="button"
            onClick={onMelanger}
            disabled={enCours || melange}
            aria-current={melange || undefined}
            className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left disabled:opacity-100"
            style={melange ? { background: 'var(--accent-soft)' } : undefined}
          >
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
              style={{ background: melange ? 'var(--card)' : 'var(--accent-soft)' }}
            >
              <Icone
                nom="inbox"
                taille="1rem"
                style={{ color: melange ? 'var(--accent)' : 'inherit' }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-semibold">
                Tous les comptes
              </span>
              <span className="block truncate text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
                Vue réunie
              </span>
            </span>
            {melange && (
              <span className="text-[0.6875rem] font-medium" style={{ color: 'var(--accent)' }}>
                Active
              </span>
            )}
          </button>
          <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--line)' }} />
        </>
      )}

      {autres.map((c) => (
        <div key={c.adresse} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onBasculer(c.adresse)}
            disabled={enCours}
            className="survolable flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left disabled:opacity-40"
          >
            <Vignette photo={c.photo} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-semibold">
                {c.nom ?? c.adresse}
              </span>
              {c.nom && (
                <span
                  className="block truncate text-[0.6875rem]"
                  style={{ color: 'var(--sub)' }}
                >
                  {c.adresse}
                </span>
              )}
            </span>
          </button>

          {aRetirer === c.adresse ? (
            <div className="flex flex-none items-center gap-1.5 pr-1">
              <span className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
                Retirer ?
              </span>
              <BoutonTexte
                onClick={() => {
                  setARetirer(null)
                  onOublierCompte(c.adresse)
                }}
                couleur="#C2410C"
              >
                Oui
              </BoutonTexte>
              <BoutonTexte onClick={() => setARetirer(null)}>Non</BoutonTexte>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setARetirer(c.adresse)}
              aria-label={`Retirer le compte ${c.adresse}`}
              className="bouton bouton-icone flex-none rounded-lg p-1.5"
            >
              <Icone nom="delete" taille="0.9375rem" />
            </button>
          )}
        </div>
      ))}

      <div className={`${autres.length > 0 || plusieurs ? 'border-t pt-1.5 mt-1' : ''}`} style={{ borderColor: 'var(--line)' }}>
        <button
          type="button"
          onClick={onAjouterCompte}
          disabled={enCours || bloque}
          className="survolable flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent-fg)' }}
        >
          <Icone nom="login" taille="0.9375rem" />
          Ajouter un compte Google
        </button>
      </div>
    </div>
  )
}

function Vignette({ photo }: { photo: string | null }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="h-7 w-7 flex-none rounded-full object-cover"
        style={{ background: 'var(--faint)' }}
      />
    )
  }

  return (
    <span
      className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
      style={{ background: 'var(--card)' }}
    >
      <LogoGoogle taille="0.875rem" />
    </span>
  )
}

function Avatar({
  profil,
  connecte,
  accent,
}: {
  profil: ProfilCompte | null
  connecte: boolean
  accent: string
}) {
  if (profil?.photo) {
    return (
      <div className="relative flex-none">
        <img
          src={profil.photo}
          alt=""
          className="h-11 w-11 rounded-full object-cover ring-2 ring-[var(--accent)]/40 ring-offset-2 ring-offset-[var(--card)] shadow-xs"
          style={{ background: 'var(--card)' }}
        />
      </div>
    )
  }

  if (!connecte) {
    return (
      <div
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full border shadow-inner"
        style={{
          background: 'var(--sunk)',
          borderColor: 'var(--line)',
        }}
      >
        <Icone nom="person_off" taille="1.25rem" style={{ color: 'var(--sub)' }} />
      </div>
    )
  }

  const nom = profil?.nom ?? profil?.adresse ?? ''

  return (
    <div
      className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[0.9375rem] font-bold shadow-xs ring-2 ring-[var(--accent)]/40 ring-offset-2 ring-offset-[var(--card)]"
      style={{ background: accent, color: '#FFFFFF' }}
    >
      {nom ? initiales(nom) : <LogoGoogle taille="1.25rem" />}
    </div>
  )
}
