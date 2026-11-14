import { describe, expect, it } from 'vitest'
import {
  brouillonDepuisMailto,
  brouillonDeReponse,
  brouillonDeTransfert,
  brouillonModifie,
  brouillonVierge,
  decouperAdresses,
  delaiDEnregistrement,
  joindre,
  POIDS_MAX_PIECES,
  prefixerReponse,
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

describe('fichiers joints', () => {
  const piece = (nom: string, taille: number) => ({
    nom,
    typeMime: 'application/pdf',
    taille,
    contenu: '',
  })

  it('ajoute les fichiers à la suite de ceux déjà joints', () => {
    const { pieces, refusees } = joindre([piece('a.pdf', 10)], [piece('b.pdf', 20)])

    expect(pieces.map((p) => p.nom)).toEqual(['a.pdf', 'b.pdf'])
    expect(refusees).toEqual([])
  })

  it('ne joint pas deux fois le même fichier', () => {
    const { pieces } = joindre([piece('a.pdf', 10)], [piece('a.pdf', 10)])

    expect(pieces).toHaveLength(1)
  })

  it('écarte ce qui ferait dépasser la limite de Gmail, et le nomme', () => {
    const { pieces, refusees } = joindre(
      [piece('a.pdf', POIDS_MAX_PIECES - 100)],
      [piece('trop.mp4', 200), piece('petit.txt', 50)],
    )

    // Le fichier trop lourd n'empêche pas le suivant de passer.
    expect(pieces.map((p) => p.nom)).toEqual(['a.pdf', 'petit.txt'])
    expect(refusees).toEqual(['trop.mp4'])
  })
})

describe('brouillonModifie', () => {
  const vierge = brouillonVierge()
  const rien = { pieces: 0, cci: '' }

  it('ne voit rien à perdre dans un message neuf qu’on n’a pas touché', () => {
    expect(brouillonModifie(vierge, vierge, rien)).toBe(false)
  })

  it('compte chacun des quatre champs', () => {
    const champs = ['destinataires', 'copies', 'sujet', 'corps'] as const

    for (const champ of champs) {
      expect(brouillonModifie(vierge, { ...vierge, [champ]: 'x' }, rien)).toBe(true)
    }
  })

  it('ne compte pas une frappe qui n’a laissé que des espaces', () => {
    expect(brouillonModifie(vierge, { ...vierge, corps: '   \n ' }, rien)).toBe(false)
  })

  it('compte une pièce jointe, même sans un mot écrit', () => {
    // Le fichier a demandé d'être choisi, lu et téléversé : le perdre d'un
    // Échap coûte plus cher qu'une ligne de texte.
    expect(brouillonModifie(vierge, vierge, { pieces: 1, cci: '' })).toBe(true)
  })

  it('compte une copie cachée, qui ne vit pas dans le brouillon', () => {
    expect(brouillonModifie(vierge, vierge, { pieces: 0, cci: 'elle@exemple.fr' })).toBe(true)
  })

  it('ne réclame rien pour un transfert qu’on vient d’ouvrir', () => {
    // Le transfert arrive pré-rempli. Demander « garder le brouillon ? » à
    // quelqu'un qui n'a pas encore écrit un mot ferait du garde-fou une
    // formalité qu'on apprend à cliquer sans lire.
    const depart = brouillonDeTransfert(MESSAGE, null)

    expect(brouillonModifie(depart, depart, rien)).toBe(false)
  })

  it('réclame dès qu’un destinataire est ajouté à un transfert', () => {
    const depart = brouillonDeTransfert(MESSAGE, null)

    expect(
      brouillonModifie(depart, { ...depart, destinataires: 'alice@exemple.fr' }, rien),
    ).toBe(true)
  })

  it('réclame quand le corps cité d’un transfert a été effacé', () => {
    const depart = brouillonDeTransfert(MESSAGE, null)

    expect(brouillonModifie(depart, { ...depart, corps: '' }, rien)).toBe(true)
  })
})

describe('delaiDEnregistrement', () => {
  it('enregistre vite une lettre sans fichier', () => {
    expect(delaiDEnregistrement(0)).toBe(3000)
  })

  it('espace les enregistrements dès qu’un fichier est joint', () => {
    // L'API des brouillons de Gmail n'a pas de mise à jour partielle : chaque
    // enregistrement renvoie le message entier, pièces jointes comprises.
    // Toutes les trois secondes, une pièce de vingt mégaoctets saturerait le
    // débit montant pendant toute la rédaction.
    expect(delaiDEnregistrement(5 * 1024 * 1024)).toBeGreaterThan(delaiDEnregistrement(0))
  })

  it('reste court pour une pièce légère', () => {
    // Une signature en image ou un petit PDF ne coûtent rien à renvoyer : ils
    // ne doivent pas faire perdre la sauvegarde rapprochée.
    expect(delaiDEnregistrement(50 * 1024)).toBe(3000)
  })

  it('ne dépasse jamais une minute, même pour le maximum admis', () => {
    // Au-delà, l'attente cesse d'être une sauvegarde automatique.
    expect(delaiDEnregistrement(POIDS_MAX_PIECES)).toBeLessThanOrEqual(60_000)
  })
})

describe('prefixerReponse', () => {
  it('pose « Re : » une seule fois', () => {
    expect(prefixerReponse('La facture')).toBe('Re : La facture')
    expect(prefixerReponse('Re : La facture')).toBe('Re : La facture')
    expect(prefixerReponse('Re: La facture')).toBe('Re: La facture')
    expect(prefixerReponse('RE: La facture')).toBe('RE: La facture')
  })

  it('nomme un objet vide', () => {
    expect(prefixerReponse('  ')).toBe('Re : (sans objet)')
  })

  it('répond à un transfert sans empiler deux « Re : »', () => {
    const une = prefixerReponse('Tr : La facture')
    expect(une).toBe('Re : Tr : La facture')
    expect(prefixerReponse(une)).toBe(une)
  })
})

describe('brouillonDeReponse', () => {
  const corpsLu = { html: null, texte: 'Bonjour Léa,\n\nMerci.', pieces: [] }

  it('adresse la réponse à l’expéditeur, et à lui seul', () => {
    const b = brouillonDeReponse(MESSAGE, null, 'moi@exemple.fr', false)

    expect(b.destinataires).toBe('jules@exemple.fr')
    expect(b.copies).toBe('')
  })

  it('met les autres en copie quand on répond à tous', () => {
    // Et jamais soi-même : se répondre en copie est le travers classique de ce
    // bouton.
    const m = {
      ...MESSAGE,
      destinataires: [
        { nom: 'Moi', adresse: 'moi@exemple.fr' },
        { nom: 'Alice', adresse: 'alice@exemple.fr' },
      ],
      copies: [{ nom: 'Bob', adresse: 'bob@exemple.fr' }],
    }

    const b = brouillonDeReponse(m, null, 'moi@exemple.fr', true)

    expect(b.destinataires).toBe('jules@exemple.fr')
    expect(b.copies).toBe('alice@exemple.fr, bob@exemple.fr')
  })

  it('préfixe l’objet', () => {
    expect(brouillonDeReponse(MESSAGE, null, null, false).sujet).toBe(
      'Re : La facture de juillet',
    )
  })

  it('cite le message sous une ligne d’attribution', () => {
    const b = brouillonDeReponse(MESSAGE, corpsLu, null, false)

    expect(b.corps).toContain('JULES')
    expect(b.corps).toContain('a écrit :')
    expect(b.corps).toContain('> Bonjour Léa,')
    expect(b.corps).toContain('> Merci.')
  })

  it('laisse le curseur sur une ligne vide, avant la citation', () => {
    // On écrit au-dessus de ce qu'on cite. Un brouillon qui s'ouvre au milieu
    // du message d'origine oblige à remonter avant d'écrire un mot.
    const b = brouillonDeReponse(MESSAGE, corpsLu, null, false)

    expect(b.corps.startsWith('\n\n')).toBe(true)
  })

  it('porte de quoi rattacher la réponse au fil', () => {
    const avecFil = { ...corpsLu, messageId: '<abc@mail>', references: '<n1@mail>', threadId: 't1' }

    const b = brouillonDeReponse(MESSAGE, avecFil, null, false)

    expect(b.reponse).toEqual({
      messageId: '<abc@mail>',
      references: '<n1@mail>',
      threadId: 't1',
    })
  })

  it('n’invente pas de fil quand le message d’origine n’en donne pas', () => {
    // Un corps rangé par une version antérieure n'a pas ces champs. Mieux vaut
    // une réponse hors fil qu'un threadId inventé, que Google refuserait.
    expect(brouillonDeReponse(MESSAGE, corpsLu, null, false).reponse).toBeUndefined()
  })
})

describe('brouillonDepuisMailto', () => {
  it('ouvre un brouillon adressé au destinataire du lien', () => {
    // Un lien `mailto:` dans un message ouvrait le client du système, donc
    // Gmail dans un navigateur. MailFlow sait écrire : c'est sa fenêtre qui
    // doit s'ouvrir.
    const b = brouillonDepuisMailto('mailto:alice@exemple.fr')

    expect(b?.destinataires).toBe('alice@exemple.fr')
    expect(b?.sujet).toBe('')
    expect(b?.corps).toBe('')
  })

  it('reprend objet, corps et copies, décodés', () => {
    const b = brouillonDepuisMailto(
      'mailto:alice@exemple.fr?subject=Bonjour%20Alice&body=Un%20mot.&cc=bob@exemple.fr',
    )

    expect(b?.sujet).toBe('Bonjour Alice')
    expect(b?.corps).toBe('Un mot.')
    expect(b?.copies).toBe('bob@exemple.fr')
  })

  it('accepte plusieurs destinataires', () => {
    const b = brouillonDepuisMailto('mailto:a@exemple.fr,b@exemple.fr')

    expect(b?.destinataires).toBe('a@exemple.fr, b@exemple.fr')
  })

  it('ramène un objet sur une ligne', () => {
    // Rust refuse un retour à la ligne dans l'objet : un lien forgé ne doit
    // pas bloquer l'envoi, ni glisser un en-tête.
    const b = brouillonDepuisMailto('mailto:a@exemple.fr?subject=Un%0D%0ABcc:%20x@y.fr')

    expect(b?.sujet).not.toMatch(/[\r\n]/)
  })

  it('rend null pour ce qui n’est pas un mailto', () => {
    expect(brouillonDepuisMailto('https://exemple.fr')).toBeNull()
    expect(brouillonDepuisMailto('mailto:')).toBeNull()
  })
})
