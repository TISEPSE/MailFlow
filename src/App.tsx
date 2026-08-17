import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Bouton,
  Icone,
  Progression,
  Toasts,
  Vide,
  type EtapeChargement,
} from './composants/base'
import type { NomIcone } from './composants/glyphes'
import { Courrier, type Proposition } from './vues/Courrier'
import { Parametres } from './vues/Parametres'
import { Regles } from './vues/Regles'
import { Newsletters } from './vues/Newsletters'
import { Archives } from './vues/Archives'
import { Bienvenue } from './vues/Bienvenue'
import { initiales, ton, type Teintable } from './lib/presentation'
import { creerCache, oublier, ranger, type CacheCorps } from './lib/corps'
import { useLogos, usePreferences, useToasts } from './lib/crochets'
import { autresQueMoi } from './lib/reponse'
import {
  MINUTES,
  lirePreferences,
  type Frequence,
} from './lib/preferences'
import { LogoGoogle } from './composants/LogoGoogle'
import { Recherche } from './composants/Recherche'
import { ModaleFormation } from './composants/ModaleFormation'
import {
  appHealth,
  boiteEnCache,
  boiteLister,
  boiteMelangee,
  compteAjouter,
  compteBasculer,
  compteOublier,
  compteProfil,
  corpsPrecharger,
  resumesConnus,
  resumesProduire,
  resumesArreter,
  EVENEMENT_RESUMES,
  EVENEMENT_PRECHARGEMENT,
  EVENEMENT_RELEVE,
  type Avancement,
  comptesLister,
  gmailSynchroniser,
  googleConnecter,
  googleDeconnecter,
  messageDErreur,
  archivesEnCache,
  archivesLister,
  libelleCreer,
  libellePoser,
  libelleRetirer,
  libellesLister,
  llmEtat,
  tasDefaire,
  tableauEcrire,
  tableauLire,
  messageMarquerLu,
  messageRanger,
  repondreAuMessage,
  messageCorbeille,
  regleAjouter,
  regleModifier,
  regleBasculer,
  regleSupprimer,
  reglesToutes,
} from './lib/tauri'
import type {
  CategorieMessage,
  EtatApplication,
  MessageAffiche,
  CompteConnu,
  LibelleGmail,
  JeuDeRegles,
  ProfilCompte,
  Regle,
  ReglesDuCompte,
  Resume,
  Tableau,
} from './types/backend'

type Vue = CategorieMessage | 'regles' | 'archives' | 'parametres'

/**
 * Valeur de `compteAffiche` désignant la vue mélangée.
 *
 * Ce n'est pas une adresse : aucun compte ne peut porter ce nom, et la
 * distinction est ainsi impossible à confondre avec un vrai compte.
 */
const TOUS_LES_COMPTES = '\u0000tous'

/** Traduit une vue en clé de couleur.
 *
 *  Les deux vocabulaires ne coïncident pas — la vue s'appelle « regles », le
 *  ton « regle » — et une entrée sans correspondance rendait `TONS[…]`
 *  indéfini : lire `.clair` dessus effaçait toute l'application. */
function teinteDeLaVue(v: Vue): Teintable {
  if (v === 'regles') return 'regle'
  if (v === 'archives') return 'archive'
  if (v === 'parametres') return 'humain'
  return v
}

