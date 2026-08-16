/**
 * Le fil de travail de pdf.js n'est pas typé par le paquet.
 *
 * Il n'est importé que pour ses effets de bord : mettre son code à disposition
 * du fil qui lit le document, sans dépendre d'un fil imbriqué que tous les
 * moteurs n'autorisent pas. Voir `lib/apercu-pdf.worker.ts`.
 */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs'
