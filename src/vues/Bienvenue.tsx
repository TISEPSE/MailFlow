/**
 * Guide de première ouverture.
 *
 * Il ne se montre qu'une fois. Sans lui, on arrive devant quatre pages dont
 * rien ne dit ce qui les distingue, et devant un geste — poser une règle depuis
 * un message — qui est le cœur du produit mais qu'aucune étiquette n'annonce.
 *
 * Quatre écrans courts, pas un manuel : ce qui n'est pas lu ne sert à rien, et
 * une personne qui découvre l'application veut y entrer, pas l'étudier. Chaque
 * écran tient en une phrase et une image.
 */
import { useState } from 'react'
import { Bouton, Icone } from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { ton } from '../lib/presentation'

interface Etape {
  icone: NomIcone
  /** Sert à teinter l'illustration comme la vue dont on parle. */
  couleur: 'humain' | 'publicite' | 'newsletter' | 'formation' | 'regle'
  titre: string
  texte: string
  /** Ce que l'écran montre en plus du texte. */
  illustration: 'pages' | 'regle' | 'corbeille' | 'connexion' | 'reglages'
}

const ETAPES: Etape[] = [
  {
    icone: 'inbox',
    couleur: 'humain',
    titre: 'Votre courrier, rangé tout seul',
    texte:
      "MailFlow lit votre boîte Gmail et sépare ce qui vous est écrit de ce qui vous est envoyé. Rien n'est supprimé sans que vous l'ayez demandé.",
    illustration: 'pages',
  },
  {
    icone: 'bolt',
    couleur: 'regle',
    titre: 'Un expéditeur, une décision, pour toujours',
    texte:
      "C'est le geste central. Depuis un message, dites ce qu'il faut faire des suivants : les archiver, les ranger ailleurs, ou les laisser. La règle s'appliquera d'elle-même.",
    illustration: 'regle',
  },
  {
    icone: 'delete',
    couleur: 'publicite',
    titre: 'Rien d’irréversible',
    texte:
      'Supprimer met à la corbeille de Gmail, où tout reste récupérable trente jours. Archiver ne fait que sortir un message de la boîte de réception.',
    illustration: 'corbeille',
  },
  {
    icone: 'person',
    couleur: 'newsletter',
    titre: 'Reliez votre compte Gmail',
    texte:
      "MailFlow ouvrira votre navigateur sur la vraie page de Google. Votre mot de passe ne passe jamais par cette fenêtre, et l'autorisation se retire quand vous voulez.",
    illustration: 'connexion',
  },
  {
    icone: 'settings',
    couleur: 'formation',
    titre: 'Tout se règle ici',
    texte:
      'Le thème, la fréquence des relevés, vos comptes Google. Vous pourrez y revoir ce guide quand vous voudrez.',
    illustration: 'reglages',
  },
]

