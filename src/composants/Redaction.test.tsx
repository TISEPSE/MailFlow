/**
 * La fenêtre de rédaction, éprouvée sans interface.
 *
 * `renderToString` n'exécute pas les effets ni les clics : ce qui est vérifié
 * ici, c'est l'image de départ — celle qu'on voit en ouvrant. C'est elle qui
 * compte pour un transfert, puisque tout son contenu est pré-rempli et que
 * l'utilisateur ne fera souvent qu'ajouter un destinataire avant d'envoyer.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Redaction } from './Redaction'
import { brouillonDeTransfert, brouillonVierge } from '../lib/redaction'
import type { Connaissance } from '../lib/contacts'
import type { MessageAffiche } from '../types/backend'

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
  destinataires: [],
  copies: [],
  libelles: [],
}

const CARNET: Connaissance[] = [
  { adresse: 'alice@exemple.fr', nom: 'Alice Martin', apparitions: 3 },
]

function rendre(depart = brouillonVierge()) {
  return renderToString(
    <Redaction
      depart={depart}
      de="moi@exemple.fr"
      carnet={CARNET}
      onFermer={() => {}}
      onEnvoye={() => {}}
    />,
  )
}

describe('Redaction', () => {
  it("dit de quel compte le message partira", () => {
    // Sur plusieurs boîtes reliées, c'est la seule chose qui distingue un
    // message parti du bon compte d'un message parti de l'autre.
    expect(rendre()).toContain('Envoyé depuis moi@exemple.fr')
  })

  it('ouvre un message neuf sur des champs vides', () => {
    const html = rendre()

    expect(html).toContain('Nouveau message')
    expect(html).toContain('aria-label="Destinataires"')
    expect(html).toContain('aria-label="Objet du message"')
    expect(html).toContain('aria-label="Corps du message"')
  })

  it('replie les copies tant qu il n y en a pas', () => {
    expect(rendre()).not.toContain('aria-label="Copies"')
  })

  it("ouvre les copies quand le brouillon en porte", () => {
    const html = rendre({ ...brouillonVierge(), copies: 'elle@exemple.fr' })

    expect(html).toContain('aria-label="Copies"')
  })

  it("s'annonce comme un transfert et porte l'objet préfixé", () => {
    const html = rendre(brouillonDeTransfert(MESSAGE, null))

    expect(html).toContain('Transférer le message')
    expect(html).toContain('Tr : La facture de juillet')
  })

  it("n'envoie pas tant qu'il n'y a ni destinataire ni objet", () => {
    // Le bouton inerte évite l'aller-retour d'un message qui ne peut pas
    // partir. La validation qui compte, elle, est côté Rust.
    expect(rendre()).toContain('disabled=""')
  })
})
