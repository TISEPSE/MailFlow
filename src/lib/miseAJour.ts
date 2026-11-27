/**
 * Mises à jour de l'application.
 *
 * # Ce qui se passe
 *
 * Le greffon `updater` lit `latest.json` dans la dernière release publiée du
 * dépôt GitHub (l'adresse est dans `tauri.conf.json`). S'il annonce un numéro
 * plus grand que celui de l'application, un bandeau le dit, et le bouton
 * télécharge l'installeur, en vérifie la signature, l'exécute, puis relance
 * MailFlow. Rien ne s'installe sans ce clic.
 *
 * Les préversions ne sont jamais proposées : `releases/latest` ne désigne que
 * les versions publiées comme définitives.
 *
 * # Ce qui ne se passe pas
 *
 * Une vérification qui échoue — pas de réseau, GitHub injoignable — ne dit
 * rien. Ne pas savoir s'il existe une version plus récente n'empêche pas de
 * lire son courrier, et un message d'erreur au démarrage ferait croire le
 * contraire.
 */
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/** Page des téléchargements, pour quand l'installation intégrée n'aboutit pas. */
export const PAGE_DES_VERSIONS = 'https://github.com/TISEPSE/MailFlow/releases/latest'

/** Événement par lequel les Paramètres confient au bandeau une mise à jour trouvée. */
export const EVENEMENT_MISE_A_JOUR = 'mailflow:mise-a-jour'

/** Intervalle entre deux vérifications, pour une fenêtre qui reste ouverte. */
export const INTERVALLE_VERIFICATION = 6 * 60 * 60 * 1000

/**
 * Demande au dépôt s'il existe une version plus récente.
 *
 * Rend `null` quand l'application est à jour. Lève quand la question n'a pas pu
 * être posée : c'est à l'appelant de décider s'il le dit.
 */
export async function verifier(): Promise<Update | null> {
  // Le mode démo n'a pas de backend : il n'y a rien à mettre à jour.
  if (import.meta.env.MODE === 'demo') return null
  return check()
}

/**
 * Pourquoi une vérification a échoué, en deux cas que l'utilisateur distingue.
 *
 * `sansFichier` : GitHub a répondu, mais la dernière release ne contient pas
 * de `latest.json`. C'est le cas tant qu'aucune version n'a été publiée avec
 * le mécanisme de mise à jour, ou si une publication a oublié la clé de
 * signature. Rien n'est cassé chez l'utilisateur.
 *
 * `reseau` : la question n'a pas pu être posée (pas de connexion, GitHub en
 * panne).
 *
 * Le greffon ne rend qu'un message en anglais : c'est lui qu'on reconnaît.
 */
export function raisonDeLEchec(e: unknown): 'sansFichier' | 'reseau' {
  return String(e).includes('valid release JSON') ? 'sansFichier' : 'reseau'
}

/** Comme {@link verifier}, mais muet en cas d'échec. Pour les vérifications de fond. */
export async function verifierEnSilence(): Promise<Update | null> {
  try {
    return await verifier()
  } catch (e) {
    console.info('vérification des mises à jour impossible', e)
    return null
  }
}

/**
 * Télécharge, installe, puis relance l'application.
 *
 * `onProgression` reçoit une fraction entre 0 et 1, ou `null` quand le serveur
 * ne donne pas la taille du fichier.
 *
 * Sous Windows, l'installeur ferme lui-même l'application : `relaunch` n'est
 * alors jamais atteint, et c'est l'installeur qui la redémarre.
 */
export async function installer(
  miseAJour: Update,
  onProgression: (fraction: number | null) => void,
): Promise<void> {
  let total = 0
  let recu = 0

  await miseAJour.downloadAndInstall((evenement) => {
    switch (evenement.event) {
      case 'Started':
        total = evenement.data.contentLength ?? 0
        onProgression(total > 0 ? 0 : null)
        break
      case 'Progress':
        recu += evenement.data.chunkLength
        onProgression(total > 0 ? Math.min(recu / total, 1) : null)
        break
      case 'Finished':
        onProgression(1)
        break
    }
  })

  await relaunch()
}
