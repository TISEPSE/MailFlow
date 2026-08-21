import { describe, expect, it } from 'vitest'
import { adresseValide, identifiant, nouvelleRegle, phrase, quand } from './regles'
import type { Regle } from '../types/backend'

function regle(champs: Partial<Regle> = {}): Regle {
  return {
    id: 'rule_01',
    expediteur: 'promo@offres-tech.fr',
    nom_affichage: 'Offres Tech',
    categorie: 'publicite',
    action: 'supprimer_toujours',
    active: true,
    date_ajout: '2026-08-14',
    ...champs,
  }
}

describe('phrase', () => {
  it('dit ce que fait une suppression', () => {
    expect(phrase(regle())).toBe(
      'Supprimer systématiquement les messages de Offres Tech.',
    )
  })

  it('dit où le message ira, et ce que Gmail en fera', () => {
    // « sans rien y changer » ne nommait ni l'un ni l'autre : la phrase doit
    // dire la page de destination *et* que la boîte Gmail reste intacte.
    const p = phrase(regle({ action: 'classer_seulement', categorie: 'humain' }))

    expect(p).toContain('Mails directs')
    expect(p).toContain('boîte de réception Gmail')
    expect(p).not.toContain('sans rien')
  })

  it('dit ce que fait un résumé', () => {
    const p = phrase(
      regle({ action: 'generer_resume_et_archiver', nom_affichage: 'TLDR' }),
    )

    expect(p).toContain('Résumer')
    expect(p).toContain('archiver')
    expect(p).toContain('TLDR')
  })

  it("précise le jour et l'heure d'un archivage récurrent", () => {
    // Sans eux, l'utilisateur ne saurait pas quand ça se produit.
    const p = phrase(
      regle({
        action: 'archiver_automatique',
        frequence: 'vendredi',
        heure_execution: '18:00',
        nom_affichage: 'OpenClassrooms',
      }),
    )

    expect(p).toContain('vendredis')
    expect(p).toContain('18 h 00')
  })

  it('reste juste quand aucune récurrence n’est définie', () => {
    // Annoncer un vendredi qui n'existe pas serait un mensonge.
    const p = phrase(regle({ action: 'archiver_automatique' }))

    expect(p).not.toContain('vendredi')
    expect(p).toContain('Archiver automatiquement')
  })

  it("retombe sur l'adresse quand le nom affiché manque", () => {
    // Une phrase avec un trou serait pire qu'une adresse technique.
    const p = phrase(regle({ nom_affichage: '' }))

    expect(p).toContain('promo@offres-tech.fr')
  })
})

describe('identifiant', () => {
  it('rend le même identifiant pour la même adresse', () => {
    // C'est ce qui fait qu'ajouter deux fois la même adresse remplace la règle
    // au lieu d'en empiler une seconde qui la contredirait.
    expect(identifiant('Promo@Offres-Tech.FR')).toBe(identifiant('promo@offres-tech.fr'))
  })

  it('ne garde que des caractères sûrs', () => {
    expect(identifiant('a+b@x.fr')).toBe('rule_a_b_x_fr')
  })
})

describe('adresseValide', () => {
  it('accepte une adresse ordinaire', () => {
    expect(adresseValide('  Promo@Offres-Tech.fr ')).toBe(true)
  })

  it('refuse ce qui ne peut désigner personne', () => {
    // Une règle sur une adresse impossible ne se déclencherait jamais, et
    // l'utilisateur croirait pourtant avoir agi.
    expect(adresseValide('')).toBe(false)
    expect(adresseValide('sans-arobase.fr')).toBe(false)
    expect(adresseValide('a@sanspoint')).toBe(false)
    expect(adresseValide('a b@x.fr')).toBe(false)
    expect(adresseValide('a@@x.fr')).toBe(false)
  })
})

