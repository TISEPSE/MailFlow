import type { ActionRegle, Categorie, FrequenceRegle, Regle } from '../types/backend'

/**
 * Met une règle en français.
 *
 * Le miroir exact de `RuleSet::sentence` côté maquette : l'utilisateur doit
 * pouvoir relire ce qu'il a demandé sans traduire du vocabulaire technique.
 */
/**
 * Nom de la vue où une catégorie range les messages.
 *
 * Distinct de `LIBELLE_CATEGORIE`, qui nomme l'étiquette d'un message : la
 * phrase d'une règle désigne une destination, et l'utilisateur doit reconnaître
 * l'entrée de la barre latérale où il ira les lire.
 */
export const VUE_DE_CATEGORIE: Record<Categorie, string> = {
  humain: 'Mails directs',
  publicite: 'Triage & publicités',
  newsletter: 'Newsletters',
  formation: 'Rappels de formations',
}

export function phrase(r: Regle): string {
  const cible = r.nom_affichage || r.expediteur

  if (r.action === 'classer_seulement') {
    // « sans rien y changer » ne disait rien : ni ce qui change, ni où. La
    // phrase nomme donc les deux choses que l'utilisateur veut savoir — dans
    // quelle page de MailFlow il les retrouvera, et ce que Gmail en fait, à
    // savoir rien : le message reste en boîte de réception, ni archivé ni lu.
    return `Afficher les messages de ${cible} dans « ${VUE_DE_CATEGORIE[r.categorie]} ». Ils restent dans la boîte de réception Gmail.`
  }
  if (r.action === 'supprimer_toujours') {
    return `Supprimer systématiquement les messages de ${cible}.`
  }
  if (r.action === 'generer_resume_et_archiver') {
    return `Résumer puis archiver automatiquement la newsletter ${cible}.`
  }

  return r.frequence
    ? `Archiver les messages de ${cible} ${quand(r.frequence, r.heure_execution)}.`
    : `Archiver automatiquement les messages de ${cible}.`
}

/** Le nom que porte chaque fréquence dans la phrase d'une règle. */
const CADENCE: Record<FrequenceRegle, string> = {
  quotidienne: 'tous les jours',
  lundi: 'tous les lundis',
  mardi: 'tous les mardis',
  mercredi: 'tous les mercredis',
  jeudi: 'tous les jeudis',
  vendredi: 'tous les vendredis',
  samedi: 'tous les samedis',
  dimanche: 'tous les dimanches',
}

/** Le nom que porte chaque fréquence dans un menu, où le sujet est déjà connu. */
export const LIBELLE_FREQUENCE: Record<FrequenceRegle, string> = {
  quotidienne: 'Tous les jours',
  lundi: 'Tous les lundis',
  mardi: 'Tous les mardis',
  mercredi: 'Tous les mercredis',
  jeudi: 'Tous les jeudis',
  vendredi: 'Tous les vendredis',
  samedi: 'Tous les samedis',
  dimanche: 'Tous les dimanches',
}

/** Les fréquences dans l'ordre du menu : la quotidienne, puis la semaine. */
export const FREQUENCES_REGLE: FrequenceRegle[] = [
  'quotidienne',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
]

/** Heure proposée d'emblée quand on programme un archivage. */
export const HEURE_PAR_DEFAUT = '18:00'

/**
 * Quand la règle passera à l'acte, en toutes lettres.
 *
 * L'heure absente n'est pas remplacée par une heure inventée : le moteur, dans
 * ce cas, agit au premier passage du bon jour, et c'est cela qu'il faut dire.
 * Écrire « à 18 h » là où rien n'a été choisi ferait attendre l'utilisateur
 * devant une heure qui n'existe pas.
 */
export function quand(frequence: FrequenceRegle, heure?: string): string {
  const cadence = CADENCE[frequence] ?? 'tous les jours'
  return heure ? `${cadence} à ${heure.replace(':', ' h ')}` : cadence
}

/**
 * Identifiant d'une règle.
 *
 * Dérivé de l'adresse : il est donc stable et unique sans compteur, et reste
 * lisible dans `regles.json`, que l'utilisateur avancé peut ouvrir. Deux ajouts
 * pour la même adresse portent le même identifiant, ce qui remplace la règle au
 * lieu d'en empiler une seconde qui la contredirait.
 */
export function identifiant(adresse: string): string {
  return `rule_${adresse.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '_')}`
}

/**
 * L'adresse peut-elle désigner quelqu'un ?
 *
 * Contrôle volontairement grossier : il ne s'agit pas de valider la RFC 5322,
 * mais d'empêcher une règle qui ne se déclencherait jamais alors que
 * l'utilisateur croirait avoir agi.
 */
export function adresseValide(adresse: string): boolean {
  const v = adresse.trim()

  // `@linkedin.com` vise le domaine entier — la seule façon d'attraper un
  // expéditeur qui écrit depuis dix adresses différentes. Sans ce cas, la
  // saisie était refusée et la règle de domaine restait impossible à poser
  // depuis l'interface, alors que le backend la comprend.
  if (v.startsWith('@')) return /^@[^\s@]+\.[^\s@]+$/.test(v)

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** Construit la règle correspondant à ce que l'utilisateur vient de demander. */
export function nouvelleRegle({
  adresse,
  nom,
  categorie = 'publicite',
  action = 'archiver_automatique',
  frequence,
  heure,
}: {
  adresse: string
  nom?: string
  categorie?: Categorie
  action?: ActionRegle
  /** Absente : l'archivage a lieu dès que le message est vu. */
  frequence?: FrequenceRegle
  /** `HH:MM`. Sans objet sans fréquence. */
  heure?: string
}): Regle {
  const expediteur = adresse.trim().toLowerCase()

  return {
    id: identifiant(expediteur),
    expediteur,
    // Le domaine se relit mieux que l'adresse entière dans la phrase de la
    // règle, et c'est lui qui identifie l'organisme.
    nom_affichage: nom?.trim() || (expediteur.split('@')[1] ?? expediteur),
    categorie,
    action,
    active: true,
    date_ajout: new Date().toISOString().slice(0, 10),
    // Rien n'est programmé d'office. La règle posait auparavant « vendredi
    // 18 h » sans le dire : une adresse ajoutée un lundi restait donc quatre
    // jours en boîte, et rien à l'écran n'expliquait pourquoi. L'archivage est
    // désormais immédiat par défaut, et la programmation est un choix qu'on
    // fait, pas un réglage qu'on subit.
    ...(action === 'archiver_automatique' && frequence
      ? { frequence, heure_execution: heure ?? HEURE_PAR_DEFAUT }
      : {}),
  }
}
