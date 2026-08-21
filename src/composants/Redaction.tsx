/**
 * La fenêtre où l'on écrit un message.
 *
 * # Ce qu'elle fait, et ce qu'elle ne fait pas
 *
 * Quatre champs : destinataires, copies, objet, corps. Le corps est du texte
 * brut, et il part en `text/plain`. Ni mise en forme, ni pièces jointes, ni
 * signature — c'est ce qui a été demandé, et chaque forme de plus est une forme
 * de plus à vérifier avant d'envoyer quelque chose au nom de quelqu'un.
 *
 * Elle sert deux gestes qui ne diffèrent que par leur contenu de départ :
 * écrire à quelqu'un, et transférer une lettre. Les faire vivre dans deux
 * composants aurait donné deux fenêtres qui divergent — c'est déjà arrivé sur
 * ce projet avec la fenêtre de lecture.
 *
 * # Sur la validation
 *
 * Elle n'est pas ici. Les adresses et l'objet sont contrôlés par Rust, dans
 * `gmail::redaction::composer`, qui refuse net une fin de ligne dans un
 * en-tête. Un second contrôle ici les ferait diverger le jour où l'un des deux
 * changerait, et c'est celui de Rust qui décide puisque c'est lui qui compose.
 *
 * Le seul jugement porté ici est celui du bouton : il reste inerte tant qu'il
 * n'y a ni destinataire ni objet, pour ne pas faire faire l'aller-retour à un
 * message qui ne peut pas partir.
 */
import { useState } from 'react'
import { Bouton, Icone, Modale } from './base'
import { decouperAdresses, type Brouillon } from '../lib/redaction'
import { ChampDestinataires } from './ChampDestinataires'
import type { Connaissance } from '../lib/contacts'
import { messageDErreur, messageEnvoyer } from '../lib/tauri'

export function Redaction({
  depart,
  de,
  carnet,
  onFermer,
  onEnvoye,
}: {
  /** Ce que la fenêtre affiche d'emblée. Vierge pour un message neuf. */
  depart: Brouillon
  /** Adresse du compte connecté, montrée en pied : le message part de là. */
  de: string | null
  /** Les gens qui figurent déjà dans vos messages. Voir `lib/contacts`. */
  carnet: readonly Connaissance[]
  onFermer: () => void
  /** Appelé après un envoi réussi, pour l'annoncer là où on annonce. */
  onEnvoye: (message: string) => void
}) {
  const [brouillon, setBrouillon] = useState(depart)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Le champ « Cc » est replié tant qu'il est vide : la plupart des messages
  // n'en ont pas, et un champ vide de plus est une ligne de plus à survoler.
  // Il s'ouvre déjà rempli quand le brouillon de départ en porte un.
  const [copiesVisibles, setCopiesVisibles] = useState(Boolean(depart.copies))

  const changer = (champ: keyof Brouillon) => (valeur: string) =>
    setBrouillon((b) => ({ ...b, [champ]: valeur }))

  const destinataires = decouperAdresses(brouillon.destinataires)
  const envoyable = destinataires.length > 0 && Boolean(brouillon.sujet.trim())

  const envoyer = async () => {
    if (!envoyable || enCours) return

    setEnCours(true)
    setErreur(null)

    try {
      await messageEnvoyer(
        destinataires,
        decouperAdresses(brouillon.copies),
        brouillon.sujet,
        brouillon.corps,
      )
      onEnvoye('Message envoyé.')
      onFermer()
    } catch (e) {
      // L'échec reste dans la fenêtre, et la fenêtre reste ouverte : refermer
      // sur une erreur ferait perdre un texte qu'on vient d'écrire.
      setErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Modale
      taille="moyenne"
      titre={depart.sujet ? 'Transférer le message' : 'Nouveau message'}
      sous={de ? `Envoyé depuis ${de}` : undefined}
      onFermer={onFermer}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void envoyer()
        }}
        className="flex flex-col gap-3"
      >
        <Ligne titre="À">
          <ChampDestinataires
            valeur={brouillon.destinataires}
            onChange={changer('destinataires')}
            carnet={carnet}
            libelle="Destinataires"
            placeholder="Un nom ou une adresse"
            autoFocus
          />
          {!copiesVisibles && (
            <button
              type="button"
              onClick={() => setCopiesVisibles(true)}
              className="bouton flex-none rounded-full px-3 py-1.5 text-[0.6875rem] font-medium"
            >
              Cc
            </button>
          )}
        </Ligne>

        {copiesVisibles && (
          <Ligne titre="Cc">
            <ChampDestinataires
              valeur={brouillon.copies}
              onChange={changer('copies')}
              carnet={carnet}
              libelle="Copies"
              placeholder="Un nom ou une adresse"
            />
          </Ligne>
        )}

        <Ligne titre="Objet">
          <Saisie
            valeur={brouillon.sujet}
            onChange={changer('sujet')}
            libelle="Objet du message"
            placeholder="De quoi s'agit-il ?"
          />
        </Ligne>

        <textarea
          value={brouillon.corps}
          onChange={(e) => changer('corps')(e.target.value)}
          aria-label="Corps du message"
          placeholder="Écrivez votre message…"
          rows={20}
          className="champ-de-saisie selectionnable resize-none rounded-2xl border px-4 py-3 text-[0.8125rem] leading-relaxed outline-none placeholder:text-[var(--sub)]"
          style={{
            background: 'var(--sunk)',
            borderColor: 'var(--line)',
            color: 'var(--fg)',
            // Une hauteur plancher : sans elle, la fenêtre se rétractait sur un
            // message court et l'on écrivait dans une fente.
            minHeight: '22rem',
          }}
        />

        {erreur && (
          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
            style={{ background: 'var(--sunk)' }}
          >
            <Icone nom="error" taille="1rem" style={{ color: '#d93025' }} />
            <span className="min-w-0 flex-1 text-[0.75rem] leading-relaxed">{erreur}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Bouton onClick={onFermer}>Annuler</Bouton>
          <Bouton
            type="submit"
            variante="principal"
            icone="send"
            disabled={!envoyable || enCours}
          >
            {enCours ? 'Envoi…' : 'Envoyer'}
          </Bouton>
        </div>
      </form>
    </Modale>
  )
}

/** Une ligne d'en-tête : son intitulé à gauche, le champ à droite. */
function Ligne({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-baseline gap-3 border-b pb-2.5"
      style={{ borderColor: 'var(--line)' }}
    >
      <span
        className="w-10 flex-none pt-1.5 text-[0.75rem] font-semibold"
        style={{ color: 'var(--sub)' }}
      >
        {titre}
      </span>
      {children}
    </div>
  )
}

/** Un champ d'en-tête, sans cadre : la ligne le souligne déjà. */
function Saisie({
  valeur,
  onChange,
  libelle,
  placeholder,
  autoFocus = false,
}: {
  valeur: string
  onChange: (v: string) => void
  libelle: string
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={libelle}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="champ-de-saisie selectionnable min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-[var(--sub)]"
      style={{ color: 'var(--fg)' }}
    />
  )
}
