/**
 * Saisie d'une adresse d'expéditeur, avec suggestions.
 *
 * Partagée par la fenêtre d'ajout de règle et celle des rappels de formation :
 * c'est le même geste, et il doit se faire de la même façon.
 *
 * Taper une adresse de mémoire est le moyen le plus sûr de se tromper d'une
 * lettre — et une règle qui vise une adresse inexistante ne se déclenche jamais
 * sans rien dire. Les propositions viennent des messages réellement reçus.
 */
import { useState } from 'react'
import { Etiquette, Icone } from './base'
import { LIBELLE_CATEGORIE, ton } from '../lib/presentation'
import { adresseValide } from '../lib/regles'
import { HORS_JEU, normaliser, rangDeCorrespondance } from '../lib/recherche'
import type { Categorie, MessageAffiche } from '../types/backend'

export function ChampAdresse({
  adresse,
  onChange,
  expediteurs,
  categorie,
  sombre,
  titre = "Adresse de l'expéditeur",
}: {
  adresse: string
  /** Le second argument porte la catégorie devinée, quand elle se déduit. */
  onChange: (v: string, categorie?: Categorie) => void
  expediteurs: MessageAffiche[]
  categorie: Categorie
  sombre: boolean
  titre?: string
}) {
  const choisi = expediteurs.find((m) => m.adresse === adresse)

  // Une fois l'adresse retenue, elle devient une étiquette : on ne risque plus
  // de la modifier d'une frappe, et la croix dit comment revenir en arrière.
  if (adresseValide(adresse)) {
    const [encre, fond] = ton(categorie, sombre)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.7812rem] font-semibold">{titre}</span>
        {/* Hauteur libre plutôt que fixe : c'est l'adresse qui fait la règle,
            elle doit se relire en entier. Une adresse longue passe donc à la
            ligne au lieu d'être coupée. */}
        <div
          className="flex min-h-11 items-center rounded-xl border px-3 py-2"
          style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}
        >
          <span
            className="inline-flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-1.5"
            style={{ background: fond, color: encre }}
          >
            <span className="font-mono text-[0.7812rem] leading-5 font-semibold break-all">
              {adresse}
            </span>
            {/* Une cible carrée de 20 pixels, centrée sur elle-même : la croix
                flottait auparavant sur la ligne de texte, calée par une marge
                d'un demi-pixel, et l'opacité au survol faisait pâlir le dessin
                — ce qui se lit comme un bouton qui se désactive. Un fond qui
                apparaît dit l'inverse. */}
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="Changer d'adresse"
              className="croix-etiquette flex h-5 w-5 flex-none items-center justify-center self-center rounded-md"
              style={{ color: encre }}
            >
              <Icone nom="close" taille="0.8125rem" />
            </button>
          </span>
        </div>
        {choisi && (
          <span className="truncate text-[0.75rem]" style={{ color: 'var(--sub)' }}>
            {choisi.nom}
          </span>
        )}
      </div>
    )
  }

  return (
    <Saisie
      adresse={adresse}
      onChange={onChange}
      expediteurs={expediteurs}
      sombre={sombre}
      titre={titre}
    />
  )
}

/**
 * Le champ vide, et sa liste de propositions.
 *
 * Rien ne s'affiche tant qu'on n'a pas tapé : dérouler d'emblée tous les
 * expéditeurs connus recouvrait le reste du formulaire avant même qu'on ait
 * commencé.
 */
