/**
 * Lecteur PDF, isolé dans un fil d'exécution à part.
 *
 * # Pourquoi un « worker » et pas un simple affichage
 *
 * Un PDF est un format riche : polices embarquées, images compressées, flux de
 * commandes. L'analyser, c'est exécuter du code sur des octets écrits par un
 * inconnu — le point faible historique de tous les lecteurs de courrier. Ce
 * travail ne doit donc pas se faire dans le fil qui tient l'application.
 *
 * Ce fichier est ce fil séparé. Ce qu'il en sort n'est jamais du PDF, ni du
 * balisage, ni du texte à interpréter : **des images déjà rendues**, sous forme
 * d'`ImageBitmap`, c'est-à-dire des pixels et rien d'autre. Même si l'analyse
 * était mise en défaut, ce qui traverse cette frontière reste inerte.
 *
 * Ce fil n'a par construction :
 *
 * - aucun accès au document de l'application — pas de DOM, pas de fenêtre ;
 * - aucun accès au stockage local des préférences, réservé à la fenêtre ;
 * - aucune sortie réseau utile : la politique de sécurité de l'application
 *   n'autorise que sa propre origine ;
 * - aucun moyen d'appeler le backend Rust : les commandes Tauri exigent une clé
 *   qui n'existe que dans la fenêtre.
 *
 * Les options passées à pdf.js referment le reste : ni WebAssembly compilé à la
 * volée, ni récupération réseau de polices ou de tables de caractères. Tout ce
 * qu'il faut lire est déjà dans le fichier, et ce qui manque manquera — un
 * aperçu approximatif vaut mieux qu'une porte ouverte.
 */
/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist'
import urlDuTravailleur from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as codeDuTravailleur from 'pdfjs-dist/build/pdf.worker.min.mjs'

// pdf.js sépare lui-même l'analyse du rendu. Selon ce que le moteur autorise
// depuis un fil secondaire, il ouvre un fil imbriqué ou se rabat sur le code
// déjà chargé ici — les deux restent à l'intérieur de ce cloisonnement.
;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = codeDuTravailleur
pdfjs.GlobalWorkerOptions.workerSrc = urlDuTravailleur

/** Au-delà, on s'arrête : un aperçu n'est pas une lecture intégrale. */
const PAGES_MAX = 40

/** Largeur de rendu, en pixels. Au-delà, la mémoire coûte plus que la finesse. */
const LARGEUR_RENDU = 1_400

export interface DemandeApercuPdf {
  octets: ArrayBuffer
}

export type ReponseApercuPdf =
  | { pages: ImageBitmap[]; total: number }
  /** `cause` distingue ce qui se corrige d'un fichier à l'autre de ce qui ne se
   *  corrigera pas : un moteur trop ancien ne saura jamais dessiner ici. */
  | { erreur: string; cause: 'document' | 'systeme' }

/** `self` vu comme ce qu'il est ici : un fil dédié, sans fenêtre autour. */
const fil = self as unknown as DedicatedWorkerGlobalScope

fil.onmessage = async (evenement: MessageEvent<DemandeApercuPdf>) => {
  try {
    const pages = await rendre(evenement.data.octets)
    const reponse: ReponseApercuPdf = { pages: pages.images, total: pages.total }
    // Les images sont transférées et non copiées : elles quittent ce fil.
    fil.postMessage(reponse, pages.images)
  } catch (e) {
    const reponse: ReponseApercuPdf = {
      erreur: e instanceof Error ? e.message : 'document illisible',
      cause: e instanceof SansToileHorsEcran ? 'systeme' : 'document',
    }
    fil.postMessage(reponse)
  }
}

/** Le moteur ne sait pas dessiner hors de l'écran : l'isolement est impossible. */
class SansToileHorsEcran extends Error {}

async function rendre(
  octets: ArrayBuffer,
): Promise<{ images: ImageBitmap[]; total: number }> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new SansToileHorsEcran("dessin hors de l'écran indisponible")
  }

  const lecture = pdfjs.getDocument({
    data: new Uint8Array(octets),
    // Rien ne part sur le réseau et rien n'est compilé à la volée : tout ce
    // qu'il faut lire est déjà là, et ce qui manque manquera.
    useWasm: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
  })
  const document = await lecture.promise

  const total = document.numPages
  const images: ImageBitmap[] = []

  for (let numero = 1; numero <= Math.min(total, PAGES_MAX); numero += 1) {
    const page = await document.getPage(numero)
    const naturelle = page.getViewport({ scale: 1 })
    const echelle = Math.min(2, LARGEUR_RENDU / naturelle.width)
    const vue = page.getViewport({ scale: echelle })

    const toile = new OffscreenCanvas(
      Math.ceil(vue.width),
      Math.ceil(vue.height),
    )
    const contexte = toile.getContext('2d')
    if (!contexte) throw new Error('rendu impossible')

    // Le fond est peint : un PDF ne déclare pas le sien, et une page
    // transparente se lirait mal sur le fond sombre de l'application.
    contexte.fillStyle = '#FFFFFF'
    contexte.fillRect(0, 0, toile.width, toile.height)

    await page.render({
      // pdf.js déclare une toile du document ; celle-ci n'en est pas une, et
      // c'est justement le but — rien ici n'appartient à une page affichée.
      canvas: toile as unknown as HTMLCanvasElement,
      canvasContext: contexte as unknown as CanvasRenderingContext2D,
      viewport: vue,
    }).promise

    images.push(toile.transferToImageBitmap())
    page.cleanup()
  }

  await lecture.destroy()
  return { images, total }
}
