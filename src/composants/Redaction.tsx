/**
 * La fenêtre où l'on écrit un message avec l'interface et les boutons natifs de Gmail.
 *
 * # Architecture
 *
 * - Les en-têtes (destinataires, copies, objet) sont fixés en haut.
 * - La barre de formatage s'affiche/se masque avec le bouton `Aa`.
 * - Le corps du texte défile indépendamment.
 * - La barre d'actions inférieure (Envoyer, pièces jointes, Drive, emoji, corbeille...)
 *   reste TOUJOURS visible et indépendante du défilement.
 */
import { useState } from 'react'
import { Icone, Modale } from './base'
import { decouperAdresses, type Brouillon } from '../lib/redaction'
import { ChampDestinataires } from './ChampDestinataires'
import type { Connaissance } from '../lib/contacts'
import { messageDErreur, messageEnvoyer } from '../lib/tauri'

const POLICES = [
  'Sans Serif',
  'Serif',
  'Monospace',
  'Wide',
  'Garamond',
  'Georgia',
  'Tahoma',
  'Trebuchet MS',
  'Verdana',
]

const TAILLES = [
  { nom: 'Petit', taille: '0.75rem' },
  { nom: 'Normal', taille: '0.875rem' },
  { nom: 'Grand', taille: '1.125rem' },
  { nom: 'Très grand', taille: '1.375rem' },
]

