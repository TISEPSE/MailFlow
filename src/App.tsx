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
import type { EtatSynthese } from './vues/Newsletters'
import { Redaction } from './composants/Redaction'
import {
  brouillonDeTransfert,
  brouillonVierge,
  type Brouillon,
} from './lib/redaction'
import { type Connaissance } from './lib/contacts'
import { Archives } from './vues/Archives'
import { Bienvenue } from './vues/Bienvenue'
import { initiales, ton, type Teintable } from './lib/presentation'
import { creerCache, oublier, ranger, type CacheCorps } from './lib/corps'
import { archivesDuCompte } from './lib/table'
import { useLogos, usePreferences, useToasts } from './lib/crochets'
import { autresQueMoi } from './lib/reponse'
import { grouperNewsletters, phraseDuRapport } from './lib/newsletters'
import type { GroupeNewsletters } from './lib/newsletters'
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
  syntheseProduire,
  EVENEMENT_RESUMES,
  EVENEMENT_PRECHARGEMENT,
  type AvancementResumes,
  EVENEMENT_RELEVE,
  type Avancement,
  comptesLister,
  contactsLister,
  contactsSynchroniser,
  gmailSynchroniser,
  messageCorps,
  googleConnecter,
  googleDeconnecter,
  estErreurBackend,
  messageDErreur,
  archivesLister,
  archivesSynchroniser,
  archiveRetirer,
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
  RapportResumes,
  Resume,
  Tableau,
} from './types/backend'

type Vue = CategorieMessage | 'regles' | 'archives' | 'parametres'

