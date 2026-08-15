import type { ActionRegle, Categorie, Regle } from '../types/backend'

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
    return `Afficher les messages de ${cible} dans « ${VUE_DE_CATEGORIE[r.categorie]} », sans rien y changer.`
  }
  if (r.action === 'supprimer_toujours') {
    return `Supprimer systématiquement les messages de ${cible}.`
  }
  if (r.action === 'generer_resume_et_archiver') {
    return `Résumer puis archiver automatiquement la newsletter ${cible}.`
  }

  const heure = (r.heure_execution ?? '18:00').replace(':', ' h ')
  return r.frequence
    ? `Archiver les messages de ${cible} tous les vendredis à ${heure}.`
    : `Archiver automatiquement les messages de ${cible}.`
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** Construit la règle correspondant à ce que l'utilisateur vient de demander. */
export function nouvelleRegle({
  adresse,
  nom,
  categorie = 'publicite',
  action = 'archiver_automatique',
}: {
  adresse: string
  nom?: string
  categorie?: Categorie
  action?: ActionRegle
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
    // `phrase` annonce le jour et l'heure dès qu'ils existent : les poser sur
    // une suppression ferait dire à l'interface ce qui n'arrivera pas.
    ...(action === 'archiver_automatique'
      ? { frequence: 'tous_les_vendredis' as const, heure_execution: '18:00' }
      : {}),
  }
}
