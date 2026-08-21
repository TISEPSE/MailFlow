import { describe, expect, it } from 'vitest'
import { decouperLesLiens } from './liens'

/** Raccourci de lecture : les seules adresses, dans l'ordre. */
function adresses(texte: string): string[] {
  return decouperLesLiens(texte)
    .filter((m) => m.genre === 'lien')
    .map((m) => (m.genre === 'lien' ? m.adresse : ''))
}

describe('decouperLesLiens', () => {
  it('laisse intact un texte sans adresse', () => {
    const morceaux = decouperLesLiens('Bonjour, à demain.')

    expect(morceaux).toEqual([{ genre: 'texte', contenu: 'Bonjour, à demain.' }])
  })

  it('reconnaît une adresse au milieu d une phrase', () => {
    const morceaux = decouperLesLiens('Voir https://exemple.fr/page pour la suite.')

    expect(morceaux).toEqual([
      { genre: 'texte', contenu: 'Voir ' },
      {
        genre: 'lien',
        contenu: 'https://exemple.fr/page',
        adresse: 'https://exemple.fr/page',
      },
      { genre: 'texte', contenu: ' pour la suite.' },
    ])
  })

  it("rend le point final à la phrase, jamais à l'adresse", () => {
    expect(adresses('Rendez-vous sur https://exemple.fr/page.')).toEqual([
      'https://exemple.fr/page',
    ])
  })

  it('rend la parenthèse fermante à la citation', () => {
    expect(adresses('(voir https://exemple.fr).')).toEqual(['https://exemple.fr'])
  })

  it("ajoute le schéma manquant sans toucher au texte affiché", () => {
    const [morceau] = decouperLesLiens('www.exemple.fr')

    expect(morceau).toEqual({
      genre: 'lien',
      contenu: 'www.exemple.fr',
      adresse: 'https://www.exemple.fr',
    })
  })

  it('trouve plusieurs adresses dans le même texte', () => {
    expect(
      adresses('Un http://a.fr puis un autre https://b.fr/x?y=1 et fin.'),
    ).toEqual(['http://a.fr', 'https://b.fr/x?y=1'])
  })

  it("garde la requête et l'ancre d'une adresse", () => {
    expect(adresses('https://exemple.fr/a?b=1&c=2#haut')).toEqual([
      'https://exemple.fr/a?b=1&c=2#haut',
    ])
  })

  it("s'arrête aux chevrons qui entourent parfois une adresse", () => {
    expect(adresses('<https://exemple.fr/page>')).toEqual(['https://exemple.fr/page'])
  })

  it("ne fabrique pas d'adresse à partir d'un schéma seul", () => {
    expect(adresses('Le schéma https:// ne mène nulle part.')).toEqual([])
  })

  it('recompose exactement le texte de départ', () => {
    // La propriété qui compte : rien ne doit être perdu ni dupliqué au
    // découpage. Un caractère avalé au passage se lirait comme un message
    // tronqué, ce qui est pire qu'un lien mort.
    const texte =
      'Bonjour,\nVotre commande : https://boutique.fr/suivi?id=42.\nMerci ! www.boutique.fr'

    expect(
      decouperLesLiens(texte)
        .map((m) => m.contenu)
        .join(''),
    ).toBe(texte)
  })
})