describe('nouvelleRegle', () => {
  it('normalise l’adresse et active la règle', () => {
    const r = nouvelleRegle({
      adresse: '  Promo@Offres-Tech.FR ',
      categorie: 'publicite',
      action: 'supprimer_toujours',
    })

    expect(r.expediteur).toBe('promo@offres-tech.fr')
    expect(r.active).toBe(true)
    expect(r.date_ajout).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('déduit un nom lisible quand l’utilisateur n’en donne pas', () => {
    // « offres-tech.fr » se relit mieux que l'adresse entière dans la phrase.
    expect(nouvelleRegle({ adresse: 'promo@offres-tech.fr' }).nom_affichage).toBe(
      'offres-tech.fr',
    )
  })

  it('garde le nom fourni', () => {
    const r = nouvelleRegle({ adresse: 'a@x.fr', nom: 'Offres Tech' })

    expect(r.nom_affichage).toBe('Offres Tech')
  })

  it('ne programme rien tant que rien n a été demandé', () => {
    // La règle imposait « vendredi 18 h » sans le dire : une adresse ajoutée un
    // lundi restait quatre jours en boîte, et rien à l'écran ne l'expliquait.
    const archive = nouvelleRegle({ adresse: 'a@x.fr', action: 'archiver_automatique' })

    expect(archive.frequence).toBeUndefined()
    expect(archive.heure_execution).toBeUndefined()
  })

  it('programme ce qu on lui demande, et rien de plus', () => {
    const r = nouvelleRegle({
      adresse: 'a@x.fr',
      action: 'archiver_automatique',
      frequence: 'mardi',
      heure: '07:30',
    })

    expect(r.frequence).toBe('mardi')
    expect(r.heure_execution).toBe('07:30')
  })

  it('ne planifie rien sur une action qui ne range pas', () => {
    // `phrase` annonce le jour et l'heure dès qu'ils existent : les poser sur
    // une suppression ferait dire à l'interface ce qui n'arrivera pas.
    const supprime = nouvelleRegle({
      adresse: 'a@x.fr',
      action: 'supprimer_toujours',
      frequence: 'vendredi',
      heure: '18:00',
    })

    expect(supprime.frequence).toBeUndefined()
    expect(supprime.heure_execution).toBeUndefined()
  })

  it('retombe sur une heure raisonnable quand seule la fréquence est donnée', () => {
    const r = nouvelleRegle({
      adresse: 'a@x.fr',
      action: 'archiver_automatique',
      frequence: 'quotidienne',
    })

    expect(r.heure_execution).toBe('18:00')
  })
})

describe('quand', () => {
  it('nomme la cadence et l heure', () => {
    expect(quand('quotidienne', '07:30')).toBe('tous les jours à 07 h 30')
    expect(quand('mercredi', '18:00')).toBe('tous les mercredis à 18 h 00')
  })

  it('n invente pas une heure qui n a pas été choisie', () => {
    // Le moteur, sans heure, agit au premier passage du bon jour. Écrire
    // « à 18 h » ferait attendre devant une heure qui n'existe pas.
    expect(quand('vendredi')).toBe('tous les vendredis')
  })
})

describe('règles de domaine', () => {
  it('accepte un domaine entier, écrit avec un arobase en tête', () => {
    // Le seul moyen d'attraper LinkedIn, qui écrit depuis « messages-noreply@ »,
    // « notifications-noreply@ », « jobs-noreply@ »…
    expect(adresseValide('@linkedin.com')).toBe(true)
    expect(adresseValide('@offres-tech.fr')).toBe(true)
  })

  it('refuse un domaine bancal', () => {
    for (const bancal of ['@', '@linkedin', '@ linkedin.com', '@a@b.fr']) {
      expect(adresseValide(bancal)).toBe(false)
    }
  })

  it("n'a rien changé aux adresses complètes", () => {
    expect(adresseValide('promo@offres-tech.fr')).toBe(true)
    expect(adresseValide('pas-une-adresse')).toBe(false)
  })
})
