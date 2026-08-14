import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bouton, EnTete, Icone, Vide } from './composants/base'
import type { NomIcone } from './composants/glyphes'
import { Courrier, type Proposition } from './vues/Courrier'
import { Parametres } from './vues/Parametres'
import { Regles } from './vues/Regles'
import { initiales, ton } from './lib/presentation'
import {
  DEFAUTS,
  MINUTES,
  ecrirePreferences,
  lirePreferences,
  type Frequence,
} from './lib/preferences'
import { LogoGoogle } from './composants/LogoGoogle'
import {
  appHealth,
  boiteLister,
  compteAjouter,
  compteBasculer,
  compteOublier,
  compteProfil,
  comptesLister,
  logosExpediteurs,
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
  CompteConnu,
  ProfilCompte,
} from './types/backend'

type Vue = CategorieMessage | 'regles' | 'parametres'

const NAV: { vue: Vue; libelle: string; glyphe: NomIcone }[] = [
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
  parametres: ['Paramètres', 'Compte, apparence, synchronisation et automatisations.'],
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
  const [prefs, setPrefs] = useState(DEFAUTS)
  const [profil, setProfil] = useState<ProfilCompte | null>(null)
  const [comptes, setComptes] = useState<CompteConnu[]>([])
  const [logos, setLogos] = useState<Record<string, string>>({})

  /** Messages ouverts pendant cette session.
   *
   *  MailFlow ne lit que des métadonnées et ne retire jamais le libellé
   *  `UNREAD` : Gmail continue donc de les croire non lus. Sans cette trace,
   *  une tuile qu'on vient de consulter resterait blanche, ce qui reviendrait à
   *  redire « nouveau » à propos d'un message qu'on a sous les yeux. */
  const [consultes, setConsultes] = useState<ReadonlySet<string>>(new Set())
  const { sombre, accent } = prefs

  // Relues une fois au montage : `localStorage` n'existe pas au moment où
  // l'état initial est calculé côté rendu serveur, et l'application doit
  // s'afficher même sans dépôt disponible.
  useEffect(() => setPrefs(lirePreferences()), [])

  const regler = useCallback((champs: Partial<typeof DEFAUTS>) => {
    setPrefs((p) => {
      const suivant = { ...p, ...champs }
      ecrirePreferences(suivant)
      return suivant
    })
  }, [])
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null)

  const annoncer = useCallback((texte: string, erreur = false) => {
    setMessage({ texte, erreur })
    window.setTimeout(() => setMessage(null), 5000)
  }, [])

  const rafraichir = useCallback(async () => {
    try {
      const [sante, jeu, connus] = await Promise.all([
        appHealth(),
        reglesLister(),
        comptesLister().catch(() => [] as CompteConnu[]),
      ])
      setEtat(sante)
      setRegles(jeu)
      setComptes(connus)
      if (!sante.compteConnecte) setProfil(null)
      return sante
    } catch (e) {
      annoncer(messageDErreur(e), true)
      return null
    }
  }, [annoncer])

  const relever = useCallback(async () => {
    try {
      const messages = await boiteLister()
      setBoite(messages)

      // Les logos arrivent après : ils partent sur le réseau, et la boîte doit
      // s'afficher sans les attendre.
      const adresses = [...new Set(messages.map((m) => m.adresse))].filter(Boolean)
      logosExpediteurs(adresses)
        .then((trouves) => setLogos((connus) => ({ ...connus, ...trouves })))
        .catch(() => undefined)
    } catch (e) {
      annoncer(messageDErreur(e), true)
    }
  }, [annoncer])

  useEffect(() => {
    void rafraichir().then(async (sante) => {
      if (!sante?.compteConnecte) return
      setProfil(await compteProfil().catch(() => null))
      if (lirePreferences().syncAuLancement) {
        await gmailSynchroniser().catch(() => null)
      }
      await relever()
    })
  }, [rafraichir, relever])

  /** Relevé périodique. La fréquence est un réglage, pas une constante : le
   *  minuteur se reconstruit quand elle change. */
  useEffect(() => {
    if (!etat?.compteConnecte) return
    const minuteur = window.setInterval(
      () => void relever(),
      MINUTES[prefs.frequence] * 60_000,
    )
    return () => window.clearInterval(minuteur)
  }, [etat?.compteConnecte, prefs.frequence, relever])

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
                className="survolable flex items-center gap-3 rounded-lg px-2.5 py-2 text-left"
                style={actif ? { background: 'var(--card)' } : undefined}
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-[9px]"
                  style={{ background: actif ? solide : doux }}
                >
                  <Icone
                    nom={glyphe}
                    taille={16}
                    rempli={actif}
                    style={{ color: actif ? '#FFFFFF' : solide }}
                  />
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

          <div
            className="mt-3 flex items-center gap-2.5 border-t pt-3"
            style={{ borderColor: 'var(--line)' }}
          >
            <AvatarCompte profil={profil} connecte={etat?.compteConnecte ?? false} />

            <button
              type="button"
              onClick={() => setVue('parametres')}
              className="survolable min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left"
              title={profil?.adresse ?? undefined}
            >
              <div className="truncate text-[12px] font-semibold">
                {profil?.nom ?? (etat?.compteConnecte ? 'Compte Google' : 'Non connecté')}
              </div>
              <div
                className="truncate font-mono text-[10px]"
                style={{ color: 'var(--sub)' }}
              >
                {profil?.adresse ?? 'aucun compte relié'}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setVue('parametres')}
              aria-label="Paramètres"
              aria-current={vue === 'parametres' ? 'page' : undefined}
              className="survolable flex h-8 w-8 flex-none items-center justify-center rounded-lg"
              style={
                vue === 'parametres'
                  ? { background: 'var(--card)', color: 'var(--accent-fg)' }
                  : { color: 'var(--sub)' }
              }
            >
              <Icone nom="settings" taille={17} rempli={vue === 'parametres'} />
            </button>
          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg)' }}>
          {/* La vue Règles porte son propre en-tête, avec son bouton d'ajout :
              le répéter ici afficherait deux fois le même titre. */}
          {vue !== 'regles' && (
            <EnTete titre={titre} sous={sous}>
              {etat?.compteConnecte && vue !== 'parametres' && (
                <Bouton
                  icone="refresh"
                  onClick={() => void agir(async () => (await relever(), null))}
                  disabled={enCours}
                >
                  Actualiser
                </Bouton>
              )}
            </EnTete>
          )}

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
              profil={profil}
              sombre={sombre}
              onBasculerTheme={() => regler({ sombre: !sombre })}
              accent={accent}
              onAccent={(c) => regler({ accent: c })}
              syncAuLancement={prefs.syncAuLancement}
              onSyncAuLancement={() => regler({ syncAuLancement: !prefs.syncAuLancement })}
              frequence={prefs.frequence}
              onFrequence={(f: Frequence) => regler({ frequence: f })}
              enCours={enCours}
              onConnecter={() =>
                void agir(async () => {
                  await googleConnecter()
                  setProfil(await compteProfil().catch(() => null))
                  return 'Compte Gmail connecté.'
                })
              }
              onDeconnecter={() =>
                void agir(async () => {
                  await googleDeconnecter()
                  setBoite([])
                  setProfil(null)
                  return 'Compte déconnecté et autorisation révoquée.'
                })
              }
              comptes={comptes}
              onBasculer={(adresse) =>
                void agir(async () => {
                  await compteBasculer(adresse)
                  // La boîte affichée est celle du compte précédent : la vider
                  // avant le relevé évite de montrer les messages de l'un sous
                  // l'adresse de l'autre.
                  setBoite([])
                  setConsultes(new Set())
                  setProfil(await compteProfil().catch(() => null))
                  return `Compte actif : ${adresse}.`
                })
              }
              onAjouterCompte={() =>
                void agir(async () => {
                  await compteAjouter()
                  setBoite([])
                  setConsultes(new Set())
                  setProfil(await compteProfil().catch(() => null))
                  return 'Compte ajouté.'
                })
              }
              onOublierCompte={(adresse) =>
                void agir(async () => {
                  await compteOublier(adresse)
                  return `Compte ${adresse} retiré.`
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
              onCreerRegle={(r) =>
                agir(async () => {
                  setRegles(await regleAjouter(r))
                  return `Règle créée pour ${r.nom_affichage || r.expediteur}.`
                })
              }
            />
          ) : (
            <Courrier
              messages={parCategorie[vue]}
              sombre={sombre}
              regles={regles?.automations ?? []}
              proposition={PROPOSITIONS[vue]}
              logos={logos}
              consultes={consultes}
              onConsulte={(id) =>
                setConsultes((vus) => (vus.has(id) ? vus : new Set(vus).add(id)))
              }
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

/**
 * Avatar du compte relié.
 *
 * Trois cas, du plus au moins renseigné : la photo du compte Google, le logo
 * Google quand le compte est relié sans photo, les initiales sinon. Le dernier
 * n'est pas un pis-aller : beaucoup de comptes n'ont pas de photo.
 */
function AvatarCompte({
  profil,
  connecte,
}: {
  profil: ProfilCompte | null
  connecte: boolean
}) {
  if (profil?.photo) {
    return (
      <img
        src={profil.photo}
        alt=""
        className="h-8 w-8 flex-none rounded-full object-cover"
        style={{ background: 'var(--faint)' }}
      />
    )
  }

  if (connecte) {
    return (
      <div
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
      >
        <LogoGoogle taille={17} />
      </div>
    )
  }

  return (
    <div
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ background: 'var(--faint)', color: 'var(--sub)' }}
    >
      {initiales(profil?.nom ?? profil?.adresse ?? '?')}
    </div>
  )
}

const VIDES: Record<
  CategorieMessage,
  { icone: NomIcone; titre: string; detail: string }
> = {
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
