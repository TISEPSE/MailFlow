import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bouton, Icone, Vide } from './composants/base'
import { Courrier, type Proposition } from './vues/Courrier'
import { Parametres } from './vues/Parametres'
import { Regles } from './vues/Regles'
import { resumerRapport } from './lib/rapport'
import { ton } from './lib/presentation'
import {
  appHealth,
  boiteLister,
  gmailSynchroniser,
  googleConnecter,
  googleDeconnecter,
  messageDErreur,
  regleAjouter,
  regleBasculer,
  regleSupprimer,
  reglesLister,
} from './lib/tauri'
import type {
  CategorieMessage,
  EtatApplication,
  JeuDeRegles,
  MessageAffiche,
} from './types/backend'

type Vue = CategorieMessage | 'regles' | 'parametres'

const NAV: { vue: Vue; libelle: string; glyphe: string }[] = [
  { vue: 'humain', libelle: 'Mails directs', glyphe: 'person' },
  { vue: 'publicite', libelle: 'Triage & publicités', glyphe: 'sell' },
  { vue: 'newsletter', libelle: 'Newsletters', glyphe: 'newspaper' },
  { vue: 'formation', libelle: 'Rappels de formations', glyphe: 'school' },
  { vue: 'regles', libelle: 'Règles automatiques', glyphe: 'bolt' },
]

const ENTETES: Record<Vue, [string, string]> = {
  humain: ['Mails directs', 'Les messages écrits par de vraies personnes. Rien d’automatique ici.'],
  publicite: ['Publicités', 'Coupez la source une bonne fois, plutôt que de supprimer chaque semaine.'],
  newsletter: ['Newsletters', 'Ce que vous recevez en nombre, et ce que vous voulez en faire.'],
  formation: ['Rappels de formations', 'Les rappels que vous avez rangés là par une règle.'],
  regles: ['Règles automatiques', 'Tout ce que MailFlow fait en votre nom, en une phrase par règle.'],
  parametres: ['Paramètres', 'Compte, apparence et état du backend.'],
}

/** Ce que chaque vue de courrier propose de faire d'un expéditeur. */
const PROPOSITIONS: Partial<Record<Vue, Proposition>> = {
  publicite: {
    libelle: 'Ne plus jamais recevoir ça',
    icone: 'auto_delete',
    action: 'supprimer_toujours',
    categorie: 'publicite',
    effet: (nom) => `Les prochains messages de ${nom} iront directement à la corbeille.`,
  },
  newsletter: {
    libelle: 'Archiver automatiquement',
    icone: 'archive',
    action: 'archiver_automatique',
    categorie: 'newsletter',
    effet: (nom) => `Les prochains messages de ${nom} quitteront la boîte de réception chaque vendredi à 18 h.`,
  },
  formation: {
    libelle: 'Archiver chaque semaine',
    icone: 'event_repeat',
    action: 'archiver_automatique',
    categorie: 'formation',
    effet: (nom) => `Les rappels de ${nom} seront archivés chaque vendredi à 18 h.`,
  },
}

