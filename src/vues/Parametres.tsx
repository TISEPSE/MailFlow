/**
 * Vue « Paramètres », reprise de la maquette.
 *
 * Un principe la gouverne : ne jamais montrer un contrôle qui ne ferait rien.
 * Un interrupteur qui bascule sans rien déclencher fait croire le réglage
 * actif, et c'est pire que son absence.
 *
 * Deux écarts à la maquette en découlaient, et tous deux ont été comblés
 * depuis :
 *
 * - les résumés de newsletters existent — voir [`ResumesIA`] — et le réglage
 *   ouvre désormais une vraie fenêtre de saisie plutôt qu'un contrôle inerte ;
 * - MailFlow gère plusieurs comptes ; « Ajouter un compte » fonctionne, et
 *   « Changer de compte » avec.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Bloc, Bouton, Icone, Interrupteur, Modale, Segments } from '../composants/base'
import { LogoGoogle } from '../composants/LogoGoogle'
import { FREQUENCES, type Frequence } from '../lib/preferences'
import { initiales } from '../lib/presentation'
import {
  cacheTaille,
  cacheVider,
  lienOuvrir,
  llmCleEffacer,
  llmCleEnregistrer,
  llmEtat,
  messageDErreur,
} from '../lib/tauri'
import type {
  CompteConnu,
  EtatApplication,
  EtatLlm,
  ProfilCompte,
} from '../types/backend'

/** Même orangé que les notifications d'erreur : un refus se reconnaît d'un
 *  écran à l'autre. */
