# Plan — six chantiers MailFlow

Ordre choisi : les correctifs peu risqués d'abord (ils rendent l'application
utilisable tout de suite), le sous-système d'écriture en dernier.

## Étape 0 — Spec et plan écrits

- `docs/superpowers/specs/2026-08-21-six-chantiers-design.md` : la conception
  validée, volet par volet.
- Commit isolé, avant toute ligne de code.

## Chantier A — Les fenêtres passent sous les cartes  (volet 5)

**Cause établie** : `Modale` (`base.tsx:449`) se rend en place. Appelée depuis
une carte de Newsletters, elle tombe sous le `isolation: isolate` de
`Newsletters.tsx:853`, qui borne son `z-50` à la carte.

1. Test de non-régression d'abord : rendu d'une `Modale` sous un parent
   `isolate`, on vérifie que le nœud atterrit dans `document.body`.
2. `base.tsx` : `Modale` enveloppe son rendu dans `createPortal(…, document.body)`.
3. Vérifier les autres appelants — `LecteurEnGrand`, `Confirmation`,
   `Courrier` (fenêtre d'archivage), `Regles`, `Parametres` — que rien ne
   dépendait de la position dans l'arbre (le focus et `Escape` sont gérés par
   `useEffect`, pas par la hiérarchie DOM : ils survivent au portail).

Commit : `fix(fenetres) : une fenêtre ne passe plus sous les cartes`

## Chantier B — Le modal « Voir le mail » et la synthèse ne disent rien  (volets 3 et 6)

Même défaut des deux côtés : un échec silencieux affiché comme un vide.

### B1 — `LecteurEnGrand`

1. `LecteurEnGrand.tsx:47` : remplacer `useState(corps)` par un état à trois
   branches — `chargement` / `charge` / `echec`. Le `.catch(() => undefined)`
   disparaît.
2. Squelette de lettre (barres pulsantes) portant `mouvement-utile`, pour
   échapper à la neutralisation `prefers-reduced-motion` de `index.css:158` —
   une attente qui ne bouge pas se lit comme un blocage.
3. Le squelette n'apparaît qu'après ~150 ms : un corps déjà en cache ne doit
   pas faire clignoter l'écran.
4. Branche `echec` : la raison en clair plus un bouton « Réessayer ».

### B2 — La synthèse du jour

1. `resumes.rs:607` : `synthese_produire` ne rend plus `Option<SyntheseAffichee>`
   mais une union discriminée — `faite`, `aucun_resume`, `sans_cle`, `echec`.
   Les trois cas de `Ok(None)` (lignes 623, 637, 650) deviennent distincts.
   Tests Rust sur chacun.
2. `types/backend.ts` + `lib/tauri.ts` : le miroir TypeScript.
3. `App.tsx:505` : `rafraichirLaSynthese` cesse de tout avaler dans un
   `console.warn` ; elle porte l'état jusqu'au bandeau.
4. `Newsletters.tsx:327` : le bandeau `Synthese` gagne l'état de chargement
   (points en squelette) et une phrase par cas d'échec, chacune disant quoi
   faire : lancer l'analyse / enregistrer une clé dans Paramètres / réessayer.

Commits : un par sous-chantier.

## Chantier C — Les liens ne s'ouvrent pas  (volet 1)

Le mécanisme existe (`ListeMessages.tsx:826` → `lien_ouvrir` → `sortie::ouvrir`).
Corriger sans diagnostic reviendrait à réécrire au hasard du code qui marche
peut-être. Donc : mesurer, puis corriger.

### C1 — Diagnostic (aucune correction à ce stade)

