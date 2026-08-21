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
  CompteConnu,
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
  comptes,
  tableau,
  onTableau,
  sombre,
  melange,
  corpsConnus,
  onCorpsCharge,
  onTransferer,
  gestes,
}: {
  archives: MessageAffiche[]
  libelles: LibelleGmail[]
  /** Adresse de la boîte regardée. Sert de repère, pas d'affichage : quand elle
   *  change, tout ce que la page retenait du compte précédent est lâché. */
  compte: string | null
  comptes?: CompteConnu[]
  tableau: Tableau
  /** Appelée à chaque dépose : c'est elle qui écrit `tableau.json`. */
  onTableau: (tableau: Tableau) => void
  sombre: boolean
  /** Vrai sous « Tous les comptes ». */
  melange: boolean
  corpsConnus: ReadonlyMap<string, CorpsMessage>
  onCorpsCharge: (id: string, corps: CorpsMessage) => void
  /** Ouvre la fenêtre de rédaction sur un transfert du message lu. */
  onTransferer?: (message: MessageAffiche) => void
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
   */
  const tasVivants = useMemo(() => [...parTas.keys()], [parTas])

  /** Effectifs de chaque tas au passage précédent : c'est la chute qu'on guette. */
  const effectifs = useRef(new Map<string, number>())

  /** Tas dont on a déjà demandé la suppression. Un ordre suffit. */
  const signales = useRef(new Set<string>())

  const apresUnGeste = useRef(false)

  useEffect(() => {
    effectifs.current = new Map()
    signales.current = new Set()
  }, [compte])

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
  // d'arriver en reçoit une au coin supérieur gauche libre.
  const dispose = useMemo(
    () =>
      completer(
        tableau,
        tasVivants,
        seuls.map((m) => m.id),
      ),
    [tableau, tasVivants, seuls],
  )

  /** Tout ce qui est posé, pour savoir ce qu'on survole en lâchant. */
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

  // Sous « Tous les comptes », on montre les archives séparées dans des blocs distincts par compte.
  if (melange) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <VueArchivesMelangees
          archives={archives}
          comptes={comptes}
          nomsDesLibelles={nomsDesLibelles}
          accent={accent}
          onOuvrir={ouvrir}
          onSupprimer={setASupprimer}
          onRetirer={(m) => {
            noterLeGeste()
            void gestes.onRetirer(m.id).catch((e) => gestes.onErreur(String(e)))
          }}
        />

        {lu && (
          <LecteurEnGrand
            message={lu}
            corps={corpsConnus.get(lu.id) ?? null}
            onCorpsCharge={onCorpsCharge}
            onFermer={() => setLu(null)}
            actions={
              <>
                {onTransferer && (
                  <Bouton
                    icone="forward"
                    onClick={() => {
                      const cible = lu
                      setLu(null)
                      onTransferer(cible)
                    }}
                    titre="Faire suivre ce message. Les fichiers joints ne partent pas avec."
                  >
                    Transférer
                  </Bouton>
                )}
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
              </>
            }
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
      </div>
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
            <>
              {onTransferer && (
                <Bouton
                  icone="forward"
                  onClick={() => {
                    const cible = lu
                    setLu(null)
                    onTransferer(cible)
                  }}
                  titre="Faire suivre ce message. Les fichiers joints ne partent pas avec."
                >
                  Transférer
                </Bouton>
              )}
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
            </>
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

/** Vue sous « Tous les comptes » : les archives regroupées par compte dans des blocs distincts. */
function VueArchivesMelangees({
  archives,
  comptes,
  nomsDesLibelles,
  accent,
  onOuvrir,
  onSupprimer,
  onRetirer,
}: {
  archives: MessageAffiche[]
  comptes?: CompteConnu[]
  nomsDesLibelles: Map<string, string>
  accent: string
  onOuvrir: (message: MessageAffiche) => void
  onSupprimer: (message: MessageAffiche) => void
  onRetirer: (message: MessageAffiche) => void
}) {
  const [deplieTas, setDeplieTas] = useState<string | null>(null)

  // Liste ordonnée des comptes à afficher
  const listeComptes = useMemo(() => {
    if (comptes && comptes.length > 0) {
      return comptes
    }
    const adresses = Array.from(new Set(archives.map((m) => m.compte).filter(Boolean)))
    return adresses.map((adresse) => ({
      adresse,
      nom: null,
      photo: null,
      actif: false,
    }))
  }, [comptes, archives])

  if (archives.length === 0) {
    return (
      <Vide
        icone="archive"
        titre="Aucune archive"
        detail="Les messages que vous rangez depuis les autres pages apparaîtront ici."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6" style={{ background: 'var(--sunk)' }}>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        {listeComptes.map((c, indexCompte) => {
          const messagesDuCompte = archives.filter(
            (m) => m.compte === c.adresse || (!m.compte && indexCompte === 0),
          )
          const { parTas: parTasCompte, seuls: seulsCompte } = repartir(
            messagesDuCompte,
            new Set(nomsDesLibelles.keys()),
          )
          const tasCompte = [...parTasCompte.keys()]
          const [fondCompte, encreCompte] = palette(indexCompte)

          return (
            <div
              key={c.adresse}
              className="overflow-hidden rounded-2xl border transition-all"
              style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
            >
              {/* En-tête du bloc de compte */}
              <div
                className="flex items-center justify-between border-b px-5 py-4"
                style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
              >
                <div className="flex items-center gap-3">
                  {c.photo ? (
                    <img
                      src={c.photo}
                      alt={c.nom ?? c.adresse}
                      className="h-9 w-9 rounded-full object-cover shadow-xs"
                    />
                  ) : (
                    <span
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-[0.875rem] font-bold shadow-xs"
                      style={{ background: fondCompte, color: encreCompte }}
                    >
                      {initiales(c.nom || c.adresse)}
                    </span>
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight">
                      {c.nom || c.adresse}
                      {c.nom && c.nom !== c.adresse && (
                        <span className="text-[0.75rem] font-normal" style={{ color: 'var(--sub)' }}>
                          ({c.adresse})
                        </span>
                      )}
                    </div>
                    <div className="text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
                      {decompte(messagesDuCompte.length, 'archive', 'archives')}
                    </div>
                  </div>
                </div>

                <span
                  className="rounded-full px-2.5 py-1 text-[0.6875rem] font-medium"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent-fg)' }}
                >
                  {decompte(messagesDuCompte.length, 'archive', 'archives')}
                </span>
              </div>

              {/* Contenu du bloc */}
              <div className="p-5">
                {messagesDuCompte.length === 0 ? (
                  <div className="py-6 text-center text-[0.8125rem]" style={{ color: 'var(--sub)' }}>
                    Aucune archive pour ce compte.
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {/* Les tas de ce compte */}
                    {tasCompte.length > 0 && (
                      <div className="space-y-3">
                        <div
                          className="flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-wider"
                          style={{ color: 'var(--sub)' }}
                        >
                          <Icone nom="rule_folder" taille="0.875rem" rempli style={{ color: accent }} />
                          Tas & Libellés ({tasCompte.length})
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {tasCompte.map((id) => {
                            const nom = nomsDesLibelles.get(id) ?? 'Sans nom'
                            const msgs = parTasCompte.get(id) ?? []
                            const ouvert = deplieTas === id

                            return (
                              <div
                                key={id}
                                className="flex flex-col rounded-xl border p-3.5 transition-all"
                                style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
                              >
                                <div
                                  className="flex cursor-pointer items-center justify-between"
                                  onClick={() => setDeplieTas((d) => (d === id ? null : id))}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      setDeplieTas((d) => (d === id ? null : id))
                                    }
                                  }}
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Icone nom="rule_folder" taille="1.125rem" rempli style={{ color: accent }} />
                                    <span className="truncate text-[0.8125rem] font-semibold">{nom}</span>
                                  </div>
                                  <span
                                    className="rounded-md px-2 py-0.5 font-mono text-[0.6875rem]"
                                    style={{ background: 'var(--sunk)', color: 'var(--sub)' }}
                                  >
                                    {msgs.length}
                                  </span>
                                </div>

                                {ouvert && (
                                  <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                                    {msgs.map((m) => (
                                      <div
                                        key={m.id}
                                        className="group/item flex cursor-pointer items-center justify-between rounded-lg p-2 transition-colors hover:bg-[var(--sunk)]"
                                        onClick={() => onOuvrir(m)}
                                      >
                                        <div className="min-w-0 flex-1 pr-2">
                                          <div className="truncate text-[0.75rem] font-medium">
                                            {m.sujet || '(sans objet)'}
                                          </div>
                                          <div className="truncate text-[0.6875rem]" style={{ color: 'var(--sub)' }}>
                                            {m.nom || m.adresse}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              onRetirer(m)
                                            }}
                                            className="bouton bouton-icone rounded p-1"
                                            title="Retirer de la table"
                                          >
                                            <Icone nom="close" taille="0.75rem" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              onSupprimer(m)
                                            }}
                                            className="bouton bouton-icone rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                            title="Mettre à la corbeille"
                                          >
                                            <Icone nom="delete" taille="0.75rem" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Les tuiles libres de ce compte */}
                    {seulsCompte.length > 0 && (
                      <div className="space-y-3">
                        {tasCompte.length > 0 && (
                          <div
                            className="text-[0.75rem] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--sub)' }}
                          >
                            Tuiles libres ({seulsCompte.length})
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {seulsCompte.map((message) => {
                            const [fondTuile, encreTuile] = palette(rangDeLAdresse(message.adresse))

                            return (
                              <div
                                key={message.id}
                                onClick={() => onOuvrir(message)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    onOuvrir(message)
                                  }
                                }}
                                className="tuile-de-table relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition-all hover:shadow-xs"
                                style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
                              >
                                <div>
                                  <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span
                                        className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[0.5625rem] font-bold"
                                        style={{ background: fondTuile, color: encreTuile }}
                                      >
                                        {initiales(message.nom || message.adresse)}
                                      </span>
                                      <span className="min-w-0 truncate text-[0.75rem] font-semibold">
                                        {message.nom || message.adresse}
                                      </span>
                                    </div>
                                    <span
                                      className="flex-none text-[0.625rem] font-medium"
                                      style={{ color: 'var(--sub)' }}
                                    >
                                      {heureCourte(message.date)}
                                    </span>
                                  </div>
                                  <div className="line-clamp-2 text-[0.75rem] font-medium leading-snug">
                                    {message.sujet || '(sans objet)'}
                                  </div>
                                </div>

                                <div
                                  className="geste-de-tuile absolute top-2 right-2 flex items-center gap-0.5 rounded-md border shadow-xs"
                                  style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onRetirer(message)
                                    }}
                                    title="Retirer de la table"
                                    className="bouton bouton-icone rounded-md p-1"
                                  >
                                    <Icone nom="close" taille="0.75rem" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onSupprimer(message)
                                    }}
                                    title="Mettre à la corbeille"
                                    className="bouton bouton-icone rounded-md p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                  >
                                    <Icone nom="delete" taille="0.75rem" />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
