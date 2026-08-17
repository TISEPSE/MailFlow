/**
 * Newsletters : la seule vue qui ne soit pas une liste.
 *
 * Une newsletter ne se lit pas comme un message : on la parcourt, on retient
 * deux lignes, on passe. La liste plus panneau de lecture des autres vues
 * obligeait à ouvrir chacune pour savoir si elle valait la peine. Ici tout se
 * voit d'un coup — une synthèse en tête, puis une carte par publication.
 *
 * # Une carte par publication, pas par message
 *
 * Un journal écrit depuis plusieurs adresses et plusieurs fois par semaine.
 * À plat, il occupait autant de cartes qu'il avait envoyé de numéros, et la
 * page se remplissait de doublons apparents. Les numéros d'un même émetteur
 * sont donc empilés : une carte, une cascade derrière elle, et le détail au
 * clic. Voir `lib/newsletters.ts`.
 *
 * # Les résumés
 *
 * La ligne sous le nom de l'émetteur est composée sur la machine, à partir du
 * sujet du dernier numéro. Quand un modèle de langage sera branché, sa phrase
 * prendra exactement cette place — même emplacement, même hauteur — de sorte
 * que la page ne bouge pas d'un pixel selon qu'il est là ou non. C'est ce qui
 * rend l'IA réellement optionnelle plutôt que promise.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Bouton,
  Confirmation,
  Icone,
  Modale,
  Pastille,
  SqueletteListe,
  Vide,
} from '../composants/base'
import type { NomIcone } from '../composants/glyphes'
import { domaineDe, heureCourte, initiales, palette } from '../lib/presentation'
import {
  decompteDuGroupe,
  grouperNewsletters,
  ligneLocale,
  resserrerSujet,
  type GroupeNewsletters,
} from '../lib/newsletters'
import { messageCorps } from '../lib/tauri'
import type { CorpsMessage, MessageAffiche } from '../types/backend'
import { CorpsIsole, PiecesJointes } from '../composants/ListeMessages'

export function Newsletters({
  messages,
  vide,
  logos,
  onOuvrir,
  onSupprimer,
  onArchiver,
  corpsConnus,
  onCorpsCharge,
  chargement,
  vise,
  onVise,
}: {
  messages: MessageAffiche[]
  vide: { icone: NomIcone; titre: string; detail: string }
  logos: Record<string, string>
  onOuvrir: (id: string) => void
  onSupprimer: (id: string) => void
  onArchiver: (id: string) => void
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  chargement?: boolean
  /** Message désigné par la recherche, à ouvrir sans attendre un clic. */
  vise?: string | null
  /** Prévient que la désignation a été honorée, pour qu'elle ne se répète pas. */
  onVise?: () => void
}) {
  const [ouvert, setOuvert] = useState<MessageAffiche | null>(null)

  const groupes = useMemo(() => grouperNewsletters(messages), [messages])

  // La recherche désigne une newsletter : elle s'ouvre en grand, comme sur les
  // autres pages. Sans ce raccord, un résultat de recherche portant sur une
  // newsletter changeait bien de page mais n'ouvrait rien — la carte était
  // quelque part dans la grille, à retrouver à l'œil.
  useEffect(() => {
    if (!vise) return
    const cible = messages.find((m) => m.id === vise)
    if (cible) {
      setOuvert(cible)
      onOuvrir(cible.id)
    }
    onVise?.()
  }, [vise, messages, onOuvrir, onVise])

  if (chargement) return <SqueletteListe lignes={4} />
  if (!messages.length) return <Vide {...vide} />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-6">
        <Synthese groupes={groupes} logos={logos} />

        {/* Deux colonnes : une carte tient dans la moitié d'un écran, et deux
            de front font voir la journée d'un coup. Les cartes s'alignent en
            haut — une pile dépliée ne doit pas étirer sa voisine. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {groupes.map((groupe, i) => (
            <CarteGroupe
              key={groupe.cle}
              groupe={groupe}
              rang={i}
              logos={logos}
              onVoir={(m) => {
                setOuvert(m)
                onOuvrir(m.id)
              }}
              onArchiver={onArchiver}
              onSupprimer={onSupprimer}
            />
          ))}
        </div>
      </div>

      {ouvert && (
        <LecteurEnGrand
          message={ouvert}
          corps={corpsConnus.get(ouvert.id) ?? null}
          onCorpsCharge={onCorpsCharge}
          onFermer={() => setOuvert(null)}
        />
      )}
    </div>
  )
}

/**
 * Bandeau de synthèse.
 *
 * Il compte les publications plutôt que les messages : quinze numéros de trois
 * journaux, ce sont trois choses à lire, pas quinze. Sa phrase est composée
 * localement ; le modèle la remplacera sans déplacer quoi que ce soit.
 */
function Synthese({
  groupes,
  logos,
}: {
  groupes: GroupeNewsletters[]
  logos: Record<string, string>
}) {
  const sources = groupes.slice(0, 6)
  const numeros = groupes.reduce((n, g) => n + g.messages.length, 0)
  const derniere = groupes[0]?.messages[0]?.date

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'var(--accent-soft)' }}
      >
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: 'var(--accent)' }}
        >
          <Icone nom="auto_awesome" taille="1.125rem" rempli style={{ color: '#FFFFFF' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.875rem] font-semibold tracking-tight">
            {groupes.length} publication{groupes.length > 1 ? 's' : ''}
            {numeros > groupes.length ? `, ${numeros} numéros` : ''}
          </span>
          <span className="block text-[0.7188rem]" style={{ color: 'var(--sub)' }}>
            {derniere ? `Dernier reçu à ${heureCourte(derniere)}` : 'En attente du relevé'}
          </span>
        </span>
        <span className="flex flex-none items-center gap-1">
          <span className="pr-1 text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
            Sources
          </span>
          {sources.map((g, i) => {
            const [fond, encre] = palette(i)
            return (
              <Pastille
                key={g.cle}
                texte={initiales(g.nom)}
                taille="1.375rem"
                fond={fond}
                couleur={encre}
                logo={logos[domaineDe(g.adresse)]}
              />
            )
          })}
        </span>
      </div>
    </div>
  )
}