export function Bienvenue({
  sombre,
  onTerminer,
  onConnecter,
  compteConnecte,
}: {
  sombre: boolean
  /** Marque le guide comme vu et rend la main à l'application. */
  onTerminer: () => void
  /** Lance le parcours Google, depuis l'écran qui le propose. */
  onConnecter: () => void
  /** Vrai quand un compte est déjà relié : l'écran le dit au lieu de le
   *  proposer une seconde fois. */
  compteConnecte: boolean
}) {
  const [rang, setRang] = useState(0)

  // Le sens du dernier déplacement : l'animation glisse dans cette direction,
  // ce qui distingue « page suivante » de « contenu remplacé ».
  const [sens, setSens] = useState<'avance' | 'recule'>('avance')

  const aller = (vers: number) => {
    setSens(vers > rang ? 'avance' : 'recule')
    setRang(vers)
  }
  const etape = ETAPES[rang]!
  const dernier = rang === ETAPES.length - 1
  const [solide, doux] = ton(etape.couleur, sombre)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-8"
      style={{ background: 'var(--bg)' }}
    >
      {/* La clé de rendu force le rejeu de l'apparition à chaque écran : sans
          elle, React réutilise le nœud et l'animation ne se relance pas. */}
      <div
        key={rang}
        className={`guide-${sens} mouvement-utile flex w-full max-w-lg flex-col items-center gap-6`}
      >
        <span
          className="flex h-20 w-20 items-center justify-center rounded-3xl"
          style={{ background: doux }}
        >
          <Icone nom={etape.icone} taille="2.375rem" rempli style={{ color: solide }} />
        </span>

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-[1.5rem] font-semibold tracking-tight">{etape.titre}</h1>
          <p
            className="max-w-md text-[0.875rem] leading-relaxed"
            style={{ color: 'var(--sub)' }}
          >
            {etape.texte}
          </p>
        </div>

        <Illustration
          quoi={etape.illustration}
          sombre={sombre}
          onConnecter={onConnecter}
          compteConnecte={compteConnecte}
        />
      </div>

      {/* Hors du bloc animé : ces commandes ne doivent pas rejouer d'apparition
          à chaque écran, sans quoi le bouton bougerait sous le curseur. */}
      <div className="mt-9 flex w-full max-w-lg flex-col items-center gap-5">
        <div className="flex items-center gap-2" role="tablist" aria-label="Progression du guide">
          {ETAPES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === rang}
              aria-label={`Écran ${i + 1} sur ${ETAPES.length}`}
              onClick={() => aller(i)}
              className="point rounded-full"
              // La largeur distingue l'écran courant : un simple changement de
              // couleur ne se voit pas sur un point de six pixels.
              style={{
                width: i === rang ? 22 : 6,
                height: 6,
                background: i === rang ? solide : 'var(--piste)',
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          {rang > 0 && (
            <Bouton icone="chevron_left" onClick={() => aller(rang - 1)}>
              Précédent
            </Bouton>
          )}
          <Bouton
            variante="principal"
            icone={dernier ? 'check_circle' : 'chevron_right'}
            onClick={() => (dernier ? onTerminer() : aller(rang + 1))}
          >
            {dernier ? 'Commencer' : 'Suivant'}
          </Bouton>
        </div>

        {!dernier && (
          <button
            type="button"
            onClick={onTerminer}
            className="text-[0.7812rem] underline-offset-2 hover:underline"
            style={{ color: 'var(--sub)' }}
          >
            Passer le guide
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Petite scène qui montre ce que la phrase décrit.
 *
 * Dessinée avec les briques de l'application plutôt qu'avec des images : ce que
 * l'utilisateur voit ici est exactement ce qu'il retrouvera ensuite, aux mêmes
 * couleurs. Une illustration générique aurait à réapprendre.
 */
function Illustration({
  quoi,
  sombre,
  onConnecter,
  compteConnecte,
}: {
  quoi: Etape['illustration']
  sombre: boolean
  onConnecter: () => void
  compteConnecte: boolean
}) {
  const cadre =
    'flex w-full flex-col gap-2 rounded-2xl border p-3.5 text-[0.7812rem]'
  const style = { background: 'var(--sunk)', borderColor: 'var(--line)' }

  if (quoi === 'pages') {
    const pages: { v: Parameters<typeof ton>[0]; icone: NomIcone; nom: string }[] = [
      { v: 'humain', icone: 'person', nom: 'Mails directs' },
      { v: 'publicite', icone: 'sell', nom: 'Publicités' },
      { v: 'newsletter', icone: 'newspaper', nom: 'Newsletters' },
      { v: 'formation', icone: 'school', nom: 'Formations' },
    ]
    return (
      <div className={cadre} style={style}>
        <div className="grid grid-cols-2 gap-2">
          {pages.map(({ v, icone, nom }) => {
            const [s, d] = ton(v, sombre)
            return (
              <div
                key={nom}
                className="flex items-center gap-2 rounded-xl px-2.5 py-2"
                style={{ background: 'var(--card)' }}
              >
                <span
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-lg"
                  style={{ background: d }}
                >
                  <Icone nom={icone} taille="0.875rem" style={{ color: s }} />
                </span>
                <span className="truncate font-medium">{nom}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (quoi === 'regle') {
    return (
      <div className={cadre} style={style}>
        <div
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
          style={{ background: 'var(--card)' }}
        >
          <span
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[0.6875rem] font-semibold"
            style={{ background: '#E8EEFF', color: '#2455CC' }}
          >
            LM
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">Le Marché du coin</span>
            <span className="block truncate font-mono text-[0.6562rem]" style={{ color: 'var(--sub)' }}>
              promos@marche-du-coin.fr
            </span>
          </span>
          {/* Les classes du vrai bouton, `leading-none` compris : sans lui, la
              boîte du texte est plus haute que ses lettres, et centrer les
              boîtes laisse l'icône au-dessus du mot. */}
          <span
            className="inline-flex h-8 flex-none items-center justify-center gap-1.5 rounded-lg px-3 text-xs leading-none font-semibold"
            style={{ background: 'var(--accent)', color: '#FFFFFF' }}
          >
            <Icone nom="archive" taille="0.875rem" />
            Archiver
          </span>
        </div>
        <p className="px-1 text-center text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
          Un clic, et tous ses prochains messages suivront le même chemin.
        </p>
      </div>
    )
  }

  if (quoi === 'corbeille') {
    return (
      <div className={cadre} style={style}>
        <div className="flex items-center justify-center gap-3 py-1">
          <span
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[0.75rem] font-semibold"
            style={{ background: 'var(--card)', color: 'var(--fg)' }}
          >
            <Icone nom="delete" taille="0.875rem" />
            Supprimer
          </span>
          <Icone nom="chevron_right" taille="1rem" style={{ color: 'var(--sub)' }} />
          <span className="text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            Corbeille Gmail · 30 jours
          </span>
        </div>
      </div>
    )
  }

  if (quoi === 'connexion') {
    return (
      <div className={cadre} style={style}>
        {compteConnecte ? (
          <div className="flex items-center justify-center gap-2 py-2 text-[0.7812rem]">
            <Icone nom="check_circle" taille="1rem" rempli style={{ color: 'var(--accent-fg)' }} />
            <span>Un compte est déjà relié. Vous pourrez en ajouter d'autres.</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5 py-1">
            {/* Le geste est proposé ici même : renvoyer aux Paramètres au
                moment où l'on explique la connexion ajouterait un détour à
                l'endroit précis où l'on veut avancer. */}
            <Bouton
              variante="principal"
              icone="person"
              onClick={onConnecter}
            >
              Connecter mon compte Google
            </Bouton>
            <span className="text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
              Vous pourrez aussi le faire plus tard, depuis les Paramètres.
            </span>
          </div>
        )}
      </div>
    )
  }

  // Les icônes sont écrites une à une, et non parcourues depuis un tableau :
  // `outils/extraire-icones.py` relit les noms dans les sources, et ne
  // reconnaît que la forme `nom="…"`. Un nom caché dans un tableau de paires
  // manquerait au jeu de tracés — sans erreur, mais sans dessin.
  return (
    <div className={cadre} style={style}>
      <div className="flex items-center justify-center gap-4 py-1">
        <Reglage nom="Thème">
          <Icone nom="palette" taille="1.25rem" style={{ color: 'var(--sub)' }} />
        </Reglage>
        <Reglage nom="Fréquence">
          <Icone nom="schedule" taille="1.25rem" style={{ color: 'var(--sub)' }} />
        </Reglage>
        <Reglage nom="Comptes">
          <Icone nom="person" taille="1.25rem" style={{ color: 'var(--sub)' }} />
        </Reglage>
      </div>
    </div>
  )
}

/** Une pastille de réglage dans l'illustration du dernier écran. */
function Reglage({ nom, children }: { nom: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: 'var(--card)' }}
      >
        {children}
      </span>
      <span className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
        {nom}
      </span>
    </span>
  )
}
