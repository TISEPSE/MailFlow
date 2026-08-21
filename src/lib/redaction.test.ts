import { describe, expect, it } from 'vitest'
import {
  brouillonDeTransfert,
  decouperAdresses,
  prefixerTransfert,
  texteCitable,
} from './redaction'
import type { CorpsMessage, MessageAffiche } from '../types/backend'

const MESSAGE: MessageAffiche = {
  id: 'msg_1',
  nom: 'JULES',
  adresse: 'jules@exemple.fr',
  sujet: 'La facture de juillet',
  extrait: 'Un extrait.',
  date: '2026-07-14T09:30:00Z',
  nonLu: false,
  categorie: 'humain',
  compte: 'moi@exemple.fr',
  destinataires: [{ nom: 'Moi', adresse: 'moi@exemple.fr' }],
  copies: [],
  libelles: [],
}

function corps(partiel: Partial<CorpsMessage> = {}): CorpsMessage {
  return { html: null, texte: null, pieces: [], ...partiel }
}

describe('decouperAdresses', () => {
  it('accepte les trois séparateurs qu on colle depuis ailleurs', () => {
    expect(decouperAdresses('a@x.fr, b@x.fr; c@x.fr\nd@x.fr')).toEqual([
      'a@x.fr',
      'b@x.fr',
      'c@x.fr',
      'd@x.fr',
    ])
  })

  it('ne compte pas une virgule finale pour un destinataire', () => {
    expect(decouperAdresses('a@x.fr,  ')).toEqual(['a@x.fr'])
  })

  it('ne rend rien sur une saisie vide', () => {
    expect(decouperAdresses('   ')).toEqual([])
  })
})

describe('texteCitable', () => {
  it('préfère le texte de l expéditeur à son HTML', () => {
    const c = corps({ texte: 'La version texte.', html: '<p>La version HTML.</p>' })

    expect(texteCitable(c, 'extrait')).toBe('La version texte.')
  })

  it('réduit le HTML à son texte quand il n y a que lui', () => {
    const c = corps({ html: '<p>Bonjour,</p><p>Voici la <b>facture</b>.</p>' })

    expect(texteCitable(c, 'extrait')).toBe('Bonjour,\nVoici la facture.')
  })

  it('ne cite pas le contenu des balises qui ne sont pas du texte', () => {
    const c = corps({ html: '<style>p{color:red}</style><p>Le vrai texte.</p>' })

    expect(texteCitable(c, 'extrait')).toBe('Le vrai texte.')
  })

  it('rend les entités les plus courantes', () => {
    const c = corps({ html: '<p>R&eacute;union &amp; caf&eacute;&nbsp;: 10&#8239;h</p>' })

    expect(texteCitable(c, 'extrait')).toContain('Réunion & café')
  })

  it("retombe sur l'extrait quand le corps n'a rien", () => {
    expect(texteCitable(null, 'Un extrait.')).toBe('Un extrait.')
    expect(texteCitable(corps({ texte: '   ' }), 'Un extrait.')).toBe('Un extrait.')
  })
})

describe('prefixerTransfert', () => {
  it('pose le préfixe une seule fois', () => {
    expect(prefixerTransfert('La facture')).toBe('Tr : La facture')
    expect(prefixerTransfert('Tr : La facture')).toBe('Tr : La facture')
    expect(prefixerTransfert('Fwd: Invoice')).toBe('Fwd: Invoice')
  })

  it('dit qu il n y a pas d objet plutôt que de n en mettre aucun', () => {
    expect(prefixerTransfert('  ')).toBe('Tr : (sans objet)')
  })
})

describe('brouillonDeTransfert', () => {
  it('laisse les destinataires vides', () => {
    // Le seul champ qu'un transfert ne peut pas deviner, et celui où une
    // erreur coûte le plus cher.
    const b = brouillonDeTransfert(MESSAGE, corps({ texte: 'Le corps.' }))

    expect(b.destinataires).toBe('')
    expect(b.copies).toBe('')
  })

  it('reprend l objet et les en-têtes d origine', () => {
    const b = brouillonDeTransfert(MESSAGE, corps({ texte: 'Le corps.' }))

    expect(b.sujet).toBe('Tr : La facture de juillet')
    expect(b.corps).toContain('JULES <jules@exemple.fr>')
    expect(b.corps).toContain('Objet : La facture de juillet')
    expect(b.corps).toContain('À : moi@exemple.fr')
    expect(b.corps).toContain('Le corps.')
  })

  it('annonce dans le message même les pièces jointes qui ne suivent pas', () => {
    // Dans le corps et non dans un bandeau : le destinataire doit lui aussi
    // savoir qu'il manque quelque chose. Un avertissement affiché seulement
    // chez l'expéditeur se lit une fois et s'oublie.
    const b = brouillonDeTransfert(
      MESSAGE,
      corps({
        texte: 'Le corps.',
        pieces: [
          { id: 'p1', nom: 'facture.pdf', typeMime: 'application/pdf', taille: 1000 },
          { id: 'p2', nom: 'photo.png', typeMime: 'image/png', taille: 2000 },
        ],
      }),
    )

    expect(b.corps).toContain('2 fichiers joints')
    expect(b.corps).toContain('facture.pdf')
    expect(b.corps).toContain('photo.png')
  })

  it('ne parle pas de pièces jointes quand il n y en a pas', () => {
    const b = brouillonDeTransfert(MESSAGE, corps({ texte: 'Le corps.' }))

    expect(b.corps).not.toContain('joint')
  })

  it('reste utilisable quand le corps n a pas pu être chargé', () => {
    const b = brouillonDeTransfert(MESSAGE, null)

    expect(b.sujet).toBe('Tr : La facture de juillet')
    expect(b.corps).toContain('Un extrait.')
  })
})