function Saisie({
  adresse,
  onChange,
  expediteurs,
  sombre,
  titre,
}: {
  adresse: string
  onChange: (v: string, categorie?: Categorie) => void
  expediteurs: MessageAffiche[]
  sombre: boolean
  titre: string
}) {
  const [ouvert, setOuvert] = useState(false)
  const q = normaliser(adresse.trim())

  // Deux lettres au minimum : sur une lettre, la liste rendait presque tous les
  // expéditeurs et ne guidait rien — il fallait la lire en entier pour trouver,
  // c'est-à-dire faire soi-même le travail qu'elle prétend éviter.
  const MINIMUM = 2

  /** Là où la requête tombe dans une chaîne : plus c'est tôt, plus c'est sûr. */
  const rang = (texte: string): number => rangDeCorrespondance(q, texte)

  const propositions =
    q.length >= MINIMUM
      ? Array.from(
          new Map(
            expediteurs
              .filter((m) => m.adresse)
              .map((m) => [m.adresse, m] as const),
          ).values(),
        )
          .map((m) => ({ m, r: Math.min(rang(m.nom), rang(m.adresse)) }))
          .filter(({ r }) => r < HORS_JEU)
          // Le classement d'abord, l'alphabet ensuite : une correspondance en
          // début de nom passe avant une qui se cache au milieu d'une adresse.
          .sort(
            (a, b) =>
              a.r - b.r ||
              (a.m.nom || a.m.adresse).localeCompare(b.m.nom || b.m.adresse, 'fr'),
          )
          .map(({ m }) => m)
      : []

  /** Domaine partagé par toutes les propositions, s'il y en a un seul.
   *
   *  Un seul domaine parmi les résultats veut dire que la recherche a désigné
   *  un expéditeur, pas une liste hétéroclite : proposer « tout le domaine » a
   *  alors un sens. Deux domaines différents, et la proposition serait un piège.
   *  On ne la fait pas non plus quand l'utilisateur a déjà tapé un `@` suivi de
   *  quelque chose : il vise une adresse précise. */
  const domaines = new Set(
    propositions.map((m) => m.adresse.split('@')[1]).filter(Boolean),
  )
  const domaineCommun =
    domaines.size === 1 && !/@./.test(adresse) ? [...domaines][0] : null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.7812rem] font-semibold">{titre}</span>
      <input
        type="text"
        value={adresse}
        onChange={(e) => {
          onChange(e.target.value)
          setOuvert(true)
        }}
        onFocus={() => setOuvert(true)}
        placeholder="promo@offres-tech.fr"
        autoFocus
        autoComplete="off"
        className="selectionnable h-11 rounded-xl border px-4 font-mono text-[0.8125rem] outline-none"
        style={{ background: 'var(--sunk)', borderColor: 'var(--line)', color: 'var(--fg)' }}
      />

      {ouvert && propositions.length > 0 && (
        <div
          className="mt-1 flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-xl border p-1"
          style={{ background: 'var(--card)', borderColor: 'var(--line)' }}
        >
          {/* Un grand expéditeur écrit depuis plusieurs adresses : LinkedIn
              emploie `messages-noreply@`, `notifications-noreply@`,
              `jobs-noreply@`… Viser l'une d'elles laisse passer les autres, et
              la page paraît vide alors que la règle existe. Cette entrée-là
              vise le domaine entier, sans qu'il faille connaître la notation. */}
          {domaineCommun && (
            <button
              type="button"
              onClick={() => {
                onChange(`@${domaineCommun}`)
                setOuvert(false)
              }}
              className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
            >
              <Icone nom="groups" taille="1.1em" style={{ color: 'var(--sub)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.7812rem] font-semibold">
                  Tous les messages de {domaineCommun}
                </span>
                <span
                  className="block truncate font-mono text-[0.6875rem]"
                  style={{ color: 'var(--sub)' }}
                >
                  @{domaineCommun}
                </span>
              </span>
            </button>
          )}

          {propositions.map((m) => {
            const [encre, fond] = ton(m.categorie, sombre)
            return (
              <button
                key={m.adresse}
                type="button"
                onClick={() => {
                  // La catégorie du message porte déjà le classement : la
                  // reprendre évite à l'utilisateur de la redonner.
                  onChange(m.adresse, m.categorie === 'humain' ? undefined : m.categorie)
                  setOuvert(false)
                }}
                className="survolable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.7812rem] font-semibold">
                    {m.nom}
                  </span>
                  <span
                    className="block truncate font-mono text-[0.6875rem]"
                    style={{ color: 'var(--sub)' }}
                  >
                    {m.adresse}
                  </span>
                </span>
                {m.categorie !== 'humain' && (
                  <Etiquette
                    texte={LIBELLE_CATEGORIE[m.categorie]}
                    fond={fond}
                    couleur={encre}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
