/**
 * Vue « Paramètres », reprise de la maquette.
 *
 * Un écart assumé : « Résumer les newsletters automatiquement » est affiché mais
 * désactivé. Le module d'IA n'existe pas encore ; un interrupteur qui bascule
 * sans rien déclencher serait pire qu'une absence, parce que l'utilisateur
 * croirait le réglage actif.
 */
import { Bloc, Bouton, Icone, Interrupteur, Segments } from '../composants/base'
import { LogoGoogle } from '../composants/LogoGoogle'
import { FREQUENCES, type Frequence } from '../lib/preferences'
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
  enCours: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-7">
        <CarteCompte
          connecte={etat.compteConnecte}
          profil={profil}
          bloque={!etat.clientGoogleConfigure || !etat.trousseauDisponible}
          enCours={enCours}
          onConnecter={onConnecter}
          onDeconnecter={onDeconnecter}
        />

        <Bloc titre="Apparence">
          <Reglage
            icone="dark_mode"
            titre="Thème sombre"
            detail="Indépendant du réglage de votre système."
          >
            <Interrupteur actif={sombre} onChange={onBasculerTheme} libelle="Thème sombre" />
          </Reglage>

          <Reglage
            icone="palette"
            titre="Couleur d'accent"
            detail="Appliquée aux boutons, filtres et interrupteurs."
          >
            <div className="flex flex-none gap-2.5">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAccent(c)}
                  aria-label={`Couleur d'accent ${c}`}
                  aria-pressed={c === accent}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
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
            />
          </Reglage>

          <Reglage
            icone="hourglass_empty"
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
            <span className="flex-none font-mono text-[11px]" style={{ color: 'var(--sub)' }}>
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
  bloque,
  enCours,
  onConnecter,
  onDeconnecter,
}: {
  connecte: boolean
  profil: ProfilCompte | null
  bloque: boolean
  enCours: boolean
  onConnecter: () => void
  onDeconnecter: () => void
}) {
  return (
    <div
      className="carte-survolable flex items-center gap-4 rounded-2xl p-4"
      style={{
        background: connecte ? 'var(--accent-soft)' : 'var(--sunk)',
        border: '1px solid var(--line)',
      }}
    >
      {profil?.photo ? (
        <img
          src={profil.photo}
          alt=""
          className="h-12 w-12 flex-none rounded-full object-cover"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
        />
      ) : (
        <div
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
        >
          {connecte ? (
            <LogoGoogle taille={24} />
          ) : (
            <Icone nom="person_off" taille={22} style={{ color: 'var(--sub)' }} />
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">
            {profil?.nom ?? (connecte ? 'Compte Google relié' : 'Aucun compte relié')}
          </span>
          {connecte && profil?.photo && <LogoGoogle taille={16} />}
        </div>
        <div
          className="selectionnable truncate pt-0.5 font-mono text-[12px]"
          style={{ color: 'var(--sub)' }}
        >
          {connecte
            ? (profil?.adresse ?? 'autorisation conservée dans le trousseau')
            : bloque
              ? 'configuration incomplète, voir le diagnostic ci-dessous'
              : 'MailFlow ne peut rien trier tant qu’aucun compte n’est autorisé'}
        </div>
      </div>

      {connecte ? (
        <Bouton onClick={onDeconnecter} disabled={enCours} icone="logout">
          Déconnecter
        </Bouton>
      ) : (
        <Bouton
          variante="principal"
          onClick={onConnecter}
          disabled={enCours || bloque}
          icone="login"
        >
          Connecter mon compte Gmail
        </Bouton>
      )}
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
    <div className="flex items-center gap-3.5 px-4 py-4">
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
        style={{ background: 'var(--sunk)' }}
      >
        <Icone nom={icone} taille={18} style={{ color: 'var(--sub)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">{titre}</div>
        <div className="truncate pt-0.5 text-[12.5px]" style={{ color: 'var(--sub)' }}>
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
      className="inline-flex flex-none items-center gap-1.5 text-[12px] font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille={16} />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}
