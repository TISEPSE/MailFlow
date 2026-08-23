/**
 * Saisie de destinataires, avec pastilles et propositions.
 *
 * # Pourquoi ce n'est pas `ChampAdresse`
 *
 * Celui-là vise **une** adresse, et la fige en étiquette dès qu'elle est
 * valide : c'est ce qu'il faut pour une règle, qui ne concerne qu'un
 * expéditeur. Écrire à quelqu'un demande l'inverse — plusieurs adresses, qu'on
 * ajoute et qu'on retire une à une.
 *
 * Ce qu'ils partagent, ils le partagent pour de bon : le classement des
 * correspondances vit dans `lib/recherche`, et non en double dans chaque champ.
 *
 * # Ce que les propositions évitent
 *
 * Une adresse tapée de mémoire se trompe d'une lettre, et un message parti à
 * côté ne revient pas. Les propositions viennent des gens qui figurent déjà
 * dans vos messages — voir `lib/contacts`.
 */
import { useRef, useState } from 'react'
import { Icone, Pastille } from './base'
import { proposer, type Connaissance } from '../lib/contacts'
import { decouperAdresses } from '../lib/redaction'
import { domaineDe, initiales, palette } from '../lib/presentation'

export function ChampDestinataires({
  valeur,
  onChange,
  carnet,
  logos,
  libelle,
  placeholder,
  autoFocus = false,
}: {
  /** Les adresses, telles que `lib/redaction` les découpe : séparées par des virgules. */
  valeur: string
  onChange: (v: string) => void
  carnet: readonly Connaissance[]
  logos?: Record<string, string>
  libelle: string
  placeholder: string
  autoFocus?: boolean
}) {
  /** Ce qu'on est en train de taper, pas encore validé. */
  const [saisie, setSaisie] = useState('')
  const [ouvert, setOuvert] = useState(false)
  /** La proposition sous le curseur, pilotée aux flèches. */
  const [vise, setVise] = useState(0)

  const champ = useRef<HTMLInputElement>(null)

  const retenues = decouperAdresses(valeur)
  const propositions = ouvert ? proposer(carnet, saisie, retenues) : []

  const poser = (adresse: string) => {
    const propre = adresse.trim()
    if (!propre) return

    // Pas deux fois la même : la comparaison ignore la casse, parce que
    // « Alice@ » et « alice@ » désignent la même personne.
    const deja = retenues.some((a) => a.toLowerCase() === propre.toLowerCase())
    onChange(deja ? valeur : [...retenues, propre].join(', '))

    setSaisie('')
    setVise(0)
    champ.current?.focus()
  }

  const retirer = (adresse: string) => {
    onChange(retenues.filter((a) => a !== adresse).join(', '))
    champ.current?.focus()
  }

  const auClavier = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && propositions.length) {
      e.preventDefault()
      setVise((n) => (n + 1) % propositions.length)
      return
    }

    if (e.key === 'ArrowUp' && propositions.length) {
      e.preventDefault()
      setVise((n) => (n - 1 + propositions.length) % propositions.length)
      return
    }

    // Entrée, virgule, point-virgule et tabulation valident : ce sont les
    // quatre gestes que les gens font pour dire « celle-là, et au suivant ».
    if (['Enter', ',', ';', 'Tab'].includes(e.key)) {
      const choisie = propositions[vise]
      if (!choisie && !saisie.trim()) return

      // La tabulation ne valide que s'il y a quelque chose à valider : sinon
      // elle doit continuer de sortir du champ, comme partout ailleurs.
      e.preventDefault()
      poser(choisie ? choisie.adresse : saisie)
      return
    }

    // Retour arrière sur un champ vide : on reprend la dernière pastille. C'est
    // le geste attendu, et il évite d'avoir à viser une croix de huit pixels.
    if (e.key === 'Backspace' && !saisie && retenues.length) {
      e.preventDefault()
      const derniere = retenues[retenues.length - 1] ?? ''
      onChange(retenues.slice(0, -1).join(', '))
      setSaisie(derniere)
      return
    }

    if (e.key === 'Escape' && ouvert) {
      e.preventDefault()
      setOuvert(false)
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {retenues.map((adresse) => (
          <span
            key={adresse}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5"
            style={{ background: 'var(--sunk)' }}
          >
            <span className="truncate font-mono text-[0.75rem]">{adresse}</span>
            <button
              type="button"
              onClick={() => retirer(adresse)}
              aria-label={`Retirer ${adresse}`}
              className="bouton bouton-icone flex h-5 w-5 flex-none items-center justify-center rounded-full"
            >
              <Icone nom="close" taille="0.75rem" />
            </button>
          </span>
        ))}

        <input
          ref={champ}
          type="text"
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value)
            setOuvert(true)
            setVise(0)
          }}
          onFocus={() => setOuvert(true)}
          // `blur` différé : un clic sur une proposition passe par le `blur` du
          // champ avant d'arriver au bouton. Fermer tout de suite ferait
          // disparaître la ligne sous le doigt.
          onBlur={() => {
            window.setTimeout(() => {
              setOuvert(false)
              // Ce qui restait tapé est retenu : quitter le champ après avoir
              // écrit une adresse entière et la voir disparaître est une perte
              // de travail qu'on ne comprend pas.
              if (saisie.trim()) poser(saisie)
            }, 120)
          }}
          onKeyDown={auClavier}
          aria-label={libelle}
          placeholder={retenues.length ? '' : placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="champ-de-saisie selectionnable min-w-[12rem] flex-1 bg-transparent py-1 text-[0.8125rem] outline-none placeholder:text-[var(--sub)]"
          style={{ color: 'var(--fg)' }}
        />
      </div>

      {propositions.length > 0 && (
        <ul
          className="menu-apparait absolute top-full right-0 left-0 z-20 mt-1.5 max-h-64 overflow-y-auto rounded-2xl border p-1"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--line)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {propositions.map((c, i) => {
            const dom = domaineDe(c.adresse)
            const logo = logos?.[dom]
            const [fond, couleur] = palette(i)
            return (
              <li key={c.adresse}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    poser(c.adresse)
                  }}
                  onMouseEnter={() => setVise(i)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                  style={{ background: i === vise ? 'var(--selection)' : 'transparent' }}
                >
                  <Pastille
                    texte={initiales(c.nom || c.adresse)}
                    fond={fond}
                    couleur={couleur}
                    // La photo de la personne l'emporte sur le logo de son
                    // domaine : on reconnaît un visage plus vite qu'une marque.
                    // Les « autres contacts » n'en ont pas, et retombent sur le
                    // logo puis sur les initiales.
                    logo={c.photo ?? logo}
                    taille="1.875rem"
                  />
                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    {c.nom ? (
                      <>
                        <span className="truncate text-[0.8125rem] font-medium text-[var(--fg)]">
                          {c.nom}
                        </span>
                        <span
                          className="truncate font-mono text-[0.6875rem]"
                          style={{ color: 'var(--sub)' }}
                        >
                          {c.adresse}
                        </span>
                      </>
                    ) : (
                      <span className="truncate font-mono text-[0.8125rem] text-[var(--fg)]">
                        {c.adresse}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
