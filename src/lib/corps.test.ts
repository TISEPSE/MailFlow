import { describe, expect, it } from 'vitest'
import { CAPACITE, creerCache, ranger } from './corps'
import type { CorpsMessage } from '../types/backend'

const corps = (html: string): CorpsMessage => ({ html, texte: null, pieces: [] })

describe('cache des corps', () => {
  it('rend ce qui a été rangé', () => {
    const c = ranger(creerCache(), 'm1', corps('<p>a</p>'))

    expect(c.get('m1')?.html).toBe('<p>a</p>')
  })

  it('ne modifie pas le cache qu’on lui donne', () => {
    // React ne redessine que si la référence change : muter en place
    // laisserait l'affichage sur l'ancien contenu.
    const avant = creerCache()
    const apres = ranger(avant, 'm1', corps('<p>a</p>'))

    expect(avant.size).toBe(0)
    expect(apres).not.toBe(avant)
  })

  it('oublie les plus anciens au-delà de la capacité', () => {
    let c = creerCache()
    for (let i = 0; i <= CAPACITE; i++) c = ranger(c, `m${i}`, corps('x'))

    expect(c.size).toBe(CAPACITE)
    expect(c.has('m0')).toBe(false)
    expect(c.has(`m${CAPACITE}`)).toBe(true)
  })

  it('rajeunit un message qu’on consulte à nouveau', () => {
    // Sans cela, le message le plus lu serait évincé aussi vite que les autres.
    let c = creerCache()
    for (let i = 0; i < CAPACITE; i++) c = ranger(c, `m${i}`, corps('x'))

    c = ranger(c, 'm0', corps('x'))
    c = ranger(c, 'nouveau', corps('x'))

    expect(c.has('m0')).toBe(true)
    expect(c.has('m1')).toBe(false)
  })
})
