/**
 * La table des archives.
 *
 * # L'idée
 *
 * Une surface où chaque message archivé est une tuile qu'on attrape et qu'on
 * pose où l'on veut. Lâcher une tuile sur une autre forme un **tas** ; le tas
 * se nomme, se déplie, se replie.
 *
 * # La règle qui rend l'idée acceptable
 *
 * **Un tas est un libellé Gmail.** Le nommer crée le libellé, y déposer une
 * tuile pose le libellé sur le message. Le rangement se retrouve donc dans
 * Gmail, sur le téléphone, et survit à la disparition de MailFlow.
 *
 * Seule la **disposition** — où les choses sont posées sur la table — reste
 * locale, dans `tableau.json`. Perdre ce fichier fait perdre une mise en page,
 * jamais un classement. Un tableau blanc dont le contenu n'existerait que dans
 * une application est un tableau blanc qu'on perd.
 *
 * # Ce qui donne la sensation du geste
 *
 * Quatre choses, toutes obtenues sans bibliothèque :
 *
 * 1. **Pointer Events** plutôt que l'API HTML5 `dragstart`, qui impose son
 *    image fantôme et ses saccades. On suit le doigt à la milliseconde.
 * 2. **`translate3d` seul** pendant le déplacement, jamais `top`/`left` : la
 *    tuile reste sur sa propre couche et rien n'est repeint.
 * 3. **Un ressort à la dépose**, pas une transition linéaire. C'est le
 *    dépassement puis le retour qui donnent la matière.
 * 4. **La capture du pointeur**, sans quoi une main rapide « lâche » la tuile
 *    dès qu'elle sort de son cadre.
 *
 * # Ce qui n'est pas fait, délibérément
 *
 * Pas de zoom infini ni de défilement sans limite. Sur une table sans bord, on
 * perd ses affaires : la surface est plus grande que l'écran, mais finie, et un
 * bouton réaligne tout en grille.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as PointerEventReact } from 'react'
import { Bouton, Confirmation, Icone, Modale, Vide } from '../composants/base'
import { LecteurEnGrand } from '../composants/LecteurEnGrand'
import {
  SURFACE,
  TAS,
  TUILE,
  borner,
  cibleSousLaTuile,
  completer,
  repartir,
} from '../lib/table'
import type { Pose } from '../lib/table'
import { heureCourte, initiales, palette, ton } from '../lib/presentation'
import type {
  CorpsMessage,
  LibelleGmail,
  MessageAffiche,
  Position,
  Tableau,
} from '../types/backend'

/** Ce que la table sait faire, et qui vient de la page qui l'accueille. */
export interface GestesDeLaTable {
  /** Pose un libellé sur un message : le dépôt sur un tas. */
  onDeposer: (message: string, libelle: string) => Promise<void>
  /** Retire un libellé : la sortie d'un tas. */
  onSortir: (message: string, libelle: string) => Promise<void>
  /** Crée un libellé et rend la liste à jour. */
  onCreerLibelle: (nom: string) => Promise<LibelleGmail[]>
  /**
   * Défait un tas : ses messages en sortent, le libellé disparaît de Gmail.
   *
   * Le seul geste sans retour de cette page — d'où la confirmation qui le nomme.
   */
  onDefaireLeTas: (libelle: string, messages: string[]) => Promise<void>
  /** Met un message à la corbeille Gmail. */
  onSupprimer: (message: string) => Promise<void>
  /**
   * Retire un message de la table, sans toucher à Gmail.
   *
   * Distinct de la corbeille : le message reste archivé, ses libellés compris.
   * Sans lui, la table n'avait qu'une sortie et c'était la corbeille — on ne
   * pouvait pas dire « celui-là est classé » sans le jeter.
   */
  onRetirer: (message: string) => Promise<void>
  /**
   * Un tas vient de perdre sa dernière tuile : son libellé disparaît de Gmail.
   *
   * Sans retour, comme « Défaire le tas », et sans confirmation cette fois —
   * c'est le geste demandé. Ce qui le rend acceptable n'est pas une fenêtre de
   * plus, c'est la condition : le tas doit être **tombé** à zéro sous la main
   * de l'utilisateur. Un libellé qui n'a jamais rien porté sur la table ne
   * passe jamais par ici, et peut donc contenir trois cents messages en paix.
   */
  onTasVide: (libelle: string, nom: string) => Promise<void>
  /** Marque un message comme lu, à son ouverture. */
  onLu: (message: string) => void
  /** Relève à nouveau les archives chez Gmail. */
  onRelever: () => void
  onErreur: (message: string) => void
}

