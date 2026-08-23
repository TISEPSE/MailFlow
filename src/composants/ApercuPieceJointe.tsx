/**
 * Fenêtre d'aperçu d'une pièce jointe.
 *
 * # Ce qui arrive ici, et ce qui n'y arrive pas
 *
 * Rien de ce qui s'affiche dans cette fenêtre n'est le fichier reçu. Le backend
 * décode les images puis les ré-encode — voir `gmail::apercu` — et refuse tout
 * ce qu'il ne sait pas reconstruire. Le texte est rendu comme du texte, jamais
 * comme du balisage : un `.html` joint se lit en clair, ce qui est précisément
 * ce qu'on veut en voir.
 *
 * Le PDF est le seul format transmis tel quel, parce qu'il n'existe pas de
 * moyen de le « reconstruire ». Il est donc lu dans un fil d'exécution à part,
 * qui ne rend que des pixels : voir `lib/apercu-pdf.worker.ts`.
 *
 * # Voir n'est pas garder
 *
 * L'aperçu ne laisse aucune trace sur le disque. Enregistrer reste un geste
 * distinct, et le bouton est là pour ça — regarder une facture ne doit pas
 * remplir le dossier de téléchargement.
 */
import { useEffect, useRef, useState } from 'react'
import { Bouton, Icone, Modale } from './base'
import { messageDErreur, pieceJointeApercu, pieceJointeEnregistrer } from '../lib/tauri'
import type { Apercu, PieceJointe } from '../types/backend'
import type { ReponseApercuPdf } from '../lib/apercu-pdf.worker'
import { poids } from '../lib/presentation'

export function ApercuPieceJointe({
  message,
  piece,
  onFermer,
  onEnregistree,
}: {
  message: string
  piece: PieceJointe
  onFermer: () => void
  /** Prévient la vue appelante du chemin écrit, pour qu'elle le dise. */
  onEnregistree: (chemin: string) => void
}) {
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)

  useEffect(() => {
    let abandonne = false

    void (async () => {
      try {
        const recu = await pieceJointeApercu(message, piece.id)
        if (!abandonne) setApercu(recu)
      } catch (e) {
        if (!abandonne) setErreur(messageDErreur(e))
      }
    })()

    return () => {
      abandonne = true
    }
  }, [message, piece.id])

  const enregistrer = async () => {
    if (enregistrement) return
    setEnregistrement(true)
    try {
      onEnregistree(await pieceJointeEnregistrer(message, piece.id, piece.nom))
    } catch (e) {
      setErreur(messageDErreur(e))
    } finally {
      setEnregistrement(false)
    }
  }

  return (
    <Modale titre={piece.nom} sous={poids(piece.taille)} onFermer={onFermer} taille="grande">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div
          className="flex min-h-[18rem] flex-1 items-center justify-center overflow-auto rounded-xl"
          style={{ background: 'var(--sunk)' }}
        >
          {erreur ? (
            <Explication icone="error" texte={erreur} />
          ) : apercu === null ? (
            <Attente texte="Préparation de l'aperçu…" />
          ) : (
            <Contenu apercu={apercu} />
          )}
        </div>

        <div className="flex flex-none items-center justify-between gap-3">
          <span className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            L'aperçu ne conserve rien : enregistrez le fichier pour le garder.
          </span>
          <div className="flex items-center gap-2">
            <Bouton onClick={onFermer}>Fermer</Bouton>
            <Bouton
              variante="principal"
              icone="download"
              onClick={() => void enregistrer()}
              enAttente={enregistrement}
            >
              Enregistrer
            </Bouton>
          </div>
        </div>
      </div>
    </Modale>
  )
}

function Contenu({ apercu }: { apercu: Apercu }) {
  switch (apercu.genre) {
    case 'image':
      return (
        <img
          // Toujours en PNG : c'est le backend qui l'a produit, à partir des
          // seuls pixels du fichier reçu.
          src={`data:image/png;base64,${apercu.donnees}`}
          alt="Aperçu de la pièce jointe"
          className="max-h-full max-w-full object-contain"
        />
      )

    case 'texte':
      return (
        <pre
          className="selectionnable h-full w-full overflow-auto p-6 text-[0.8125rem] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--fg)' }}
        >
          {apercu.contenu}
        </pre>
      )

    case 'pdf':
      return <ApercuPdf donnees={apercu.donnees} />

    case 'impossible':
      return <Explication icone="visibility_off" texte={apercu.raison} />
  }
}