export default function App() {
  const [etat, setEtat] = useState<EtatApplication | null>(null)
  const [regles, setRegles] = useState<JeuDeRegles | null>(null)
  const [boite, setBoite] = useState<MessageAffiche[]>([])
  const [vue, setVue] = useState<Vue>('humain')
  const [sombre, setSombre] = useState(false)
  const [accent, setAccent] = useState('#2F6BFF')
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null)

  const annoncer = useCallback((texte: string, erreur = false) => {
    setMessage({ texte, erreur })
    window.setTimeout(() => setMessage(null), 5000)
  }, [])

  const rafraichir = useCallback(async () => {
    try {
      const [sante, jeu] = await Promise.all([appHealth(), reglesLister()])
      setEtat(sante)
      setRegles(jeu)
      return sante
    } catch (e) {
      annoncer(messageDErreur(e), true)
      return null
    }
  }, [annoncer])

  const relever = useCallback(async () => {
    try {
      setBoite(await boiteLister())
    } catch (e) {
      annoncer(messageDErreur(e), true)
    }
  }, [annoncer])

  useEffect(() => {
    void rafraichir().then((sante) => {
      if (sante?.compteConnecte) void relever()
    })
  }, [rafraichir, relever])

  /** Toute action qui touche au backend passe par ici : un seul endroit gère
   *  l'état « occupé », les erreurs et le rafraîchissement qui suit. */
  async function agir(travail: () => Promise<string | null>) {
    setEnCours(true)
    setMessage(null)
    try {
      const dit = await travail()
      if (dit) annoncer(dit)
    } catch (e) {
      annoncer(messageDErreur(e), true)
    } finally {
      setEnCours(false)
      const sante = await rafraichir()
      if (sante?.compteConnecte) await relever()
    }
  }

  const parCategorie = useMemo(() => {
    const vides: Record<CategorieMessage, MessageAffiche[]> = {
      humain: [],
      publicite: [],
      newsletter: [],
      formation: [],
    }
    for (const m of boite) vides[m.categorie].push(m)
    return vides
  }, [boite])

  const compte = (v: Vue): number =>
    v === 'regles'
      ? (regles?.automations.length ?? 0)
      : v === 'parametres'
        ? 0
        : parCategorie[v as CategorieMessage].length

  const [titre, sous] = ENTETES[vue]

  return (
    <div
      data-mf={sombre ? 'sombre' : 'clair'}
      style={{
        // La couleur d'accent est surchargée ici pour que tous les jetons
        // dérivés suivent, thème clair comme sombre.
        ['--accent' as string]: accent,
        ['--accent-soft' as string]: sombre
          ? `color-mix(in oklab, ${accent} 26%, #1C1C1F)`
          : `color-mix(in oklab, ${accent} 12%, #FFFFFF)`,
        ['--accent-fg' as string]: sombre
          ? `color-mix(in oklab, ${accent} 62%, #FFFFFF)`
          : `color-mix(in oklab, ${accent} 82%, #1D1D1F)`,
      }}
      className="flex h-full flex-col"
    >
      <header
        data-tauri-drag-region
        className="flex h-11 flex-none items-center gap-3 border-b px-4"
        style={{ background: 'var(--side)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-2 pl-16">
          <Icone nom="bolt" taille={17} rempli style={{ color: 'var(--accent)' }} />
          <span className="text-[13px] font-semibold">MailFlow</span>
        </div>

        <div className="flex-1" />

        {etat && (
          <span
            className="flex items-center gap-1.5 font-mono text-[11px]"
            style={{ color: 'var(--sub)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: etat.compteConnecte ? '#28A745' : 'var(--sub)' }}
            />
            {etat.compteConnecte ? 'Gmail connecté' : 'hors ligne'}
          </span>
        )}

        <button
          type="button"
          onClick={() => setSombre((s) => !s)}
          aria-label={sombre ? 'Passer au thème clair' : 'Passer au thème sombre'}
          className="flex-none rounded-lg p-1.5"
          style={{ color: 'var(--sub)' }}
        >
          <Icone nom={sombre ? 'light_mode' : 'dark_mode'} taille={17} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-[248px] flex-none flex-col gap-0.5 border-r p-3"
          style={{ background: 'var(--side)', borderColor: 'var(--line)' }}
        >
          <div
            className="px-2.5 pt-1 pb-3 text-[11px] font-semibold tracking-wider uppercase"
            style={{ color: 'var(--sub)' }}
          >
            Boîte de réception
          </div>

          {NAV.map(({ vue: v, libelle, glyphe }) => {
            const actif = vue === v
            const [solide, doux] = ton(v === 'regles' ? 'regle' : (v as CategorieMessage), sombre)
            return (
              <button
                key={v}
                type="button"
                onClick={() => setVue(v)}
                aria-current={actif ? 'page' : undefined}
                className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left"
                style={{ background: actif ? 'var(--card)' : 'transparent' }}
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px]"
                  style={{ background: actif ? solide : doux }}
                >
                  <Icone nom={glyphe} taille={16} rempli style={{ color: actif ? '#FFFFFF' : solide }} />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[13px] font-medium"
                  style={{ color: actif ? 'var(--fg)' : 'var(--sub)' }}
                >
                  {libelle}
                </span>
                <span
                  className="flex-none font-mono text-[11px]"
                  style={{ color: actif ? solide : 'var(--sub)' }}
                >
                  {compte(v)}
                </span>
              </button>
            )
          })}

          <div className="flex-1" />

          {etat?.compteConnecte && (
            <div
              className="rounded-xl border p-3"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--line)',
                boxShadow: 'var(--shadow)',
              }}
            >
              <div className="flex items-center gap-2 pb-1.5">
                <Icone nom="bolt" taille={16} rempli style={{ color: '#28A745' }} />
                <span className="text-[12px] font-semibold">Règles actives</span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--sub)' }}>
                {regles?.automations.filter((r) => r.active).length ?? 0} règle(s) prêtes à
                s'appliquer à votre boîte.
              </p>
              <div className="pt-2.5">
                <Bouton
                  variante="discret"
                  icone="sync"
                  disabled={enCours}
                  onClick={() =>
                    void agir(async () => resumerRapport(await gmailSynchroniser()))
                  }
                >
                  {enCours ? 'En cours…' : 'Appliquer mes règles'}
                </Bouton>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setVue('parametres')}
            aria-current={vue === 'parametres' ? 'page' : undefined}
            className="mt-2 flex items-center gap-3 rounded-lg px-2.5 py-2 text-left"
            style={{ background: vue === 'parametres' ? 'var(--card)' : 'transparent' }}
          >
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px]"
              style={{ background: 'var(--faint)' }}
            >
              <Icone nom="settings" taille={16} style={{ color: 'var(--sub)' }} />
            </span>
            <span
              className="flex-1 text-[13px] font-medium"
              style={{ color: vue === 'parametres' ? 'var(--fg)' : 'var(--sub)' }}
            >
              Paramètres
            </span>
          </button>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg)' }}>
          <div
            className="flex flex-none items-end gap-4 border-b px-6 py-5"
            style={{ borderColor: 'var(--line)' }}
          >
            <div className="min-w-0 flex-1">
              <h1 className="text-[21px] font-semibold tracking-tight">{titre}</h1>
              <p className="pt-1 text-[13px]" style={{ color: 'var(--sub)' }}>
                {sous}
              </p>
            </div>
            {etat?.compteConnecte && vue !== 'parametres' && vue !== 'regles' && (
              <Bouton icone="refresh" onClick={() => void agir(async () => (await relever(), null))} disabled={enCours}>
                Actualiser
              </Bouton>
            )}
          </div>

          {message && (
            <div
              role="status"
              className="mx-6 mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]"
              style={{
                background: message.erreur ? '#FDE3DC' : 'var(--accent-soft)',
                color: message.erreur ? '#8A2E12' : 'var(--accent-fg)',
              }}
            >
              <Icone nom={message.erreur ? 'error' : 'check_circle'} taille={17} rempli />
              <span className="flex-1">{message.texte}</span>
            </div>
          )}

          {!etat ? (
            <Vide icone="hourglass_empty" titre="Démarrage…" detail="Lecture de l'état du backend." />
          ) : vue === 'parametres' ? (
            <Parametres
              etat={etat}
              sombre={sombre}
              onBasculerTheme={() => setSombre((s) => !s)}
              accent={accent}
              onAccent={setAccent}
              enCours={enCours}
              onConnecter={() => void agir(async () => (await googleConnecter(), 'Compte Gmail connecté.'))}
              onDeconnecter={() =>
                void agir(async () => {
                  await googleDeconnecter()
                  setBoite([])
                  return 'Compte déconnecté et autorisation révoquée.'
                })
              }
            />
          ) : !etat.compteConnecte ? (
            <PasConnecte etat={etat} enCours={enCours} onConnecter={() => setVue('parametres')} />
          ) : vue === 'regles' ? (
            <Regles
              regles={regles?.automations ?? []}
              sombre={sombre}
              onBasculer={(id) => agir(async () => (setRegles(await regleBasculer(id)), null))}
              onSupprimer={(id) => agir(async () => (setRegles(await regleSupprimer(id)), 'Règle supprimée.'))}
            />
          ) : (
            <Courrier
              messages={parCategorie[vue]}
              sombre={sombre}
              regles={regles?.automations ?? []}
              proposition={PROPOSITIONS[vue]}
              onCreerRegle={(r) =>
                agir(async () => {
                  setRegles(await regleAjouter(r))
                  return `Règle créée pour ${r.nom_affichage || r.expediteur}.`
                })
              }
              vide={VIDES[vue]}
            />
          )}
        </main>
      </div>
    </div>
  )
}

