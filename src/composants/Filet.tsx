/**
 * Le filet sous l'application : ce qui reste à l'écran quand tout tombe.
 *
 * # Pourquoi il existe
 *
 * Une exception levée pendant un rendu ne noircit pas seulement le composant
 * fautif : React **démonte l'arbre entier**. La fenêtre devient blanche, sans
 * un mot, sans un bouton, sans la moindre indication de ce qui s'est passé. Du
 * point de vue de l'utilisateur, l'application a disparu.
 *
 * C'est arrivé plusieurs fois sur ce projet — une couleur manquante dans un
 * tableau, un champ absent d'un relevé écrit par une version antérieure — et à
 * chaque fois le diagnostic a dû se faire à l'aveugle, faute de la moindre
 * trace. Un écran blanc ne dit ni quoi, ni où, ni quand.
 *
 * # Ce qu'il fait, et ce qu'il ne fait pas
 *
 * Il **ne répare rien**. Il rend la panne lisible : ce qui a été levé, et deux
 * gestes pour s'en sortir — recharger, ou copier le détail pour le rapporter.
 * Un filet qui prétendrait rattraper l'erreur en la masquant serait pire que
 * l'écran blanc, parce qu'on croirait l'application saine.
 *
 * Le détail technique est affiché **replié**. Il ne s'adresse pas au public de
 * MailFlow, mais c'est le seul moyen qu'un utilisateur a de rapporter autre
 * chose que « ça ne marche plus ».
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface EtatDuFilet {
  erreur: Error | null
  pile: string | null
}

export class Filet extends Component<{ children: ReactNode }, EtatDuFilet> {
  override state: EtatDuFilet = { erreur: null, pile: null }

  static getDerivedStateFromError(erreur: Error): Partial<EtatDuFilet> {
    return { erreur }
  }

  override componentDidCatch(erreur: Error, infos: ErrorInfo) {
    // La console reste la trace la plus complète — elle porte la pile de
    // composants, que l'affichage ne montre qu'abrégée.
    console.error('rendu interrompu', erreur, infos.componentStack)
    this.setState({ pile: infos.componentStack ?? null })
  }

  override render() {
    const { erreur, pile } = this.state
    if (!erreur) return this.props.children

    const detail = [erreur.message, erreur.stack, pile]
      .filter(Boolean)
      .join('\n\n')

    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center"
        style={{ background: 'var(--bg)', color: 'var(--fg)' }}
      >
        <div className="text-[1.1875rem] font-semibold tracking-tight">
          L'affichage s'est interrompu
        </div>

        <p className="max-w-md text-[0.9062rem] leading-relaxed" style={{ color: 'var(--sub)' }}>
          Rien n'est perdu : vos messages sont chez Gmail, vos règles sur votre
          disque. Recharger suffit le plus souvent.
        </p>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bouton bouton-principal inline-flex h-9 items-center rounded-lg px-3.5 text-xs font-semibold"
          >
            Recharger
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(detail)}
            className="bouton bouton-neutre inline-flex h-9 items-center rounded-lg px-3.5 text-xs font-semibold"
          >
            Copier le détail
          </button>
        </div>

        {/* Replié : ce n'est pas pour le public de MailFlow, mais c'est le seul
            moyen de rapporter autre chose que « ça ne marche plus ». */}
        <details className="w-full max-w-2xl pt-2 text-left">
          <summary className="cursor-pointer text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            Détail technique
          </summary>
          <pre
            className="selectionnable mt-2 max-h-64 overflow-auto rounded-lg border p-3 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap"
            style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
          >
            {detail}
          </pre>
        </details>
      </div>
    )
  }
}
