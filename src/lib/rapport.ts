import type { RapportExecution } from '../types/backend'

/** « 1 message », « 4 messages ». */
function messages(nombre: number): string {
  return `${nombre} message${nombre > 1 ? 's' : ''}`
}

/**
 * Met un rapport de synchronisation en une phrase lisible.
 *
 * Le public visé ne compte pas des appels d'API : il veut savoir ce qui est
 * arrivé à son courrier, et si quelque chose a échoué.
 */
export function resumerRapport(rapport: RapportExecution): string {
  const faits: string[] = []

  if (rapport.archives > 0) {
    faits.push(`${messages(rapport.archives)} archivé${rapport.archives > 1 ? 's' : ''}`)
  }
  if (rapport.misALaCorbeille > 0) {
    faits.push(
      `${messages(rapport.misALaCorbeille)} mis${rapport.misALaCorbeille > 1 ? '' : ''} à la corbeille`,
    )
  }

  // Les échecs ne sont jamais tus : un rapport silencieux laisserait croire que
  // tout est passé.
  const echecs =
    rapport.echecs > 0
      ? `${rapport.echecs} action${rapport.echecs > 1 ? 's ont' : ' a'} échoué.`
      : ''

  if (faits.length === 0) {
    return echecs || "Rien à faire : aucun message ne correspondait à vos règles."
  }

  return [`${faits.join(', ')}.`, echecs].filter(Boolean).join(' ')
}
