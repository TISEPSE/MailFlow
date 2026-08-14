/**
 * Vue « Paramètres », reprise de la maquette.
 *
 * Deux écarts assumés, tous deux pour la même raison : ne pas montrer un
 * contrôle qui ne ferait rien.
 *
 * « Résumer les newsletters automatiquement » est affiché mais désactivé — le
 * module d'IA n'existe pas, et un interrupteur qui bascule sans rien déclencher
 * ferait croire le réglage actif.
 *
 * La maquette propose « Ajouter un compte » ; MailFlow n'en gère qu'un. Le
 * trousseau ne conserve qu'une autorisation, et deux comptes demanderaient de
 * revoir le stockage, les règles et le classement. La place est occupée par
 * « Changer de compte », qui, lui, fonctionne.
 */
import { Bloc, Icone, Interrupteur, Segments } from '../composants/base'
import { LogoGoogle } from '../composants/LogoGoogle'
import { FREQUENCES, type Frequence } from '../lib/preferences'
import { initiales } from '../lib/presentation'
import type { EtatApplication, ProfilCompte } from '../types/backend'

const ACCENTS = ['#2F6BFF', '#1F7A5A', '#4C3BCF', '#C2410C'] as const

export function Parametres({
  etat,
  profil,
  sombre,
  onBasculerTheme,
  accent,
  onAccent,
  syncAuLancement,
  onSyncAuLancement,
  frequence,
  onFrequence,
  onConnecter,
  onDeconnecter,
  onChangerDeCompte,
  enCours,
}: {
  etat: EtatApplication
  profil: ProfilCompte | null
  sombre: boolean
  onBasculerTheme: () => void
  accent: string
  onAccent: (c: string) => void
  syncAuLancement: boolean
  onSyncAuLancement: () => void
  frequence: Frequence
  onFrequence: (f: Frequence) => void
  onConnecter: () => void
  onDeconnecter: () => void
  onChangerDeCompte: () => void
  enCours: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pt-6 pb-12">
        <CarteCompte
          connecte={etat.compteConnecte}
          profil={profil}
          accent={accent}
          bloque={!etat.clientGoogleConfigure || !etat.trousseauDisponible}
          enCours={enCours}
          onConnecter={onConnecter}
          onDeconnecter={onDeconnecter}
          onChangerDeCompte={onChangerDeCompte}
        />

        <Bloc titre="Apparence">
          <Reglage
            icone="dark_mode"
            titre="Thème sombre"
            detail="Indépendant du réglage de votre système."
          >
            <Interrupteur
              actif={sombre}
              onChange={onBasculerTheme}
              libelle="Thème sombre"
              grand
            />
          </Reglage>

          <Reglage
            icone="palette"
            titre="Couleur d'accent"
            detail="Appliquée aux boutons, filtres et interrupteurs."
          >
            <div className="flex flex-none gap-3">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAccent(c)}
                  aria-label={`Couleur d'accent ${c}`}
                  aria-pressed={c === accent}
                  className="h-8 w-8 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: c === accent ? '2px solid var(--fg)' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Reglage>
        </Bloc>

        <Bloc titre="Synchronisation Gmail">
          <Reglage
            icone="sync"
            titre="Appliquer les règles au lancement"
            detail="Le tri se fait avant même l'ouverture de la boîte."
          >
            <Interrupteur
              actif={syncAuLancement}
              onChange={onSyncAuLancement}
              disabled={!etat.compteConnecte}
              libelle="Appliquer les règles au lancement"
              grand
            />
          </Reglage>

          <Reglage
            icone="timer"
            titre="Fréquence de vérification"
            detail="Intervalle entre deux relevés de la boîte de réception."
          >
            <Segments
              valeurs={FREQUENCES}
              valeur={frequence}
              onChange={onFrequence}
              libelle="Fréquence de vérification"
            />
          </Reglage>
        </Bloc>

        <Bloc titre="Résumés IA">
          <Reglage
            icone="auto_awesome"
            titre="Résumer les newsletters automatiquement"
            detail="Pas encore disponible : aucun moteur de résumé n'est branché."
          >
            <Interrupteur
              actif={false}
              onChange={() => {}}
              disabled
              libelle="Résumer les newsletters automatiquement"
              grand
            />
          </Reglage>
        </Bloc>

        <Bloc titre="Diagnostic">
          <Reglage
            icone="key"
            titre="Trousseau du système"
            detail="Sans lui, la connexion Gmail ne peut pas être conservée."
          >
            <Statut ok={etat.trousseauDisponible} />
          </Reglage>

          <Reglage
            icone="badge"
            titre="Identifiants Google"
            detail="Voir docs/connexion-google.md pour les renseigner."
          >
            <Statut ok={etat.clientGoogleConfigure} />
          </Reglage>

          <Reglage
            icone="rule_folder"
            titre="Fichier de règles"
            detail={etat.cheminRegles}
          >
            <span
              className="flex-none font-mono text-[12px]"
              style={{ color: 'var(--sub)' }}
            >
              {etat.nombreDeRegles === null ? 'illisible' : `${etat.nombreDeRegles} règles`}
            </span>
          </Reglage>

          <Reglage
            icone="info"
            titre="Version"
            detail={`MailFlow ${etat.version} — ${etat.plateforme}`}
          >
            <span />
          </Reglage>
        </Bloc>
      </div>
    </div>
  )
}