/** Les identifiants des newsletters d'un relevé, dans l'ordre. */
function idsNewsletters(messages: MessageAffiche[]): string[] {
  return messages.filter((m) => m.categorie === 'newsletter').map((m) => m.id)
}

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

  /**
   * Publications dont on sait qu'elles n'ont pas un mot à résumer.
   *
   * Certains expéditeurs mettent tout en pièce jointe — une auto-école qui
   * envoie son planning en PDF laisse un corps entièrement vide. Il n'y a rien
   * à envoyer, et il n'y en aura jamais : la carte doit le dire plutôt que
   * d'offrir un bouton qui ne peut rien faire.
   */
  const [sansTexte, setSansTexte] = useState<ReadonlySet<string>>(new Set())

  /**
   * Ce que la journée a apporté, en trois points — ou la raison nommée pour
   * laquelle il n'y en a pas.
   *
   * Aucun de ces états n'est une panne de MailFlow : une machine sans clé, une
   * page dont aucune publication n'est encore résumée, un modèle qui n'a pas
   * répondu. Mais ils appellent trois gestes différents, et le bandeau ne peut
   * les proposer que s'il sait lequel il regarde. Un `null` unique le
   * condamnait à se taire — et l'on attendait devant lui sans savoir quoi.
   */
  const [synthese, setSynthese] = useState<EtatSynthese>({ quoi: 'chargement' })

  /**
   * Le message en cours d'écriture, ou `null` quand la fenêtre est fermée.
   *
   * Un seul état pour les deux gestes — écrire et transférer — parce que ce
   * sont la même fenêtre avec un contenu de départ différent. Deux états
   * auraient permis d'ouvrir les deux à la fois, ce qui n'a aucun sens.
   */
  const [redaction, setRedaction] = useState<Brouillon | null>(null)

  /**
   * Le carnet d'adresses Google, pour les propositions de la fenêtre de
   * rédaction.
   *
   * Il se déduisait autrefois des messages sous la main, ce qui proposait
   * comme destinataire quiconque avait écrit une fois — robots d'expédition
   * et newsletters compris. Il vient maintenant du carnet que l'utilisateur
   * tient chez Google, relevé au démarrage et rangé sur le disque.
   */
  const [contactsGmail, setContactsGmail] = useState<Connaissance[]>([])

  const carnetDAdresses = contactsGmail

  /** Avancement de la troisième phase, ou `null` quand elle ne tourne pas.
   *
   *  Séparé de `avancement` à dessein : celui-ci pose un écran qui bloque, et
   *  les résumés ne doivent rien bloquer. Ils s'annoncent par une bande sur la
   *  seule page qui les concerne. */
  const [avancementResumes, setAvancementResumes] = useState<AvancementResumes | null>(null)

  /** Fenêtre de recherche, ouverte au raccourci. */
  const [rechercheOuverte, setRechercheOuverte] = useState(false)

  /** Fenêtre d'ajout d'un expéditeur aux rappels de formation. */
  const [ajoutFormation, setAjoutFormation] = useState(false)
  const boutonProfil = useRef<HTMLButtonElement>(null)
  const { logos, chercher: chercherLesLogos, oublier: oublierLesLogos } = useLogos()

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
      if (!messages.length) return null

      setBoite(messages)
      setPremierReleve(false)
      chercherLesLogos(messages)
      // Les messages, et non un simple « oui » : l'appelant en a besoin pour
      // aller chercher leurs résumés sur le disque.
      return messages
    } catch {
      // Cache illisible ou absent : ce n'est pas une panne, on relèvera.
      return null
    }
  }, [chercherLesLogos])

  /**
   * Remet à l'écran les résumés déjà rangés sur le disque.
   *
   * **Aucun appel, aucune dépense** : deux lectures de fichier par publication,
   * et rien de plus. C'est la moitié « lecture » de la troisième phase, séparée
   * de la moitié « production » parce qu'elles n'ont ni le même coût ni le même
   * moment.
   *
   * Elle manquait au chemin du cache — celui que prend tout démarrage après le
   * premier. `chargerLaBoite` y rendait la main avant la troisième phase, si
   * bien que les résumés déjà payés restaient sur le disque sans jamais
   * remonter à l'écran : les cartes reprenaient leur ligne composée localement,
   * et il fallait recliquer « Analyser » pour les revoir.
   */
  const relireLesResumes = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    const connus = await resumesConnus(ids).catch(() => null)
    if (!connus) return
    setResumes(connus.resumes)
    setSansTexte(new Set(connus.sansTexte))
  }, [])

  /**
   * Identifiants des newsletters à l'écran, pour la relecture des résumés.
   *
   * Une référence et non une dépendance : l'écoute des événements est posée au
   * montage et ne doit pas se redéfinir à chaque relevé, sous peine de manquer
   * ce qui passe pendant qu'elle se repose.
   */
  const idsDesNewsletters = useRef<string[]>([])
  useEffect(() => {
    idsDesNewsletters.current = idsNewsletters(boite)
  }, [boite])

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
   * Charge la table des archives.
   *
   * Deux lectures de fichier, aucun réseau : la table porte ce que MailFlow a
   * archivé, et c'est le geste d'archivage qui l'écrit. Elle apparaît donc
   * instantanément, et il n'y a plus rien à attendre ni à annoncer.
   */
  const chargerLesArchives = useCallback(async () => {
    try {
      setTableau(await tableauLire().catch(() => ({ tas: {}, messages: {} })))

      // Le registre d'abord : deux lectures de fichier, la table paraît sans
      // attendre. Puis ce qui a été classé depuis Gmail — un libellé posé
      // depuis le téléphone doit rejoindre la table, sans quoi elle prétendrait
      // classer en ignorant la moitié du classement.
      setArchives(await archivesLister())
    } catch (e) {
      annoncer(messageDErreur(e), true)
      return
    }

    // Le réseau, ensuite et à part : hors ligne, la table doit rester celle du
    // registre plutôt que de disparaître derrière une erreur. Ce qui manque
    // sera repris à la prochaine ouverture.
    try {
      setLibelles(await libellesLister())
      setArchives(await archivesSynchroniser())
    } catch (e) {
      console.warn('classement Gmail non relu', messageDErreur(e))
    }
  }, [annoncer])

  /**
   * Le compte qu'on regarde, et il ne vaut jamais rien.
   *
   * `compteAffiche` ne répond pas à cette question : il ne dit que « a-t-on
   * basculé à la main », et vaut `null` tant qu'on ne l'a pas fait. L'employer
   * comme adresse a vidé la table des archives pour tout le monde — le message
   * archivé était bien sur le disque, la comparaison ne le retenait pas.
   *
   * Le repli suit l'ordre de ce qui fait autorité : le choix explicite, puis le
   * profil du compte connecté, puis le premier compte connu.
   */
  const compteRegarde = useMemo(
    () =>
      (compteAffiche === TOUS_LES_COMPTES ? null : compteAffiche) ??
      profil?.adresse ??
      comptes[0]?.adresse ??
      null,
    [compteAffiche, profil, comptes],
  )

  /** Vrai sous « Tous les comptes » : une vue, pas une boîte. */
  const melange = compteAffiche === TOUS_LES_COMPTES

  /**
   * Les archives du compte qu'on regarde, et d'aucun autre.
   *
   * Une ceinture par-dessus les bretelles : `basculerVers` vide déjà l'état au
   * changement de compte, mais cette liste-là avait justement été oubliée
   * pendant des semaines, et rien ne l'avait signalé. Un filtre au moment de
   * l'affichage rend l'oubli sans conséquence — chaque message porte le compte
   * qui l'a reçu, il suffit de le lire.
   *
   * Sous « Tous les comptes », rien ne passe : la table est cloisonnée par
   * compte jusque dans son fichier de disposition, et les libellés de l'un
   * n'existent pas chez l'autre. Une table mélangée serait une table dont la
   * moitié des gestes échoue.
   */
  const archivesVisibles = useMemo(
    () => (melange ? archives : archivesDuCompte(archives, compteRegarde)),
    [archives, melange, compteRegarde],
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
   * Réunit en trois points ce que les publications ont apporté.
   *
   * # Ce que cela coûte
   *
   * **Un appel, et seulement quand la liste des publications a changé.** Rien
   * n'est relu : la commande part des résumés déjà rangés sur le disque, et
   * rend le cache tant que les mêmes publications portent les mêmes derniers
   * numéros. Ce qui monte vers Google est du texte que nous avons écrit
   * nous-mêmes, déjà expurgé au moment du résumé.
   *
   * # Pourquoi elle ne se déclenche pas toute seule à chaque geste
   *
   * Archiver une newsletter change la liste, donc l'empreinte, donc le cache.
   * Rappelée sur chaque changement, la synthèse serait refaite cinq fois pour
   * cinq mails rangés. Elle est donc rappelée aux deux seuls moments où une
   * dépense est déjà consentie — une passe de résumés — et à l'ouverture de la
   * page quand rien n'est encore affiché.
   *
   * Un échec ne remplace pas ce qui est à l'écran : une synthèse d'il y a dix
   * minutes vaut mieux qu'un bandeau qui se vide sans explication.
   */
  const rafraichirLaSynthese = useCallback(async (messages: MessageAffiche[]) => {
    const newsletters = messages.filter((m) => m.categorie === 'newsletter')
    if (!newsletters.length) {
      setSynthese({ quoi: 'aucun_resume' })
      return
    }

    // Le même regroupement que celui de la page : les rangs envoyés au modèle
    // sont ceux des cartes, et les clés rendues retrouvent donc leur pastille.
    const publications = grouperNewsletters(newsletters)
      .map((g) => ({ cle: g.cle, nom: g.nom, idRecent: g.messages[0]?.id ?? '' }))
      .filter((p) => p.idRecent)

    setSynthese({ quoi: 'chargement' })

    try {
      setSynthese(await syntheseProduire(publications))
    } catch (e) {
      // L'échec cesse de finir dans la console. Il n'y avait que là qu'il se
      // disait, et le bandeau restait vide sans que rien ne l'explique.
      console.warn('synthèse du jour non produite', messageDErreur(e))
      setSynthese({ quoi: 'echec' })
    }
  }, [])

  /**
   * Liste de newsletters pour laquelle une synthèse a déjà été demandée.
   *
   * Sans cette mémoire, une page ouverte sans clé — la commande rend alors
   * `null` — redemanderait à chaque changement de la boîte, indéfiniment.
   */
  const syntheseDemandee = useRef<string | null>(null)

  // À l'ouverture de la page, la synthèse déjà faite reparaît : la commande lit
  // son cache et n'appelle personne tant que les mêmes publications portent les
  // mêmes derniers numéros. On ne redemande que si rien n'est affiché.
  useEffect(() => {
    if (vue !== 'newsletter' || synthese.quoi === 'faite') return

    const liste = boite
      .filter((m) => m.categorie === 'newsletter')
      .map((m) => m.id)
      .join(',')
    if (!liste || syntheseDemandee.current === liste) return

    syntheseDemandee.current = liste
    void rafraichirLaSynthese(boite)
  }, [vue, synthese, boite, rafraichirLaSynthese])

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
  const resumerLesNewsletters = useCallback(
    async (messages: MessageAffiche[]): Promise<RapportResumes | null> => {
      const newsletters = messages.filter((m) => m.categorie === 'newsletter')
      if (!newsletters.length) return null

      // Le regroupement par émetteur est celui de la page — la même fonction
      // que celle qui dessine les cartes. Un appel par publication au lieu d'un
      // par numéro : trente newsletters coûtaient trente appels, et le palier
      // gratuit s'épuisait avant la fin de la page.
      const groupes = grouperNewsletters(newsletters).map((g) => ({
        cle: g.cle,
        // `grouperNewsletters` trie du plus récent au plus ancien, et Rust
        // range le résumé sous le premier : c'est ce qui le périme tout seul
        // quand un numéro plus récent arrive.
        ids: g.messages.map((m) => m.id),
      }))

      const ids = newsletters.map((m) => m.id)
      await relireLesResumes(ids)

      try {
        // La commande empile et rend la main : ce qui suit n'attend donc pas
        // les résumés, il les demande. Ils arrivent un à un, par l'événement
        // d'avancement, à mesure que la file se vide.
        return await resumesProduire(groupes)
      } catch (e) {
        // Un moteur de résumés indisponible ne mérite pas de notification :
        // chaque carte garde sa ligne composée localement.
        console.warn('résumés non demandés', messageDErreur(e))
        return null
      }
    },
    [relireLesResumes],
  )

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

    // L'avancement n'est plus posé ici : c'est la file qui l'annonce, et elle
    // seule sait combien de publications sont réellement à faire. En le
    // devinant, le bandeau affichait « 0 sur 30 » devant trente publications
    // déjà résumées, le temps d'un aller-retour.
    const ids = messages.map((m) => m.id)
    await corpsPrecharger(ids).catch(() => null)

    const rapport = await resumerLesNewsletters(messages)
    if (!rapport) {
      annoncer("L'analyse n'a pas pu démarrer. Consultez le journal.", true)
      return
    }

    annoncer(...phraseDuRapport(rapport))
  }, [boite, annoncer, resumerLesNewsletters])

  /**
   * Résume une seule publication, depuis sa carte.
   *
   * Le même chemin que l'analyse d'ensemble, avec un seul groupe : c'est déjà
   * un appel par publication, il n'y a donc rien de neuf à écrire côté Rust.
   *
   * Ce qui change est le moment. On décide de lire ou non **avant** d'ouvrir :
   * un bouton logé derrière l'ouverture arriverait après la question qu'il
   * devait aider à trancher. Et c'est un appel payé sciemment, pour celle-là
   * seule, plutôt que trente payés d'avance au démarrage.
   */
  const resumerUnGroupe = useCallback(
    async (groupe: GroupeNewsletters) => {
      const ids = groupe.messages.map((m) => m.id)

      const etatLlm = await llmEtat().catch(() => null)
      if (!etatLlm?.cleConfiguree) {
        annoncer('Aucune clé configurée : posez-la dans les Paramètres.', true)
        return
      }

      await corpsPrecharger(ids).catch(() => null)

      try {
        // Une seule publication, mais la même file : elle passera devant si
        // elle est seule, et derrière ce qui attend sinon. Le résumé arrive
        // par l'événement d'avancement, comme les autres.
        const rapport = await resumesProduire([{ cle: groupe.cle, ids }])
        if (rapport.enFile === 0) {
          // Rien n'est parti : soit elle est déjà résumée — la carte le montre
          // et il n'y a rien à dire — soit elle n'a pas un mot à envoyer, et
          // c'est la carte qui le dit désormais, à sa place.
          await relireLesResumes(idsDesNewsletters.current)
        }
      } catch (e) {
        annoncer(messageDErreur(e), true)
      }
    },
    [annoncer, relireLesResumes],
  )

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
    const enCache = await afficherLeCache()
    if (enCache) {
      // Les résumés d'abord, depuis le disque : ils sont là avant même que le
      // relevé ne parte. Puis de nouveau après lui, car il peut avoir apporté
      // un numéro qui en périme un.
      void relireLesResumes(idsNewsletters(enCache))
      void relever().then((messages) => {
        if (messages?.length) void relireLesResumes(idsNewsletters(messages))
      })
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
  }, [relever, afficherLeCache, relireLesResumes, resumerLesNewsletters])

  /**
   * Après « Tout effacer » : l'écran suit le disque, sans redémarrage.
   *
   * L'effacement ne touchait que le disque. La fenêtre continuait d'afficher
   * les messages, les corps et les résumés qu'elle tenait en mémoire — rien ne
   * disait que le geste avait eu lieu, et il fallait redémarrer pour retrouver
   * un état cohérent.
   *
   * Tout ce qui est une **copie** est donc lâché ici, puis le chargement repart
   * du début. Ce qui n'est pas une copie — les comptes, les règles, la
   * disposition des tables — n'a pas été effacé sur le disque et n'a aucune
   * raison de disparaître de l'écran.
   */
  const toutEffacer = useCallback(() => {
    setBoite([])
    setArchives([])
    setCorpsConnus(creerCache)
    setResumes({})
    setSynthese({ quoi: 'chargement' })
    syntheseDemandee.current = null
    oublierLesLogos()
    setPremierReleve(true)
    annoncer('Disque nettoyé. Les messages se rechargent.')
    void chargerLaBoite()
  }, [annoncer, chargerLaBoite, oublierLesLogos])


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
      // Même garde que pour le relevé, et pour la même raison. Sans elle, tout
      // préchargement demandé en cours de route — le bouton « Analyser » des
      // newsletters, par exemple — posait l'écran de chargement du démarrage
      // par-dessus la page qu'on était en train de lire, et faisait tourner
      // toutes les icônes de la barre latérale. Un geste volontaire sur une
      // page ne doit pas ressembler à une ouverture d'application.
      listen<Avancement>(EVENEMENT_PRECHARGEMENT, (e) => {
        if (chargementComplet.current) {
          setAvancement({ ...e.payload, etape: 'corps' })
        }
      }),
      // La file annonce chaque publication traitée, et l'on va aussitôt
      // chercher sur le disque ce qu'elle vient d'y écrire : les résumés
      // paraissent ainsi un à un, sans que personne n'ait à recliquer. Le
      // passage est fini quand le compte est plein — ou quand il n'y a rien à
      // compter, ce qui est le cas d'un arrêt.
      listen<AvancementResumes>(EVENEMENT_RESUMES, (e) => {
        const avancement = e.payload
        const enCours = avancement.total > 0 && avancement.faits < avancement.total
        setAvancementResumes(enCours ? avancement : null)
        void relireLesResumes(idsDesNewsletters.current)

        // La synthèse se refait quand le passage est terminé, et seulement là.
        //
        // C'est ce qui manquait, et c'est ce qui donnait le tableau absurde
        // d'une page où chaque carte portait son résumé pendant que le bandeau
        // du haut affirmait qu'aucune publication n'était résumée : la synthèse
        // avait été demandée **avant** l'analyse, la réponse « aucun résumé »
        // avait été retenue, et `syntheseDemandee` — dont le rôle est
        // justement d'empêcher de redemander pour rien — interdisait de
        // reposer la question. Rien, ensuite, ne la reposait jamais.
        //
        // Le test porte sur un passage réellement achevé et non sur `!enCours` :
        // la file annonce aussi `total: 0` à l'arrêt et au démarrage, et ces
        // deux-là ne valent pas une fin.
        if (avancement.total > 0 && avancement.faits >= avancement.total) {
          syntheseDemandee.current = null
          setSynthese({ quoi: 'chargement' })
        }
      }),
    ]
    return () => {
      for (const arret of arrets) void arret.then((f) => f())
    }
  // `relireLesResumes` ne dépend de rien : son identité ne change jamais, et
  // l'écoute n'est donc posée qu'une fois. La citer ici satisfait la règle sans
  // rien reposer — une écoute qui se réinstalle perd ce qui passe entre-temps.
  }, [relireLesResumes])

  useEffect(() => {
    void rafraichir().then(async (sante) => {
      if (!interrogeable(sante)) return
      setProfil(await compteProfil().catch(() => null))
      // Une seule lecture par session : la liste des libellés bouge rarement,
      // et la relire à chaque relevé dépenserait du quota pour rien.
      setLibelles(await libellesLister().catch(() => []))

      // Le registre des archives, dès le démarrage : deux lectures de fichier
      // et aucun appel réseau.
      setArchives(await archivesLister().catch(() => []))

      // Le carnet rangé sur le disque s'affiche tout de suite ; celui de Google
      // le remplace dès qu'il arrive.
      void contactsLister().then(setContactsGmail).catch(console.warn)
      void contactsSynchroniser()
        .then(setContactsGmail)
        .catch((e) => {
          // Un compte relié avant que MailFlow ne demande les contacts ne peut
          // pas les lire. Sans ce message, l'utilisateur n'aurait qu'un champ
          // de destinataire muet, sans rien à quoi le rattacher.
          if (estErreurBackend(e) && e.code === 'PORTEE_MANQUANTE') {
            annoncer(e.message, true)
            return
          }
          console.warn(e)
        })

      if (lirePreferences().syncAuLancement) {
        await gmailSynchroniser().catch(() => null)
      }
      await chargerLaBoite()
    })
  }, [rafraichir, chargerLaBoite, annoncer])

  /**
   * La table se charge à son ouverture, et se relève à chaque ouverture.
   *
   * Pas au démarrage : payer deux cents appels pour une page qu'on n'ouvrira
   * peut-être pas serait de l'attente offerte à personne.
   *
   * Mais **à chaque fois**, et non la première seule. La page n'a plus de bouton
   * « Relever » — il occupait un en-tête qui répétait la barre latérale, pour un
   * geste que l'application sait faire elle-même. Le cache tient l'écran sans
   * délai pendant que le relevé se fait derrière : on ne voit donc pas
   * l'attente, on voit la table se corriger.
   */
  useEffect(() => {
    if (vue !== 'archives' || !interrogeable(etat)) return
    void chargerLesArchives()
  }, [vue, etat, chargerLesArchives])

  /**
   * Relevé périodique, règles comprises.
   *
   * La fréquence est un réglage, pas une constante : le minuteur se reconstruit
   * quand elle change.
   *
   * # Pourquoi les règles passent aussi par ici
   *
   * Le minuteur ne faisait que relister la boîte. Les règles, elles, ne
   * s'appliquaient qu'au lancement, et seulement si « synchroniser au
   * lancement » était coché. Une règle programmée à 18 h ne se déclenchait donc
   * jamais tant que l'application restait ouverte — c'est-à-dire précisément
   * dans le cas où l'on est devant elle à 18 h. Choisir une heure aurait été
   * une promesse que rien ne tenait.
   *
   * L'échec ne remonte pas à l'écran : c'est un travail de fond, et un bandeau
   * rouge toutes les cinq minutes sur une coupure réseau passagère serait pire
   * que le silence. Le journal Rust, lui, garde tout.
   */
  useEffect(() => {
    if (!interrogeable(etat)) return

    const minuteur = window.setInterval(() => {
      void gmailSynchroniser()
        .catch(() => null)
        .then(() => relever())
    }, MINUTES[prefs.frequence] * 60_000)

    return () => window.clearInterval(minuteur)
  }, [etat, prefs.frequence, relever])

  /**
   * Ouvre la fenêtre de rédaction sur un transfert.
   *
   * Le corps est pris dans le cache quand il y est — c'est le cas dès qu'on a
   * ouvert le message, donc presque toujours. Sinon il est demandé, et la
   * fenêtre attend : l'ouvrir sur l'extrait de deux lignes de Gmail ferait
   * transférer un message tronqué à quelqu'un, et rien ne le signalerait.
   *
   * Un échec n'empêche pas le transfert : la fenêtre s'ouvre alors sur ce que
   * l'on a — l'extrait — plutôt que de refuser un geste que l'utilisateur
   * pourra compléter à la main.
   */
  const transferer = useCallback(
    async (message: MessageAffiche) => {
      const connu = corpsConnus.get(message.id)
      if (connu) {
        setRedaction(brouillonDeTransfert(message, connu))
        return
      }

      const charge = await messageCorps(message.id).catch(() => null)
      if (charge) setCorpsConnus((connus) => ranger(connus, message.id, charge))
      setRedaction(brouillonDeTransfert(message, charge))
    },
    [corpsConnus],
  )

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

  /**
   * Archive un message, et le fait apparaître sur la table dans la foulée.
   *
   * # Pourquoi relire le registre plutôt que d'ajouter la tuile à la main
   *
   * C'est Rust qui décide de ce qui entre au registre — le message est repris
   * du relevé en cache, ses libellés reportés, son classement recalculé.
   * Reconstituer ici la tuile qu'il vient d'écrire, c'est écrire une deuxième
   * fois la même règle, et la voir diverger au premier cas tordu.
   *
   * La relecture n'est pas attendue : le message est déjà rangé chez Gmail, et
   * retenir la notification derrière une lecture de fichier n'apprendrait rien
   * à personne. C'est ce qui met à jour, du même coup, le compteur de la barre
   * latérale et la table qu'on n'a pas encore ouverte.
   */
  const archiverLeMessage = async (id: string, libelle?: string) => {
    await messageRanger(id, libelle)
    retirerDeLaBoite(id)
    void archivesLister()
      .then(setArchives)
      .catch((e) => console.warn('registre des archives non relu', messageDErreur(e)))
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
        // Tout ce qui appartient au compte précédent est lâché ici, et la
        // liste doit rester complète : montrer les messages de l'un sous
        // l'adresse de l'autre n'est pas un défaut d'affichage, c'est une
        // confusion de boîtes. Les archives et la disposition de leur table en
        // font partie — les avoir oubliées faisait apparaître, sur un compte
        // qui n'a jamais rien archivé, les quinze archives du compte d'à côté.
        // Et glisser l'une de ces tuiles envoyait à Gmail l'identifiant d'un
        // message que le compte connecté ne possède pas.
        setBoite([])
        setArchives([])
        setTableau({ tas: {}, messages: {} })
        setResumes({})
        setSynthese({ quoi: 'chargement' })
        syntheseDemandee.current = null
        setPremierReleve(true)
        setCorpsConnus(creerCache())
        setProfil(await compteProfil().catch(() => null))
        setLibelles(await libellesLister().catch(() => []))
        // Le registre du nouveau compte, relu tout de suite : deux lectures de
        // fichier, aucun appel réseau. Sans cette ligne, le compteur de la
        // barre restait à zéro après une bascule — les archives venaient
        // d'être lâchées avec le reste du compte précédent, et rien ne les
        // remplaçait avant qu'on ouvre la table. Le chiffre annonçait donc une
        // table vide devant une table qui ne l'était pas.
        setArchives(await archivesLister().catch(() => []))
        return `Compte actif : ${adresse}.`
      },
      { rechargerTout: true },
    )

  const deconnecter = () =>
    agir(
      async () => {
        await googleDeconnecter()
        setBoite([])
        setArchives([])
        setTableau({ tas: {}, messages: {} })
        setResumes({})
        setSynthese({ quoi: 'chargement' })
        syntheseDemandee.current = null
        setCorpsConnus(creerCache())
        const p = await compteProfil().catch(() => null)
        setProfil(p)
        setLibelles(await libellesLister().catch(() => []))
        setArchives(await archivesLister().catch(() => []))
        setPremierReleve(p !== null)
        return p
          ? `Compte déconnecté. Bascule sur ${p.nom ?? p.adresse}.`
          : 'Compte déconnecté et autorisation révoquée.'
      },
      { rechargerTout: true },
    )

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
   *  Celle qu'on regarde, ou toutes sous « Tous les comptes ». Cette page
   *  portait son propre repli pour le cas où `compteAffiche` n'était pas encore
   *  fixé ; la table des archives ne l'avait pas, et c'est ce qui l'a vidée.
   *  Deux endroits qui répondent à la même question doivent la poser au même
   *  endroit — d'où `compteRegarde`. */
  const comptesDesRegles = useMemo(
    () =>
      melange
        ? comptes.map((c) => c.adresse)
        : compteRegarde
          ? [compteRegarde]
          : [],
    [melange, compteRegarde, comptes],
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
  /** Compte de messages à afficher dans la barre de navigation.
   *
   *  Vaut 0 quand aucun compte n'est connecté : afficher des chiffres alors
   *  qu'on n'a pas de compte est trompeur. */
  const compte = (v: Vue): number => {
    if (!etat?.compteConnecte) return 0
    switch (v) {
      case 'regles':
        return reglesAffichees.length
      case 'parametres':
        return 0
      case 'archives':
        return archivesVisibles.length
      default:
        return parCategorie[v].length
    }
  }

  /** Vrai tant qu'un relevé tourne : chaque entrée de la barre montre alors un
   *  anneau à la place de son décompte. */
  const releveEnCours = Boolean(etat?.compteConnecte && (premierReleve || enRecherche || avancement !== null))


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

          <div className="flex min-h-0 flex-1 gap-3 p-3">
        <nav
          className="flex flex-none flex-col gap-1 rounded-2xl p-3 transition-[width] duration-150"
          style={{
            width: repliee ? '4.5rem' : '15.5rem',
            background: 'var(--side)',
            border: '1px solid var(--line)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <div className="flex items-center justify-between pb-2 pt-1 px-1">
            {!repliee && (
              <span
                className="min-w-0 flex-1 truncate px-2 text-[0.6875rem] font-semibold tracking-wider uppercase"
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
              className="bouton bouton-icone mx-auto h-9 w-9 flex-none rounded-full"
            >
              <Icone nom={repliee ? 'left_panel_open' : 'left_panel_close'} taille="1.125rem" />
            </button>
          </div>

          {/* Écrire vient avant lire. Le bouton est en haut de la barre et non
              dans une vue : on écrit à quelqu'un depuis n'importe où, et
              chercher le geste dans la page où l'on se trouve reviendrait à le
              cacher partout ailleurs. */}
          {interrogeable(etat) && (
            <div className={`pb-2 ${repliee ? 'flex justify-center' : ''}`}>
              <button
                type="button"
                onClick={() => setRedaction(brouillonVierge())}
                title={repliee ? 'Nouveau mail' : undefined}
                aria-label="Écrire un nouveau message"
                className={`bouton bouton-principal flex items-center gap-2.5 rounded-full font-medium transition-all ${
                  repliee ? 'h-10 w-10 justify-center px-0' : 'h-10 w-full px-4 text-[0.8125rem]'
                }`}
              >
                <Icone nom="edit" taille="1.125rem" />
                {!repliee && <span>Nouveau mail</span>}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {NAV.map(({ vue: v, libelle, glyphe }) => {
              const actif = vue === v
              const [solide] = ton(teinteDeLaVue(v), sombre)
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVue(v)}
                  aria-current={actif ? 'page' : undefined}
                  title={
                    repliee
                      ? `${libelle}${releveEnCours ? ' (relevé en cours…)' : ` (${compte(v)})`}`
                      : undefined
                  }
                  className={`group relative flex items-center gap-3 rounded-full py-2.5 transition-all duration-150 hover:brightness-95 ${
                    repliee ? 'justify-center px-0 h-10 w-10 mx-auto' : 'px-3.5 text-left h-10 w-full'
                  }`}
                  style={{
                    background: actif
                      ? 'var(--selection)'
                      : 'transparent',
                    color: actif ? 'var(--accent-fg)' : 'var(--fg)',
                  }}
                  onMouseEnter={(e) => {
                    if (!actif) {
                      e.currentTarget.style.background = `color-mix(in oklab, ${solide} 12%, var(--side))`
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!actif) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <span
                    className="flex flex-none items-center justify-center"
                  >
                    <Icone
                      nom={glyphe}
                      taille="1.25rem"
                      rempli={actif}
                      style={{ color: solide }}
                    />
                    {repliee &&
                      (releveEnCours ? (
                        <span
                          className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
                          style={{ background: solide, color: '#FFFFFF' }}
                        >
                          <Icone nom="progress_activity" taille="0.6875rem" tourne />
                        </span>
                      ) : (
                        compte(v) > 0 && (
                          <span
                            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[0.5625rem] font-semibold shadow-xs"
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
                        className="min-w-0 flex-1 truncate text-xs font-medium"
                        style={{
                          fontWeight: actif ? 600 : 500,
                          color: actif ? 'var(--fg)' : solide,
                        }}
                      >
                        {libelle}
                      </span>
                      <span
                        className="flex flex-none items-center justify-end font-mono text-[0.6875rem] font-medium"
                        style={{
                          color: actif ? 'var(--fg)' : solide,
                          minWidth: 18,
                        }}
                      >
                        {releveEnCours ? (
                          <Icone nom="progress_activity" taille="0.875rem" tourne />
                        ) : (
                          compte(v) > 0 ? (
                            <span
                              className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
                              style={actif
                                ? { background: 'var(--card)', color: 'var(--fg)' }
                                : { background: `color-mix(in oklab, ${solide} 15%, var(--side))`, color: solide }}
                            >
                              {compte(v)}
                            </span>
                          ) : null
                        )}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          {etat?.compteConnecte && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void agir(async () => (await relever(), null))}
                disabled={enCours || premierReleve}
                title={repliee ? 'Actualiser la boîte' : undefined}
                className={`bouton bouton-neutre flex w-full items-center gap-3 rounded-full py-2.5 text-xs font-medium ${
                  repliee ? 'justify-center px-0 h-10 w-10 mx-auto' : 'px-3.5 text-left h-10'
                }`}
              >
                <span className="flex flex-none items-center justify-center">
                  <Icone
                    nom="refresh"
                    taille="1.125rem"
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
            className="relative mt-3 flex items-center gap-1.5 pt-3"
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
                melange={melange}
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

            <button
              ref={boutonProfil}
              type="button"
              onClick={() => setMenuCompte((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuCompte}
              className={`survolable flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-2 transition-all ${
                repliee ? 'justify-center px-0 h-11 w-11 mx-auto' : 'px-2.5 text-left h-12'
              }`}
              title={
                compteAffiche === TOUS_LES_COMPTES
                  ? 'Toutes vos boîtes réunies'
                  : (profil?.adresse ?? undefined)
              }
            >
              {compteAffiche === TOUS_LES_COMPTES ? (
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
                  style={{ background: 'var(--accent-soft)' }}
                >
                  <Icone nom="groups" taille="1.125rem" style={{ color: 'var(--accent-fg)' }} />
                </span>
              ) : (
                <AvatarCompte profil={profil} connecte={etat?.compteConnecte ?? false} />
              )}
              {!repliee && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {compteAffiche === TOUS_LES_COMPTES
                        ? 'Tous les comptes'
                        : (profil?.nom ??
                          (etat?.compteConnecte ? 'Compte Google' : 'Non connecté'))}
                    </span>
                    <span
                      className="block truncate font-mono text-[0.6875rem]"
                      style={{ color: 'var(--sub)' }}
                    >
                      {compteAffiche === TOUS_LES_COMPTES
                        ? `${comptes.length} boîtes réunies`
                        : (profil?.adresse ?? 'aucun compte relié')}
                    </span>
                  </span>
                  <Icone
                    nom="expand_more"
                    taille="1.125rem"
                    style={{
                      color: 'var(--sub)',
                      transform: menuCompte ? 'rotate(180deg)' : undefined,
                      transition: 'transform 160ms ease',
                    }}
                  />
                </>
              )}
            </button>
          </div>
        </nav>

        {/* La fenêtre de rédaction vit à la racine et non dans une vue : elle
            s'ouvre depuis la barre latérale comme depuis un message, et deux
            montages auraient donné deux fenêtres à tenir d'accord. */}
        {redaction && (
          <Redaction
            depart={redaction}
            de={profil?.adresse ?? null}
            carnet={carnetDAdresses}
            logos={logos}
            onFermer={() => setRedaction(null)}
            onEnvoye={(m) => annoncer(m)}
          />
        )}

        <main
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border"
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--line)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
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
              onToutEffacer={toutEffacer}
              melange={melange}
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
              archives={archivesVisibles}
              libelles={libelles}
              compte={compteRegarde}
              comptes={comptes}
              tableau={tableau}
              onTableau={poserSurLaTable}
              sombre={sombre}
              melange={melange}
              corpsConnus={corpsConnus}
              onCorpsCharge={(id, corps) =>
                setCorpsConnus((connus) => ranger(connus, id, corps))
              }
              onTransferer={(m) => void transferer(m)}
              gestes={{
                onRelever: () => void chargerLesArchives(),
                onErreur: (m) => annoncer(m, true),
                onLu: (id) => void marquerLu(id),
                onRetirer: async (id) => {
                  await archiveRetirer(id)
                  setArchives((liste) => liste.filter((m) => m.id !== id))
                  annoncer('Retiré de la table. Le mail reste archivé chez Gmail.')
                },
                onSupprimer: async (id) => {
                  await messageCorbeille(id)
                  // Retirée de la table sans attendre un relevé : la tuile est
                  // sous les yeux de l'utilisateur, et la voir survivre au
                  // geste ferait croire que rien ne s'est passé.
                  setArchives((liste) => liste.filter((m) => m.id !== id))
                  annoncer('Message mis à la corbeille.')
                },
                onTasVide: async (libelle, nom) => {
                  // Le même chemin que « Défaire le tas », sans messages à en
                  // sortir : il n'en reste aucun, c'est précisément la raison
                  // pour laquelle on est ici. Côté Rust, le retrait en lot rend
                  // la main sans rien appeler sur une liste vide, et seul le
                  // libellé part.
                  await tasDefaire(libelle, [])
                  setLibelles((connus) => connus.filter((l) => l.id !== libelle))
                  annoncer(`Le tas « ${nom} » était vide : son libellé a été supprimé de Gmail.`)
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
              onResumerGroupe={resumerUnGroupe}
              sansTexte={sansTexte}
              synthese={synthese}
              onTransferer={(m) => void transferer(m)}
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
                  await archiverLeMessage(id)
                  return 'Newsletter archivée, elle vous attend sur la table.'
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
              onTransferer={(m) => void transferer(m)}
              onCreerLibelle={
                vue === 'humain'
                  ? async (nom) => {
                      setLibelles(await libelleCreer(nom))
                    }
                  : undefined
              }
              // Sur toutes les pages de courrier, et plus seulement les mails
              // directs : jeter était sinon le seul moyen de vider la page des
              // publicités, alors qu'une publicité qu'on veut garder sans la
              // lire se range. Le choix d'un libellé, lui, reste propre aux
              // mails directs — c'est là qu'on classe finement.
              onRanger={(id, libelle) =>
                void agir(async () => {
                  await archiverLeMessage(id, libelle)
                  return 'Mail archivé, il vous attend sur la table.'
                })
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
      className={`${
        sortant ? 'menu-disparait' : 'menu-apparait'
      } absolute bottom-full left-2 z-40 mb-2 rounded-2xl border p-2`}
      style={{
        width: 280,
        background: 'var(--card)',
        borderColor: 'var(--line)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {comptes.length > 1 && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onMelanger}
            aria-current={melange || undefined}
            className="survolable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
          >
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
              style={{ background: 'var(--accent-soft)' }}
            >
              <Icone nom="groups" taille="1.125rem" style={{ color: 'var(--accent-fg)' }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                Tous les comptes
              </span>
              <span className="block truncate font-mono text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
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
          aria-current={(!melange && c.actif) || undefined}
          onClick={() => onBasculer(c.adresse)}
          className="survolable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
        >
          {c.photo ? (
            <img src={c.photo} alt="" className="h-8 w-8 flex-none rounded-full object-cover" />
          ) : (
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
              style={{ background: 'var(--sunk)' }}
            >
              <LogoGoogle taille="1rem" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">
              {c.nom ?? c.adresse}
            </span>
            {c.nom && (
              <span
                className="block truncate font-mono text-[0.6875rem]"
                style={{ color: 'var(--sub)' }}
              >
                {c.adresse}
              </span>
            )}
          </span>
          {!melange && c.actif && (
            <Icone
              nom="check_circle"
              taille="1.125rem"
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
        className="survolable flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium"
        style={{ color: 'var(--accent)' }}
      >
        <Icone nom="login" taille="1.125rem" />
        Ajouter un compte Google
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onParametres}
        className="survolable flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium"
      >
        <Icone nom="settings" taille="1.125rem" style={{ color: 'var(--sub)' }} />
        Paramètres
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={onDeconnecter}
        className="survolable flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-medium"
        style={{ color: '#d93025' }}
      >
        <Icone nom="logout" taille="1.125rem" />
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
