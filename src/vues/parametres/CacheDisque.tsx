import { useEffect, useState } from 'react'
import { Bouton } from '../../composants/base'
import { cacheTaille, cacheVider, messageDErreur } from '../../lib/tauri'
import { Reglage } from './Reglage'

export function CacheDisque({
  onErreur,
  onEfface,
}: {
  onErreur: (message: string) => void
  onEfface: () => void
}) {
  const [octets, setOctets] = useState<number | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    cacheTaille()
      .then(setOctets)
      .catch(() => setOctets(null))
  }, [])

  const vider = async () => {
    setEnCours(true)
    try {
      await cacheVider()
      setOctets(await cacheTaille().catch(() => 0))
      onEfface()
    } catch (e) {
      onErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const taille =
    octets === null
      ? ''
      : octets < 1024 * 1024
        ? ` (${Math.max(1, Math.round(octets / 1024))} Ko)`
        : ` (${(octets / 1024 / 1024).toFixed(1)} Mo)`

  return (
    <Reglage
      icone="delete"
      titre="Tout ce que MailFlow garde sur cet ordinateur"
      detail={`Messages, images, journaux${taille}. Tout se retélécharge : vos comptes, vos règles et vos tas ne sont pas touchés.`}
    >
      <Bouton
        variante="danger"
        icone="delete"
        enAttente={enCours}
        disabled={enCours || octets === 0}
        onClick={() => void vider()}
      >
        {enCours ? 'Effacement…' : 'Tout effacer'}
      </Bouton>
    </Reglage>
  )
}
