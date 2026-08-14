import type { Regle } from '../types/backend'

/**
 * Met une règle en français.
 *
 * Le miroir exact de `RuleSet::sentence` côté maquette : l'utilisateur doit
 * pouvoir relire ce qu'il a demandé sans traduire du vocabulaire technique.
 */
export function phrase(r: Regle): string {
  const cible = r.nom_affichage || r.expediteur

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