const TEINTE_REFUS = '#C2410C'

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
  destinatairesDeplies,
  onDestinatairesDeplies,
  frequence,
  onFrequence,
  onConnecter,
  onDeconnecter,
  comptes,
  onBasculer,
  onAjouterCompte,
  onOublierCompte,
  onRevoirLeGuide,
  onErreur,
  onToutEffacer,
  melange,
  onMelanger,
  toucheRecherche,
  onToucheRecherche,
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
  destinatairesDeplies: boolean
  onDestinatairesDeplies: () => void
  frequence: Frequence
  onFrequence: (f: Frequence) => void
  onConnecter: () => void
  onDeconnecter: () => void
  comptes: CompteConnu[]
  onBasculer: (adresse: string) => void
  onAjouterCompte: () => void
  onOublierCompte: (adresse: string) => void
  /** Réaffiche le guide de première ouverture. */
  onRevoirLeGuide: () => void
  /** Annonce une panne réseau sans faire disparaître la page. */
  onErreur: (message: string) => void
  /** Relance le chargement complet après l'effacement du disque. */
  onToutEffacer: () => void
  /** Vrai quand la vue mélangée est celle qu'on regarde. */
  melange: boolean
  /** Ouvre la vue qui réunit les boîtes de tous les comptes. */
  onMelanger: () => void
  /** Lettre du raccourci de recherche, combinée à Ctrl ou Cmd. */
  toucheRecherche: string
  onToucheRecherche: (touche: string) => void
  enCours: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-6">
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
          melange={melange}
          onMelanger={onMelanger}
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

        <Bloc titre="Prise en main">
          <Reglage
            icone="school"
            titre="Revoir le guide"
            detail="Les quatre pages, le geste des règles, et ce qui est réversible."
          >
            <Bouton icone="chevron_right" onClick={onRevoirLeGuide}>
              Afficher
            </Bouton>
          </Reglage>

          <Reglage
            icone="search"
            titre="Raccourci de recherche"
            detail="Ouvre la recherche depuis n'importe quelle page. Une lettre, combinée à Ctrl (Cmd sur macOS)."
          >
            <div className="flex items-center gap-2">
              <kbd
                className="rounded-md border px-2 py-1 font-mono text-[0.75rem] font-semibold"
                style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
              >
                Ctrl
              </kbd>
              <span style={{ color: 'var(--sub)' }}>+</span>
              {/* Une seule lettre, mise en majuscule : la comparaison au clavier
                  se fait dessus, et accepter autre chose rendrait la recherche
                  inatteignable. */}
              <input
                type="text"
                value={toucheRecherche}
                onChange={(e) => {
                  const t = e.target.value.slice(-1).toUpperCase()
                  if (/^[A-Z0-9]$/.test(t)) onToucheRecherche(t)
                }}
                aria-label="Touche du raccourci de recherche"
                className="w-12 rounded-md border text-center font-mono text-[0.8125rem] font-semibold outline-none"
                style={{
                  background: 'var(--card)',
                  borderColor: 'var(--line)',
                  color: 'var(--fg)',
                  height: '2.2em',
                }}
              />
            </div>
          </Reglage>

          <Reglage
            icone="groups"
            titre="Déplier les destinataires"
            detail="À l'ouverture d'un message, montrer l'expéditeur, les destinataires et les copies. Repliés, seul l'expéditeur reste visible."
          >
            <Interrupteur
              actif={destinatairesDeplies}
              onChange={onDestinatairesDeplies}
              libelle="Déplier les destinataires à l'ouverture d'un message"
              grand
            />
          </Reglage>

          <ResumesIA onErreur={onErreur} />

          <MiseAJour onErreur={onErreur} />

          <CacheDisque onErreur={onErreur} onEfface={onToutEffacer} />
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

        {/* Un bloc « Résumés IA » vivait ici, avec un interrupteur mort et la
            mention « aucun moteur de résumé n'est branché ». C'était vrai le
            jour où il a été écrit, avant Gemini. Ce n'est plus le cas : le
            réglage réel est `ResumesIA`, quelques lignes plus haut, et il sait
            enregistrer la clé comme l'effacer.

            Deux réglages pour un seul sujet, dont l'un affirme le contraire de
            l'autre, coûtent plus cher qu'un réglage manquant : l'utilisateur
            qui a posé sa clé et qui lit ensuite « pas encore disponible » a
            toutes les raisons de croire que rien ne marche. */}

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
              className="flex-none text-[0.75rem]"
              style={{ color: 'var(--sub)' }}
            >
              {etat.nombreDeRegles === null ? 'illisible' : `${etat.nombreDeRegles} règles`}
            </span>
          </Reglage>

          <Reglage
            icone="info"
            titre="Version"
            detail={`MailFlow ${etat.version} · ${etat.plateforme}`}
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
    // Une colonne, et non une seule rangée qui se replie : le bloc dépliant y
    // était un enfant du même `flex`, et même réduit à rien il consommait
    // l'espacement — d'où seize pixels de trop sous la ligne, et un avatar qui
    // ne tombait pas au milieu de la carte.
    <div
      className="rounded-2xl p-4"
      style={{
        background: connecte ? 'var(--accent-soft)' : 'var(--sunk)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Avatar profil={profil} connecte={connecte} accent={accent} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[1rem] font-semibold">
              {profil?.nom ?? (connecte ? 'Compte Google relié' : 'Aucun compte relié')}
            </span>
            {connecte && profil?.photo && <LogoGoogle taille="1.0625rem" />}
          </div>
          <div
            className="selectionnable truncate pt-0.5 text-[0.8125rem]"
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
  /** Vrai à partir de deux comptes : à un seul, la vue mélangée montrerait
   *  exactement la même chose que la boîte. */
  plusieurs: boolean
}) {
  const [aRetirer, setARetirer] = useState<string | null>(null)

  return (
    <div
      // La marge est ici, à l'intérieur du bloc qui se replie : posée sur la
      // carte, elle subsisterait une fois la liste fermée.
      className="mt-4 w-full rounded-xl border p-2"
      style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
    >
      {/* La vue mélangée est un choix de compte, pas un réglage à part : c'est
          ici qu'on vient pour décider quelle boîte on regarde. */}
      {plusieurs && (
        <>
          <button
            type="button"
            onClick={onMelanger}
            disabled={enCours || melange}
            aria-current={melange || undefined}
            className="survolable flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left disabled:opacity-100"
            style={melange ? { background: 'var(--accent-soft)' } : undefined}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
              style={{ background: melange ? 'var(--card)' : 'var(--accent-soft)' }}
            >
              <Icone nom="groups" taille="1.125rem" style={{ color: 'var(--accent-fg)' }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8438rem] font-semibold">
                Tous les comptes
              </span>
              <span className="block truncate text-[0.75rem]" style={{ color: 'var(--sub)' }}>
                {melange
                  ? 'Vue active'
                  : `Réunit vos ${autres.length + 1} boîtes dans les mêmes pages`}
              </span>
            </span>
            {melange && (
              <Icone
                nom="check_circle"
                taille="1.0625rem"
                rempli
                style={{ color: 'var(--accent-fg)' }}
              />
            )}
          </button>
          <div className="mx-2 my-1.5 border-t" style={{ borderColor: 'var(--line)' }} />
        </>
      )}

      {autres.length === 0 ? (
        <p className="px-3 py-2.5 text-[0.8125rem]" style={{ color: 'var(--sub)' }}>
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
                <span className="block truncate text-[0.8438rem] font-semibold">
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
                <span className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
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
                <Icone nom="delete" taille="1.0625rem" />
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
          className="survolable flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[0.8438rem] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent-fg)' }}
        >
          <Icone nom="login" taille="1.0625rem" />
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
      <LogoGoogle taille="1rem" />
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
      className="bouton flex-none rounded-full px-2.5 py-1 text-xs font-medium"
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
      className={`bouton ${principal ? 'bouton-principal' : 'bouton-neutre'} inline-flex h-10 flex-none items-center justify-center gap-2 rounded-full px-5 text-xs font-medium`}
    >
      {icone && <Icone nom={icone} taille="1.125rem" />}
      <span>{children}</span>
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
        <Icone nom="person_off" taille="1.375rem" style={{ color: 'var(--sub)' }} />
      </div>
    )
  }

  const nom = profil?.nom ?? profil?.adresse ?? ''

  return (
    <div
      className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-[1.0625rem] font-semibold"
      style={{ background: accent, color: '#FFFFFF' }}
    >
      {nom ? initiales(nom) : <LogoGoogle taille="1.5rem" />}
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
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[0.625rem]"
        style={{ background: 'var(--sunk)' }}
      >
        <Icone nom={icone} taille="1.125rem" style={{ color: 'var(--sub)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.875rem] font-semibold">{titre}</div>
        <div className="truncate pt-0.5 text-[0.7812rem]" style={{ color: 'var(--sub)' }}>
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
      className="inline-flex flex-none items-center gap-1.5 text-[0.8125rem] leading-none font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille="1.0625rem" rempli />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}

/**
 * Mise à jour automatique intégrée.
 *
 * Le plugin `tauri-plugin-updater` interroge le fichier `latest.json` attaché
 * à la dernière publication GitHub, vérifie la signature Ed25519, télécharge
 * le binaire et l'installe — le tout sans que l'utilisateur quitte
 * l'application.
 *
 * Flux : Vérifier → télécharger (avec pourcentage) → installer → relancer.
 */
function MiseAJour({ onErreur }: { onErreur: (message: string) => void }) {
  const [phase, setPhase] = useState<
    'repos' | 'verifie' | 'a_jour' | 'disponible' | 'telecharge' | 'pret' | 'installe'
  >('repos')
  const [version, setVersion] = useState<string | null>(null)
  const [progression, setProgression] = useState(0)

  const verifier = async () => {
    setPhase('verifie')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const maj = await check()
      if (maj) {
        setVersion(maj.version)
        setPhase('disponible')
      } else {
        setPhase('a_jour')
      }
    } catch (e) {
      onErreur(messageDErreur(e))
      setPhase('repos')
    }
  }

  const installer = async () => {
    setPhase('telecharge')
    setProgression(0)
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const maj = await check()
      if (!maj) {
        setPhase('a_jour')
        return
      }

      let totalRecu = 0
      let totalAttendu = 0

      await maj.downloadAndInstall((ev) => {
        if (ev.event === 'Started' && ev.data.contentLength) {
          totalAttendu = ev.data.contentLength
        } else if (ev.event === 'Progress') {
          totalRecu += ev.data.chunkLength
          if (totalAttendu > 0) {
            setProgression(Math.round((totalRecu / totalAttendu) * 100))
          }
        } else if (ev.event === 'Finished') {
          setProgression(100)
        }
      })

      setPhase('pret')
    } catch (e) {
      onErreur(messageDErreur(e))
      setPhase('repos')
    }
  }

  const relancer = async () => {
    setPhase('installe')
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      onErreur(messageDErreur(e))
      setPhase('repos')
    }
  }

  const detail = (): string => {
    switch (phase) {
      case 'verifie':
        return 'Vérification en cours…'
      case 'a_jour':
        return 'Vous avez la dernière version.'
      case 'disponible':
        return `Version ${version} disponible.`
      case 'telecharge':
        return `Téléchargement… ${progression} %`
      case 'pret':
        return `Version ${version} prête. Redémarrez pour l'appliquer.`
      case 'installe':
        return 'Redémarrage…'
      default:
        return "Vérifie s'il existe une version plus récente."
    }
  }

  const bouton = () => {
    switch (phase) {
      case 'disponible':
        return (
          <Bouton variante="principal" icone="download" onClick={() => void installer()}>
            Installer
          </Bouton>
        )
      case 'pret':
        return (
          <Bouton variante="principal" icone="refresh" onClick={() => void relancer()}>
            Redémarrer
          </Bouton>
        )
      case 'telecharge':
      case 'installe':
        return (
          <Bouton icone="refresh" enAttente disabled>
            {phase === 'telecharge' ? `${progression} %` : 'Redémarrage…'}
          </Bouton>
        )
      default:
        return (
          <Bouton
            icone="refresh"
            enAttente={phase === 'verifie'}
            disabled={phase === 'verifie'}
            onClick={() => void verifier()}
          >
            {phase === 'verifie' ? 'Vérification…' : 'Vérifier'}
          </Bouton>
        )
    }
  }

  return (
    <Reglage icone="refresh" titre="Mises à jour" detail={detail()}>
      {bouton()}
    </Reglage>
  )
}

/**
 * Ce que MailFlow pose sur le disque, et qu'il sait refaire seul.
 *
 * # « Effacer » veut dire effacer
 *
 * Le bouton ne couvrait que les relevés et les corps de messages. Il annonçait
 * 33 Mo et en laissait 51 derrière lui — le cache du moteur d'affichage, qui
 * grossit à chaque image de message ouverte et que rien ne nettoyait jamais.
 * Le décompte et l'effacement portent désormais sur la même liste, tenue à un
 * seul endroit côté Rust.
 *
 * # Et l'application se remplit à nouveau, sans redémarrer
 *
 * Effacer laissait une fenêtre pleine de messages qu'on venait de supprimer du
 * disque : rien à l'écran ne disait que le geste avait eu lieu, et il fallait
 * redémarrer pour retrouver un état cohérent. Le relevé repart maintenant dans
 * la foulée, et l'on voit la boîte se reconstruire.
 */
function CacheDisque({
  onErreur,
  onEfface,
}: {
  onErreur: (message: string) => void
  /** Relance le chargement complet, pour que l'écran suive le disque. */
  onEfface: () => void
}) {
  const [octets, setOctets] = useState<number | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    cacheTaille()
      .then(setOctets)
      .catch(() => setOctets(null))
  }, [])

  const vider = async () => {
    setEnCours(true)
    try {
      await cacheVider()
      setOctets(await cacheTaille().catch(() => 0))
      onEfface()
    } catch (e) {
      onErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const taille =
    octets === null
      ? ''
      : octets < 1024 * 1024
        ? ` (${Math.max(1, Math.round(octets / 1024))} Ko)`
        : ` (${(octets / 1024 / 1024).toFixed(1)} Mo)`

  return (
    <Reglage
      icone="delete"
      titre="Tout ce que MailFlow garde sur cet ordinateur"
      detail={`Messages, images, journaux${taille}. Tout se retélécharge : vos comptes, vos règles et vos tas ne sont pas touchés.`}
    >
      <Bouton
        variante="danger"
        icone="delete"
        enAttente={enCours}
        disabled={enCours || octets === 0}
        onClick={() => void vider()}
      >
        {enCours ? 'Effacement…' : 'Tout effacer'}
      </Bouton>
    </Reglage>
  )
}

/**
 * Réglage des résumés de newsletters.
 *
 * # Ce qui est dit franchement
 *
 * Le palier gratuit de Gemini n'est pas confidentiel : Google se réserve le
 * droit d'utiliser ce qu'on lui envoie pour améliorer ses modèles. Ce n'est pas
 * dissimulé dans des conditions d'utilisation — c'est écrit ici, avec ce qui
 * l'atténue : seules les newsletters partent, et les liens de désabonnement,
 * qui portent l'adresse de l'utilisateur, sont retirés avant l'envoi.
 *
 * # Pourquoi un bouton qui essaie vraiment
 *
 * Enregistrer une clé la vérifie par un véritable appel. Une clé bien formée
 * mais révoquée passerait n'importe quel contrôle de syntaxe, et l'utilisateur
 * ne l'apprendrait qu'au premier relevé — sans savoir pourquoi rien ne se
 * résume.
 */
function ResumesIA({ onErreur }: { onErreur: (message: string) => void }) {
  const [etat, setEtat] = useState<EtatLlm | null>(null)
  const [saisie, setSaisie] = useState(false)

  useEffect(() => {
    void llmEtat().then(setEtat).catch(() => undefined)
  }, [])

  const effacer = async () => {
    try {
      await llmCleEffacer()
      setEtat(await llmEtat())
    } catch (e) {
      onErreur(messageDErreur(e))
    }
  }

  return (
    <>
      <Reglage
        icone="auto_awesome"
        titre="Résumés automatiques des newsletters"
        detail="Un modèle de Google lit vos newsletters et en écrit une phrase. Facultatif, et gratuit."
      >
        {/* Pas de mention « Clé enregistrée » à côté : le bouton « Retirer »
            ne s'affiche que lorsqu'il y a une clé, et dit donc déjà qu'il y en
            a une. L'écrire en plus revenait à répondre deux fois. */}
        {etat?.cleConfiguree ? (
          <Bouton
            compact
            icone="delete"
            variante="danger"
            onClick={() => void effacer()}
          >
            Retirer
          </Bouton>
        ) : (
          <Bouton compact variante="principal" onClick={() => setSaisie(true)}>
            Configurer
          </Bouton>
        )}
      </Reglage>

      {saisie && (
        <ModaleCleResumes
          onFermer={() => setSaisie(false)}
          onEnregistree={async () => {
            setSaisie(false)
            setEtat(await llmEtat().catch(() => null))
          }}
        />
      )}
    </>
  )
}

/**
 * Fenêtre de saisie de la clé d'API.
 *
 * # Pourquoi une fenêtre et non un champ dans la ligne
 *
 * Le champ tenait dans la ligne de réglage, et c'est bien le problème : il n'y
 * restait de place ni pour dire où l'on obtient la clé, ni pour dire ce que
 * Google en fait. Ces deux phrases ne sont pas du décor — sans la première, on
 * ne peut pas se servir du réglage ; sans la seconde, on accepte quelque chose
 * qu'on n'a pas lu. Une fenêtre leur donne la place, et laisse la ligne de
 * réglage dire une seule chose à la fois.
 *
 * # Pourquoi l'erreur reste ici
 *
 * Une clé refusée s'affiche dans la fenêtre, sous le champ, et non en
 * notification passagère : on est au milieu du geste, la correction se fait
 * sur-le-champ, et un message qui s'efface au bout de trois secondes ferait
 * recommencer.
 */
function ModaleCleResumes({
  onFermer,
  onEnregistree,
}: {
  onFermer: () => void
  onEnregistree: () => void | Promise<void>
}) {
  const [cle, setCle] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)

  const enregistrer = async () => {
    setEnCours(true)
    setRefus(null)
    try {
      await llmCleEnregistrer(cle)
      setCle('')
      await onEnregistree()
    } catch (e) {
      setRefus(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const pretA = Boolean(cle.trim()) && !enCours

  return (
    <Modale
      titre="Résumés automatiques des newsletters"
      sous="Un modèle de Google lit chaque newsletter et en écrit une phrase."
      onFermer={onFermer}
    >
      <div className="flex flex-col gap-4">
        <Etape numero={1} titre="Obtenir une clé">
          <p>
            Elle s'obtient sur Google AI Studio avec le compte Google que vous
            avez déjà. Aucune carte bancaire n'est demandée.
          </p>
          <Bouton
            compact
            icone="open_in_new"
            onClick={() => {
              void lienOuvrir('https://aistudio.google.com/apikey').catch((e) =>
                setRefus(messageDErreur(e)),
              )
            }}
          >
            Ouvrir Google AI Studio
          </Bouton>
        </Etape>

        <Etape numero={2} titre="La coller ici">
          <input
            type="password"
            value={cle}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pretA) void enregistrer()
            }}
            placeholder="AIza…"
            aria-label="Clé d'API pour les résumés"
            className="champ-de-saisie selectionnable w-full rounded-lg border bg-transparent px-3 text-[0.8125rem] outline-none"
            style={{
              borderColor: refus ? TEINTE_REFUS : 'var(--line)',
              color: 'var(--fg)',
              height: '2.4rem',
            }}
          />
          {refus && (
            <p
              className="flex items-start gap-1.5 text-[0.75rem]"
              style={{ color: TEINTE_REFUS }}
            >
              <Icone nom="error" taille="0.875rem" />
              <span>{refus}</span>
            </p>
          )}
          <p className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            La clé est rangée dans le trousseau du système, jamais dans un
            fichier de l'application. Elle n'est enregistrée qu'après un
            véritable appel : une clé révoquée est refusée tout de suite plutôt
            qu'au premier relevé.
          </p>
        </Etape>

        {/* Dit à l'écran, pas enfoui dans des conditions d'utilisation. */}
        <div
          className="flex items-start gap-2.5 rounded-xl border p-3"
          style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
        >
          <Icone nom="shield" taille="1rem" style={{ color: 'var(--sub)' }} />
          <p className="text-[0.75rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
            <strong style={{ color: 'var(--fg)' }}>
              Le palier gratuit de Google n'est pas confidentiel :
            </strong>{' '}
            ce qui lui est envoyé peut servir à améliorer ses modèles. Seules
            les newsletters partent — jamais vos messages personnels, jamais vos
            rappels de formation — et les adresses web, dont les liens de
            désabonnement qui portent la vôtre, sont retirées avant l'envoi.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Bouton onClick={onFermer}>Annuler</Bouton>
          <Bouton
            variante="principal"
            icone="check_circle"
            enAttente={enCours}
            disabled={!pretA}
            onClick={() => void enregistrer()}
          >
            {enCours ? 'Vérification…' : 'Tester et enregistrer'}
          </Bouton>
        </div>
      </div>
    </Modale>
  )
}

/** Une étape numérotée de la fenêtre de saisie. */
function Etape({
  numero,
  titre,
  children,
}: {
  numero: number
  titre: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[0.75rem] font-semibold"
        style={{ background: 'var(--sunk)', color: 'var(--sub)' }}
      >
        {numero}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="text-[0.8125rem] font-semibold">{titre}</div>
        <div
          className="flex w-full flex-col items-start gap-2 text-[0.8125rem] leading-relaxed"
          style={{ color: 'var(--sub)' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