const VIDES: Record<CategorieMessage, { icone: string; titre: string; detail: string }> = {
  humain: {
    icone: 'inbox',
    titre: 'Aucun message direct',
    detail: 'Rien qui semble écrit par une personne dans les messages relevés.',
  },
  publicite: {
    icone: 'sell',
    titre: 'Aucune publicité',
    detail: 'Rien que Gmail ait rangé en promotions dans les messages relevés.',
  },
  newsletter: {
    icone: 'newspaper',
    titre: 'Aucune newsletter',
    detail: 'Rien qui porte un lien de désabonnement dans les messages relevés.',
  },
  formation: {
    icone: 'school',
    titre: 'Aucun rappel de formation',
    detail:
      "Cette catégorie ne se devine pas : un message n'y apparaît que si vous y avez rangé son expéditeur par une règle.",
  },
}

function PasConnecte({
  etat,
  enCours,
  onConnecter,
}: {
  etat: EtatApplication
  enCours: boolean
  onConnecter: () => void
}) {
  const bloque = !etat.clientGoogleConfigure || !etat.trousseauDisponible

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <Icone nom="mail_lock" taille={36} style={{ color: 'var(--sub)', opacity: 0.5 }} />
      <div className="text-sm font-semibold">Aucun compte Gmail connecté</div>
      <p className="max-w-sm text-[13px]" style={{ color: 'var(--sub)' }}>
        {bloque
          ? "La configuration n'est pas complète. Les Paramètres disent ce qui manque."
          : 'MailFlow ouvrira votre navigateur sur la vraie page de connexion Google.'}
      </p>
      <div className="pt-2">
        <Bouton variante="principal" icone="settings" onClick={onConnecter} disabled={enCours}>
          Ouvrir les paramètres
        </Bouton>
      </div>
    </div>
  )
}