const NAV: { vue: Vue; libelle: string; glyphe: NomIcone }[] = [
  { vue: 'humain', libelle: 'Mails directs', glyphe: 'person' },
  { vue: 'publicite', libelle: 'Triage & publicités', glyphe: 'sell' },
  { vue: 'newsletter', libelle: 'Newsletters', glyphe: 'newspaper' },
  { vue: 'formation', libelle: 'Rappels de formations', glyphe: 'school' },
  { vue: 'regles', libelle: 'Règles automatiques', glyphe: 'bolt' },
  { vue: 'archives', libelle: 'Archives', glyphe: 'archive' },
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

/**
 * Peut-on interroger Gmail ?
 *
 * Il y faut les deux : un compte relié **et** des identifiants clients. Ne
 * regarder que le premier a produit la panne la plus visible de l'application —
 * un jeton restait dans le trousseau alors que le binaire, lui, n'avait pas
 * d'identifiant client. MailFlow se croyait donc connecté, relevait la boîte à
 * chaque action et toutes les cinq minutes, et chaque tentative échouait sur
 * « configuration invalide ». L'écran finissait couvert de notifications
 * identiques.
 *
 * Sans identifiants, on n'essaie rien : la vue de connexion dit quoi faire.
 */
function interrogeable(sante: EtatApplication | null | undefined): boolean {
  return Boolean(sante?.compteConnecte && sante.clientGoogleConfigure)
}

export default function App() {
  const [etat, setEtat] = useState<EtatApplication | null>(null)
  /** Règles de chaque compte, indexées par adresse.
   *
   *  Une même adresse d'expéditeur peut mériter deux sorts selon la boîte qui
   *  la reçoit : les règles ne sont donc pas communes. `null` tant que rien n'a
   *  encore été lu — distinct d'un utilisateur qui n'a aucune règle. */
  const [reglesParCompte, setReglesParCompte] = useState<Record<
    string,
    Regle[]
  > | null>(null)
  const [boite, setBoite] = useState<MessageAffiche[]>([])
  const [vue, setVue] = useState<Vue>('humain')
  const { prefs, regler } = usePreferences()
  const [profil, setProfil] = useState<ProfilCompte | null>(null)
  const [comptes, setComptes] = useState<CompteConnu[]>([])
  const [libelles, setLibelles] = useState<LibelleGmail[]>([])

  /** Les messages archivés, et où ils sont posés sur la table.
   *
   *  Relevés à part de la boîte : un message archivé n'est, par définition, pas
   *  dans la boîte de réception, et Gmail demande sa propre requête. Ils ne se
   *  chargent qu'à la première ouverture de la page — payer ce relevé au
   *  démarrage pour une page qu'on n'ouvrira peut-être pas serait de l'attente
   *  offerte à personne. */
  const [archives, setArchives] = useState<MessageAffiche[]>([])
  const [tableau, setTableau] = useState<Tableau>({ tas: {}, messages: {} })
  const [archivesDemandees, setArchivesDemandees] = useState(false)

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

  /** Avancement du chargement, `null` quand il n'est pas en cours.
   *
   *  L'étape distingue les deux attentes, que l'écran annonce différemment : le
   *  relevé des messages, puis la préparation de leur contenu. */
  const [avancement, setAvancement] = useState<
    (Avancement & { etape: EtapeChargement }) | null
  >(null)

  /** Compte dont la vue montre le courrier.
   *
   *  Presque toujours le compte actif ; vaut [`TOUS_LES_COMPTES`] quand
   *  l'utilisateur a choisi la vue mélangée, qui n'est pas une boîte mais la
   *  réunion des relevés déjà rangés sur le disque. */
  const [compteAffiche, setCompteAffiche] = useState<string | null>(null)

  /** Vrai pendant toute recherche de messages, écran de chargement ou non.
   *
   *  Le relevé périodique et le bouton « Actualiser » n'ouvrent pas l'écran de
   *  chargement — ils ne doivent pas effacer la boîte sous les yeux de
   *  l'utilisateur — mais ils cherchent bel et bien, et les compteurs affichent
   *  pendant ce temps un total qui n'est plus le bon. */
  const [enRecherche, setEnRecherche] = useState(false)

  /** Vrai pendant un chargement complet, et lui seul.
   *
   *  Le relevé périodique passe par la même commande, donc par le même
   *  événement : sans ce garde-fou, la boîte disparaîtrait toutes les cinq
   *  minutes derrière l'écran de chargement. Une référence et non un état :
   *  l'écoute est posée une fois pour toutes et doit lire la valeur du moment. */
  const chargementComplet = useRef(false)

  /** Message désigné par la recherche, à sélectionner dans sa vue.
   *
   *  Un état à part de la sélection interne de la vue : celle-ci se souvient de
   *  ce qu'on a ouvert, tandis que celui-ci est un ordre venu d'ailleurs. */
  const [messageVise, setMessageVise] = useState<string | null>(null)

  /** Résumés de newsletters déjà produits, par identifiant de message. */
  const [resumes, setResumes] = useState<Record<string, Resume>>({})

  /** Avancement de la troisième phase, ou `null` quand elle ne tourne pas.
   *
   *  Séparé de `avancement` à dessein : celui-ci pose un écran qui bloque, et
   *  les résumés ne doivent rien bloquer. Ils s'annoncent par une bande sur la
   *  seule page qui les concerne. */
  const [avancementResumes, setAvancementResumes] = useState<Avancement | null>(null)

  /** Fenêtre de recherche, ouverte au raccourci. */
  const [rechercheOuverte, setRechercheOuverte] = useState(false)

  /** Fenêtre d'ajout d'un expéditeur aux rappels de formation. */
  const [ajoutFormation, setAjoutFormation] = useState(false)
  const boutonProfil = useRef<HTMLButtonElement>(null)
  const { logos, chercher: chercherLesLogos } = useLogos()

  const { sombre, accent, barreRepliee: repliee } = prefs

  const [enCours, setEnCours] = useState(false)

  const { toasts, annoncer, retirer: retirerToast } = useToasts()

  const rafraichir = useCallback(async () => {
    try {
      const [sante, jeux, connus] = await Promise.all([
        appHealth(),
        reglesToutes().catch(() => [] as ReglesDuCompte[]),
        comptesLister().catch(() => [] as CompteConnu[]),
      ])
      setEtat(sante)
      setReglesParCompte(
        Object.fromEntries(jeux.map((j) => [j.compte, j.regles.automations])),
      )
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

  /** Demande les logos des expéditeurs. Ils partent sur le réseau, et la boîte
   *  doit s'afficher sans les attendre. */
  /**
   * Affiche le dernier relevé rangé sur le disque, sans toucher au réseau.
   *
   * C'est ce qu'on voit à l'ouverture et à chaque bascule de compte : le relevé
   * dure une vingtaine de secondes, et les messages d'il y a dix minutes valent
   * mieux qu'un écran vide pendant ce temps. Le vrai relevé suit et corrige.
   */
  const afficherLeCache = useCallback(async () => {
    try {
      const messages = await boiteEnCache()
      if (!messages.length) return false

      setBoite(messages)
      setPremierReleve(false)
      chercherLesLogos(messages)
      return true
    } catch {
      // Cache illisible ou absent : ce n'est pas une panne, on relèvera.
      return false
    }
  }, [chercherLesLogos])

  const relever = useCallback(async () => {
    setEnRecherche(true)
    try {
      const messages = await boiteLister()
      setBoite(messages)
      setPremierReleve(false)
      chercherLesLogos(messages)
      return messages
    } catch (e) {
      annoncer(messageDErreur(e), true)
      setPremierReleve(false)
      return null
    } finally {
      setEnRecherche(false)
    }
  }, [annoncer, chercherLesLogos])

  /**
   * Charge la table des archives, une fois, à la première ouverture de la page.
   *
   * Le cache d'abord, le réseau ensuite : une table qui met dix secondes à
   * apparaître n'est plus une table, c'est une attente. La disposition suit le
   * même chemin — elle est locale, donc immédiate.
   */
  const chargerLesArchives = useCallback(
    async (forcer = false) => {
      setEnRecherche(true)
      try {
        setTableau(await tableauLire().catch(() => ({ tas: {}, messages: {} })))

        const enCache = await archivesEnCache().catch(() => [])
        if (enCache.length > 0) setArchives(enCache)

        // Le relevé réseau n'est refait que si le cache est vide, ou si
        // l'utilisateur le demande : les archives ne bougent pas d'elles-mêmes,
        // et deux cents messages coûtent deux cents appels.
        if (forcer || enCache.length === 0) {
          setArchives(await archivesLister())
        }
      } catch (e) {
        annoncer(messageDErreur(e), true)
      } finally {
        setEnRecherche(false)
      }
    },
    [annoncer],
  )

  /** Écrit la disposition, et la garde à l'écran sans attendre le disque.
   *
   *  L'écriture est volontairement non attendue : faire patienter la tuile
   *  jusqu'à la fin d'une écriture fichier ferait traîner chaque dépose. */
  const poserSurLaTable = useCallback(
    (suivant: Tableau) => {
      setTableau(suivant)
      void tableauEcrire(suivant).catch((e) =>
        console.warn('disposition non enregistrée', messageDErreur(e)),
      )
    },
    [],
  )

  /**
   * Troisième phase : les résumés des newsletters relevées.
   *
   * Ne concerne que cette catégorie — c'est la garantie, tenue ici et vérifiée
   * côté Rust, qu'aucun message humain ni aucun rappel de formation ne part
   * vers un service tiers.
   *
   * Sans clé configurée la commande rend zéro sans rien tenter : ce n'est pas
   * une panne, et rien ne doit s'afficher. Les résumés déjà sur le disque sont
   * lus d'abord, pour que la page les montre avant même que la phase commence.
   */
  const resumerLesNewsletters = useCallback(async (messages: MessageAffiche[]) => {
    const ids = messages.filter((m) => m.categorie === 'newsletter').map((m) => m.id)
    if (!ids.length) return

    setResumes(await resumesConnus(ids).catch(() => ({})))

    try {
      await resumesProduire(ids)
      setResumes(await resumesConnus(ids).catch(() => ({})))
    } catch (e) {
      // Un moteur de résumés indisponible ne mérite pas de notification :
      // chaque carte garde sa ligne composée localement.
      console.warn('résumés non produits', messageDErreur(e))
    } finally {
      setAvancementResumes(null)
    }
  }, [])

  /**
   * L'analyse relancée à la main, depuis la page Newsletters.
   *
   * # Pourquoi elle existe en plus de la phase automatique
   *
   * La clé se pose presque toujours **après** le premier démarrage : on ouvre
   * l'application, on découvre les résumés, on va chercher une clé, on la colle
   * dans les Paramètres — et la troisième phase est passée depuis longtemps.
   * Sans ce bouton, il fallait redémarrer pour en profiter, sans que rien ne le
   * dise.
   *
   * # Elle parle, là où la phase automatique a le droit de se taire
   *
   * Un démarrage sans clé ne doit rien afficher : l'utilisateur n'a pas demandé
   * d'IA. Mais un bouton sur lequel on vient de cliquer et qui ne produit rien
   * de visible est pire que pas de bouton du tout — on le reclique, et on
   * conclut que l'application est cassée. Les trois issues sont donc dites.
   *
   * Les corps sont préchargés d'abord : `resumes_produire` saute en silence
   * tout message dont le corps manque, et c'est le cas de tout ce qui est
   * arrivé depuis le dernier relevé complet.
   */
  const analyserLesNewsletters = useCallback(async () => {
    const messages = boite.filter((m) => m.categorie === 'newsletter')
    if (!messages.length) {
      annoncer('Aucune newsletter à analyser.')
      return
    }

    const etatLlm = await llmEtat().catch(() => null)
    if (!etatLlm?.cleConfiguree) {
      annoncer('Aucune clé configurée : posez-la dans les Paramètres.', true)
      return
    }

    const ids = messages.map((m) => m.id)
    const avant = Object.keys(await resumesConnus(ids).catch(() => ({}))).length

    setAvancementResumes({ faits: avant, total: ids.length })
    await corpsPrecharger(ids).catch(() => null)
    await resumerLesNewsletters(messages)

    const apres = Object.keys(await resumesConnus(ids).catch(() => ({}))).length
    const produits = apres - avant

    annoncer(
      produits > 0
        ? `${produits} résumé${produits > 1 ? 's' : ''} produit${produits > 1 ? 's' : ''}.`
        : avant === ids.length
          ? 'Toutes les newsletters sont déjà résumées.'
          : "Aucun résumé n'a pu être produit — le journal en dit la raison.",
      produits === 0 && avant < ids.length,
    )
  }, [boite, annoncer, resumerLesNewsletters])

  /** Ouvre la vue mélangée : la réunion des relevés de tous les comptes. */
  const afficherLaVueMelangee = useCallback(async () => {
    setCompteAffiche(TOUS_LES_COMPTES)
    setEnRecherche(true)
    try {
      const messages = await boiteMelangee()
      setBoite(messages)
      setPremierReleve(false)
      chercherLesLogos(messages)
    } catch (e) {
      annoncer(messageDErreur(e), true)
    } finally {
      setEnRecherche(false)
    }
  }, [annoncer, chercherLesLogos])

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
    // Le cache d'abord : s'il a quelque chose à montrer, l'écran de chargement
    // n'a plus lieu d'être et le relevé se fait en arrière-plan.
    const dejaVu = await afficherLeCache()
    if (dejaVu) {
      void relever()
      return
    }

    chargementComplet.current = true
    setAvancement((en) => en ?? { faits: 0, total: 0, etape: 'releve' })
    try {
      const messages = await relever()
      if (!messages?.length) return

      setAvancement({ faits: 0, total: messages.length, etape: 'corps' })
      await corpsPrecharger(messages.map((m) => m.id)).catch(() => null)

      // Troisième phase, lancée sans être attendue : les résumés ont besoin
      // des corps que la phase précédente vient de rapporter, mais rien ne
      // justifie de retenir l'utilisateur devant un écran pendant qu'ils se
      // font. La bande de la page Newsletters s'en charge.
      void resumerLesNewsletters(messages)
    } finally {
      chargementComplet.current = false
      setAvancement(null)
    }
  }, [relever, afficherLeCache, resumerLesNewsletters])

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
    const auClavier = (e: KeyboardEvent) => {
      // `Ctrl` ou `Cmd` selon la plateforme, sans distinguer : les deux
      // ouvrent, et personne n'a jamais les deux à la fois sous le pouce.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toUpperCase() === prefs.toucheRecherche
      ) {
        e.preventDefault()
        setRechercheOuverte(true)
      }
    }
    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  }, [prefs.toucheRecherche])

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
    const arrets = [
      // Le relevé est l'attente la plus longue de l'ouverture : un appel par
      // message. Il se compte, à condition que ce soit bien un chargement
      // complet et non le relevé périodique, qui doit rester invisible.
      listen<Avancement>(EVENEMENT_RELEVE, (e) => {
        if (chargementComplet.current) {
          setAvancement({ ...e.payload, etape: 'releve' })
        }
      }),
      listen<Avancement>(EVENEMENT_PRECHARGEMENT, (e) =>
        setAvancement({ ...e.payload, etape: 'corps' }),
      ),
      listen<Avancement>(EVENEMENT_RESUMES, (e) => setAvancementResumes(e.payload)),
    ]
    return () => {
      for (const arret of arrets) void arret.then((f) => f())
    }
  }, [])

  useEffect(() => {
    void rafraichir().then(async (sante) => {
      if (!interrogeable(sante)) return
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

  /** La table des archives se charge à sa première ouverture, et pas avant.
   *
   *  Payer deux cents appels au démarrage pour une page qu'on n'ouvrira
   *  peut-être pas serait de l'attente offerte à personne. */
  useEffect(() => {
    if (vue !== 'archives' || archivesDemandees || !interrogeable(etat)) return
    setArchivesDemandees(true)
    void chargerLesArchives()
  }, [vue, archivesDemandees, etat, chargerLesArchives])

  /** Relevé périodique. La fréquence est un réglage, pas une constante : le
   *  minuteur se reconstruit quand elle change. */
  useEffect(() => {
    if (!interrogeable(etat)) return
    const minuteur = window.setInterval(
      () => void relever(),
      MINUTES[prefs.frequence] * 60_000,
    )
    return () => window.clearInterval(minuteur)
  }, [etat, prefs.frequence, relever])

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
      if (interrogeable(sante)) {
        if (rechargerTout) await chargerLaBoite()
        else await relever()
      }
      // Toujours, même en cas d'échec : une action qui a posé l'écran de
      // chargement avant d'échouer le laisserait sinon en place, sans fin.
      setAvancement(null)
      setEnCours(false)
    }
  }

  /**
   * Retire un message de la boîte affichée, sans attendre le relevé suivant.
   *
   * Archivé ou mis à la corbeille, il a quitté la boîte : le laisser à l'écran
   * le temps d'un relevé — une vingtaine de secondes — donne à croire que le
   * geste n'a pas été pris en compte, et invite à le refaire. Sa place se
   * referme donc tout de suite, et le relevé qui suit ne fait que confirmer.
   *
   * Son corps quitte le cache du même coup : plusieurs mégaoctets d'images
   * retenus pour un message qu'on ne peut plus ouvrir.
   */
  const retirerDeLaBoite = (id: string) => {
    setBoite((liste) => liste.filter((m) => m.id !== id))
    setCorpsConnus((connus) => oublier(connus, id))
  }

  /** Bascule de compte, partagée par la barre latérale et les Paramètres. */
  const basculerVers = (adresse: string) =>
    agir(
      async () => {
        // Dès le clic, et non après le relevé : la boîte de l'autre compte
        // n'a rien en cache, l'attente est réelle et doit s'annoncer.
        setAvancement({ faits: 0, total: 0, etape: 'releve' })
        setCompteAffiche(adresse)
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
        // L'étape le dit : on n'ouvre pas une boîte, on attend Google dans le
        // navigateur. L'écran de relevé, ici, décrivait autre chose que ce qui
        // se passait — et ne disait pas qu'il fallait finir dans l'onglet.
        setAvancement({ faits: 0, total: 0, etape: 'connexion' })
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

  /** Boîtes dont la page des règles montre le contenu.
   *
   *  Celle qu'on regarde, ou toutes sous « Tous les comptes ». Avant le premier
   *  relevé, `compteAffiche` n'est pas encore fixé : la première boîte connue
   *  fait l'affaire, c'est celle du compte actif. */
  const comptesDesRegles = useMemo(
    () =>
      compteAffiche === TOUS_LES_COMPTES
        ? comptes.map((c) => c.adresse)
        : compteAffiche
          ? [compteAffiche]
          : comptes.slice(0, 1).map((c) => c.adresse),
    [compteAffiche, comptes],
  )

  /** Boîte visée par une règle qu'aucun message ne rattache à un compte. */
  const compteParDefaut = comptesDesRegles[0] ?? ''

  /** Les règles à l'écran, chacune avec la boîte à laquelle elle appartient. */
  const reglesAffichees = useMemo(
    () =>
      comptesDesRegles.flatMap((compte) =>
        (reglesParCompte?.[compte] ?? []).map((regle) => ({ compte, regle })),
      ),
    [comptesDesRegles, reglesParCompte],
  )

  /** Range le jeu que vient de rendre le backend, pour le seul compte touché. */
  const noterLesRegles = (compte: string, jeu: JeuDeRegles) =>
    setReglesParCompte((connues) => ({
      ...connues,
      [compte]: jeu.automations,
    }))

  /** Combien d'éléments porte cette vue.
   *
   *  Des messages pour les vues de courrier, des règles pour la page des
   *  règles, des archives pour la table — c'est ce qu'on veut savoir d'un coup
   *  d'œil dans chaque cas.
   *
   *  Écrit en `switch` et **sans conversion de type**, ce qui n'est pas un
   *  détail de style. La version précédente finissait par
   *  `parCategorie[v as CategorieMessage]`, et cette conversion était un
   *  mensonge : elle affirmait au compilateur que toute vue restante est une
   *  catégorie de message. Le jour où la page des archives est arrivée, la
   *  promesse est devenue fausse, le compilateur n'a rien pu dire, et
   *  `undefined.length` a vidé la fenêtre entière — sans message.
   *
   *  Ici, le `default` ne reçoit que ce que les `case` n'ont pas pris. Ajouter
   *  une vue qui n'est pas une catégorie sans lui donner son `case` ne
   *  compilera pas. */
  const compte = (v: Vue): number => {
    switch (v) {
      case 'regles':
        return reglesAffichees.length
      case 'parametres':
        return 0
      // Zéro tant que la table n'a pas été ouverte : elle ne se charge qu'à sa
      // première visite. La pastille se tait quand le compte est nul, ce qui
      // évite d'affirmer une table vide avant de l'avoir regardée.
      case 'archives':
        return archives.length
      default:
        return parCategorie[v].length
    }
  }

  /** Vrai tant que la boîte se relève : les compteurs ne veulent alors rien dire.
   *
   *  Le relevé demande un appel par message et dure une vingtaine de secondes.
   *  Afficher « 0 » pendant ce temps affirme une boîte vide ; un compteur qui
   *  tourne dit qu'on cherche encore. Les règles, elles, viennent du disque et
   *  sont connues tout de suite : leur compte reste. */
  const releveEnCours = premierReleve || enRecherche || avancement !== null


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

      {rechercheOuverte && etat?.compteConnecte && (
        <Recherche
          messages={boite}
          corps={corpsConnus}
          logos={logos}
          sombre={sombre}
          onFermer={() => setRechercheOuverte(false)}
          onOuvrir={(m) => {
            setVue(m.categorie)
            setMessageVise(m.id)
            setRechercheOuverte(false)
          }}
        />
      )}

      {/* Pleine fenêtre, barre de navigation comprise : le guide explique
          justement à quoi elle sert, et la laisser visible derrière lui
          faisait doublon avec sa propre illustration. */}
      {!prefs.guideVu ? (
        <Bienvenue
          sombre={sombre}
          onTerminer={() => regler({ guideVu: true })}
          compteConnecte={etat?.compteConnecte ?? false}
          onConnecter={() =>
            void agir(
              async () => {
                setAvancement({ faits: 0, total: 0, etape: 'connexion' })
                await googleConnecter()
                setPremierReleve(true)
                return 'Compte Google relié.'
              },
              { rechargerTout: true },
            )
          }
        />
      ) : (
        <>
      {ajoutFormation && (
        <ModaleFormation
          expediteurs={boite}
          compteParDefaut={compteParDefaut}
          sombre={sombre}
          onFermer={() => setAjoutFormation(false)}
          onValider={async (compte, r) => {
            setAjoutFormation(false)
            await agir(async () => {
              noterLesRegles(compte, await regleAjouter(compte, r))
              return `${r.nom_affichage || r.expediteur} rejoint les rappels de formation.`
            })
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex flex-none flex-col gap-0.5 border-r p-3 transition-[width] duration-150"
          style={{
            // En `rem`, comme le reste de la mise en page : la barre suit la
            // taille de police du système au lieu de rester figée à côté d'un
            // texte qui grandit.
            //
            // Repliée, 4,5 rem et pas moins : ôtez le rembourrage de chaque
            // côté et celui de l'entrée, il ne reste que la place de l'icône.
            // En deçà, elle débordait, et la pastille active le montrait.
            width: repliee ? '4.25rem' : '14.5rem',
            background: 'var(--side)',
            borderColor: 'var(--line)',
          }}
        >
          <div className="flex items-center gap-1 pt-1 pb-3">
            {!repliee && (
              <span
                className="min-w-0 flex-1 truncate px-2.5 text-[0.6875rem] font-semibold tracking-wider uppercase"
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
              <Icone nom={repliee ? 'left_panel_open' : 'left_panel_close'} taille="1.125rem" />
            </button>
          </div>

          {NAV.map(({ vue: v, libelle, glyphe }) => {
            const actif = vue === v
            const [solide, doux] = ton(teinteDeLaVue(v), sombre)
            return (
              <button
                key={v}
                type="button"
                onClick={() => setVue(v)}
                aria-current={actif ? 'page' : undefined}
                // Repliée, la barre garde le libellé en infobulle : une icône
                // seule ne dit pas ce qu'elle range.
                title={
                  repliee
                    ? `${libelle}${v !== 'regles' && releveEnCours ? ' — relevé en cours…' : ` (${compte(v)})`}`
                    : undefined
                }
                className={`survolable flex items-center gap-3 rounded-lg py-2 ${
                  repliee ? 'justify-center px-0' : 'px-2.5 text-left'
                }`}
                style={actif ? { background: 'var(--card)' } : undefined}
              >
                <span
                  className="relative flex h-7 w-7 flex-none items-center justify-center rounded-[0.5625rem]"
                  style={{ background: actif ? solide : doux }}
                >
                  <Icone
                    nom={glyphe}
                    taille="1rem"
                    rempli={actif}
                    style={{ color: actif ? '#FFFFFF' : solide }}
                  />
                  {repliee &&
                    (v !== 'regles' && releveEnCours ? (
                      <span
                        className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full"
                        style={{ background: solide, color: '#FFFFFF' }}
                      >
                        <Icone nom="progress_activity" taille="0.6875rem" tourne />
                      </span>
                    ) : (
                      compte(v) > 0 && (
                        <span
                          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[0.5625rem] font-semibold"
                          style={{ background: solide, color: '#FFFFFF' }}
                        >
                          {compte(v)}
                        </span>
                      )
                    ))}
                </span>
                {!repliee && (
                  <>
                    <span
                      className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium"
                      style={{ color: actif ? 'var(--fg)' : 'var(--sub)' }}
                    >
                      {libelle}
                    </span>
                    <span
                      className="flex flex-none items-center justify-end font-mono text-[0.6875rem]"
                      // Largeur réservée : sans elle, le passage du compteur à
                      // l'anneau décalait le libellé au moment du relevé.
                      style={{ color: actif ? solide : 'var(--sub)', minWidth: 16 }}
                    >
                      {v !== 'regles' && releveEnCours ? (
                        <Icone nom="progress_activity" taille="0.8125rem" tourne />
                      ) : (
                        compte(v)
                      )}
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
                className={`bouton bouton-doux flex w-full items-center gap-3 rounded-lg py-2 text-[0.8125rem] font-semibold ${
                  repliee ? 'justify-center px-0' : 'px-2.5 text-left'
                }`}
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center">
                  <Icone
                    nom="refresh"
                    taille="1rem"
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
                melange={compteAffiche === TOUS_LES_COMPTES}
                onMelanger={() => {
                  setMenuCompte(false)
                  void afficherLaVueMelangee()
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
              title={
                compteAffiche === TOUS_LES_COMPTES
                  ? 'Toutes vos boîtes réunies'
                  : (profil?.adresse ?? undefined)
              }
            >
              {/* La vue mélangée a sa propre marque : sans elle, le profil
                  affichait le compte actif alors que la liste montrait tout,
                  et rien ne disait où l'on se trouvait. */}
              {compteAffiche === TOUS_LES_COMPTES ? (
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
                  style={{ background: 'var(--accent-soft)' }}
                >
                  <Icone nom="groups" taille="0.9375rem" style={{ color: 'var(--accent-fg)' }} />
                </span>
              ) : (
                <AvatarCompte profil={profil} connecte={etat?.compteConnecte ?? false} />
              )}
              {!repliee && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.75rem] font-semibold">
                      {compteAffiche === TOUS_LES_COMPTES
                        ? 'Tous les comptes'
                        : (profil?.nom ??
                          (etat?.compteConnecte ? 'Compte Google' : 'Non connecté'))}
                    </span>
                    <span
                      className="block truncate font-mono text-[0.625rem]"
                      style={{ color: 'var(--sub)' }}
                    >
                      {compteAffiche === TOUS_LES_COMPTES
                        ? `${comptes.length} boîtes réunies`
                        : (profil?.adresse ?? 'aucun compte relié')}
                    </span>
                  </span>
                  <Icone
                    nom="expand_more"
                    taille="1rem"
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
            <Progression
              faits={avancement.faits}
              total={avancement.total}
              etape={avancement.etape}
            />
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
              destinatairesDeplies={prefs.destinatairesDeplies}
              onDestinatairesDeplies={() =>
                regler({ destinatairesDeplies: !prefs.destinatairesDeplies })
              }
              frequence={prefs.frequence}
              onFrequence={(f: Frequence) => regler({ frequence: f })}
              onRevoirLeGuide={() => regler({ guideVu: false })}
              melange={compteAffiche === TOUS_LES_COMPTES}
              onMelanger={() => void afficherLaVueMelangee()}
              toucheRecherche={prefs.toucheRecherche}
              onToucheRecherche={(t) => regler({ toucheRecherche: t })}
              onErreur={(m) => annoncer(m, true)}
              enCours={enCours}
              // Même traitement qu'un ajout de compte : l'écran de chargement
              // dès le clic, puis la boîte entière, corps compris. Sans le
              // rechargement complet, les corps n'étaient jamais préchargés et
              // le squelette réapparaissait à l'ouverture de chaque message.
              onConnecter={() =>
                void agir(
                  async () => {
                    setAvancement({ faits: 0, total: 0, etape: 'connexion' })
                    await googleConnecter()
                    setPremierReleve(true)
                    setProfil(await compteProfil().catch(() => null))
                    setLibelles(await libellesLister().catch(() => []))
                    return 'Compte Gmail connecté.'
                  },
                  { rechargerTout: true },
                )
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
              regles={reglesAffichees}
              comptes={comptesDesRegles}
              expediteurs={boite}
              libelles={libelles}
              sombre={sombre}
              onBasculer={(compte, id) =>
                agir(async () => {
                  noterLesRegles(compte, await regleBasculer(compte, id))
                  return null
                })
              }
              onSupprimer={(compte, id) =>
                agir(async () => {
                  noterLesRegles(compte, await regleSupprimer(compte, id))
                  return 'Règle supprimée.'
                })
              }
              onCreerRegle={(compte, r) =>
                agir(async () => {
                  noterLesRegles(compte, await regleAjouter(compte, r))
                  return `Règle créée pour ${r.nom_affichage || r.expediteur}.`
                })
              }
              onModifierRegle={(compte, id, r) =>
                agir(async () => {
                  noterLesRegles(compte, await regleModifier(compte, id, r))
                  return `Règle modifiée pour ${r.nom_affichage || r.expediteur}.`
                })
              }
            />
          ) : vue === 'archives' ? (
            <Archives
              archives={archives}
              libelles={libelles}
              tableau={tableau}
              onTableau={poserSurLaTable}
              sombre={sombre}
              enCours={enRecherche}
              corpsConnus={corpsConnus}
              onCorpsCharge={(id, corps) =>
                setCorpsConnus((connus) => ranger(connus, id, corps))
              }
              gestes={{
                onRelever: () => void chargerLesArchives(true),
                onErreur: (m) => annoncer(m, true),
                onLu: (id) => void marquerLu(id),
                onSupprimer: async (id) => {
                  await messageCorbeille(id)
                  // Retirée de la table sans attendre un relevé : la tuile est
                  // sous les yeux de l'utilisateur, et la voir survivre au
                  // geste ferait croire que rien ne s'est passé.
                  setArchives((liste) => liste.filter((m) => m.id !== id))
                  annoncer('Message mis à la corbeille.')
                },
                onDefaireLeTas: async (libelle, messages) => {
                  await tasDefaire(libelle, messages)

                  // Les tuiles s'éparpillent d'elles-mêmes : privées de ce
                  // libellé, elles retombent dans « seuls » par le seul jeu de
                  // `repartir`. Rien de plus n'est à écrire pour cela.
                  setArchives((liste) =>
                    liste.map((m) =>
                      messages.includes(m.id)
                        ? { ...m, libelles: (m.libelles ?? []).filter((l) => l !== libelle) }
                        : m,
                    ),
                  )
                  setLibelles((connus) => connus.filter((l) => l.id !== libelle))
                  annoncer('Tas défait.')
                },
                onCreerLibelle: async (nom) => {
                  const aJour = await libelleCreer(nom)
                  setLibelles(aJour)
                  return aJour
                },
                onDeposer: async (message, libelle) => {
                  await libellePoser(message, libelle)
                  // L'archive est mise à jour sur place : relever à nouveau
                  // pour un seul libellé coûterait deux cents appels, et la
                  // tuile resterait immobile pendant tout ce temps.
                  setArchives((liste) =>
                    liste.map((m) =>
                      m.id === message && !(m.libelles ?? []).includes(libelle)
                        ? { ...m, libelles: [...(m.libelles ?? []), libelle] }
                        : m,
                    ),
                  )
                },
                onSortir: async (message, libelle) => {
                  await libelleRetirer(message, libelle)
                  setArchives((liste) =>
                    liste.map((m) =>
                      m.id === message
                        ? {
                            ...m,
                            libelles: (m.libelles ?? []).filter((l) => l !== libelle),
                          }
                        : m,
                    ),
                  )
                },
              }}
            />
          ) : vue === 'newsletter' ? (
            <Newsletters
              messages={parCategorie.newsletter}
              chargement={premierReleve}
              resumes={resumes}
              avancementResumes={avancementResumes}
              onArreterResumes={() => void resumesArreter()}
              onAnalyser={() => void analyserLesNewsletters()}
              vise={messageVise}
              onVise={() => setMessageVise(null)}
              logos={logos}
              vide={VIDES.newsletter}
              onOuvrir={(id) => void marquerLu(id)}
              corpsConnus={corpsConnus}
              onCorpsCharge={(id, corps) =>
                setCorpsConnus((connus) => ranger(connus, id, corps))
              }
              onArchiver={(id) =>
                void agir(async () => {
                  await messageRanger(id, undefined)
                  retirerDeLaBoite(id)
                  return 'Newsletter archivée.'
                })
              }
              onSupprimer={(id) =>
                void agir(async () => {
                  await messageCorbeille(id)
                  retirerDeLaBoite(id)
                  return 'Newsletter mise à la corbeille.'
                })
              }
            />
          ) : (
            <Courrier
              messages={parCategorie[vue]}
              chargement={premierReleve}
              vise={messageVise}
              onVise={() => setMessageVise(null)}
              comptes={compteAffiche === TOUS_LES_COMPTES ? comptes : undefined}
              regles={reglesParCompte ?? {}}
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
                  ? (m, tous) =>
                      void agir(async () => {
                        await repondreAuMessage(
                          m.adresse,
                          m.sujet,
                          tous ? autresQueMoi(m, profil?.adresse) : [],
                        )
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
                        retirerDeLaBoite(id)
                        return 'Message archivé.'
                      })
                  : undefined
              }
              onSupprimer={(id) =>
                void agir(async () => {
                  await messageCorbeille(id)
                  retirerDeLaBoite(id)
                  return 'Message mis à la corbeille.'
                })
              }
              onCopier={(adresse) => annoncer(`${adresse} copiée.`)}
              onCreerRegle={(compte, r) =>
                agir(async () => {
                  noterLesRegles(compte, await regleAjouter(compte, r))
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
                        // Sans conversion : le nom est vérifié par le
                        // compilateur, comme partout ailleurs. Une conversion
                        // ici cacherait une icône inexistante, qui
                        // s'afficherait vide sans lever la moindre erreur.
                        icone: 'playlist_add_check',
                        onClick: () => setAjoutFormation(true),
                      },
                    }
                  : VIDES[vue]
              }
            />
          )}
        </main>
      </div>
        </>
      )}
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
  onMelanger,
  melange,
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
  /** Ouvre la vue qui réunit les boîtes de tous les comptes. */
  onMelanger: () => void
  /** Vrai quand cette vue est déjà celle qu'on regarde. */
  melange: boolean
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

  // Tous les comptes sont proposés, y compris celui qu'on regarde — marqué,
  // pas caché.
  //
  // Le retirer de la liste paraissait logique tant que le menu ne servait qu'à
  // aller ailleurs. Depuis la vue mélangée, cela le rendait inatteignable :
  // trois comptes reliés, deux dans la liste, et aucun moyen de revenir au
  // troisième seul. Une liste qui compte moins d'entrées que de comptes se lit
  // d'ailleurs comme un compte perdu.

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
      {/* Le compte fictif, en tête et seulement à plusieurs : à un compte, la
          vue mélangée montrerait exactement la même chose que la boîte. */}
      {comptes.length > 1 && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onMelanger}
            aria-current={melange || undefined}
            className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
          >
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
              style={{ background: 'var(--accent-soft)' }}
            >
              <Icone nom="groups" taille="0.9375rem" style={{ color: 'var(--accent-fg)' }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.7812rem] font-semibold">
                Tous les comptes
              </span>
              <span className="block truncate text-[0.625rem]" style={{ color: 'var(--sub)' }}>
                {comptes.length} boîtes réunies
              </span>
            </span>
          </button>
          <div className="mx-1 my-1.5 border-t" style={{ borderColor: 'var(--line)' }} />
        </>
      )}

      {comptes.map((c) => (
        <button
          key={c.adresse}
          type="button"
          role="menuitem"
          // « Celui qu'on regarde » et non « l'actif » : en vue mélangée on
          // regarde tout, et aucune ligne ne doit alors se prétendre courante.
          aria-current={(!melange && c.actif) || undefined}
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
              <LogoGoogle taille="0.875rem" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.7812rem] font-semibold">
              {c.nom ?? c.adresse}
            </span>
            {c.nom && (
              <span
                className="block truncate font-mono text-[0.625rem]"
                style={{ color: 'var(--sub)' }}
              >
                {c.adresse}
              </span>
            )}
          </span>
          {!melange && c.actif && (
            <Icone
              nom="check_circle"
              taille="1rem"
              rempli
              style={{ color: 'var(--accent-fg)' }}
            />
          )}
        </button>
      ))}

      {comptes.length > 0 && (
        <div className="mx-1 my-1.5 border-t" style={{ borderColor: 'var(--line)' }} />
      )}

      <button
        type="button"
        role="menuitem"
        onClick={onAjouter}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.7812rem] font-semibold"
        style={{ color: 'var(--accent-fg)' }}
      >
        <Icone nom="login" taille="1rem" compenser />
        Ajouter un compte Google
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onParametres}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.7812rem] font-semibold"
      >
        <Icone nom="settings" taille="1rem" compenser style={{ color: 'var(--sub)' }} />
        Paramètres
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onDeconnecter}
        className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.7812rem] font-semibold"
        style={{ color: '#C2410C' }}
      >
        <Icone nom="logout" taille="1rem" compenser />
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
        <LogoGoogle taille="1.0625rem" />
      </div>
    )
  }

  return (
    <div
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[0.6875rem] font-semibold"
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
      <Icone nom="mail_lock" taille="3.25rem" style={{ color: 'var(--sub)', opacity: 0.45 }} />
      <div className="text-[1.1875rem] font-semibold tracking-tight">
        Aucun compte Gmail connecté
      </div>
      <p
        className="max-w-md text-[0.9062rem] leading-relaxed"
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
