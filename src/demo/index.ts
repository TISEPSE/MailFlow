/**
 * Mode démo : l'interface tourne dans un navigateur, sans backend ni compte.
 *
 * Chaque commande Tauri reçoit une réponse tirée de `donnees.ts`, entièrement
 * fictive. Sert aux captures d'écran du README : aucune vraie boîte n'y passe,
 * et les images se refont à l'identique avec `npm run captures`.
 *
 * Chargé seulement sous `vite --mode demo` : le bundle livré n'en contient rien.
 */

import { mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type {
  Apercu,
  EtatApplication,
  JeuDeRegles,
  LibelleGmail,
  RapportExecution,
  RapportResumes,
  Regle,
  Resume,
} from '../types/backend'
import type { ResumesConnus } from '../lib/tauri'
import {
  ARCHIVES,
  BOITE,
  COMPTE,
  COMPTES,
  CONTACTS,
  LIBELLES,
  PROFIL,
  REGLES,
  RESUMES,
  SYNTHESE,
  corpsDe,
} from './donnees'

/** Règles et libellés tenus en mémoire : les gestes marchent jusqu'au rechargement. */
let regles: JeuDeRegles = structuredClone(REGLES)
let libelles: LibelleGmail[] = [...LIBELLES]

function remplacerLesRegles(automations: Regle[]): JeuDeRegles {
  regles = { ...regles, last_updated: new Date().toISOString(), automations }
  return regles
}

function repondre(cmd: string, args: Record<string, unknown>): unknown {
  switch (cmd) {
    case 'app_health':
      return {
        version: '0.1.15',
        plateforme: 'linux',
        trousseauDisponible: true,
        cheminRegles: '~/.config/fr.mailflow.desktop/regles',
        nombreDeRegles: regles.automations.length,
        compteConnecte: true,
        clientGoogleConfigure: true,
      } satisfies EtatApplication

    case 'compte_adresse':
      return COMPTE
    case 'compte_profil':
      return PROFIL
    case 'comptes_lister':
      return COMPTES

    case 'regles_toutes':
      return [{ compte: COMPTE, regles }]
    case 'regles_lister':
      return regles
    case 'regle_ajouter': {
      const regle = args.regle as Regle
      return remplacerLesRegles([
        ...regles.automations.filter((r) => r.expediteur !== regle.expediteur),
        regle,
      ])
    }
    case 'regle_modifier': {
      const regle = args.regle as Regle
      return remplacerLesRegles(
        regles.automations.map((r) => (r.id === args.id ? regle : r)),
      )
    }
    case 'regle_supprimer':
      return remplacerLesRegles(regles.automations.filter((r) => r.id !== args.id))
    case 'regle_basculer':
      return remplacerLesRegles(
        regles.automations.map((r) => (r.id === args.id ? { ...r, active: !r.active } : r)),
      )

    case 'boite_en_cache':
    case 'boite_lister':
    case 'boite_melangee':
      return BOITE
    case 'message_corps':
      return corpsDe(String(args.id))
    case 'corps_precharger':
      return (args.ids as string[]).length

    case 'archives_lister':
    case 'archives_synchroniser':
      return ARCHIVES
    case 'libelles_lister':
      return libelles
    case 'libelle_creer': {
      const nom = String(args.nom)
      libelles = [...libelles, { id: `Label_${libelles.length + 1}`, nom }]
      return libelles
    }
    case 'tableau_lire':
      // Posés à la main pour tenir dans la largeur d'une capture, un peu de
      // biais comme sur une vraie table.
      return {
        tas: { Label_factures: { x: 40, y: 40 }, Label_voyage: { x: 330, y: 64 } },
        messages: { a6: { x: 620, y: 40 }, a7: { x: 200, y: 230 } },
      }

    case 'llm_etat':
      return { cleConfiguree: true, modele: 'gemini-3.5-flash-lite' }
    case 'resumes_connus': {
      const ids = args.ids as string[]
      const resumes: Record<string, Resume> = {}
      for (const id of ids) {
        const r = RESUMES[id]
        if (r) resumes[id] = r
      }
      return { resumes, sansTexte: [] } satisfies ResumesConnus
    }
    case 'resumes_produire': {
      const total = Object.keys(RESUMES).length
      return { disponibles: total, total, enFile: 0 } satisfies RapportResumes
    }
    case 'synthese_produire':
      return SYNTHESE

    case 'contacts_lister':
    case 'contacts_synchroniser':
      return CONTACTS
    case 'logos_expediteurs':
      return {}
    case 'cache_taille':
      return 48_300_000
    case 'piece_jointe_vignette':
      return null
    case 'piece_jointe_apercu':
      return { genre: 'impossible', raison: 'Aperçu indisponible en mode démo.' } satisfies Apercu
    case 'gmail_synchroniser':
      return { archives: 0, misALaCorbeille: 0, echecs: 0 } satisfies RapportExecution

    // Gestes sans réponse : l'interface met déjà l'écran à jour d'elle-même.
    case 'message_ranger':
    case 'message_corbeille':
    case 'message_marquer_lu':
    case 'message_envoyer':
    case 'repondre_au_message':
    case 'libelle_poser':
    case 'libelle_retirer':
    case 'tas_defaire':
    case 'archive_retirer':
    case 'tableau_ecrire':
    case 'compte_basculer':
    case 'lien_ouvrir':
    case 'cache_vider':
    case 'resumes_arreter':
      return null

    default:
      console.info('[démo] commande sans réponse :', cmd)
      return null
  }
}

/**
 * Le cadre du corps des messages, recréé dans le navigateur.
 *
 * L'application le demande au protocole `mailflow-corps://` de `cadre.rs`, qui
 * n'existe pas hors de Tauri. Ce document parle le même langage : il annonce
 * qu'il écoute, reçoit le HTML, puis renvoie sa hauteur.
 */
const CADRE = URL.createObjectURL(
  new Blob(
    [
      `<!doctype html><meta charset="utf-8">
<style>
  html { background: #ffffff; }
  body {
    margin: 0; padding: 20px 24px; overflow-x: auto;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    color: #1d1d1f; overflow-wrap: break-word;
  }
  a { color: #2f6bff; }
</style>
<body><script>
  const hauteur = () => parent.postMessage({ type: 'mailflow:hauteur', hauteur: document.documentElement.scrollHeight }, '*')
  addEventListener('message', (e) => {
    if (e.data && e.data.type === 'mailflow:corps') { document.body.innerHTML = e.data.html; hauteur() }
  })
  parent.postMessage({ type: 'mailflow:pret' }, '*')
</script></body>`,
    ],
    { type: 'text/html' },
  ),
)

interface InternesTauri {
  convertFileSrc: (chemin: string, protocole?: string) => string
}

mockWindows('main')
mockConvertFileSrc('linux')
{
  const internes = (window as unknown as { __TAURI_INTERNALS__: InternesTauri })
    .__TAURI_INTERNALS__
  const convertir = internes.convertFileSrc
  internes.convertFileSrc = (chemin, protocole) =>
    protocole === 'mailflow-corps' ? CADRE : convertir(chemin, protocole)
}
mockIPC((cmd, payload) => repondre(cmd, (payload ?? {}) as Record<string, unknown>), {
  shouldMockEvents: true,
})