/** Feuilles décalées derrière une carte, quand la publication a plusieurs numéros.
 *
 *  Purement décoratif, et donc `aria-hidden` : le décompte est déjà écrit en
 *  toutes lettres sur la carte, un lecteur d'écran n'a que faire de l'illusion
 *  de papier. */
function Cascade({ nombre }: { nombre: number }) {
  // Deux feuilles suffisent à dire « il y en a d'autres ». Trois épaisseurs de
  // plus n'ajoutent que du bruit sous la carte.
  const feuilles = Math.min(nombre - 1, 2)

  return (
    <span aria-hidden>
      {Array.from({ length: feuilles }, (_, i) => (
        <span
          key={i}
          className="absolute inset-x-0 top-0 h-full rounded-2xl border"
          style={{
            borderColor: 'var(--line)',
            background: 'var(--card)',
            transform: `translate(${(i + 1) * 5}px, ${(i + 1) * 5}px) rotate(${(i + 1) * 0.35}deg)`,
            zIndex: -1 - i,
            opacity: 1 - (i + 1) * 0.25,
          }}
        />
      ))}
    </span>
  )
}

/** Carte d'une publication : son dernier numéro, et la pile des précédents. */
function CarteGroupe({
  groupe,
  rang,
  logos,
  onVoir,
  onArchiver,
  onSupprimer,
}: {
  groupe: GroupeNewsletters
  rang: number
  logos: Record<string, string>
  onVoir: (m: MessageAffiche) => void
  onArchiver: (id: string) => void
  onSupprimer: (id: string) => void
}) {
  const [fond, encre] = palette(rang)
  const [deplie, setDeplie] = useState(false)

  /** Numéro montré par la carte, désigné par son identifiant.
   *
   *  Un identifiant et non un rang : archiver un numéro décale les rangs, et la
   *  carte se mettrait alors à montrer son voisin sans que personne ne l'ait
   *  demandé. Un identifiant disparu retombe simplement sur le plus récent. */
  const [visible, setVisible] = useState<string | null>(null)

  /** Geste en attente de confirmation, ou `null`.
   *
   *  Les deux boutons font disparaître la carte de la page. Rien n'est perdu —
   *  la corbeille garde trente jours, l'archive ne détruit rien — mais un clic
   *  de travers coûterait d'aller rechercher les messages dans Gmail. Et le
   *  geste porte ici sur toute la pile, ce qui rend la confirmation d'autant
   *  plus nécessaire. */
  const [aConfirmer, setAConfirmer] = useState<'archiver' | 'supprimer' | null>(null)

  const nombre = groupe.messages.length
  const decompte = decompteDuGroupe(groupe)

  /** Le numéro effectivement à l'écran. */
  const courant = groupe.messages.find((m) => m.id === visible) ?? groupe.messages[0]

  const agirSurToute = (geste: 'archiver' | 'supprimer') => {
    for (const m of groupe.messages) {
      if (geste === 'supprimer') onSupprimer(m.id)
      else onArchiver(m.id)
    }
  }

  return (
    // `isolate` crée un contexte d'empilement : sans lui, les feuilles en
    // `z-index` négatif passeraient derrière le fond de la page plutôt que
    // derrière leur seule carte.
    <div className="relative isolate">
      {nombre > 1 && <Cascade nombre={nombre} />}

      <div
        className="carte-survolable relative flex flex-col overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
      >
        <div className="flex items-center gap-2.5 px-4 pt-4">
          <Pastille
            texte={initiales(groupe.nom)}
            taille="2.125rem"
            fond={fond}
            couleur={encre}
            logo={logos[domaineDe(groupe.adresse)]}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.875rem] font-semibold tracking-tight">
              {groupe.nom}
            </span>
            <span
              className="block truncate font-mono text-[0.6562rem]"
              style={{ color: 'var(--sub)' }}
            >
              {groupe.adresse}
            </span>
          </span>
          <span
            className="flex flex-none items-center gap-1 text-[0.6875rem]"
            style={{ color: 'var(--sub)' }}
          >
            <Icone nom="schedule" taille="0.75rem" />
            {courant.date ? heureCourte(courant.date) : ''}
          </span>
        </div>

        {/* `key` sur l'identifiant : changer de numéro remonte ce bloc, ce qui
            relance le fondu. Sans lui, React réutiliserait les mêmes nœuds et
            le texte se remplacerait d'un coup, sans qu'on voie qu'il a
            changé — le clic paraîtrait alors n'avoir rien fait. */}
        <div key={courant.id} className="apparait px-4 pt-3">
          <p className="text-[0.8125rem] leading-relaxed font-medium">
            {ligneLocale(courant)}
          </p>
          <p
            className="mt-1 line-clamp-2 text-[0.7812rem] leading-relaxed"
            style={{ color: 'var(--sub)' }}
          >
            {courant.extrait}
          </p>

          {decompte && (
            <button
              type="button"
              onClick={() => setDeplie(!deplie)}
              aria-expanded={deplie}
              className="survolable mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.6875rem] font-semibold"
              style={{ color: 'var(--accent-fg)', background: 'var(--accent-soft)' }}
            >
              {/* La même flèche retournée, comme au panneau des destinataires :
                  le jeu d'icônes est engendré à partir des noms employés dans
                  le code, et n'en porte donc qu'une seule. */}
              <Icone
                nom="expand_more"
                taille="0.875rem"
                style={{
                  transform: deplie ? 'rotate(180deg)' : undefined,
                  transition: 'transform 160ms ease',
                }}
              />
              {deplie ? 'Replier' : decompte}
            </button>
          )}
        </div>

        {deplie && (
          <ul className="mt-3 flex flex-col border-t" style={{ borderColor: 'var(--line)' }}>
            {groupe.messages.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 border-b px-4 py-2 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
              >
                {/* Le clic fait passer ce numéro en tête de la carte plutôt que
                    d'ouvrir la fenêtre de lecture : la pile se feuillette sur
                    place, et « Voir le mail » reste le geste qui sort du
                    résumé. Ouvrir à chaque coup d'œil obligeait à refermer
                    pour en regarder un autre. */}
                <button
                  type="button"
                  onClick={() => setVisible(m.id)}
                  aria-current={m.id === courant.id}
                  className="survolable min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[0.75rem]"
                  title={m.sujet || '(sans objet)'}
                >
                  {resserrerSujet(m.sujet) || '(sans objet)'}
                </button>
                <span
                  className="flex-none font-mono text-[0.6562rem]"
                  style={{ color: 'var(--sub)' }}
                >
                  {m.date ? heureCourte(m.date) : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onArchiver(m.id)}
                  title="Archiver ce numéro"
                  aria-label="Archiver ce numéro"
                  className="bouton bouton-icone flex-none rounded-md p-1"
                >
                  <Icone nom="archive" taille="0.875rem" />
                </button>
                <button
                  type="button"
                  onClick={() => onSupprimer(m.id)}
                  title="Mettre ce numéro à la corbeille"
                  aria-label="Mettre ce numéro à la corbeille"
                  className="bouton bouton-icone flex-none rounded-md p-1"
                >
                  <Icone nom="delete" taille="0.875rem" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center gap-2 px-4 py-3.5">
          <Bouton icone="open_in_full" onClick={() => onVoir(courant)}>
            Voir le mail
          </Bouton>
          <Bouton
            variante="principal"
            icone="archive"
            onClick={() => setAConfirmer('archiver')}
            titre={
              nombre > 1
                ? `Les ${nombre} numéros quittent la boîte de réception. Rien n'est supprimé.`
                : "Le message quitte la boîte de réception. Rien n'est supprimé."
            }
          >
            Garder &amp; archiver
          </Bouton>
          <Bouton
            variante="danger"
            icone="delete"
            onClick={() => setAConfirmer('supprimer')}
            titre="Mettre à la corbeille — récupérable 30 jours"
          >
            Supprimer
          </Bouton>
        </div>
      </div>

      {aConfirmer && (
        <Confirmation
          titre={
            aConfirmer === 'supprimer'
              ? nombre > 1
                ? `Mettre les ${nombre} numéros à la corbeille ?`
                : 'Mettre cette newsletter à la corbeille ?'
              : nombre > 1
                ? `Archiver les ${nombre} numéros ?`
                : 'Archiver cette newsletter ?'
          }
          sous={
            aConfirmer === 'supprimer'
              ? `De ${groupe.nom}. Gmail les garde trente jours, puis les efface.`
              : `De ${groupe.nom}. Ils quittent la boîte de réception ; rien n'est supprimé.`
          }
          libelle={aConfirmer === 'supprimer' ? 'Supprimer' : 'Archiver'}
          variante={aConfirmer === 'supprimer' ? 'danger' : 'principal'}
          icone={aConfirmer === 'supprimer' ? 'delete' : 'archive'}
          onConfirmer={() => {
            const geste = aConfirmer
            setAConfirmer(null)
            agirSurToute(geste)
          }}
          onAnnuler={() => setAConfirmer(null)}
        />
      )}
    </div>
  )
}

/**
 * Le message d'origine, en grand.
 *
 * Le fond de l'application s'estompe et se floute derrière : la newsletter
 * occupe l'écran le temps qu'on la lise, et la grille reste à sa place quand on
 * referme. Le corps passe par la même `iframe` en bac à sable qu'ailleurs —
 * rien ne s'exécute, quoi que contienne le message.
 */
function LecteurEnGrand({
  message,
  corps,
  onCorpsCharge,
  onFermer,
}: {
  message: MessageAffiche
  corps: CorpsMessage | null
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  onFermer: () => void
}) {
  const [charge, setCharge] = useState(corps)

  useMemo(() => {
    if (corps) return
    let courant = true
    messageCorps(message.id)
      .then((c) => {
        if (!courant) return
        setCharge(c)
        onCorpsCharge(message.id, c)
      })
      .catch(() => undefined)
    return () => {
      courant = false
    }
  }, [message.id, corps, onCorpsCharge])

  return (
    <Modale
      large
      sansRembourrage
      titre={message.sujet || '(sans objet)'}
      sous={`${message.nom} — ${message.adresse}`}
      onFermer={onFermer}
    >
      {/* Le cadre du message prend désormais la hauteur de son contenu : c'est
          donc ici que le défilement doit vivre. Sur la même feuille blanche que
          le message lui-même, sans quoi une bande de fenêtre apparaîtrait
          au-dessous d'une lettre courte. */}
      {/* `h-full` et non `flex-1` : la fenêtre donne à son contenu une hauteur
          fixe mais n'est pas un conteneur flex, si bien que `flex-1` n'y valait
          rien. Le cadre du message, désormais à la hauteur de son contenu,
          débordait alors d'un parent qui masque ce qui dépasse — le message
          était coupé et plus rien ne défilait. */}
      <div
        className="h-full overflow-y-auto"
        style={charge?.html ? { background: '#FFFFFF' } : undefined}
      >
        <CorpsIsole corps={charge} extrait={message.extrait} />
        {/* Les fichiers joints appartiennent à la lettre, et manquaient ici :
            la fenêtre montrait le texte du message mais taisait le planning
            attaché, si bien que « Voir le mail » n'en montrait pas la
            moitié. Ils tiennent sur la même feuille blanche qu'ailleurs. */}
        <PiecesJointes
          message={message.id}
          pieces={charge?.pieces ?? []}
          surPapier={Boolean(charge?.html)}
        />
      </div>
    </Modale>
  )
}