/**
 * Carte de compte.
 *
 * Teintée de la couleur d'accent quand un compte est relié, neutre sinon : la
 * différence doit sauter aux yeux avant même de lire le texte.
 */
function CarteCompte({
  connecte,
  profil,
  accent,
  bloque,
  enCours,
  onConnecter,
  onDeconnecter,
  onChangerDeCompte,
}: {
  connecte: boolean
  profil: ProfilCompte | null
  accent: string
  bloque: boolean
  enCours: boolean
  onConnecter: () => void
  onDeconnecter: () => void
  onChangerDeCompte: () => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-5 rounded-2xl p-5"
      style={{
        background: connecte ? 'var(--accent-soft)' : 'var(--sunk)',
        border: '1px solid var(--line)',
      }}
    >
      <Avatar profil={profil} connecte={connecte} accent={accent} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[17px] font-semibold">
            {profil?.nom ?? (connecte ? 'Compte Google relié' : 'Aucun compte relié')}
          </span>
          {connecte && profil?.photo && <LogoGoogle taille={17} />}
        </div>
        <div
          className="selectionnable truncate pt-0.5 text-[14px]"
          style={{ color: 'var(--sub)' }}
        >
          {connecte
            ? (profil?.adresse ?? 'autorisation conservée dans le trousseau')
            : bloque
              ? 'configuration incomplète, voir le diagnostic ci-dessous'
              : 'MailFlow ne peut rien trier tant qu’aucun compte n’est autorisé'}
        </div>
      </div>

      <div className="flex flex-none items-center gap-3">
        {connecte ? (
          <>
            <BoutonCarte onClick={onDeconnecter} disabled={enCours} icone="logout">
              Déconnecter
            </BoutonCarte>
            {/* L'accent va sur l'action qui construit, pas sur celle qui
                défait : « changer de compte » révoque puis relance le parcours
                Google, en une seule opération pour qu'on ne puisse pas se
                retrouver révoqué sans être reconnecté. */}
            <BoutonCarte
              principal
              onClick={onChangerDeCompte}
              disabled={enCours || bloque}
              icone="person"
            >
              Changer de compte
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
  )
}

/** Bouton de la carte de compte : plus généreux que ceux des listes. */
function BoutonCarte({
  children,
  onClick,
  disabled = false,
  principal = false,
  icone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  principal?: boolean
  icone?: Parameters<typeof Icone>[0]['nom']
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex flex-none items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
      style={
        principal
          ? { background: 'var(--accent)', color: '#FFFFFF' }
          : {
              background: 'var(--card)',
              color: 'var(--fg)',
              border: '1px solid var(--line)',
            }
      }
    >
      {icone && <Icone nom={icone} taille={17} />}
      {children}
    </button>
  )
}

/**
 * Avatar du compte.
 *
 * Photo Google si elle existe, initiales sur fond d'accent sinon. Les initiales
 * ne sont pas un pis-aller : beaucoup de comptes n'ont pas de photo, et c'est
 * ce que montre la maquette.
 */
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
      <img
        src={profil.photo}
        alt=""
        className="h-14 w-14 flex-none rounded-full object-cover"
        style={{ background: 'var(--card)' }}
      />
    )
  }

  if (!connecte) {
    return (
      <div
        className="flex h-14 w-14 flex-none items-center justify-center rounded-full"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
      >
        <Icone nom="person_off" taille={24} style={{ color: 'var(--sub)' }} />
      </div>
    )
  }

  const nom = profil?.nom ?? profil?.adresse ?? ''

  return (
    <div
      className="flex h-14 w-14 flex-none items-center justify-center rounded-full text-[19px] font-semibold"
      style={{ background: accent, color: '#FFFFFF' }}
    >
      {nom ? initiales(nom) : <LogoGoogle taille={26} />}
    </div>
  )
}

/** Ligne de réglage : icône en pastille, intitulé, explication, contrôle. */
function Reglage({
  icone,
  titre,
  detail,
  children,
}: {
  icone: Parameters<typeof Icone>[0]['nom']
  titre: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div
        className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
        style={{ background: 'var(--sunk)' }}
      >
        <Icone nom={icone} taille={20} style={{ color: 'var(--sub)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{titre}</div>
        <div className="truncate pt-0.5 text-[13px]" style={{ color: 'var(--sub)' }}>
          {detail}
        </div>
      </div>
      {children}
    </div>
  )
}

function Statut({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 text-[13px] font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille={17} rempli />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}