export function Redaction({
  depart,
  de,
  carnet,
  logos,
  onFermer,
  onEnvoye,
}: {
  /** Ce que la fenêtre affiche d'emblée. Vierge pour un message neuf. */
  depart: Brouillon
  /** Adresse du compte connecté, montrée en pied : le message part de là. */
  de: string | null
  /** Les gens qui figurent déjà dans vos messages. */
  carnet: readonly Connaissance[]
  /** Logos des domaines enregistrés. */
  logos?: Record<string, string>
  onFermer: () => void
  /** Appelé après un envoi réussi, pour l'annoncer là où on annonce. */
  onEnvoye: (message: string) => void
}) {
  const [brouillon, setBrouillon] = useState(depart)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Champs d'en-tête repliables
  const [copiesVisibles, setCopiesVisibles] = useState(Boolean(depart.copies))
  const [cciVisibles, setCciVisibles] = useState(false)
  const [cci, setCci] = useState('')

  // Barre d'outils de formatage (bouton Aa)
  const [formatageActif, setFormatageActif] = useState(true)
  const [police, setPolice] = useState('Sans Serif')
  const [taillePolice, setTaillePolice] = useState('Normal')
  const [gras, setGras] = useState(false)
  const [italique, setItalique] = useState(false)
  const [souligne, setSouligne] = useState(false)
  const [alignement, setAlignement] = useState<'left' | 'center' | 'right' | 'justify'>('left')

  // Menus déroulants
  const [menuPolice, setMenuPolice] = useState(false)
  const [menuTaille, setMenuTaille] = useState(false)
  const [menuProgrammer, setMenuProgrammer] = useState(false)
  const [menuPlus, setMenuPlus] = useState(false)
  const [infoBulleAction, setInfoBulleAction] = useState<string | null>(null)

  const changer = (champ: keyof Brouillon) => (valeur: string) =>
    setBrouillon((b) => ({ ...b, [champ]: valeur }))

  const destinataires = decouperAdresses(brouillon.destinataires)
  const envoyable = destinataires.length > 0 && Boolean(brouillon.sujet.trim())

  const envoyer = async () => {
    if (!envoyable || enCours) return

    setEnCours(true)
    setErreur(null)

    try {
      const toutesCopies = [
        ...decouperAdresses(brouillon.copies),
        ...decouperAdresses(cci),
      ]
      await messageEnvoyer(
        destinataires,
        toutesCopies,
        brouillon.sujet,
        brouillon.corps,
      )
      onEnvoye('Message envoyé.')
      onFermer()
    } catch (e) {
      setErreur(messageDErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const afficherInfoBulle = (texte: string) => {
    setInfoBulleAction(texte)
    window.setTimeout(() => setInfoBulleAction(null), 2500)
  }

  const policeStyle = () => {
    switch (police) {
      case 'Serif':
        return 'font-serif'
      case 'Monospace':
        return 'font-mono'
      default:
        return 'font-sans'
    }
  }

  const tailleStyle = () => {
    const trouve = TAILLES.find((t) => t.nom === taillePolice)
    return trouve ? trouve.taille : '0.875rem'
  }

  return (
    <Modale
      taille="moyenne"
      titre={depart.sujet ? 'Transférer le message' : 'Nouveau message'}
      sous={de ? `Envoyé depuis ${de}` : undefined}
      onFermer={onFermer}
      sansRembourrage
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void envoyer()
        }}
        className="flex h-[75vh] max-h-[75vh] flex-col"
      >
        {/* Section haute : En-têtes (À, Cc, Cci, Objet) - Fixe en haut */}
        <div className="flex-none space-y-2 px-6 pt-3 pb-1">
          <Ligne titre="À">
            <ChampDestinataires
              valeur={brouillon.destinataires}
              onChange={changer('destinataires')}
              carnet={carnet}
              logos={logos}
              libelle="Destinataires"
              placeholder="Un nom ou une adresse"
              autoFocus
            />
            <div className="flex flex-none items-center gap-1">
              {!copiesVisibles && (
                <button
                  type="button"
                  onClick={() => setCopiesVisibles(true)}
                  className="rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-colors hover:bg-[var(--sunk)]"
                  style={{ color: 'var(--sub)' }}
                >
                  Cc
                </button>
              )}
              {!cciVisibles && (
                <button
                  type="button"
                  onClick={() => setCciVisibles(true)}
                  className="rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-colors hover:bg-[var(--sunk)]"
                  style={{ color: 'var(--sub)' }}
                >
                  Cci
                </button>
              )}
            </div>
          </Ligne>

          {copiesVisibles && (
            <Ligne titre="Cc">
              <ChampDestinataires
                valeur={brouillon.copies}
                onChange={changer('copies')}
                carnet={carnet}
                logos={logos}
                libelle="Copies"
                placeholder="Un nom ou une adresse"
              />
            </Ligne>
          )}

          {cciVisibles && (
            <Ligne titre="Cci">
              <ChampDestinataires
                valeur={cci}
                onChange={setCci}
                carnet={carnet}
                logos={logos}
                libelle="Copies cachées"
                placeholder="Un nom ou une adresse"
              />
            </Ligne>
          )}

          <Ligne titre="Objet">
            <Saisie
              valeur={brouillon.sujet}
              onChange={changer('sujet')}
              libelle="Objet du message"
              placeholder="Objet"
            />
          </Ligne>
        </div>

        {/* Barre de formatage riche (Style Gmail Material 3) */}
        {formatageActif && (
          <div className="flex flex-none items-center overflow-x-auto min-w-0 px-5 pt-4 pb-3">
            <div
              className="flex items-center gap-0.5 rounded-full px-3 py-1 text-[0.8125rem] shadow-xs"
              style={{
                background: 'var(--sunk, #edf2fa)',
                color: 'var(--fg)',
              }}
            >
              {/* Sélecteur de Police */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMenuPolice(!menuPolice)
                    setMenuTaille(false)
                  }}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.78125rem] font-medium transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                >
                  <span className="truncate max-w-[5.5rem]">{police}</span>
                  <svg className="w-2.5 h-2.5 fill-current opacity-70" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>
                {menuPolice && (
                  <div
                    className="menu-apparait absolute top-full left-0 z-30 mt-1 min-w-[9.5rem] rounded-2xl border py-1.5 shadow-xl text-[0.8125rem]"
                    style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
                  >
                    {POLICES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setPolice(p)
                          setMenuPolice(false)
                        }}
                        className={`flex w-full px-3.5 py-1.5 text-left transition-colors hover:bg-[var(--sunk)] ${
                          police === p ? 'font-semibold text-[var(--accent)]' : ''
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-4 w-[1px] mx-1 opacity-60" style={{ background: 'var(--line)' }} />

              {/* Sélecteur de Taille TT */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMenuTaille(!menuTaille)
                    setMenuPolice(false)
                  }}
                  className="flex items-center gap-1 rounded-full px-2 py-1 transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                  title="Taille de police"
                >
                  <span className="font-bold text-[0.8125rem] tracking-tighter">TT</span>
                  <svg className="w-2.5 h-2.5 fill-current opacity-70" viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>
                {menuTaille && (
                  <div
                    className="menu-apparait absolute top-full left-0 z-30 mt-1 min-w-[7.5rem] rounded-2xl border py-1.5 shadow-xl text-[0.8125rem]"
                    style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
                  >
                    {TAILLES.map((t) => (
                      <button
                        key={t.nom}
                        type="button"
                        onClick={() => {
                          setTaillePolice(t.nom)
                          setMenuTaille(false)
                        }}
                        className={`flex w-full px-3.5 py-1.5 text-left transition-colors hover:bg-[var(--sunk)] ${
                          taillePolice === t.nom ? 'font-semibold text-[var(--accent)]' : ''
                        }`}
                      >
                        {t.nom}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-4 w-[1px] mx-1 opacity-60" style={{ background: 'var(--line)' }} />

              {/* Gras (Bold) */}
              <button
                type="button"
                onClick={() => setGras(!gras)}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  gras
                    ? 'bg-black/15 dark:bg-white/20 text-[var(--accent)] font-bold'
                    : 'hover:bg-black/8 dark:hover:bg-white/10'
                }`}
                title="Gras (Ctrl+B)"
              >
                <span className="font-bold text-[0.875rem]">B</span>
              </button>

              {/* Italique (Italic) */}
              <button
                type="button"
                onClick={() => setItalique(!italique)}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  italique
                    ? 'bg-black/15 dark:bg-white/20 text-[var(--accent)] font-bold'
                    : 'hover:bg-black/8 dark:hover:bg-white/10'
                }`}
                title="Italique (Ctrl+I)"
              >
                <span className="font-bold italic text-[0.875rem] font-serif">I</span>
              </button>

              {/* Souligné (Underline) */}
              <button
                type="button"
                onClick={() => setSouligne(!souligne)}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  souligne
                    ? 'bg-black/15 dark:bg-white/20 text-[var(--accent)] font-bold'
                    : 'hover:bg-black/8 dark:hover:bg-white/10'
                }`}
                title="Souligné (Ctrl+U)"
              >
                <span className="underline font-semibold text-[0.875rem]">U</span>
              </button>

              {/* Couleur du texte (A) */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Couleur du texte')}
                className="flex items-center gap-0.5 rounded-full px-2 py-1 transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Couleur du texte"
              >
                <div className="flex flex-col items-center leading-none">
                  <span className="font-bold text-[0.8125rem]">A</span>
                  <div className="w-3.5 h-[3px] bg-red-600 rounded-xs mt-0.5" />
                </div>
                <svg className="w-2.5 h-2.5 fill-current opacity-70" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </button>

              <div className="h-4 w-[1px] mx-1 opacity-60" style={{ background: 'var(--line)' }} />

              {/* Alignement */}
              <button
                type="button"
                onClick={() => {
                  const ordre: ('left' | 'center' | 'right' | 'justify')[] = [
                    'left',
                    'center',
                    'right',
                    'justify',
                  ]
                  const idx = ordre.indexOf(alignement)
                  setAlignement(ordre[(idx + 1) % ordre.length] ?? 'left')
                }}
                className="flex items-center gap-0.5 rounded-full px-2 py-1 transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Aligner"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z" />
                </svg>
                <svg className="w-2.5 h-2.5 fill-current opacity-70" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </button>

              {/* Liste numérotée */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Liste numérotée')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Liste numérotée"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />
                </svg>
              </button>

              {/* Liste à puces */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Liste à puces')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Liste à puces"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z" />
                </svg>
              </button>

              {/* Retrait (Indentation) */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Retrait')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Augmenter le retrait"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M11 17h10v-2H11v2zm-8-5l4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z" />
                </svg>
              </button>

              {/* Citation */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Citation')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Citation"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
                </svg>
              </button>

              {/* Barré */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Barré')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Barré"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" />
                </svg>
              </button>

              <div className="h-4 w-[1px] mx-1 opacity-60" style={{ background: 'var(--line)' }} />

              {/* Annuler / Rétablir */}
              <button
                type="button"
                onClick={() => afficherInfoBulle('Annuler')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Annuler (Ctrl+Z)"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => afficherInfoBulle('Rétablir')}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/8 dark:hover:bg-white/10"
                title="Rétablir (Ctrl+Y)"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Section médiane : Corps du message (défile indépendamment) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <textarea
            value={brouillon.corps}
            onChange={(e) => changer('corps')(e.target.value)}
            aria-label="Corps du message"
            placeholder="Écrivez votre message…"
            rows={14}
            className={`champ-de-saisie selectionnable h-full min-h-[14rem] w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-[var(--sub)] ${policeStyle()} ${
              gras ? 'font-bold' : ''
            } ${italique ? 'italic' : ''} ${souligne ? 'underline' : ''}`}
            style={{
              color: 'var(--fg)',
              fontSize: tailleStyle(),
              textAlign: alignement,
            }}
          />

          {erreur && (
            <div
              className="mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--sunk)' }}
            >
              <Icone nom="error" taille="1rem" style={{ color: '#d93025' }} />
              <span className="min-w-0 flex-1 text-[0.75rem] leading-relaxed">{erreur}</span>
            </div>
          )}
        </div>

        {/* Notification / Info bulle des actions */}
        {infoBulleAction && (
          <div className="px-6 py-1 text-center text-[0.75rem] font-medium text-[var(--sub)]">
            {infoBulleAction}
          </div>
        )}

        {/* Section basse FIXE : Barre d'actions Gmail - Toujours visible et indépendante du scroll ! */}
        <div
          className="flex flex-none items-center justify-between px-5 py-3"
          style={{
            background: 'var(--card)',
          }}
        >
          {/* Côté gauche : Bouton Envoyer split + Outils d'action natifs */}
          <div className="flex items-center gap-1">
            {/* Bouton Envoyer scindé bleu Gmail */}
            <div className="relative mr-1.5 flex items-center rounded-full bg-[#0b57d0] text-white shadow-xs transition-colors hover:bg-[#0842a0]">
              <button
                type="submit"
                disabled={!envoyable || enCours}
                className="flex items-center gap-2 rounded-l-full py-2 pr-3 pl-4 text-[0.875rem] font-medium disabled:opacity-50"
              >
                {enCours ? 'Envoi…' : 'Envoyer'}
              </button>
              <div className="h-4 w-[1px] bg-white/30" />
              <button
                type="button"
                disabled={!envoyable || enCours}
                onClick={() => setMenuProgrammer(!menuProgrammer)}
                title="Programmer l'envoi"
                className="rounded-r-full p-2 pr-2.5 hover:bg-black/10 disabled:opacity-50"
              >
                <span className="text-[0.625rem]">▼</span>
              </button>

              {menuProgrammer && (
                <div
                  className="menu-apparait absolute bottom-full left-0 z-30 mb-2 min-w-[14rem] rounded-xl border py-1.5 text-[0.8125rem] text-[var(--fg)] shadow-xl"
                  style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
                >
                  <div
                    className="border-b px-3 py-1.5 text-[0.6875rem] font-semibold text-[var(--sub)]"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    Programmer l'envoi
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuProgrammer(false)
                      afficherInfoBulle('Envoi programmé pour demain 08:00')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Demain matin (08:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuProgrammer(false)
                      afficherInfoBulle('Envoi programmé pour cet après-midi 13:00')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Cet après-midi (13:00)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuProgrammer(false)
                      afficherInfoBulle('Envoi programmé pour lundi matin 08:00')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Lundi matin (08:00)
                  </button>
                </div>
              )}
            </div>

            {/* Bouton Aa (Options de mise en forme) */}
            <button
              type="button"
              onClick={() => setFormatageActif(!formatageActif)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-[0.875rem] font-semibold transition-colors ${
                formatageActif
                  ? 'text-[var(--accent)] hover:bg-[var(--sunk)]'
                  : 'text-[var(--sub)] hover:bg-[var(--sunk)] hover:text-[var(--fg)]'
              }`}
              title="Options de mise en forme"
            >
              Aa
            </button>

            {/* Magic pen / ✨ M'aider à écrire */}
            <button
              type="button"
              onClick={() => afficherInfoBulle("M'aider à écrire (IA)")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="M'aider à écrire (IA)"
            >
              <Icone nom="auto_awesome" taille="1.125rem" />
            </button>

            {/* 📎 Joindre des fichiers */}
            <button
              type="button"
              onClick={() => afficherInfoBulle('Joindre des fichiers')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Joindre des fichiers"
            >
              <Icone nom="attach_file" taille="1.125rem" />
            </button>

            {/* 🔗 Insérer un lien */}
            <button
              type="button"
              onClick={() => {
                const url = window.prompt('URL du lien :')
                if (url) {
                  changer('corps')(brouillon.corps + (brouillon.corps ? ' ' : '') + url)
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Insérer un lien (Ctrl+K)"
            >
              <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 24 24"
                width="1.125rem"
                height="1.125rem"
                className="fill-current"
              >
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
              </svg>
            </button>

            {/* 😊 Insérer un emoji */}
            <button
              type="button"
              onClick={() => {
                changer('corps')(brouillon.corps + ' 😊')
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Insérer un emoji"
            >
              <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 24 24"
                width="1.125rem"
                height="1.125rem"
                className="fill-current"
              >
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
              </svg>
            </button>

            {/* ⏶ Insérer des fichiers avec Drive */}
            <button
              type="button"
              onClick={() => afficherInfoBulle('Google Drive')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Insérer des fichiers avec Drive"
            >
              <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 24 24"
                width="1.125rem"
                height="1.125rem"
                className="fill-current"
              >
                <path d="M7.71 3.5L1.15 15l3.43 6 6.55-11.5M9.73 15L6.3 21h13.12l3.43-6M22.85 15l-6.57-11.5H9.43L16 15" />
              </svg>
            </button>

            {/* 🖼 Insérer une photo */}
            <button
              type="button"
              onClick={() => afficherInfoBulle('Insérer une photo')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Insérer une photo"
            >
              <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 24 24"
                width="1.125rem"
                height="1.125rem"
                className="fill-current"
              >
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
              </svg>
            </button>

            {/* 🔒 Activer/désactiver le mode confidentiel */}
            <button
              type="button"
              onClick={() => afficherInfoBulle('Mode confidentiel')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Activer/désactiver le mode confidentiel"
            >
              <Icone nom="mail_lock" taille="1.125rem" />
            </button>

            {/* 🖊 Insérer une signature */}
            <button
              type="button"
              onClick={() => afficherInfoBulle('Insérer une signature')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
              title="Insérer une signature"
            >
              <Icone nom="edit" taille="1.125rem" />
            </button>

            {/* ⋮ Autres options */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuPlus(!menuPlus)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-[var(--fg)]"
                title="Autres options"
              >
                <svg
                  aria-hidden
                  focusable="false"
                  viewBox="0 0 24 24"
                  width="1.125rem"
                  height="1.125rem"
                  className="fill-current"
                >
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </svg>
              </button>

              {menuPlus && (
                <div
                  className="menu-apparait absolute bottom-full left-0 z-30 mb-2 min-w-[12rem] rounded-xl border py-1.5 text-[0.8125rem] text-[var(--fg)] shadow-xl"
                  style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuPlus(false)
                      afficherInfoBulle('Mode plein écran activé')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Plein écran
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuPlus(false)
                      afficherInfoBulle('Vérification orthographique')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Vérifier l'orthographe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuPlus(false)
                      afficherInfoBulle('Format texte brut')
                    }}
                    className="flex w-full px-3 py-2 text-left hover:bg-[var(--sunk)]"
                  >
                    Mode texte brut
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Côté droit : Supprimer le brouillon / Annuler */}
          <button
            type="button"
            onClick={onFermer}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--sub)] transition-colors hover:bg-[var(--sunk)] hover:text-red-500"
            title="Supprimer le brouillon"
            aria-label="Supprimer le brouillon"
          >
            <Icone nom="delete" taille="1.125rem" />
          </button>
        </div>
      </form>
    </Modale>
  )
}

/** Une ligne d'en-tête : son intitulé à gauche, le champ à droite. */
function Ligne({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-baseline gap-3 border-b pb-1.5"
      style={{ borderColor: 'rgba(128, 128, 128, 0.12)' }}
    >
      <span
        className="w-10 flex-none pt-1 text-[0.75rem] font-semibold"
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
