import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Bouton, Icone, Modale } from '../../composants/base'
import { lienOuvrir, llmCleEffacer, llmCleEnregistrer, llmEtat, messageDErreur } from '../../lib/tauri'
import type { EtatLlm } from '../../types/backend'
import { Reglage } from './Reglage'
import { TEINTE_REFUS } from './types'

export function ResumesIA({ onErreur }: { onErreur: (message: string) => void }) {
  const [etat, setEtat] = useState<EtatLlm | null>(null)
  const [saisie, setSaisie] = useState(false)

  useEffect(() => {
    void llmEtat().then(setEtat).catch(() => undefined)
  }, [])

  const effacer = async () => {
    try {
      await llmCleEffacer()
      setEtat(await llmEtat())
    } catch (e) {
      onErreur(messageDErreur(e))
    }
  }

  return (
    <>
      <Reglage
        icone="auto_awesome"
        titre="Résumés automatiques des newsletters"
        detail="Un modèle de Google lit vos newsletters et en écrit une phrase. Facultatif, et gratuit."
      >
        {etat?.cleConfiguree ? (
          <Bouton
            compact
            icone="delete"
            variante="danger"
            onClick={() => void effacer()}
          >
            Retirer
          </Bouton>
        ) : (
          <Bouton compact variante="principal" onClick={() => setSaisie(true)}>
            Configurer
          </Bouton>
        )}
      </Reglage>

      {saisie && (
        <ModaleCleResumes
          onFermer={() => setSaisie(false)}
          onEnregistree={async () => {
            setSaisie(false)
            setEtat(await llmEtat().catch(() => null))
          }}
        />
      )}
    </>
  )
}

function ModaleCleResumes({
  onFermer,
  onEnregistree,
}: {
  onFermer: () => void
  onEnregistree: () => void | Promise<void>
}) {
  const [cle, setCle] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)

  const enregistrer = async () => {
    setEnCours(true)
    setRefus(null)
    try {
      await llmCleEnregistrer(cle)
      setCle('')
      await onEnregistree()
    } catch (e) {
      setRefus(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const pretA = Boolean(cle.trim()) && !enCours

  return (
    <Modale
      titre="Résumés automatiques des newsletters"
      sous="Un modèle de Google lit chaque newsletter et en écrit une phrase."
      onFermer={onFermer}
    >
      <div className="flex flex-col gap-4">
        <Etape numero={1} titre="Obtenir une clé">
          <p>
            Elle s'obtient sur Google AI Studio avec le compte Google que vous
            avez déjà. Aucune carte bancaire n'est demandée.
          </p>
          <Bouton
            compact
            icone="open_in_new"
            onClick={() => {
              void lienOuvrir('https://aistudio.google.com/apikey').catch((e) =>
                setRefus(messageDErreur(e)),
              )
            }}
          >
            Ouvrir Google AI Studio
          </Bouton>
        </Etape>

        <Etape numero={2} titre="La coller ici">
          <input
            type="password"
            value={cle}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pretA) void enregistrer()
            }}
            placeholder="AIza…"
            aria-label="Clé d'API pour les résumés"
            className="champ-de-saisie selectionnable w-full rounded-lg border bg-transparent px-3 text-[0.8125rem] outline-none"
            style={{
              borderColor: refus ? TEINTE_REFUS : 'var(--line)',
              color: 'var(--fg)',
              height: '2.4rem',
            }}
          />
          {refus && (
            <p
              className="flex items-start gap-1.5 text-[0.75rem]"
              style={{ color: TEINTE_REFUS }}
            >
              <Icone nom="error" taille="0.875rem" />
              <span>{refus}</span>
            </p>
          )}
          <p className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            La clé est rangée dans le trousseau du système, jamais dans un
            fichier de l'application. Elle n'est enregistrée qu'après un
            véritable appel : une clé révoquée est refusée tout de suite plutôt
            qu'au premier relevé.
          </p>
        </Etape>

        <div
          className="flex items-start gap-2.5 rounded-xl border p-3"
          style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
        >
          <Icone nom="shield" taille="1rem" style={{ color: 'var(--sub)' }} />
          <p className="text-[0.75rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
            <strong style={{ color: 'var(--fg)' }}>
              Le palier gratuit de Google n'est pas confidentiel :
            </strong>{' '}
            ce qui lui est envoyé peut servir à améliorer ses modèles. Seules
            les newsletters partent — jamais vos messages personnels, jamais vos
            rappels de formation — et les adresses web, dont les liens de
            désabonnement qui portent la vôtre, sont retirées avant l'envoi.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Bouton onClick={onFermer}>Annuler</Bouton>
          <Bouton
            variante="principal"
            icone="check_circle"
            enAttente={enCours}
            disabled={!pretA}
            onClick={() => void enregistrer()}
          >
            {enCours ? 'Vérification…' : 'Tester et enregistrer'}
          </Bouton>
        </div>
      </div>
    </Modale>
  )
}

function Etape({
  numero,
  titre,
  children,
}: {
  numero: number
  titre: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[0.75rem] font-semibold"
        style={{ background: 'var(--sunk)', color: 'var(--sub)' }}
      >
        {numero}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="text-[0.8125rem] font-semibold">{titre}</div>
        <div
          className="flex w-full flex-col items-start gap-2 text-[0.8125rem] leading-relaxed"
          style={{ color: 'var(--sub)' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