export function Archives({
  archives,
  libelles,
  compte,
  tableau,
  onTableau,
  sombre,
  melange,
  corpsConnus,
  onCorpsCharge,
  gestes,
}: {
  archives: MessageAffiche[]
  libelles: LibelleGmail[]
  /** Adresse de la boîte regardée. Sert de repère, pas d'affichage : quand elle
   *  change, tout ce que la page retenait du compte précédent est lâché. */
  compte: string | null
  tableau: Tableau
  /** Appelée à chaque dépose : c'est elle qui écrit `tableau.json`. */
  onTableau: (tableau: Tableau) => void
  sombre: boolean
  /** Vrai sous « Tous les comptes », où la table n'a pas de sens. */
  melange: boolean
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  gestes: GestesDeLaTable
}) {
  const [deplie, setDeplie] = useState<string | null>(null)
  const [aNommer, setANommer] = useState<{ message: string; sur: string } | null>(null)
  const [lu, setLu] = useState<MessageAffiche | null>(null)
  const [aDefaire, setADefaire] = useState<{ id: string; nom: string; messages: string[] } | null>(
    null,
  )
  const [aSupprimer, setASupprimer] = useState<MessageAffiche | null>(null)

  /**
   * L'objet que la tuile en cours de glissement recouvre, s'il y en a un.
   *
   * Sans ce retour, la règle du recouvrement reste invisible : on lâche, et on
   * découvre après coup si un tas s'est formé. Un contour qui s'allume avant le
   * lâcher transforme une règle subie en règle vérifiable.
   *
   * On ne remonte que l'identifiant survolé, jamais la position : retracer la
   * table à chaque pixel est précisément ce que ce composant évite.
   */
  const [survole, setSurvole] = useState<string | null>(null)

  const nomsDesLibelles = useMemo(
    () => new Map(libelles.map((l) => [l.id, l.nom])),
    [libelles],
  )

  const { parTas, seuls } = useMemo(
    () => repartir(archives, new Set(nomsDesLibelles.keys())),
    [archives, nomsDesLibelles],
  )

  /**
   * Un tas par libellé **qui porte au moins une tuile**.
   *
   * La table énumérait tous les libellés Gmail, portants ou non, au motif qu'un
   * tas vide reste une catégorie où déposer. À l'usage c'est faux : sur une
   * boîte ordinaire, la table s'ouvrait couverte de « 0 message » qu'on ne peut
   * ni lire ni ranger, et le plan de travail n'était plus un plan de travail.
   *
   * Les deux sens du classement continuent de circuler — un libellé posé depuis
   * le téléphone arrive bien ici, mais **par ses messages** : `archives_synchroniser`
   * relève `has:userlabels` et les fait entrer au registre, tuiles et tas d'un
   * coup. Ce qu'on ne montre plus, ce sont les libellés qui n'avaient rien à
   * montrer.
   */
  const tasVivants = useMemo(() => [...parTas.keys()], [parTas])

  /** Effectifs de chaque tas au passage précédent : c'est la chute qu'on guette. */
  const effectifs = useRef(new Map<string, number>())

  /** Tas dont on a déjà demandé la suppression. Un ordre suffit. */
  const signales = useRef(new Set<string>())

  /**
   * Vrai quand la table vient d'être modifiée par un geste de l'utilisateur.
   *
   * C'est la garde qui distingue « j'ai sorti la dernière tuile » de « le
   * relevé a rendu une liste différente ». Sans elle, une relecture du
   * classement Gmail — ou un simple changement de compte — pourrait faire
   * tomber un tas à zéro sans que personne n'ait rien demandé, et emporter un
   * libellé qui contient trois cents messages ailleurs.
   */
  const apresUnGeste = useRef(false)

  /** Le compte a changé : la mémoire des effectifs ne vaut plus rien.
   *
   *  Les identifiants de libellé d'une boîte ne désignent rien dans une autre.
   *  Sans cette remise à zéro, basculer de compte ferait « tomber à zéro » tous
   *  les tas du précédent — et les supprimerait dans le nouveau. */
  useEffect(() => {
    effectifs.current = new Map()
    signales.current = new Set()
  }, [compte])

  /**
   * Les gestes, tenus à part des dépendances de l'effet.
   *
   * La page les reçoit sous forme d'objet reconstruit à chaque rendu : les
   * placer en dépendance ferait courir la détection à chaque rendu, y compris
   * ceux où la table n'a pas bougé — et la garde du geste serait effacée avant
   * d'avoir servi.
   */
  const gestesRecents = useRef(gestes)
  useEffect(() => {
    gestesRecents.current = gestes
  })

  useEffect(() => {
    const avant = effectifs.current
    const maintenant = new Map(tasVivants.map((id) => [id, parTas.get(id)?.length ?? 0]))
    effectifs.current = maintenant

    const geste = apresUnGeste.current
    apresUnGeste.current = false
    if (!geste) return

    for (const [id, combien] of avant) {
      if (combien === 0 || maintenant.has(id) || signales.current.has(id)) continue

      // Un libellé que Gmail ne liste plus n'a plus rien à supprimer : le tas a
      // disparu parce que le libellé avait déjà été effacé ailleurs.
      const nom = nomsDesLibelles.get(id)
      if (!nom) continue

      signales.current.add(id)
      const { onTasVide, onErreur } = gestesRecents.current
      void onTasVide(id, nom).catch((e) => onErreur(String(e)))
    }
  }, [tasVivants, parTas, nomsDesLibelles])

  /** Annonce qu'un geste de l'utilisateur va modifier ce que porte la table. */
  const noterLeGeste = useCallback(() => {
    apresUnGeste.current = true
  }, [])

  // La disposition complétée : ce qui a une place la garde, ce qui vient
  // d'arriver en reçoit une. Sans cela, un message relevé depuis la dernière
  // ouverture s'afficherait au coin supérieur gauche, sous tous les autres.
  const dispose = useMemo(
    () =>
      completer(
        tableau,
        tasVivants,
        seuls.map((m) => m.id),
      ),
    [tableau, tasVivants, seuls],
  )

  /** Tout ce qui est posé, pour savoir ce qu'on survole en lâchant.
   *
   *  La taille en fait partie : un tas est plus court qu'une tuile, et viser
   *  sous son bord inférieur, c'est viser la table. */
  const poses: Pose[] = useMemo(
    () => [
      ...tasVivants.map((id) => ({
        id,
        position: dispose.tas[id] ?? { x: 0, y: 0 },
        taille: TAS,
      })),
      ...seuls.map((m) => ({
        id: m.id,
        position: dispose.messages[m.id] ?? { x: 0, y: 0 },
        taille: TUILE,
      })),
    ],
    [tasVivants, seuls, dispose],
  )

  /** Déplace un objet et enregistre la nouvelle disposition. */
  const poser = useCallback(
    (id: string, position: Position, estUnTas: boolean) => {
      const suivant: Tableau = {
        tas: { ...dispose.tas },
        messages: { ...dispose.messages },
      }

      if (estUnTas) suivant.tas[id] = position
      else suivant.messages[id] = position

      onTableau(suivant)
    },
    [dispose, onTableau],
  )

  /**
   * Ce qui se passe quand une tuile est lâchée.
   *
   * Trois issues, et l'ordre compte : on regarde d'abord si elle atterrit sur
   * quelque chose, parce que c'est le geste porteur de sens. Le simple
   * déplacement est ce qui reste quand rien n'a été visé.
   */
  const lacher = useCallback(
    (message: MessageAffiche, position: Position) => {
      const cible = cibleSousLaTuile(position, poses, message.id)

      if (!cible) {
        poser(message.id, position, false)
        return
      }

      // Lâchée sur un tas : le message y entre.
      if (nomsDesLibelles.has(cible.id)) {
        void gestes.onDeposer(message.id, cible.id).catch((e) => gestes.onErreur(String(e)))
        return
      }

      // Lâchée sur une autre tuile : il faut un nom, donc un libellé à créer.
      // On ne le devine pas — un tas nommé « Karim, Devis » que personne n'a
      // choisi serait plus difficile à défaire qu'à faire.
      setANommer({ message: message.id, sur: cible.id })
    },
    [poses, poser, nomsDesLibelles, gestes],
  )

  /** Ce que recouvrirait la tuile si on la lâchait maintenant. */
  const survoler = useCallback(
    (soiMeme: string, position: Position) => {
      setSurvole(cibleSousLaTuile(position, poses, soiMeme)?.id ?? null)
    },
    [poses],
  )

  /** Ouvre un message en lecture, et le marque lu comme partout ailleurs. */
  const ouvrir = useCallback(
    (message: MessageAffiche) => {
      setLu(message)
      if (message.nonLu) gestes.onLu(message.id)
    },
    [gestes],
  )

  const [accent] = ton('archive', sombre)

  // La table est cloisonnée par compte jusque dans son fichier de disposition,
  // et les libellés de l'un n'existent pas chez l'autre : une table mélangée
  // serait une table dont la moitié des gestes échoue. Mieux vaut le dire que
  // de laisser essayer.
  if (melange) {
    return (
      <Vide
        icone="archive"
        titre="Choisissez un compte"
        detail="Chaque compte a sa propre table : ses tas sont ses libellés Gmail, et la disposition des tuiles lui appartient. Sélectionnez un compte pour ouvrir la sienne."
      />
    )
  }

  if (archives.length === 0) {
    return (
      <Vide
        icone="archive"
        titre="Aucune archive"
        detail="Les messages que vous rangez depuis les autres pages viennent se poser ici. Vous pourrez alors les grouper en tas, et chaque tas sera un libellé retrouvé dans Gmail."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pas d'en-tête. C'était un titre qui répétait la barre latérale, un
          bouton de relevé que la page déclenche désormais toute seule à chaque
          ouverture, et un « Tout ranger » qui défaisait d'un clic la
          disposition que l'utilisateur venait de faire. La table est ce que la
          page a à montrer : elle prend toute la place. */}

      {/* La surface défile dans les deux sens, et elle a une fin. */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ background: 'var(--sunk)' }}>
        <div
          className="relative"
          style={{
            width: SURFACE.largeur,
            height: SURFACE.hauteur,
            // Une trame légère : sans repère, on ne sait plus si l'on a
            // déplacé la tuile ou la table.
            backgroundImage:
              'radial-gradient(circle, color-mix(in srgb, var(--sub) 22%, transparent) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        >
          {tasVivants.map((id) => {
            const messages = parTas.get(id) ?? []
            const nom = nomsDesLibelles.get(id) ?? 'Sans nom'

            return (
              <TasPose
                key={id}
                nom={nom}
                messages={messages}
                position={dispose.tas[id] ?? { x: 0, y: 0 }}
                accent={accent}
                vise={survole === id}
                ouvert={deplie === id}
                onBasculer={() => setDeplie((d) => (d === id ? null : id))}
                onDeplacer={(p) => poser(id, p, true)}
                onOuvrirMessage={ouvrir}
                onDefaire={() =>
                  setADefaire({ id, nom, messages: messages.map((m) => m.id) })
                }
                // Les trois sorties d'un tas passent par `noterLeGeste` : ce
                // sont elles, et elles seules, qui peuvent le faire tomber à
                // zéro sous la main de l'utilisateur.
                onSortir={(message) => {
                  noterLeGeste()
                  void gestes.onSortir(message, id).catch((e) => gestes.onErreur(String(e)))
                }}
                // La suppression, elle, note son geste au moment où elle est
                // confirmée : une fenêtre ouverte puis annulée n'a rien changé.
                onSupprimer={setASupprimer}
                onRetirer={(m) => {
                  noterLeGeste()
                  void gestes.onRetirer(m.id).catch((e) => gestes.onErreur(String(e)))
                }}
              />
            )
          })}

          {seuls.map((message) => (
            <TuilePosee
              key={message.id}
              message={message}
              position={dispose.messages[message.id] ?? { x: 0, y: 0 }}
              vise={survole === message.id}
              onLacher={(p) => {
                setSurvole(null)
                lacher(message, p)
              }}
              onSurvol={(p) => survoler(message.id, p)}
              onOuvrir={() => ouvrir(message)}
              onSupprimer={() => setASupprimer(message)}
              onRetirer={() =>
                void gestes.onRetirer(message.id).catch((e) => gestes.onErreur(String(e)))
              }
            />
          ))}
        </div>
      </div>

      {lu && (
        <LecteurEnGrand
          message={lu}
          corps={corpsConnus.get(lu.id) ?? null}
          onCorpsCharge={onCorpsCharge}
          onFermer={() => setLu(null)}
          actions={
            <Bouton
              variante="danger"
              icone="delete"
              onClick={() => {
                const cible = lu
                setLu(null)
                setASupprimer(cible)
              }}
            >
              Supprimer
            </Bouton>
          }
        />
      )}

      {aDefaire && (
        <Confirmation
          titre={`Défaire le tas « ${aDefaire.nom} » ?`}
          sous={`Ses ${aDefaire.messages.length} message${
            aDefaire.messages.length > 1 ? 's redeviennent des tuiles libres' : ' redevient une tuile libre'
          } et le libellé « ${aDefaire.nom} » disparaît de Gmail — y compris des messages qui le portent ailleurs. Aucun message n'est supprimé.`}
          libelle="Défaire le tas"
          icone="open_in_full"
          onAnnuler={() => setADefaire(null)}
          onConfirmer={() => {
            const cible = aDefaire
            setADefaire(null)
            setDeplie((d) => (d === cible.id ? null : d))
            void gestes
              .onDefaireLeTas(cible.id, cible.messages)
              .catch((e) => gestes.onErreur(String(e)))
          }}
        />
      )}

      {aSupprimer && (
        <Confirmation
          titre="Supprimer ce message ?"
          sous={`« ${aSupprimer.sujet || '(sans objet)'} » part à la corbeille de Gmail, où il reste récupérable trente jours.`}
          libelle="Supprimer"
          icone="delete"
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={() => {
            const cible = aSupprimer
            setASupprimer(null)
            noterLeGeste()
            void gestes.onSupprimer(cible.id).catch((e) => gestes.onErreur(String(e)))
          }}
        />
      )}

      {aNommer && (
        <NommerLeTas
          onAnnuler={() => setANommer(null)}
          onValider={async (nom) => {
            const cible = aNommer
            setANommer(null)
            try {
              const aJour = await gestes.onCreerLibelle(nom)
              const cree = aJour.find((l) => l.nom === nom)
              if (!cree) return

              // Les deux messages entrent dans le tas : celui qu'on a lâché, et
              // celui sur lequel on l'a lâché. Ne poser le libellé que sur le
              // premier laisserait un tas à un seul élément, à côté d'une tuile
              // isolée — c'est-à-dire exactement ce qu'on voulait réunir.
              await gestes.onDeposer(cible.sur, cree.id)
              await gestes.onDeposer(cible.message, cree.id)
            } catch (e) {
              gestes.onErreur(String(e))
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * Un rang stable pour une adresse, qui sert à lui choisir sa couleur.
 *
 * `palette` attend un index, pas une adresse : ailleurs c'est le rang du
 * compte qui le fournit. Ici il n'y a pas de liste où se ranger, donc on dérive
 * le rang de l'adresse elle-même. Peu importe lequel — ce qui compte est qu'un
 * même expéditeur garde sa couleur d'une ouverture à l'autre.
 */
function rangDeLAdresse(adresse: string): number {
  let somme = 0
  for (const caractere of adresse.toLowerCase()) {
    somme = (somme * 31 + caractere.charCodeAt(0)) % 100_000
  }
  return somme
}

/** « 1 tas », « 3 tas » — le singulier compte quand on lit vite. */
function decompte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n > 1 ? pluriel : singulier}`
}

/**
 * Le glissement, isolé du reste.
 *
 * Rend ce qu'il faut poser sur l'élément et le décalage courant. La position
 * n'est écrite qu'à la dépose : la suivre dans l'état de React à chaque
 * mouvement ferait retracer toute la table soixante fois par seconde.
 */
function useGlissement(
  depart: Position,
  taille: { largeur: number; hauteur: number },
  onLacher: (position: Position) => void,
  /** Appelée pendant le geste avec la position courante, pour le contour. */
  onSurvol?: (position: Position) => void,
) {
  const noeud = useRef<HTMLDivElement>(null)
  const saisie = useRef<{ x: number; y: number } | null>(null)
  const [attrape, setAttrape] = useState(false)

  /** Vrai dès que le pointeur a bougé assez pour que ce soit un glissement. */
  const aBouge = useRef(false)

  /** Vrai entre le lâcher et l'arrivée de la nouvelle position. */
  const aPoser = useRef(false)

  /**
   * Efface le décalage exactement quand la nouvelle place est écrite.
   *
   * `useLayoutEffect` et non `useEffect` : il court avant que le navigateur ne
   * peigne. Le `left`/`top` neuf et la remise à zéro du décalage tombent donc
   * dans la même image, et la tuile ne passe jamais par son ancienne place.
   *
   * Sans tableau de dépendances : la nouvelle position peut être identique à
   * l'ancienne — on lâche une tuile là où elle était — et l'effet doit courir
   * quand même, sinon le décalage resterait pour de bon.
   */
  useLayoutEffect(() => {
    if (!aPoser.current) return
    aPoser.current = false

    const element = noeud.current
    if (!element) return

    element.style.transform = ''

    // La rendue à sa place, elle rebondit une fois. C'est le ressort promis,
    // et il porte enfin sur le bon geste : l'arrivée, pas le retour en arrière.
    //
    // Retirée puis reposée, avec une lecture forcée de la mise en page entre
    // les deux : une classe d'animation déjà présente ne rejoue rien, et le
    // deuxième lâcher serait resté sans ressort. La lecture de `offsetWidth`
    // est ce qui oblige le moteur à prendre acte du retrait avant l'ajout.
    element.classList.remove('tuile-posee')
    void element.offsetWidth
    element.classList.add('tuile-posee')
  })

  const surPointerDown = (e: PointerEventReact<HTMLDivElement>) => {
    // Bouton principal seulement : un clic droit ouvre le menu du système.
    if (e.button !== 0) return

    saisie.current = { x: e.clientX, y: e.clientY }
    aBouge.current = false
    setAttrape(true)

    // Sans la capture, une main rapide « lâche » la tuile dès que le pointeur
    // sort de son cadre, et l'objet reste collé au curseur.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const surPointerMove = (e: PointerEventReact<HTMLDivElement>) => {
    const debut = saisie.current
    const element = noeud.current
    if (!debut || !element) return

    const dx = e.clientX - debut.x
    const dy = e.clientY - debut.y

    // Trois pixels de seuil : sans lui, un clic un peu appuyé compterait comme
    // un déplacement, et ouvrir un message deviendrait un coup de chance.
    if (!aBouge.current && Math.hypot(dx, dy) < 3) return
    aBouge.current = true

    // `translate3d` seul : la tuile reste sur sa couche, rien n'est repeint.
    element.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`

    // Le survol est remonté à React, mais il ne porte qu'un identifiant : le
    // composant parent ne se retrace que lorsque la cible **change**, soit
    // quelques fois par geste, et non soixante fois par seconde.
    onSurvol?.(
      borner({ x: depart.x + dx, y: depart.y + dy }, taille.largeur, taille.hauteur),
    )
  }

  const surPointerUp = (e: PointerEventReact<HTMLDivElement>) => {
    const debut = saisie.current
    const element = noeud.current
    saisie.current = null
    setAttrape(false)

    if (!debut || !element) return

    if (!aBouge.current) {
      element.style.transform = ''
      return
    }

    // Le décalage n'est **pas** effacé ici. Il l'était, et c'était le défaut
    // qu'on voyait au lâcher : la tuile revenait à son point de départ le temps
    // que React reçoive sa nouvelle position, puis y sautait. Pire, la
    // transition posée sur `transform` animait ce retour — la tuile glissait
    // visiblement en arrière avant de se téléporter.
    //
    // Il est effacé dans l'effet de mise en page ci-dessous, au moment où la
    // nouvelle position est écrite, donc dans la même image.
    aPoser.current = true

    const arrivee = borner(
      {
        x: depart.x + (e.clientX - debut.x),
        y: depart.y + (e.clientY - debut.y),
      },
      taille.largeur,
      taille.hauteur,
    )

    onLacher(arrivee)
  }

  return {
    noeud,
    attrape,
    /** Vrai quand le geste était un déplacement, pas un clic. */
    aGlisse: () => aBouge.current,
    poignee: {
      onPointerDown: surPointerDown,
      onPointerMove: surPointerMove,
      onPointerUp: surPointerUp,
      onPointerCancel: surPointerUp,
    },
  }
}

/** Style commun à tout ce qui est posé sur la table. */
function styleDePose(position: Position, attrape: boolean) {
  return {
    left: position.x,
    top: position.y,
    // Ce qu'on tient passe devant, sinon la tuile glisse *sous* sa voisine et
    // l'on croit l'avoir perdue.
    zIndex: attrape ? 30 : 1,
    // Rien sur `transform`. La transition qui s'y trouvait n'a jamais animé le
    // déplacement — celui-ci passe par `left`/`top` — elle n'animait que le
    // retour en arrière du décalage, c'est-à-dire le défaut lui-même. Le
    // ressort d'arrivée est joué par `.tuile-posee`, en image clé.
    transition: attrape ? 'none' : 'box-shadow 180ms ease',
    cursor: attrape ? 'grabbing' : 'grab',
    touchAction: 'none' as const,
  }
}

/** Un message archivé, seul sur la table. */
function TuilePosee({
  message,
  position,
  vise,
  onLacher,
  onSurvol,
  onOuvrir,
  onSupprimer,
  onRetirer,
}: {
  message: MessageAffiche
  position: Position
  /** Vrai quand une autre tuile la recouvre en ce moment même. */
  vise: boolean
  onLacher: (position: Position) => void
  onSurvol: (position: Position) => void
  onOuvrir: () => void
  onSupprimer: () => void
  onRetirer: () => void
}) {
  const { noeud, attrape, aGlisse, poignee } = useGlissement(
    position,
    TUILE,
    onLacher,
    onSurvol,
  )
  const [fond, encre] = palette(rangDeLAdresse(message.adresse))

  return (
    <div
      ref={noeud}
      {...poignee}
      onClick={() => {
        // Un glissement n'ouvre pas le message : sans cette garde, déplacer une
        // tuile ouvrirait le lecteur à chaque fois.
        if (!aGlisse()) onOuvrir()
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOuvrir()
        }
      }}
      className="tuile-de-table absolute flex select-none flex-col gap-1.5 rounded-xl border p-3"
      style={{
        ...styleDePose(position, attrape),
        width: TUILE.largeur,
        height: TUILE.hauteur,
        background: 'var(--card)',
        ...contourDeVisee(vise, attrape),
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[0.5625rem] font-bold"
          style={{ background: fond, color: encre }}
        >
          {initiales(message.nom || message.adresse)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold">
          {message.nom || message.adresse}
        </span>
      </div>

      <div className="line-clamp-2 text-[0.75rem] leading-snug" style={{ color: 'var(--sub)' }}>
        {message.sujet || '(sans objet)'}
      </div>

      <span className="absolute bottom-2.5 right-3 text-[0.625rem] font-medium" style={{ color: 'var(--sub)' }}>
        {heureCourte(message.date)}
      </span>

      {/* Cachés tant que la tuile n'est pas survolée : deux icônes visibles sur
          deux cents tuiles feraient de la table un champ de mines.

          Retirer avant supprimer, et dans cet ordre : l'un range, l'autre
          jette. Le geste sans conséquence précède toujours celui qui en a. */}
      <span className="geste-de-tuile absolute top-1.5 right-1.5 flex items-center gap-0.5">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onRetirer()
          }}
          title="Retirer de la table (le mail reste archivé chez Gmail)"
          aria-label={`Retirer « ${message.sujet || 'sans objet'} » de la table`}
          className="bouton bouton-icone rounded-md p-1"
        >
          <Icone nom="close" taille="0.8125rem" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onSupprimer()
          }}
          title="Mettre à la corbeille"
          aria-label={`Supprimer « ${message.sujet || 'sans objet'} »`}
          className="bouton bouton-icone rounded-md p-1"
        >
          <Icone nom="delete" taille="0.8125rem" />
        </button>
      </span>
    </div>
  )
}

/**
 * Le contour d'un objet qu'une tuile recouvre en ce moment.
 *
 * C'est ce qui rend la règle du recouvrement vérifiable **avant** le lâcher :
 * sans lui, on ne découvre qu'après coup si un tas s'est formé, et former un tas
 * redevient un coup de chance — exactement ce que le nouveau critère cherche à
 * supprimer.
 */
function contourDeVisee(vise: boolean, attrape = false) {
  if (vise) {
    return {
      borderColor: 'var(--accent)',
      boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)',
    }
  }
  return {
    borderColor: 'var(--line)',
    boxShadow: attrape ? '0 18px 40px rgb(0 0 0 / 26%)' : 'var(--shadow)',
  }
}

/** Un tas : un libellé Gmail, et les archives qui le portent. */
function TasPose({
  nom,
  messages,
  position,
  accent,
  vise,
  ouvert,
  onBasculer,
  onDeplacer,
  onOuvrirMessage,
  onDefaire,
  onSortir,
  onSupprimer,
  onRetirer,
}: {
  nom: string
  messages: MessageAffiche[]
  position: Position
  accent: string
  /** Vrai quand une tuile recouvre le tas en ce moment même. */
  vise: boolean
  ouvert: boolean
  onBasculer: () => void
  onDeplacer: (position: Position) => void
  onOuvrirMessage: (message: MessageAffiche) => void
  onDefaire: () => void
  onSortir: (message: string) => void
  onSupprimer: (message: MessageAffiche) => void
  onRetirer: (message: MessageAffiche) => void
}) {
  const { noeud, attrape, aGlisse, poignee } = useGlissement(position, TAS, onDeplacer)

  return (
    <div
      ref={noeud}
      className="absolute select-none"
      style={{
        ...styleDePose(position, attrape),
        width: TAS.largeur,
        zIndex: attrape ? 30 : ouvert ? 20 : 2,
      }}
    >
      {/* Les feuilles derrière : c'est ce qui fait lire « plusieurs » avant
          même d'avoir lu le décompte. Elles ne réagissent pas au pointeur,
          sinon elles voleraient le geste à la carte de tête. */}
      {/* Elles s'effacent au lieu de disparaître : montées en permanence, leur
          opacité suit l'ouverture. Retirées du document, elles s'évanouissaient
          d'un coup à l'instant du clic, et le tas paraissait sauter avant même
          que la liste ait commencé à sortir. */}
      {messages.slice(1, 3).map((m, rang) => (
        <div
          key={m.id}
          aria-hidden
          className="absolute rounded-xl border"
          style={{
            inset: 0,
            height: TAS.hauteur,
            transform: `translate(${(rang + 1) * 5}px, ${(rang + 1) * 5}px) rotate(${(rang + 1) * 0.9}deg)`,
            background: 'var(--card)',
            borderColor: 'var(--line)',
            opacity: ouvert ? 0 : 0.75 - rang * 0.25,
            transition: 'opacity 200ms ease',
            pointerEvents: 'none',
          }}
        />
      ))}

      <div
        {...poignee}
        onClick={() => {
          if (!aGlisse()) onBasculer()
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onBasculer()
          }
        }}
        className="tuile-de-table relative flex flex-col justify-center gap-1 rounded-xl border px-3"
        style={{
          height: TAS.hauteur,
          background: 'var(--card)',
          ...contourDeVisee(vise, attrape),
          ...(attrape && !vise ? { borderColor: accent } : {}),
        }}
      >
        <div className="flex items-center gap-2">
          <Icone nom="rule_folder" taille="1rem" rempli style={{ color: accent }} />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{nom}</span>

          {/* Défaire le tas : le seul geste sans retour de cette page. Il n'est
              offert que sur le tas déplié — on ne défait pas ce qu'on n'a pas
              regardé, et la confirmation nomme ce qui va disparaître. */}
          {ouvert && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onDefaire()
              }}
              title="Défaire le tas et supprimer le libellé"
              aria-label={`Défaire le tas « ${nom} »`}
              className="bouton bouton-icone flex-none rounded-md p-1"
            >
              <Icone nom="open_in_full" taille="0.8125rem" />
            </button>
          )}

          {/* Une seule icône, retournée : la police n'a pas de chevron vers
              le haut, et en inventer un au tracé serait un dessin de plus à
              maintenir pour une rotation qui dit la même chose. */}
          <Icone
            nom="expand_more"
            taille="1rem"
            style={{
              color: 'var(--sub)',
              transform: ouvert ? 'rotate(180deg)' : undefined,
              transition: 'transform 200ms ease',
            }}
          />
        </div>
        <div className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
          {decompte(messages.length, 'message', 'messages')}
        </div>
      </div>

      {/* Déplié en place, avec sa propre barre de défilement : une pile de
          quarante messages ne doit pas couvrir la table entière.

          La liste reste **montée** : c'est ce qui permet de l'animer dans les
          deux sens. Montée et démontée au clic, elle apparaissait et
          disparaissait d'un coup — il n'y a rien à faire glisser sur un nœud
          qui n'existe pas encore. `.deplie` interpole `grid-template-rows` de
          `0fr` à `1fr`, seule façon d'animer vers une hauteur automatique ;
          voir `index.css`.

          L'ombre et la bordure sont posées à l'intérieur : `.deplie > *` clôt
          son enfant, et une ombre portée un cran plus haut se retrouverait
          rognée à hauteur nulle — donc visible sur un tas fermé. La marge
          haute suit, pour la même raison. */}
      <div className="deplie" data-ouvert={ouvert} aria-hidden={!ouvert}>
        <div>
          <div
            className="mt-1.5 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border p-1.5"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--line)',
              boxShadow: '0 18px 40px rgb(0 0 0 / 20%)',
            }}
          >
            {messages.map((m) => (
              <LigneDuTas
                key={m.id}
                message={m}
                // Rien n'est atteignable au clavier tant que le tas est fermé :
                // sans cela, la tabulation traverserait quarante boutons
                // invisibles avant d'atteindre la tuile suivante.
                atteignable={ouvert}
                onOuvrir={() => onOuvrirMessage(m)}
                onSortir={() => onSortir(m.id)}
                onSupprimer={() => onSupprimer(m)}
                onRetirer={() => onRetirer(m)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Une archive dans un tas déplié. */
function LigneDuTas({
  message,
  atteignable,
  onOuvrir,
  onSortir,
  onSupprimer,
  onRetirer,
}: {
  message: MessageAffiche
  /** Faux quand le tas est replié : la ligne existe encore, mais hors d'atteinte. */
  atteignable: boolean
  onOuvrir: () => void
  onSortir: () => void
  onSupprimer: () => void
  onRetirer: () => void
}) {
  const [fond, encre] = palette(rangDeLAdresse(message.adresse))
  const hors = atteignable ? undefined : -1

  return (
    <div className="ligne-de-tas flex items-center gap-2 rounded-lg px-2 py-1.5">
      <button
        type="button"
        tabIndex={hors}
        onClick={onOuvrir}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.5rem] font-bold"
          style={{ background: fond, color: encre }}
        >
          {initiales(message.nom || message.adresse)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem]">
          {message.sujet || '(sans objet)'}
        </span>
      </button>

      {/* Sortir et supprimer côte à côte, et dans cet ordre : le geste sans
          conséquence d'abord, celui qui jette ensuite — comme sur les fenêtres
          de confirmation, où « Annuler » précède toujours l'action. */}
      <button
        type="button"
        tabIndex={hors}
        onClick={onSortir}
        title="Sortir du tas"
        aria-label={`Sortir « ${message.sujet} » du tas`}
        className="bouton bouton-icone flex-none rounded-md p-1"
      >
        <Icone nom="close" taille="0.8125rem" />
      </button>

      <button
        type="button"
        tabIndex={hors}
        onClick={onRetirer}
        title="Retirer de la table (le mail reste archivé chez Gmail)"
        aria-label={`Retirer « ${message.sujet || 'sans objet'} » de la table`}
        className="bouton bouton-icone flex-none rounded-md p-1"
      >
        <Icone nom="archive" taille="0.8125rem" />
      </button>

      <button
        type="button"
        tabIndex={hors}
        onClick={onSupprimer}
        title="Mettre à la corbeille"
        aria-label={`Supprimer « ${message.sujet || 'sans objet'} »`}
        className="bouton bouton-icone flex-none rounded-md p-1"
      >
        <Icone nom="delete" taille="0.8125rem" />
      </button>
    </div>
  )
}

/** Demande le nom du tas qu'on vient de former. */
function NommerLeTas({
  onValider,
  onAnnuler,
}: {
  onValider: (nom: string) => void
  onAnnuler: () => void
}) {
  const [nom, setNom] = useState('')
  const pret = nom.trim().length > 0

  return (
    <Modale
      titre="Nommer ce tas"
      sous="Le tas devient un libellé Gmail : vous le retrouverez sur votre téléphone, et il survivra à MailFlow."
      onFermer={onAnnuler}
    >
      <div className="flex flex-col gap-4">
        <input
          type="text"
          value={nom}
          autoFocus
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pret) onValider(nom.trim())
          }}
          placeholder="Factures, Voyages, Impôts…"
          aria-label="Nom du tas"
          className="champ-de-saisie selectionnable w-full rounded-lg border bg-transparent px-3 text-[0.875rem] outline-none"
          style={{ borderColor: 'var(--line)', color: 'var(--fg)', height: '2.4rem' }}
        />

        <div className="flex items-center justify-end gap-2">
          <Bouton onClick={onAnnuler}>Annuler</Bouton>
          <Bouton
            variante="principal"
            icone="rule_folder"
            disabled={!pret}
            onClick={() => onValider(nom.trim())}
          >
            Créer le tas
          </Bouton>
        </div>
      </div>
    </Modale>
  )
}
