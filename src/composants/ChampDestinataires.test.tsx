/**
 * Le champ de destinataires, éprouvé sans interface.
 *
 * `renderToString` ne rejoue ni les frappes ni les clics : ce qui se vérifie
 * ici, c'est l'image de départ. Le classement et le filtrage, eux, sont éprouvés
 * là où ils vivent — `lib/contacts` — plutôt qu'à travers le rendu.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ChampDestinataires } from './ChampDestinataires'
import type { Connaissance } from '../lib/contacts'

const CARNET: Connaissance[] = [
  { adresse: 'alice@exemple.fr', nom: 'Alice Martin', photo: null, origine: 'carnet' },
  { adresse: 'bob@exemple.fr', nom: 'Bob Dupont', photo: null, origine: 'carnet' },
]

function rendre(valeur: string) {
  return renderToString(
    <ChampDestinataires
      valeur={valeur}
      onChange={() => {}}
      carnet={CARNET}
      libelle="Destinataires"
      placeholder="Un nom ou une adresse"
    />,
  )
}

describe('ChampDestinataires', () => {
  it("montre le repère du champ tant qu'il est vide", () => {
    const html = rendre('')

    expect(html).toContain('aria-label="Destinataires"')
    expect(html).toContain('Un nom ou une adresse')
  })

  it('fait une pastille de chaque adresse retenue', () => {
    const html = rendre('alice@exemple.fr, bob@exemple.fr')

    expect(html).toContain('alice@exemple.fr')
    expect(html).toContain('bob@exemple.fr')
    // Chaque pastille porte de quoi la retirer, nommée : viser une croix de
    // huit pixels sans savoir ce qu'elle enlève n'est pas une interface.
    expect(html).toContain('aria-label="Retirer alice@exemple.fr"')
    expect(html).toContain('aria-label="Retirer bob@exemple.fr"')
  })

  it("efface le repère dès qu'une adresse est là", () => {
    // Sinon il s'affiche à côté des pastilles et se lit comme un champ vide.
    expect(rendre('alice@exemple.fr')).not.toContain('Un nom ou une adresse')
  })

  it('ne déroule aucune proposition avant qu on ait tapé', () => {
    // Dérouler d'emblée tout le carnet recouvrirait le formulaire.
    expect(rendre('')).not.toContain('Alice Martin')
  })
})
