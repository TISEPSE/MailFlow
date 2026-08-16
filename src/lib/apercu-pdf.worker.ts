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

/**
 * Ce que pdf.js réclame d'une fenêtre, et qui n'existe pas dans un fil.
 *
 * La bibliothèque est écrite pour tourner dans une page. Deux endroits de son
 * code s'en souviennent sans le vérifier, et chacun casse d'une façon
 * différente :
 *
 * - avant d'ouvrir **son propre** fil d'analyse, elle compare son origine à
 *   `window.location`. L'exception qui suit est avalée, et la bibliothèque se
 *   rabat en silence sur un « faux fil » qui charge son code d'analyse **ici
 *   même** — lequel s'approprie alors le canal de messages de ce fichier. Plus
 *   aucune réponse ne parvenait à la fenêtre : c'est ce qui faisait échouer
 *   tout aperçu de PDF ;
 * - au rendu, elle cadence son travail sur `requestAnimationFrame`.
 *
 * Ce substitut donne ces deux choses, et rien d'autre. Il n'ouvre aucun accès :
 * il ne porte ni document, ni stockage, ni fenêtre réelle — seulement l'adresse
 * de ce fichier et un minuteur.
 */
;(globalThis as { window?: unknown }).window = {
  location: self.location,
  requestAnimationFrame: (f: FrameRequestCallback) =>
    setTimeout(() => f(performance.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
}

const pdfjs = await import('pdfjs-dist')
const { default: urlDuTravailleur } = await import(
  'pdfjs-dist/build/pdf.worker.min.mjs?url'
)

// L'analyse du document se fait dans un fil ouvert par pdf.js, à partir de ce
// fichier-ci : un cran de plus à l'intérieur du cloisonnement, jamais en
// dehors.
pdfjs.GlobalWorkerOptions.workerSrc = urlDuTravailleur

/**
 * Fabrique de toiles qui ne réclame pas de document.
 *
 * pdf.js crée des toiles intermédiaires pour les transparences et les motifs.
 * La sienne appelle `document.createElement`, qui n'existe pas ici. Celle-ci
 * rend des toiles hors écran, du même métal que celle où la page est dessinée.
 */
class ToilesHorsEcran {
  create(largeur: number, hauteur: number) {
    const canvas = new OffscreenCanvas(Math.max(1, largeur), Math.max(1, hauteur))
    return { canvas, context: canvas.getContext('2d') }
  }

  reset(fournie: { canvas: OffscreenCanvas }, largeur: number, hauteur: number) {
    fournie.canvas.width = largeur
    fournie.canvas.height = hauteur
  }

  destroy(fournie: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (fournie.canvas) {
      fournie.canvas.width = 0
      fournie.canvas.height = 0
    }
    fournie.canvas = null
    fournie.context = null
  }
}

/** Au-delà, on s'arrête : un aperçu n'est pas une lecture intégrale. */
const PAGES_MAX = 40

/** Largeur de rendu, en pixels. Au-delà, la mémoire coûte plus que la finesse. */
const LARGEUR_RENDU = 1_400

export interface DemandeApercuPdf {
  octets: ArrayBuffer
}

export type ReponseApercuPdf =
  /** Premier message, et le seul que la fenêtre doive attendre avant d'écrire.
   *
   *  Ce fichier charge pdf.js avant de pouvoir répondre à quoi que ce soit, et
   *  WebKit **jette** les messages adressés à un fil qui n'a pas fini de
   *  s'initialiser — sans erreur, sans trace. Un aperçu de PDF restait donc en
   *  attente pour toujours. La fenêtre attend désormais ce signal. */
  | { pret: true }
  | { pages: ImageBitmap[]; total: number }
  /** `cause` distingue ce qui se corrige d'un fichier à l'autre de ce qui ne se
   *  corrigera pas : un moteur trop ancien ne saura jamais dessiner ici. */
  | { erreur: string; cause: 'document' | 'systeme' }

/** `self` vu comme ce qu'il est ici : un fil dédié, sans fenêtre autour. */
const fil = self as unknown as DedicatedWorkerGlobalScope

fil.postMessage({ pret: true } satisfies ReponseApercuPdf)

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
    CanvasFactory: ToilesHorsEcran,

    // Les glyphes sont dessinés trait par trait, et non par une police
    // installée à la volée.
    //
    // Sans cela, pdf.js déclare les polices du document au moteur, par
    // `document.fonts` — un objet qui n'existe pas dans un fil. L'installation
    // échouait donc en silence et chaque lettre sortait en rectangle vide.
    // C'est ce que montrait l'aperçu d'une facture : la mise en page juste, le
    // logo juste, et pas un caractère lisible.
    //
    // Le tracé direct est aussi le choix le plus sûr : aucune police venue d'un
    // inconnu n'est confiée au moteur de rendu de caractères du système, qui
    // est un analyseur de format de plus.
    disableFontFace: true,

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