/** Une attente brève, sans barre ni décompte : il n'y a rien à décompter. */
function Attente({ texte }: { texte: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 p-10">
      <Icone nom="progress_activity" taille="1.25rem" tourne style={{ color: 'var(--sub)' }} />
      <span className="text-[0.8125rem]" style={{ color: 'var(--sub)' }}>
        {texte}
      </span>
    </div>
  )
}

function Explication({ icone, texte }: { icone: 'error' | 'visibility_off'; texte: string }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <Icone nom={icone} taille="2rem" style={{ color: 'var(--sub)' }} />
      <p className="text-[0.8438rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
        {texte}
      </p>
    </div>
  )
}

/**
 * Les pages du PDF, dessinées ailleurs.
 *
 * Le fil séparé ne renvoie que des `ImageBitmap` : des pixels, sans structure à
 * interpréter. Ils sont recopiés ici dans des toiles, et c'est tout ce que le
 * document aura eu le droit de produire.
 */
function ApercuPdf({ donnees }: { donnees: string }) {
  const conteneur = useRef<HTMLDivElement>(null)
  const [etat, setEtat] = useState<'lecture' | 'fait' | string>('lecture')
  const [tronque, setTronque] = useState(0)

  useEffect(() => {
    const cible = conteneur.current
    if (!cible) return

    const travailleur = new Worker(
      new URL('../lib/apercu-pdf.worker.ts', import.meta.url),
      { type: 'module' },
    )

    // Le décodage a lieu ici, dans la fenêtre : ce qui traverse est un tampon
    // d'octets, transféré et non copié.
    const brut = atob(donnees)
    const octets = new Uint8Array(brut.length)
    for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i)

    travailleur.onmessage = (evenement: MessageEvent<ReponseApercuPdf>) => {
      const reponse = evenement.data

      // Le fil charge pdf.js avant de pouvoir répondre, et un message adressé à
      // un fil qui n'a pas fini de s'initialiser est jeté sans un mot. On
      // attend donc qu'il se déclare prêt — attendre un délai arbitraire
      // reviendrait à parier sur la vitesse de la machine.
      if ('pret' in reponse) {
        travailleur.postMessage({ octets: octets.buffer }, [octets.buffer])
        return
      }

      if ('erreur' in reponse) {
        // Un document illisible et un système incapable ne se réparent pas de
        // la même façon : l'un se remplace, l'autre se met à jour.
        setEtat(
          reponse.cause === 'systeme'
            ? "Ce système ne permet pas d'afficher un PDF sans risque. Enregistrez le document pour l'ouvrir avec votre lecteur habituel."
            : "Ce PDF n'a pas pu être affiché. Enregistrez-le pour l'ouvrir.",
        )
        console.error('pdf illisible', reponse.erreur)
        return
      }

      for (const image of reponse.pages) {
        const toile = document.createElement('canvas')
        toile.width = image.width
        toile.height = image.height
        toile.className = 'w-full rounded-lg'
        toile.style.boxShadow = 'var(--shadow)'
        toile.getContext('2d')?.drawImage(image, 0, 0)
        image.close()
        cible.append(toile)
      }

      setTronque(Math.max(0, reponse.total - reponse.pages.length))
      setEtat('fait')
    }

    travailleur.onerror = () => {
      setEtat("Ce PDF n'a pas pu être affiché. Enregistrez-le pour l'ouvrir.")
    }

    return () => {
      travailleur.terminate()
      cible.replaceChildren()
    }
  }, [donnees])

  return (
    <div className="h-full w-full overflow-auto p-6">
      {etat === 'lecture' && <Attente texte="Lecture du document…" />}
      {typeof etat === 'string' && etat !== 'lecture' && etat !== 'fait' && (
        <Explication icone="visibility_off" texte={etat} />
      )}
      <div ref={conteneur} className="flex flex-col items-center gap-4" />
      {tronque > 0 && (
        <p className="pt-4 text-center text-[0.75rem]" style={{ color: 'var(--sub)' }}>
          {tronque === 1
            ? 'Une page supplémentaire n’est pas affichée.'
            : `${tronque} pages supplémentaires ne sont pas affichées.`}{' '}
          Enregistrez le document pour le lire en entier.
        </p>
      )}
    </div>
  )
}
