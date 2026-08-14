/**
 * Vue « Paramètres ».
 *
 * Elle distingue nettement deux choses : ce qui est réglable aujourd'hui, et ce
 * qui relève du diagnostic. Annoncer un réglage qui ne fait rien serait pire que
 * de ne pas l'afficher — d'où l'absence, ici, des options de fréquence et de
 * moteur d'IA tant que le code derrière n'existe pas.
 */
import { Bloc, Bouton, Icone, Interrupteur, LigneReglage } from '../composants/base'
import type { EtatApplication } from '../types/backend'

const ACCENTS = ['#2F6BFF', '#1F7A5A', '#4C3BCF', '#C2410C'] as const

export function Parametres({
  etat,
  sombre,
  onBasculerTheme,
  accent,
  onAccent,
  onConnecter,
  onDeconnecter,
  enCours,
}: {
  etat: EtatApplication
  sombre: boolean
  onBasculerTheme: () => void
  accent: string
  onAccent: (c: string) => void
  onConnecter: () => void
  onDeconnecter: () => void
  enCours: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-7">
        <div
          className="flex items-center gap-4 rounded-xl border p-4"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
            style={{
              background: etat.compteConnecte ? 'var(--accent-soft)' : 'var(--faint)',
              color: etat.compteConnecte ? 'var(--accent-fg)' : 'var(--sub)',
            }}
          >
            <Icone nom={etat.compteConnecte ? 'mail' : 'person_off'} taille={22} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              {etat.compteConnecte ? 'Compte Gmail connecté' : 'Aucun compte connecté'}
            </div>
            <div className="pt-0.5 text-[12px]" style={{ color: 'var(--sub)' }}>
              {etat.compteConnecte
                ? 'L’autorisation est conservée dans le trousseau de votre système.'
                : 'MailFlow ne peut rien trier tant qu’aucun compte n’est autorisé.'}
            </div>
          </div>

          {etat.compteConnecte ? (
            <Bouton onClick={onDeconnecter} disabled={enCours} icone="logout">
              Déconnecter
            </Bouton>
          ) : (
            <Bouton
              variante="principal"
              onClick={onConnecter}
              disabled={enCours || !etat.clientGoogleConfigure || !etat.trousseauDisponible}
              icone="login"
            >
              Connecter
            </Bouton>
          )}
        </div>

        <Bloc titre="Apparence">
          <LigneReglage
            icone="dark_mode"
            titre="Thème sombre"
            detail="Indépendant du réglage de votre système."
          >
            <Interrupteur
              actif={sombre}
              onChange={onBasculerTheme}
              libelle="Thème sombre"
            />
          </LigneReglage>

          <LigneReglage
            icone="palette"
            titre="Couleur d'accent"
            detail="Appliquée aux boutons, filtres et interrupteurs."
          >
            <div className="flex flex-none gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAccent(c)}
                  aria-label={`Couleur d'accent ${c}`}
                  aria-pressed={c === accent}
                  className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: c === accent ? '2px solid var(--fg)' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </LigneReglage>
        </Bloc>

        <Bloc titre="Diagnostic">
          <LigneReglage
            icone="key"
            titre="Trousseau du système"
            detail="Sans lui, la connexion Gmail ne peut pas être conservée."
          >
            <Statut ok={etat.trousseauDisponible} />
          </LigneReglage>

          <LigneReglage
            icone="badge"
            titre="Identifiants Google"
            detail="Voir docs/connexion-google.md pour les renseigner."
          >
            <Statut ok={etat.clientGoogleConfigure} />
          </LigneReglage>

          <LigneReglage
            icone="rule_folder"
            titre="Fichier de règles"
            detail={etat.cheminRegles}
          >
            <span
              className="flex-none font-mono text-[11px]"
              style={{ color: 'var(--sub)' }}
            >
              {etat.nombreDeRegles === null ? 'illisible' : `${etat.nombreDeRegles} règles`}
            </span>
          </LigneReglage>

          <LigneReglage
            icone="info"
            titre="Version"
            detail={`MailFlow ${etat.version} — ${etat.plateforme}`}
          >
            <span />
          </LigneReglage>
        </Bloc>

        <p
          className="px-1 pt-5 text-[12px] leading-relaxed"
          style={{ color: 'var(--sub)' }}
        >
          La fréquence de synchronisation et les résumés par IA ne sont pas encore
          réglables : le code correspondant n'existe pas. Ils apparaîtront ici
          quand ils feront réellement quelque chose.
        </p>
      </div>
    </div>
  )
}

function Statut({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 text-[12px] font-semibold"
      style={{ color: ok ? 'var(--accent-fg)' : '#C2410C' }}
    >
      <Icone nom={ok ? 'check_circle' : 'error'} taille={16} rempli />
      {ok ? 'disponible' : 'indisponible'}
    </span>
  )
}
