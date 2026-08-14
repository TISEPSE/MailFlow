import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Bouton,
  Icone,
  Progression,
  Toasts,
  Vide,
  type Toast,
} from './composants/base'
import type { NomIcone } from './composants/glyphes'
import { Courrier, type Proposition } from './vues/Courrier'
import { Parametres } from './vues/Parametres'
import { Regles } from './vues/Regles'
import { initiales, ton } from './lib/presentation'
import { creerCache, ranger, type CacheCorps } from './lib/corps'
import {
  DEFAUTS,
  MINUTES,
  ecrirePreferences,
  lirePreferences,
  type Frequence,
} from './lib/preferences'
import { LogoGoogle } from './composants/LogoGoogle'
import { ModaleFormation } from './composants/ModaleFormation'
import {
  appHealth,
  boiteLister,
  compteAjouter,
  compteBasculer,
  compteOublier,
  compteProfil,
  corpsPrecharger,
  EVENEMENT_PRECHARGEMENT,
  type Avancement,
  comptesLister,
  logosExpediteurs,
  gmailSynchroniser,
  googleConnecter,
  googleDeconnecter,
  messageDErreur,
  libelleCreer,
  libellesLister,
  messageMarquerLu,
  messageRanger,
  repondreAuMessage,
  messageSignalerSpam,
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
  LibelleGmail,
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


/** Ce que chaque vue de courrier propose de faire d'un expéditeur. */
const PROPOSITIONS: Partial<Record<Vue, Proposition>> = {
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
  const [libelles, setLibelles] = useState<LibelleGmail[]>([])

  /** Corps déjà chargés, gardés le temps de la session.
   *
   *  Vidé au changement de compte : les identifiants d'une boîte ne désignent
   *  rien dans une autre, et rendre le corps d'un message d'un compte sous
   *  l'adresse d'un autre serait pire qu'un rechargement. */
  const [corpsConnus, setCorpsConnus] = useState<CacheCorps>(creerCache)

  /** Vrai tant que le premier relevé n'a pas abouti.
   *
   *  Distinct de `enCours`, qui vaut aussi pour une action : montrer un
   *  squelette pendant qu'on supprime une règle effacerait la boîte sous les
   *  yeux de l'utilisateur. */
  const [premierReleve, setPremierReleve] = useState(true)
  const [menuCompte, setMenuCompte] = useState(false)

  /** Le menu reste dans la page le temps de sa disparition.
   *
   *  Sans ce sursis, React l'ôte à l'instant du clic : l'animation de sortie
   *  n'aurait rien à jouer, et le menu s'effacerait d'un coup. */
  const [menuMonte, setMenuMonte] = useState(false)

  /** Avancement du préchargement, `null` quand il n'est pas en cours. */
  const [avancement, setAvancement] = useState<Avancement | null>(null)

  /** Fenêtre d'ajout d'un expéditeur aux rappels de formation. */
  const [ajoutFormation, setAjoutFormation] = useState(false)
  const boutonProfil = useRef<HTMLButtonElement>(null)
  const [logos, setLogos] = useState<Record<string, string>>({})

  const { sombre, accent, barreRepliee: repliee } = prefs

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

  /** Messages passagers, empilés en haut à gauche.
   *
   *  Une liste et non un seul : deux actions rapprochées doivent se voir
   *  toutes les deux, au lieu que la seconde efface la première. */
  const [toasts, setToasts] = useState<Toast[]>([])

  const retirerToast = useCallback((id: number) => {
    setToasts((liste) => liste.filter((t) => t.id !== id))
  }, [])

  const annoncer = useCallback(
    (texte: string, erreur = false) => {
      const id = Date.now() + Math.random()
      setToasts((liste) => [...liste, { id, texte, erreur }])
      // La barre de décompte prévient la sortie et déclenche le retrait ; ce
      // minuteur n'est qu'un filet, pour le cas où l'animation ne se joue pas
      // — fenêtre en arrière-plan, animations coupées par le système.
      window.setTimeout(() => retirerToast(id), 3400)
    },
    [retirerToast],
  )

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
      if (!sante.compteConnecte) {
        setProfil(null)
        setPremierReleve(false)
      }
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
      setPremierReleve(false)

      // Les logos arrivent après : ils partent sur le réseau, et la boîte doit
      // s'afficher sans les attendre.
      const adresses = [...new Set(messages.map((m) => m.adresse))].filter(Boolean)
      logosExpediteurs(adresses)
        .then((trouves) => setLogos((connus) => ({ ...connus, ...trouves })))
        .catch(() => undefined)

      return messages
    } catch (e) {
      annoncer(messageDErreur(e), true)
      setPremierReleve(false)
      return null
    }
  }, [annoncer])

  /**
   * Relève la boîte, puis charge d'avance tous les corps, barre à l'appui.
   *
   * C'est la séquence du premier démarrage. Elle vaut aussi à chaque bascule de
   * compte : la boîte d'à côté n'a rien en cache, et sans ce passage l'attente
   * se paierait message par message, sans que rien ne l'annonce.
   */
  const chargerLaBoite = useCallback(async () => {
    // Total inconnu, mais l'écran doit être là avant le relevé : sans cela, la
    // bascule de compte montrait d'abord un squelette, puis la barre — deux
    // attentes différentes pour un seul clic.
    setAvancement((en) => en ?? { faits: 0, total: 0 })
    const messages = await relever()
    if (!messages?.length) {
      setAvancement(null)
      return
    }

    setAvancement({ faits: 0, total: messages.length })
    await corpsPrecharger(messages.map((m) => m.id)).catch(() => null)
    setAvancement(null)
  }, [relever])

  /**
   * Marque un message comme lu, d'abord à l'écran puis chez Gmail.
   *
   * L'affichage est mis à jour sans attendre le réseau : le message est sous
   * les yeux de l'utilisateur, le voir rester en gras une seconde donnerait
   * l'impression que le clic n'a pas porté. En cas d'échec, le prochain relevé
   * rétablira l'état réel — Gmail fait foi, pas notre optimisme.
   */
  const marquerLu = useCallback(
    async (id: string) => {
      setBoite((messages) =>
        messages.map((m) => (m.id === id && m.nonLu ? { ...m, nonLu: false } : m)),
      )
      await messageMarquerLu(id).catch((e) => annoncer(messageDErreur(e), true))
    },
    [annoncer],
  )

  useEffect(() => {
    if (menuCompte) {
      setMenuMonte(true)
      return
    }
    if (!menuMonte) return

    // La durée suit celle de `.menu-disparait` dans la feuille de styles.
    const minuteur = window.setTimeout(() => setMenuMonte(false), 120)
    return () => window.clearTimeout(minuteur)
  }, [menuCompte, menuMonte])

  useEffect(() => {
    // L'écoute est posée avant tout appel : un événement émis pendant qu'on
    // s'abonne serait sinon perdu, et la barre resterait à zéro.
    const arret = listen<Avancement>(EVENEMENT_PRECHARGEMENT, (e) =>
      setAvancement(e.payload),
    )
    return () => {
      void arret.then((f) => f())
    }
  }, [])

  useEffect(() => {
    void rafraichir().then(async (sante) => {
      if (!sante?.compteConnecte) return
      setProfil(await compteProfil().catch(() => null))
      // Une seule lecture par session : la liste des libellés bouge rarement,
      // et la relire à chaque relevé dépenserait du quota pour rien.
      setLibelles(await libellesLister().catch(() => []))
      if (lirePreferences().syncAuLancement) {
        await gmailSynchroniser().catch(() => null)
      }
      await chargerLaBoite()
    })
  }, [rafraichir, chargerLaBoite])

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
  async function agir(
    travail: () => Promise<string | null>,
    // `rechargerTout` pour les actions qui changent de boîte : un simple relevé
    // laisserait les corps à charger un par un.
    { rechargerTout = false }: { rechargerTout?: boolean } = {},
  ) {
    setEnCours(true)
    try {
      const dit = await travail()
      if (dit) annoncer(dit)
    } catch (e) {
      annoncer(messageDErreur(e), true)
    } finally {
      // Le rafraîchissement fait partie de l'action : rendre la main avant lui
      // arrêtait l'animation alors que la boîte se chargeait encore, ce qui
      // laissait croire que le travail était fini.
      const sante = await rafraichir()
      if (sante?.compteConnecte) {
        if (rechargerTout) await chargerLaBoite()
        else await relever()
      }
      // Toujours, même en cas d'échec : une action qui a posé l'écran de
      // chargement avant d'échouer le laisserait sinon en place, sans fin.
      setAvancement(null)
      setEnCours(false)
    }
  }

  /** Bascule de compte, partagée par la barre latérale et les Paramètres. */
  const basculerVers = (adresse: string) =>
    agir(
      async () => {
        // Dès le clic, et non après le relevé : la boîte de l'autre compte
        // n'a rien en cache, l'attente est réelle et doit s'annoncer.
        setAvancement({ faits: 0, total: 0 })
        await compteBasculer(adresse)
        // La boîte affichée est celle du compte précédent : la vider avant le
        // relevé évite de montrer les messages de l'un sous l'adresse de l'autre.
        setBoite([])
        setPremierReleve(true)
        setCorpsConnus(creerCache())
        setProfil(await compteProfil().catch(() => null))
        setLibelles(await libellesLister().catch(() => []))
        return `Compte actif : ${adresse}.`
      },
      { rechargerTout: true },
    )

  const deconnecter = () =>
    agir(async () => {
      await googleDeconnecter()
      setBoite([])
      setCorpsConnus(creerCache())
      setProfil(null)
      setLibelles([])
      setPremierReleve(false)
      return 'Compte déconnecté et autorisation révoquée.'
    })

  const ajouterUnCompte = () =>
    agir(
      async () => {
        setAvancement({ faits: 0, total: 0 })
        await compteAjouter()
        setBoite([])
        setPremierReleve(true)
        setCorpsConnus(creerCache())
        setProfil(await compteProfil().catch(() => null))
        setLibelles(await libellesLister().catch(() => []))
        return 'Compte ajouté.'
      },
      { rechargerTout: true },
    )

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
      <Toasts toasts={toasts} onFermer={retirerToast} />

      {ajoutFormation && (
        <ModaleFormation
          expediteurs={boite}
          sombre={sombre}
          onFermer={() => setAjoutFormation(false)}
          onValider={async (r) => {
            setAjoutFormation(false)
            await agir(async () => {
              setRegles(await regleAjouter(r))
              return `${r.nom_affichage || r.expediteur} rejoint les rappels de formation.`
            })
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex flex-none flex-col gap-0.5 border-r p-3 transition-[width] duration-150"
          style={{
            // 72 et non 68 : ôtez les 12 pixels de rembourrage de chaque côté
            // et les 10 de l'entrée, il ne restait que 24 pixels pour une
            // icône qui en fait 28 — elle débordait, et la pastille active le
            // montrait sans détour.
            width: repliee ? 72 : 248,
            background: 'var(--side)',
            borderColor: 'var(--line)',
          }}
        >
          <div className="flex items-center gap-1 pt-1 pb-3">
            {!repliee && (
              <span
                className="min-w-0 flex-1 truncate px-2.5 text-[11px] font-semibold tracking-wider uppercase"
                style={{ color: 'var(--sub)' }}
              >
                Boîte de réception
              </span>
            )}
            <button
              type="button"
              onClick={() => regler({ barreRepliee: !repliee })}
              aria-expanded={!repliee}
              title={repliee ? 'Déplier la barre' : 'Replier la barre'}
              aria-label={repliee ? 'Déplier la barre' : 'Replier la barre'}
              className="bouton bouton-icone mx-auto flex-none rounded-lg p-1.5"
            >
              <Icone nom={repliee ? 'left_panel_open' : 'left_panel_close'} taille={18} />
            </button>
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
                // Repliée, la barre garde le libellé en infobulle : une icône
                // seule ne dit pas ce qu'elle range.
                title={repliee ? `${libelle} (${compte(v)})` : undefined}
                className={`survolable flex items-center gap-3 rounded-lg py-2 ${
                  repliee ? 'justify-center px-0' : 'px-2.5 text-left'
                }`}
                style={actif ? { background: 'var(--card)' } : undefined}
              >
                <span
                  className="relative flex h-7 w-7 flex-none items-center justify-center rounded-[9px]"
                  style={{ background: actif ? solide : doux }}
                >
                  <Icone
                    nom={glyphe}
                    taille={16}
                    rempli={actif}
                    style={{ color: actif ? '#FFFFFF' : solide }}
                  />
                  {repliee && compte(v) > 0 && (
                    <span
                      className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-semibold"
                      style={{ background: solide, color: '#FFFFFF' }}
                    >
                      {compte(v)}
                    </span>
                  )}
                </span>
                {!repliee && (
                  <>
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
                  </>
                )}
              </button>
            )
          })}

          {etat?.compteConnecte && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void agir(async () => (await relever(), null))}
                disabled={enCours || premierReleve}
                title={repliee ? 'Actualiser la boîte' : undefined}
                // Replié, il prend la forme des entrées de navigation : un pavé
                // large au milieu de carrés se lisait comme un élément étranger.
                className={`bouton bouton-doux flex w-full items-center gap-3 rounded-lg py-2 text-[13px] font-semibold ${
                  repliee ? 'justify-center px-0' : 'px-2.5 text-left'
                }`}
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center">
                  <Icone
                    nom="refresh"
                    taille={16}
                    tourne={enCours || premierReleve}
                  />
                </span>
                {!repliee && (
                  <span className="min-w-0 flex-1 truncate">
                    {enCours || premierReleve ? 'Recherche…' : 'Actualiser'}
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="flex-1" />

          <div
            className="relative mt-3 flex items-center gap-1.5 border-t pt-3"
            style={{ borderColor: 'var(--line)' }}
          >
            {menuMonte && (
              <MenuDeCompte
                comptes={comptes}
                sortant={!menuCompte}
                declencheur={boutonProfil}
                onFermer={() => setMenuCompte(false)}
                onBasculer={(adresse) => {
                  setMenuCompte(false)
                  void basculerVers(adresse)
                }}
                onAjouter={() => {
                  setMenuCompte(false)
                  void ajouterUnCompte()
                }}
                onParametres={() => {
                  setMenuCompte(false)
                  setVue('parametres')
                }}
                onDeconnecter={() => {
                  setMenuCompte(false)
                  void deconnecter()
                }}
              />
            )}

            {/* L'avatar est dans le bouton, pas à côté : la zone survolée doit
                couvrir tout ce qui désigne le compte, sans quoi le fond gris
                s'arrête au bord de la photo. */}
            <button
              ref={boutonProfil}
              type="button"
              onClick={() => setMenuCompte((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuCompte}
              className={`survolable flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 ${
                repliee ? 'justify-center px-0' : 'px-1.5 text-left'
              }`}
              title={profil?.adresse ?? undefined}
            >
              <AvatarCompte profil={profil} connecte={etat?.compteConnecte ?? false} />
              {!repliee && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">
                      {profil?.nom ?? (etat?.compteConnecte ? 'Compte Google' : 'Non connecté')}
                    </span>
                    <span
                      className="block truncate font-mono text-[10px]"
                      style={{ color: 'var(--sub)' }}
                    >
                      {profil?.adresse ?? 'aucun compte relié'}
                    </span>
                  </span>
                  <Icone
                    nom="expand_more"
                    taille={16}
                    style={{
                      color: 'var(--sub)',
                      // Pivote vers le haut quand le menu s'ouvre : la flèche
                      // désigne alors l'endroit où le menu vient d'apparaître.
                      transform: menuCompte ? 'rotate(180deg)' : undefined,
                      transition: 'transform 160ms ease',
                    }}
                  />
                </>
              )}
            </button>

          </div>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg)' }}>
          {avancement ? (
            <Progression faits={avancement.faits} total={avancement.total} />
          ) : !etat ? (
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
              onDeconnecter={() => void deconnecter()}
              comptes={comptes}
              onBasculer={(adresse) => void basculerVers(adresse)}
              onAjouterCompte={() => void ajouterUnCompte()}
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
              expediteurs={boite}
              libelles={libelles}
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
              chargement={premierReleve}
              regles={regles?.automations ?? []}
              proposition={PROPOSITIONS[vue]}
              logos={logos}
              onOuvrir={(id) => void marquerLu(id)}
              corpsConnus={corpsConnus}
              onCorpsCharge={(id, corps) =>
                setCorpsConnus((connus) => ranger(connus, id, corps))
              }
              libelles={vue === 'humain' ? libelles : undefined}
              onRepondre={
                vue === 'humain'
                  ? (m) =>
                      void agir(async () => {
                        await repondreAuMessage(m.adresse, m.sujet)
                        return null
                      })
                  : undefined
              }
              onCreerLibelle={
                vue === 'humain'
                  ? async (nom) => {
                      setLibelles(await libelleCreer(nom))
                    }
                  : undefined
              }
              onRanger={
                vue === 'humain'
                  ? (id, libelle) =>
                      void agir(async () => {
                        await messageRanger(id, libelle)
                        return 'Message archivé.'
                      })
                  : undefined
              }
              onSignalerSpam={
                vue === 'publicite'
                  ? (id) =>
                      void agir(async () => {
                        await messageSignalerSpam(id)
                        return 'Message signalé comme indésirable.'
                      })
                  : undefined
              }
              onCreerRegle={(r) =>
                agir(async () => {
                  setRegles(await regleAjouter(r))
                  return `Règle créée pour ${r.nom_affichage || r.expediteur}.`
                })
              }
              // Les formations ne se devinent pas : la page vide doit donc
              // offrir le geste qui la remplit, sur place. La renvoyer vers la
              // page des règles imposait un détour et trois réglages là où une
              // adresse suffit.
              vide={
                vue === 'formation'
                  ? {
                      ...VIDES.formation,
                      action: {
                        libelle: 'Ajouter un expéditeur',
                        icone: 'playlist_add_check' as NomIcone,
                        onClick: () => setAjoutFormation(true),
                      },
                    }
                  : VIDES[vue]
              }
            />
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * Menu de compte, ouvert depuis le pied de la barre latérale.
 *
 * Il double le sélecteur des Paramètres à dessein : changer de compte est un
 * geste fréquent, et l'imposer par un détour en Paramètres reviendrait à le
 * ranger avec les réglages qu'on touche une fois par an.
 *
 * Il se ferme au clic hors de lui et à `Échap` — un menu dont on ne sait pas
 * sortir bloque tout ce qui est derrière.
 */
function MenuDeCompte({
  comptes,
  sortant,
  declencheur,
  onFermer,
  onBasculer,
  onAjouter,
  onParametres,
  onDeconnecter,
}: {
  comptes: CompteConnu[]
  /** Vrai pendant la disparition : le menu est encore là, mais s'en va. */
  sortant: boolean
  /** Le bouton qui ouvre le menu, exclu du « clic à l'extérieur ». */
  declencheur: React.RefObject<HTMLButtonElement | null>
  onFermer: () => void
  onBasculer: (adresse: string) => void
  onAjouter: () => void
  onParametres: () => void
  onDeconnecter: () => void
}) {
  const cadre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node
      // Le bouton d'ouverture n'est pas « l'extérieur ». Sans cette exclusion,
      // le clic le fermait puis son `onClick` le rouvrait aussitôt : le menu
      // paraissait ne jamais se fermer.
      if (cadre.current?.contains(cible) || declencheur.current?.contains(cible)) {
        return
      }
      onFermer()
    }
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer()
    }

    // En phase de capture, et au tour suivant : sans cela, le clic qui vient
    // d'ouvrir le menu le refermerait aussitôt.
    const minuteur = window.setTimeout(() => {
      document.addEventListener('mousedown', dehors, true)
    }, 0)
    document.addEventListener('keydown', auClavier)

    return () => {
      window.clearTimeout(minuteur)
      document.removeEventListener('mousedown', dehors, true)
      document.removeEventListener('keydown', auClavier)
    }
  }, [onFermer, declencheur])

  // L'actif est retiré quand l'annuaire sait lequel c'est. S'il l'ignore, mieux
  // vaut tout proposer que d'afficher une liste vide : basculer sur le compte
  // déjà actif ne fait rien de fâcheux.
  const autres = comptes.some((c) => c.actif)
    ? comptes.filter((c) => !c.actif)
    : comptes

  return (
    <div
      ref={cadre}
      role="menu"
      aria-hidden={sortant}
      // Rembourrage horizontal : sans lui, le fond de survol d'une ligne va
      // d'un bord à l'autre et coupe les arrondis du menu.
      className={`${
        sortant ? 'menu-disparait' : 'menu-apparait'
      } absolute bottom-full left-2 z-40 mb-2 rounded-xl border p-1.5`}
      style={{
        // Une largeur fixe, plus généreuse que la barre : « Ajouter un compte
        // Google » passait à la ligne dans les 236 pixels disponibles, et un
        // menu qui déborde d'un cran se lit comme ce qu'il est — une couche
        // par-dessus, pas une partie de la barre.
        width: 268,
        background: 'var(--card)',
        borderColor: 'var(--line)',
        boxShadow: '0 12px 32px rgb(0 0 0 / 22%)',
      }}
    >
      {autres.map((c) => (
        <button
          key={c.adresse}
          type="button"
          role="menuitem"
          onClick={() => onBasculer(c.adresse)}
          className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
        >
          {c.photo ? (
            <img src={c.photo} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
          ) : (
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
              style={{ background: 'var(--sunk)' }}
            >
              <LogoGoogle taille={14} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold">
              {c.nom ?? c.adresse}
            </span>
            {c.nom && (
              <span
                className="block truncate font-mono text-[10px]"
                style={{ color: 'var(--sub)' }}
              >
                {c.adresse}
              </span>
            )}
          </span>
        </button>
      ))}

      {autres.length > 0 && (
        <div className="mx-1 my-1.5 border-t" style={{ borderColor: 'var(--line)' }} />
      )}

      <button
        type="button"
        role="menuitem"
        onClick={onAjouter}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold"
        style={{ color: 'var(--accent-fg)' }}
      >
        <Icone nom="login" taille={16} compenser />
        Ajouter un compte Google
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onParametres}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold"
      >
        <Icone nom="settings" taille={16} compenser style={{ color: 'var(--sub)' }} />
        Paramètres
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onDeconnecter}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold"
        style={{ color: '#C2410C' }}
      >
        <Icone nom="logout" taille={16} compenser />
        Se déconnecter
      </button>
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
      "Rien, dans un message, ne distingue un rappel de cours d'une autre notification : c'est à vous de désigner les expéditeurs à ranger ici. Leurs messages resteront intacts dans Gmail.",
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
      <Icone nom="mail_lock" taille={52} style={{ color: 'var(--sub)', opacity: 0.45 }} />
      <div className="text-[19px] font-semibold tracking-tight">
        Aucun compte Gmail connecté
      </div>
      <p
        className="max-w-md text-[14.5px] leading-relaxed"
        style={{ color: 'var(--sub)' }}
      >
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
