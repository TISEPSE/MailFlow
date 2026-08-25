/**
 * Vue « Paramètres » refactorisée et modulaire.
 *
 * Structurée en 5 sous-onglets thématiques avec navigation latérale :
 * - Compte & Profil
 * - Apparence
 * - Synchronisation
 * - Intelligence Artificielle
 * - Aide & Diagnostic
 */
import { useState } from 'react'
import { Bloc, Bouton, Icone, Interrupteur, Segments } from '../composants/base'
import { FREQUENCES, type Frequence } from '../lib/preferences'
import type { CompteConnu, EtatApplication, ProfilCompte } from '../types/backend'
import { CacheDisque } from './parametres/CacheDisque'
import { CarteCompte } from './parametres/CarteCompte'
import { Reglage, Statut } from './parametres/Reglage'
import { ResumesIA } from './parametres/ResumesIA'
import { ACCENTS, ONGLETS, type OngletParametres } from './parametres/types'

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
  onRevoirLeGuide: () => void
  onErreur: (message: string) => void
  onToutEffacer: () => void
  melange: boolean
  onMelanger: () => void
  toucheRecherche: string
  onToucheRecherche: (touche: string) => void
  enCours: boolean
}) {
  const [onglet, setOnglet] = useState<OngletParametres>('compte')
  const ongletCourant = ONGLETS.find((o) => o.id === onglet) ?? ONGLETS[0]!

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--bg)]">
      {/* Navigation latérale des sous-pages (Svelte & aérée) */}
      <aside
        className="w-60 flex-none border-r p-5 overflow-y-auto flex flex-col gap-4"
        style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
      >
        <div className="px-1.5">
          <h1 className="text-base font-bold tracking-tight text-[var(--fg)]">Paramètres</h1>
          <p className="text-[0.7188rem] text-[var(--sub)] mt-0.5">Gérer vos préférences</p>
        </div>

        <nav className="flex flex-col gap-1">
          {ONGLETS.map((o) => {
            const actif = onglet === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setOnglet(o.id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[0.8125rem] font-medium transition-all ${
                  actif
                    ? 'text-[var(--accent)] font-semibold shadow-xs'
                    : 'text-[var(--sub)] hover:text-[var(--fg)] hover:bg-[var(--sunk)]'
                }`}
                style={{
                  background: actif ? 'var(--sunk)' : 'transparent',
                }}
              >
                <Icone
                  nom={o.icone}
                  taille="1.0625rem"
                  style={{ color: actif ? 'var(--accent)' : 'inherit' }}
                />
                <span className="truncate text-[0.8125rem]">{o.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Contenu de la sous-page active */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-3xl mx-auto space-y-5 menu-apparait" key={onglet}>
          {/* En-tête de la sous-page */}
          <div className="border-b pb-3.5" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-base font-bold text-[var(--fg)]">{ongletCourant.label}</h2>
            <p className="text-[0.75rem] text-[var(--sub)] mt-0.5">{ongletCourant.description}</p>
          </div>

          {/* 1. Compte & Profil */}
          {onglet === 'compte' && (
            <div className="space-y-5">
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

              <Bloc titre="Préférences de lecture">
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
              </Bloc>
            </div>
          )}

          {/* 2. Apparence */}
          {onglet === 'apparence' && (
            <div className="space-y-5">
              <Bloc titre="Thème d'affichage">
                <Reglage
                  icone="dark_mode"
                  titre="Thème sombre"
                  detail="Bascule entre le mode clair et le mode sombre."
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
                  titre="Couleur d'accentuation"
                  detail="Appliquée aux boutons, filtres sélectionnés et interrupteurs."
                >
                  <div className="flex flex-none gap-3">
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onAccent(c)}
                        aria-label={`Couleur d'accent ${c}`}
                        aria-pressed={c === accent}
                        className="pastille-accent h-7.5 w-7.5 rounded-full transition-transform hover:scale-105"
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
            </div>
          )}

          {/* 3. Synchronisation */}
          {onglet === 'sync' && (
            <div className="space-y-5">
              <Bloc titre="Synchronisation Gmail">
                <Reglage
                  icone="sync"
                  titre="Appliquer les règles au lancement"
                  detail="Le tri automatique se fait avant même l'ouverture de la boîte."
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
                  detail="Intervalle régulier entre deux vérifications de nouveaux messages."
                >
                  <Segments
                    valeurs={FREQUENCES}
                    valeur={frequence}
                    onChange={onFrequence}
                    libelle="Fréquence de vérification"
                  />
                </Reglage>
              </Bloc>

              <Bloc titre="Règles actives">
                <Reglage
                  icone="rule_folder"
                  titre="Fichier de règles"
                  detail={etat.cheminRegles}
                >
                  <span
                    className="flex-none font-semibold text-[0.8125rem]"
                    style={{ color: 'var(--accent)' }}
                  >
                    {etat.nombreDeRegles === null ? 'illisible' : `${etat.nombreDeRegles} règle(s)`}
                  </span>
                </Reglage>
              </Bloc>
            </div>
          )}

          {/* 4. Intelligence Artificielle */}
          {onglet === 'ia' && (
            <div className="space-y-5">
              <Bloc titre="Synthèses & Modèle IA">
                <ResumesIA onErreur={onErreur} />
              </Bloc>

              <Bloc titre="Gestion des données">
                <CacheDisque onErreur={onErreur} onEfface={onToutEffacer} />
              </Bloc>
            </div>
          )}

          {/* 5. Aide & Diagnostic */}
          {onglet === 'aide' && (
            <div className="space-y-5">
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
              </Bloc>

              <Bloc titre="Diagnostic système">
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
                  icone="info"
                  titre="Version de l'application"
                  detail={`MailFlow ${etat.version} · Plateforme ${etat.plateforme}`}
                >
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold border"
                    style={{
                      background: 'var(--sunk)',
                      borderColor: 'var(--line)',
                      color: 'var(--sub)',
                    }}
                  >
                    v{etat.version}
                  </span>
                </Reglage>
              </Bloc>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
