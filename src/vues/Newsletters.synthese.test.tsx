/**
 * Le bandeau de synthèse, éprouvé par la page qui le porte.
 *
 * `Synthese` n'est pas exporté — c'est un détail de la vue, et l'exporter pour
 * le seul besoin d'un test ferait croire à une brique réutilisable. La page
 * entière est donc rendue, ce qui a l'avantage d'éprouver aussi le câblage :
 * c'est précisément là qu'était le défaut, pas dans le bandeau lui-même.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Newsletters } from './Newsletters'
import type { MessageAffiche } from '../types/backend'
import type { EtatSynthese } from './Newsletters'

function message(id: string): MessageAffiche {
  return {
    id,
    nom: 'Lydia',
    adresse: `no-reply@${id}.example`,
    sujet: 'Le numéro du jour',
    extrait: 'Un extrait.',
    date: '2026-08-21T10:00:00Z',
    nonLu: true,
    categorie: 'newsletter',
    compte: 'moi@exemple.fr',
    destinataires: [],
    copies: [],
    libelles: [],
  }
}

function rendre(synthese: EtatSynthese, { analysable = true } = {}) {
  return renderToString(
    <Newsletters
      messages={[message('a'), message('b')]}
      vide={{ icone: 'newspaper', titre: 'Rien', detail: 'Rien' }}
      logos={{}}
      onOuvrir={() => {}}
      onSupprimer={() => {}}
      onArchiver={() => {}}
      corpsConnus={new Map()}
      onCorpsCharge={() => {}}
      resumes={{}}
      synthese={synthese}
      onAnalyser={analysable ? () => {} : undefined}
    />,
  )
}

/** Combien de fois le mot « Analyser » figure sur la page. */
function boutonsAnalyser(html: string): number {
  return html.split('>Analyser<').length - 1
}

describe('bandeau de synthèse', () => {
  it("ne propose qu'un seul bouton « Analyser » quand la synthèse manque", () => {
    // Il y en avait deux : celui de l'en-tête et celui du bandeau explicatif.
    // La même question posée deux fois sur la même carte, dont une seule fois
    // avec la phrase qui l'explique.
    expect(boutonsAnalyser(rendre({ quoi: 'aucun_resume' }))).toBe(1)
  })

  it('dit pourquoi il n y a pas de synthèse, et quoi faire', () => {
    const html = rendre({ quoi: 'aucun_resume' })

    expect(html).toContain("Aucune publication n&#x27;a encore été résumée.")
    expect(html).toContain('lancez l’analyse')
  })

  it("renvoie aux Paramètres quand il n'y a pas de clé, sans proposer d'analyser", () => {
    // Relancer l'analyse rejouerait le même refus : le bouton serait un piège.
    const html = rendre({ quoi: 'sans_cle' })

    expect(html).toContain('Paramètres')
    expect(boutonsAnalyser(html)).toBe(0)
  })

  it('propose de réessayer quand le modèle n a pas répondu', () => {
    const html = rendre({ quoi: 'echec' })

    expect(html).toContain('Réessayer')
  })

  it("montre une attente animée pendant que la synthèse se fait", () => {
    const html = rendre({ quoi: 'chargement' })

    expect(html).toContain('Synthèse en cours')
    // `mouvement-utile` exempte les barres de la neutralisation générale des
    // animations : une barre grise immobile ne se distingue pas d'un écran figé.
    expect(html).toContain('mouvement-utile squelette')
  })

  it('ne laisse pas la carte muette quand la synthèse ne retient rien', () => {
    // Le modèle a répondu, mais tous ses points citaient des publications
    // absentes de la liste envoyée et le tri les a écartés. Sans ce cas, le
    // bandeau n'affichait ni texte ni bouton.
    const html = rendre({
      quoi: 'faite',
      points: [],
      hashtags: [],
      produiteLe: '2026-08-21T07:10:00+02:00',
      publications: 2,
    })

    expect(html).toContain("La synthèse n&#x27;a rien retenu")
    expect(html).toContain('Réessayer')
  })

  it('affiche les points et un seul bouton quand la synthèse est là', () => {
    const html = rendre({
      quoi: 'faite',
      points: [{ texte: 'Trois lettres parlent du même sujet.', sources: [] }],
      hashtags: [],
      produiteLe: '2026-08-21T07:10:00+02:00',
      publications: 2,
    })

    expect(html).toContain('Synthèse du jour')
    expect(boutonsAnalyser(html)).toBe(1)
  })
})