1. Lancer l'application, ouvrir un message HTML, cliquer un lien.
2. Trois traces temporaires : à l'entrée de `brancher()` (le `catch` de
   `contentDocument` est-il pris ?), dans `surClic` (l'écouteur reçoit-il
   l'événement ?), et le journal Rust de `lien_ouvrir` / `sortie::ouvrir`.
3. Conclusion écrite avant de toucher à quoi que ce soit.

### C2 — Correctif selon la cause

- **Cause A — `contentDocument` inaccessible sous WebKitGTK.** Le `catch` de
  `ListeMessages.tsx:878` fait `setHauteur(null)` et sort **sans jamais poser
  l'écouteur** : les liens sont morts par construction. Correctif : réécrire
  les `href` côté Rust en `data-mailflow-lien`, et poser l'interception sur le
  conteneur côté application plutôt que dans le document du cadre — ou servir
  le corps par un protocole Tauri dédié. Le choix se fait avec vous, avec les
  mesures sous les yeux.
- **Cause B — `sortie::ouvrir` échoue.** Le travail est dans `sortie.rs` ; le
  journal Rust dira lequel des deux lanceurs manque.

### C3 — Les mails en texte brut  (indépendant du diagnostic, à faire dans tous les cas)

`ListeMessages.tsx:748` rend le texte dans un `<pre>` : les URL y sont du texte
mort, jamais cliquables. Détecter les adresses `http(s)://` et `www.` et les
rendre en `<a>` passant par le même `lienOuvrir`. Tests sur la détection —
ponctuation finale, parenthèses, adresses collées à un mot.

## Chantier D — Archivage programmé  (volet 2)

Le backend le fait déjà à moitié : `Rule.frequence` et `Rule.heure_execution`
existent (`model.rs:153`), `engine.rs:82` les respecte. Il manque des
fréquences et l'interface.

1. **`model.rs`** : `Frequence` passe à `Quotidienne`, `Hebdomadaire { jour }`,
   et garde `TousLesVendredis` pour que les `regles.json` déjà écrits se
   relisent. Test de relecture d'un fichier ancien.
2. **`engine.rs:82`** : `fenetre_ouverte` traite les nouveaux cas. Tests par
   variante, avec une horloge injectée comme le reste du module.
3. **`types/backend.ts`** : `frequence` cesse d'être le littéral
   `'tous_les_vendredis'`.
4. **`lib/regles.ts`** : `phrase()` dit la vérité pour chaque combinaison ;
   `nouvelleRegle` cesse d'imposer vendredi 18 h en douce.
5. **`Regles.tsx:526`** : dans le bloc déjà conditionné par `archive`, un
   `Selecteur` « Quand » (Immédiatement / Tous les jours / Toutes les semaines),
   un `<input type="time">` dès qu'une fréquence est choisie, et un `Selecteur`
   de jour pour l'hebdomadaire.
6. **`App.tsx:908`** — le point qui rend la promesse tenable. Aujourd'hui le
   minuteur périodique ne fait que relister la boîte ; les règles ne
   s'appliquent qu'au lancement (`App.tsx:880`). Une règle « tous les jours à
   18 h » ne se déclencherait donc jamais tant que l'application reste ouverte.
   Le relevé périodique passera par `gmailSynchroniser`.

Commits : un par couche (Rust, puis interface, puis le relevé périodique).

## Chantier E — Rédiger et transférer  (volet 4)

Le seul sous-système neuf. Il rompt avec une décision documentée du projet
(`auth/mod.rs:57`), mais le scope `gmail.modify` déjà accordé autorise
`users.messages.send` : aucune reconnexion Google.

### E1 — Rust

1. Nouveau `gmail/redaction.rs`, écrit en tests d'abord :
   - construction d'un MIME `text/plain; charset=utf-8`, corps en base64 ;
   - objet encodé RFC 2047 quand il porte des accents ;
   - **refus de tout `\r` ou `\n` dans un en-tête** — sans quoi un objet
     permettrait d'injecter des en-têtes arbitraires. C'est le test qui compte
     le plus du chantier ;
   - validation des adresses, réutilisant `adresse_utilisable`
     (`commands/mod.rs:1826`) plutôt que d'en écrire une seconde.
2. `client.rs` : `envoyer_message`, un `POST users/me/messages/send` avec
   `{"raw": base64url(mime)}`, par `appeler()` qui gère déjà réessais et
   renouvellement de jeton. Test avec le transport factice déjà en place.
3. `commands/mod.rs` : commande `message_envoyer`, enregistrée dans
   `lib.rs:104`.
4. Corriger les commentaires de `auth/mod.rs:57` et `Courrier.tsx:512` : ils
   affirment le contraire de ce que fait désormais l'application.

### E2 — Interface

1. `composants/Redaction.tsx` : une `Modale` avec `À`, `Cc` (replié par
   défaut), `Objet`, corps en `<textarea>`. Champs d'adresse réutilisant
   `ChampAdresse`. État d'envoi, message d'échec en clair.
2. `App.tsx` : bouton principal **« Nouveau mail »** en haut de la barre
   latérale, sous « Boîte de réception », replié en icône quand la barre l'est.
3. `Courrier.tsx:519` (`BarreDeReponse`) et les actions de `LecteurEnGrand` :
   bouton **« Transférer »**, qui ouvre la même fenêtre pré-remplie — objet
   `Tr : …`, corps précédé des en-têtes d'origine.
4. Quand le message d'origine porte des pièces jointes, une mention explicite
   dit qu'elles ne suivent pas. Mieux vaut le dire que le laisser découvrir.

Le bouton « Répondre » actuel reste sur `mailto:` : le changer n'était pas
demandé, et mêler les deux décisions dans un même lot les rendrait
indissociables.

## Vérification finale

- `npm run lint`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`
  — sorties montrées, pas résumées.
- `npm run tauri:dev` et parcours des six points à l'écran.
- Aucun « c'est corrigé » sans la sortie de commande qui le prouve.

---

## État au 22 août 2026

| Chantier | État | Vérification |
|---|---|---|
| A — fenêtres sous les cartes | fait | 3 tests de rendu ; portail dans `Modale` |
| B1 — chargement du modal de lecture | fait | 3 tests de rendu |
| B2 — la synthèse dit ce qu'elle fait | fait | 2 tests Rust + union discriminée de bout en bout |
| C3 — liens dans le texte brut | fait | 10 tests sur `decouperLesLiens` |
| C1/C2 — liens dans le HTML | **en attente d'une mesure** | voir ci-dessous |
| D — archivage programmé | fait | 5 tests de moteur + 6 tests de phrase |
| E — rédiger et transférer | fait | 16 tests MIME + 2 tests de transport + 21 tests d'interface |

Total : 506 tests Rust, 186 tests TypeScript, `tsc` et `oxlint` sans un mot.

### Ce qui reste : le diagnostic des liens

Le mécanisme d'interception existe et est correct à la lecture. Deux traces ont
été posées pour trancher entre les deux causes possibles, mais elles demandent
que l'application tourne et qu'un lien soit cliqué — ce qui n'a pas pu être fait
ici (le port 1420 est occupé par un autre projet sur cette machine).

Marche à suivre :

1. `npm run tauri:dev`
2. Ouvrir un message HTML, ouvrir la console du webview, cliquer un lien.
3. Lire ce qui sort :
   - `[MailFlow] document du cadre inaccessible` → **cause A**. WebKitGTK refuse
     `contentDocument` sur l'`iframe` en bac à sable ; l'écoute des clics ne peut
     pas être posée. Il faut alors changer la façon dont le corps est servi au
     webview, et non retoucher l'interception.
   - `[MailFlow] lien du message intercepté` sans que rien ne s'ouvre → **cause
     B**. Le clic arrive bien jusqu'à Rust ; le travail est dans `sortie.rs`, et
     le journal Rust dira lequel des deux lanceurs manque.
   - Rien du tout → l'écouteur n'est pas atteint pour une troisième raison, à
     chercher sur le document du cadre.
