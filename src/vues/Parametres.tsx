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
import { useState } from 'react'
import { Bloc, Icone, Interrupteur, Segments } from '../composants/base'
import { LogoGoogle } from '../composants/LogoGoogle'
import { FREQUENCES, type Frequence } from '../lib/preferences'
import { initiales } from '../lib/presentation'
import type { CompteConnu, EtatApplication, ProfilCompte } from '../types/backend'

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
  comptes,
  onBasculer,
  onAjouterCompte,
  onOublierCompte,
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
  comptes: CompteConnu[]
  onBasculer: (adresse: string) => void
  onAjouterCompte: () => void
  onOublierCompte: (adresse: string) => void
  enCours: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pt-6 pb-12">
        {/* `key` sur l'adresse : React remonte la carte quand le compte
            change, ce qui rejoue l'apparition. Sans elle, seuls les textes
            seraient remplacés, sans que rien ne signale le changement. */}
        <CarteCompte
          key={profil?.adresse ?? 'aucun'}
          connecte={etat.compteConnecte}
          profil={profil}
          accent={accent}
          bloque={!etat.clientGoogleConfigure || !etat.trousseauDisponible}
          enCours={enCours}
          onConnecter={onConnecter}
          onDeconnecter={onDeconnecter}
          comptes={comptes}
          onBasculer={onBasculer}
          onAjouterCompte={onAjouterCompte}
          onOublierCompte={onOublierCompte}
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
            <div className="flex flex-none gap-2.5">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAccent(c)}
                  aria-label={`Couleur d'accent ${c}`}
                  aria-pressed={c === accent}
                  className="pastille-accent h-7 w-7 rounded-full"
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
}) {
  const [listeOuverte, setListeOuverte] = useState(false)
  const autres = comptes.filter((c) => !c.actif)

  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-2xl p-4"
      style={{
        background: connecte ? 'var(--accent-soft)' : 'var(--sunk)',
        border: '1px solid var(--line)',
      }}
    >
      <Avatar profil={profil} connecte={connecte} accent={accent} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold">
            {profil?.nom ?? (connecte ? 'Compte Google relié' : 'Aucun compte relié')}
          </span>
          {connecte && profil?.photo && <LogoGoogle taille={17} />}
        </div>
        <div
          className="selectionnable truncate pt-0.5 text-[13px]"
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
                défait. */}
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

      {/* Toujours monté, replié par la grille : c'est ce qui permet à la
          fermeture de s'animer au lieu de faire sauter tout ce qui suit. */}
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
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Liste des comptes déjà autorisés.
 *
 * Basculer ne repasse pas par Google : l'autorisation du compte visé est restée
 * dans le trousseau, la boîte se recharge immédiatement. « Retirer » lui rend
 * cette autorisation et l'efface — c'est irréversible, d'où la confirmation.
 */
function ChoixDeCompte({
  autres,
  enCours,
  bloque,
  onBasculer,
  onAjouterCompte,
  onOublierCompte,
}: {
  autres: CompteConnu[]
  enCours: boolean
  bloque: boolean
  onBasculer: (adresse: string) => void
  onAjouterCompte: () => void
  onOublierCompte: (adresse: string) => void
}) {
  const [aRetirer, setARetirer] = useState<string | null>(null)

  return (
    <div
      className="mt-1 w-full rounded-xl border p-2"
      style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
    >
      {autres.length === 0 ? (
        <p className="px-3 py-2.5 text-[13px]" style={{ color: 'var(--sub)' }}>
          Aucun autre compte enregistré. Ajoutez-en un : celui-ci restera
          disponible, et vous pourrez passer de l'un à l'autre sans vous
          reconnecter.
        </p>
      ) : (
        autres.map((c) => (
          <div key={c.adresse} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBasculer(c.adresse)}
              disabled={enCours}
              className="survolable flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left disabled:opacity-40"
            >
              <Vignette photo={c.photo} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">
                  {c.nom ?? c.adresse}
                </span>
                {c.nom && (
                  <span
                    className="block truncate font-mono text-[11px]"
                    style={{ color: 'var(--sub)' }}
                  >
                    {c.adresse}
                  </span>
                )}
              </span>
            </button>

            {aRetirer === c.adresse ? (
              <div className="flex flex-none items-center gap-1.5 pr-1">
                <span className="text-[12px]" style={{ color: 'var(--sub)' }}>
                  Retirer ce compte ?
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
                className="bouton bouton-icone flex-none rounded-lg p-2"
              >
                <Icone nom="delete" taille={17} />
              </button>
            )}
          </div>
        ))
      )}

      <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--line)' }}>
        <button
          type="button"
          onClick={onAjouterCompte}
          disabled={enCours || bloque}
          className="survolable flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13.5px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent-fg)' }}
        >
          <Icone nom="login" taille={17} />
          Ajouter un compte Google
        </button>
      </div>
    </div>
  )
}

/**
 * Vignette d'un compte de la liste.
 *
 * La photo vient de l'annuaire, pas du réseau : un compte inactif n'a pas de
 * jeton en cours, et la liste doit s'afficher instantanément. À défaut, le logo
 * Google dit au moins de quel genre de compte il s'agit.
 */
function Vignette({ photo }: { photo: string | null }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className="h-8 w-8 flex-none rounded-full object-cover"
        style={{ background: 'var(--faint)' }}
      />
    )
  }

  return (
    <span
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
      style={{ background: 'var(--sunk)' }}
    >
      <LogoGoogle taille={16} />
    </span>
  )
}

function BoutonTexte({
  children,
  onClick,
  couleur,
}: {
  children: React.ReactNode
  onClick: () => void
  couleur?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bouton flex-none rounded-md px-2 py-1 text-[12px] leading-none font-semibold"
      style={{ color: couleur ?? 'var(--fg)' }}
    >
      {children}
    </button>
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
      // Hauteur explicite : sans elle, la bordure du bouton clair s'ajoutait à
      // sa taille et les deux boutons voisins ne faisaient pas la même hauteur.
      className={`bouton ${principal ? 'bouton-principal' : 'bouton-neutre'} inline-flex h-11 flex-none items-center justify-center gap-2 rounded-xl px-5 text-[14px] leading-none font-semibold`}
    >
      {icone && <Icone nom={icone} taille={15} compenser />}
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
        className="h-12 w-12 flex-none rounded-full object-cover"
        style={{ background: 'var(--card)' }}
      />
    )
  }

  if (!connecte) {
    return (
      <div
        className="flex h-12 w-12 flex-none items-center justify-center rounded-full"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
      >
        <Icone nom="person_off" taille={22} style={{ color: 'var(--sub)' }} />
      </div>
    )
  }

  const nom = profil?.nom ?? profil?.adresse ?? ''

  return (
    <div
      className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-[17px] font-semibold"
      style={{ background: accent, color: '#FFFFFF' }}
    >
      {nom ? initiales(nom) : <LogoGoogle taille={24} />}
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
    <div className="flex items-center gap-3.5 px-4.5 py-3.5">
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
        style={{ background: 'var(--sunk)' }}
      >
        <Icone nom={icone} taille={18} style={{ color: 'var(--sub)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{titre}</div>
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
      className="inline-flex flex-none items-center gap-1.5 text-[13px] leading-none font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille={17} rempli />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}
