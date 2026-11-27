/**
 * Bandeau « nouvelle version disponible ».
 *
 * Posé en haut de la fenêtre, il ne s'affiche que lorsqu'une version plus
 * récente existe, et disparaît d'un clic sur « Plus tard » jusqu'au prochain
 * lancement. Il vérifie au montage, puis à intervalle régulier pour une
 * fenêtre qu'on ne ferme jamais ; les Paramètres peuvent aussi lui confier une
 * mise à jour trouvée à la demande, par {@link EVENEMENT_MISE_A_JOUR}.
 *
 * Quand l'installation intégrée échoue — un paquet `.deb`, que le greffon ne
 * sait pas remplacer, ou un téléchargement interrompu — le bandeau le dit et
 * propose la page des téléchargements : l'utilisateur garde toujours un chemin.
 */
import { useEffect, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { Bouton, Icone } from './base'
import { lienOuvrir } from '../lib/tauri'
import {
  EVENEMENT_MISE_A_JOUR,
  INTERVALLE_VERIFICATION,
  PAGE_DES_VERSIONS,
  installer,
  verifierEnSilence,
} from '../lib/miseAJour'

type Etape =
  | { quoi: 'proposee' }
  | { quoi: 'telechargement'; fraction: number | null }
  | { quoi: 'echec' }

export function BandeauMiseAJour() {
  const [miseAJour, setMiseAJour] = useState<Update | null>(null)
  const [etape, setEtape] = useState<Etape>({ quoi: 'proposee' })
  const [masque, setMasque] = useState(false)

  useEffect(() => {
    let abandonne = false
    const proposer = (trouvee: Update | null) => {
      if (abandonne || !trouvee) return
      setMiseAJour(trouvee)
      setEtape({ quoi: 'proposee' })
      setMasque(false)
    }

    void verifierEnSilence().then(proposer)
    const minuteur = window.setInterval(
      () => void verifierEnSilence().then(proposer),
      INTERVALLE_VERIFICATION,
    )
    const aLaDemande = (e: Event) => proposer((e as CustomEvent<Update>).detail)
    window.addEventListener(EVENEMENT_MISE_A_JOUR, aLaDemande)

    return () => {
      abandonne = true
      window.clearInterval(minuteur)
      window.removeEventListener(EVENEMENT_MISE_A_JOUR, aLaDemande)
    }
  }, [])

  if (!miseAJour || masque) return null

  const lancer = async () => {
    setEtape({ quoi: 'telechargement', fraction: null })
    try {
      await installer(miseAJour, (fraction) => setEtape({ quoi: 'telechargement', fraction }))
    } catch (e) {
      console.warn('mise à jour impossible', e)
      setEtape({ quoi: 'echec' })
    }
  }

  const texte =
    etape.quoi === 'echec'
      ? `La mise à jour vers la version ${miseAJour.version} n'a pas pu s'installer.`
      : etape.quoi === 'telechargement'
        ? etape.fraction === null
          ? `Téléchargement de la version ${miseAJour.version}…`
          : `Téléchargement de la version ${miseAJour.version}… ${Math.round(etape.fraction * 100)} %`
        : `Une nouvelle version de MailFlow est disponible : ${miseAJour.version}.`

  return (
    <div
      role="status"
      className="flex flex-none items-center justify-between gap-3 border-b px-4 py-2"
      style={{
        background: etape.quoi === 'echec' ? 'var(--sunk)' : 'var(--accent-soft)',
        borderColor: 'var(--line)',
        color: 'var(--accent-fg)',
      }}
    >
      <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-medium">
        <Icone nom={etape.quoi === 'echec' ? 'error' : 'download'} taille="1.125rem" />
        <span className="truncate">{texte}</span>
      </span>

      <span className="flex flex-none items-center gap-2">
        {etape.quoi === 'proposee' && (
          <>
            <Bouton variante="discret" compact onClick={() => setMasque(true)}>
              Plus tard
            </Bouton>
            <Bouton variante="principal" compact icone="download" onClick={() => void lancer()}>
              Mettre à jour
            </Bouton>
          </>
        )}
        {etape.quoi === 'telechargement' && (
          <Bouton variante="principal" compact icone="progress_activity" enAttente disabled>
            Installation
          </Bouton>
        )}
        {etape.quoi === 'echec' && (
          <>
            <Bouton variante="discret" compact onClick={() => setMasque(true)}>
              Fermer
            </Bouton>
            <Bouton variante="discret" compact onClick={() => void lancer()} icone="refresh">
              Réessayer
            </Bouton>
            <Bouton
              variante="principal"
              compact
              icone="open_in_new"
              onClick={() => void lienOuvrir(PAGE_DES_VERSIONS)}
            >
              Télécharger
            </Bouton>
          </>
        )}
      </span>
    </div>
  )
}
