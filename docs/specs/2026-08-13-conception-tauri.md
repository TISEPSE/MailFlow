# Mise en place de MailFlow — Tauri, backend Rust, sécurité

Date : 2026-08-13
Portée : socle technique, moteur de règles, authentification Google. Ni les cinq
vues ni le client Gmail ne sont implémentés ici.

Ce document grandit avec le projet : les sections 5 et 6 ont été ajoutées après
la mise en place initiale.

## 1. Décisions structurantes

### Tauri plutôt qu'Electron

Le cahier des charges laissait le choix ouvert. Tauri est retenu pour une raison
qui tient à la nature de l'application : MailFlow affiché du HTML d'e-mail,
c'est-à-dire du contenu écrit par des tiers inconnus, et détient en même temps un
accès permanent à la boîte mail de l'utilisateur.

Tauri permet de placer cette frontière dans le processus : le webview ne peut
appeler que les commandes explicitement déclarées, et ne détient aucun jeton. Une
injection dans le rendu d'un message donne accès au DOM, pas à Gmail.

Conséquence assumée : plus de travail qu'avec Electron, où l'écosystème Node
aurait fourni `googleapis` clé en main. Le client Gmail est à écrire.

### Logique métier en Rust

OAuth2, appels Gmail, moteur de règles et accès disque vivent côté Rust. Le
frontend reçoit des données déjà triées et n'émet que des intentions
(`archive_message`, `apply_rules`).

La surface exposée reste volontairement étroite et spécifique. Aucune commande
générique du type « lis ce fichier » ou « appelle cette URL » : chacune élargirait
ce qu'un webview compromis pourrait atteindre.

### Cibles de build

macOS et Linux. La machine de développement est sous Linux, et Tauri ne sait pas
compiler vers macOS depuis Linux — la chaîne de compilation Apple ne se
redistribue pas. Les artefacts macOS proviennent donc de runners GitHub Actions,
`macos-14` pour Apple Silicon et `macos-13` pour Intel.

Le runner Linux est fixé à `ubuntu-22.04` : la glibc du runner détermine la
version minimale exigée chez l'utilisateur, et compiler sur une distribution
récente produit des binaires qui refusent de démarrer ailleurs.

## 2. Modèles de sécurité

### Le webview est une zone non fiable

Tout ce qui traverse l'IPC vers le frontend est traité comme public.

`AppError` porte le détail technique côté Rust, mais sa sérialisation ne produit
que `{ code, message }` : un code machine stable pour le branchement logique, et
une phrase en français destinée à un utilisateur non technique. Les chemins de
fichiers, les codes HTTP et les messages d'erreur des bibliothèques restent dans
les logs. La conversion depuis `reqwest::Error` est écrite à la main pour cette
raison précise : le `Display` de reqwest inclut l'URL complète, donc
potentiellement des paramètres de requête.

Trois tests verrouillent cette propriété, dont un qui vérifie qu'un
`AppError::Config` contenant `client_secret=abc123` ne laissé rien passer.

### Les secrets ne touchent pas le disque

Le `refresh_token` Google et la clé d'API du LLM vont dans le trousseau système :
Keychain sur macOS, Secret Service sur Linux. L'accès passe par le trait
`SecretStore` plutôt que par `keyring::Entry` en direct, pour que la logique
métier reste testable sans dépendre du bureau de l'hôte — une machine de CI n'a
pas de trousseau.

Cas limite traité : sur une session Linux sans agent Secret Service, le trousseau
est injoignable. `KeyringStore::disponible()` le détecte au démarrage et
l'interface le dit, plutôt que de laisser échouer le flux de connexion Google au
milieu.

### OAuth2 : PKCE et redirection loopback

MailFlow est installé chez l'utilisateur et ne peut détenir aucun secret. Google
le reconnaît pour les clients de type « Desktop app » : la sécurité repose sur
PKCE (RFC 7636), pas sur le `client_secret`.

**Correction apportée après le premier essai réel.** J'avais conclu de ce qui
précède qu'il ne fallait envoyer aucun `client_secret`, et verrouillé ce choix
par un test. Google le refuse : son endpoint de jetons répond `invalid_request` /
« client_secret is missing. », y compris pour un client « Desktop » et y compris
avec PKCE. Les deux affirmations coexistent — la valeur n'est pas un secret au
sens usuel, Google la distribue lui-même dans le fichier téléchargé depuis sa
console, mais elle reste obligatoire dans la requête.

La leçon vaut plus que la correction : le raisonnement était juste sur le
principe, faux sur la contrainte, et seul un appel réel l'a montré. Un test qui
verrouille une hypothèse jamais confrontée au service tiers ne protège de rien —
il fige l'erreur et la fait passer pour une décision.

Choix arrêtés, documentés dans `src-tauri/src/auth/mod.rs` :

- L'URL d'autorisation s'ouvre dans le **navigateur système**, jamais dans un
  webview de l'application. L'utilisateur voit la vraie barre d'adresse de Google
  et son gestionnaire de mots de passe fonctionne.
- Redirection vers `127.0.0.1` et non `localhost` : la résolution de `localhost`
  peut passer par IPv6 ou par un fichier `hosts` modifié.
- Le serveur loopback n'accepte qu'une requête et compare le `state` avant tout
  traitement.
- Le scope demandé est `gmail.modify`, sans `gmail.send`. Le bouton « Répondre »
  de la vue 1 ouvrira un brouillon dans le client par défaut plutôt que d'obtenir
  le droit d'envoyer du courrier au nom de l'utilisateur.

### Comparaison d'expéditeurs

Un en-tête `From` s'écrit `"Nom affiche" <adresse@exemple.fr>`, et le nom affiché
est entièrement choisi par l'expéditeur. Comparer la chaîne brute ouvrirait deux
failles symétriques : un expéditeur pourrait déclencher une règle visant
quelqu'un d'autre en imitant son adresse dans son nom affiché, ou échapper à une
règle de suppression en changeant ce nom.

`normaliser_adresse` n'extrait que la partie entre chevrons et la met en
minuscules. Le nom affiché est cosmétique et n'intervient jamais dans une
décision. Deux tests couvrent l'usurpation.

### Permissions du webview

Le fichier de capacités Tauri n'accordé que `core:default`. `tauri-plugin-opener`
est enregistré côté Rust — nécessaire pour ouvrir le navigateur pendant OAuth —
mais n'est **pas** accordé au webview : c'est le backend qui déclenche
l'ouverture, pas le frontend.

La CSP interdit `frame-src` et `object-src`, et limite `connect-src` à l'IPC. Le
mode développement a sa propre CSP, élargie au strict nécessaire pour le
rechargement à chaud de Vite.

Point laissé ouvert : `frame-src 'none'` devra être desserré quand la vue 1
affichera le corps des messages. Le HTML d'e-mail ne doit jamais être injecté
dans le DOM de l'application ; il ira dans une `iframe` en bac à sable, sans
accès au contexte parent. La règle CSP correspondante se décidera à ce
moment-là.

### Persistance de `regles.json`

Deux exigences, toutes deux testées :

- **Écriture atomique.** Le fichier est réécrit à chaque modification de règle.
  Une coupure au mauvais moment laisserait un JSON tronqué, donc toutes les
  automatisations perdues. L'écriture passe par un fichier temporaire voisin,
  `sync_all`, puis `rename`.
- **Permissions `0600` sur Unix.** Le fichier liste les correspondants de
  l'utilisateur : qui lui écrit, quels services il utilise. Le mode est posé à la
  création via `OpenOptionsExt`, et non après coup — entre un `create` en `0644`
  et un `set_permissions`, le contenu serait brièvement lisible par les autres
  comptes de la machine.

Un fichier absent rend un jeu de règles vide : c'est l'état normal au premier
lancement. Un fichier présent mais illisible remonte une erreur et n'est pas
écrasé, pour ne pas effacer sans préavis toutes les automatisations.

### Le LLM reçoit du courrier

Résumer une newsletter, c'est l'envoyer à un tiers. Trois contraintes inscrites
dans `src-tauri/src/llm/mod.rs` :

- Le corps transmis est nettoyé : pas d'en-têtes, pas de pixels de suivi, pas
  d'URL de désabonnement — ces dernières contiennent l'adresse de l'utilisateur,
  souvent en clair.
- Seuls les messages relevant d'une règle `newsletter` partent. Jamais un message
  de la vue 1.
- Sans clé d'API configurée, la vue 3 fonctionne sans résumés plutôt que de
  tomber en panne.

Le contenu d'une newsletter est du texte non fiable, susceptible de contenir des
instructions destinées au modèle. La réponse du modèle ne déclenche aucune action
Gmail : elle est affichée, pas exécutée.

## 3. Ce qui est livré

- Projet Tauri v2 + React 19 + TypeScript + Tailwind v4 qui compile et se lance.
- `error.rs` — erreurs typées, réduction avant IPC, 3 tests.
- `secrets.rs` — trait `SecretStore`, implémentations trousseau et mémoire, 5 tests.
- `rules/model.rs` — format `regles.json` conforme au cahier des charges,
  comparaison d'expéditeurs, 11 tests.
- `rules/store.rs` — persistance atomique en `0600`, 7 tests.
- `rules/engine.rs` — planification des actions Gmail, 14 tests (section 5).
- `auth/` — flux OAuth2 PKCE complet : serveur loopback, échange et
  renouvellement de jetons, session adossée au trousseau, 61 tests (section 6).
- `config.rs` — résolution de l'identifiant client Google, 7 tests.
- `commands/` — `app_health`, `google_connecter`, `google_deconnecter`.
  `app_health` sert de tranche verticale React → IPC → Rust, touchant le
  trousseau, le disque et les chemins Tauri.
- `gmail/` — client complet : analyse des réponses, réessais, traduction du plan
  en appels, transport, orchestration, 62 tests (section 7).
- `llm/` — surface déclarée : trait et contraintes d'implémentation documentées.
  Aucune fausse implémentation.
- CI (lint, types, tests des deux côtés, `cargo audit`) et workflow de release
  en matrice trois plateformes.

Total après les briques 5 à 7 : 172 tests Rust, 12 tests TypeScript,
clippy sans avertissement. Le parcours de connexion a été validé de bout en bout
contre le vrai Google : consentement, échange du code, `refresh_token` relu dans
le trousseau depuis un programme extérieur à l'application.

## 4. Décisions reportées

| Sujet | Quand trancher |
|---|---|
| Fournisseur LLM (Anthropic / OpenAI / Ollama) | Avant la vue 3. Le trait `LlmProvider` isolé le choix. |
| CSP du rendu des corps d'e-mail | Avec la vue 1, en même temps que l'iframe en bac à sable. |
| Signature et notarisation macOS | Avant toute distribution. Demande un compte Apple Developer. |
| Verification Google du scope restreint | Avant de dépasser 100 utilisateurs. Audit de sécurité annuel par un tiers. |
| Lecture des métadonnées par lot (`/batch`) | Quand une règle sur un expéditeur bavard rendra la latence sensible. |
| Rattrapage d'un vendredi manqué | Voir section 5. Demande de mémoriser la date de dernière exécution. |
| Affichage de l'adresse du compte connecté | Avec la vue de connexion. Le scope `userinfo.email` est déjà demandé. |

## 5. Moteur de règles

Écrit en TDD après la mise en place, dans `rules/engine.rs`. 14 tests.

**Le moteur produit un plan, il ne l'exécute pas.** `planifier` est une fonction
pure : jeu de règles + métadonnées de messages + horodatage → liste d'actions.
Aucun réseau, aucun effet de bord. L'exécution Gmail sera une couche distincte.
Deux benefices : le moteur est integralement testable sans réseau, et l'interface
pourra montrer ce qui va se passer avant que ca se passe.

**L'horodatage est injecté**, pas lu depuis `Local::now()`. Les règles
récurrentes dépendent du jour et de l'heure ; un moteur qui consulte l'horloge en
interne n'est pas testable.

**Un message ne reçoit qu'une action**, même si plusieurs règles le visent. La
priorité : suppression > résumé+archivage > archivage simple. La suppression
l'emporte parce que l'utilisateur l'a demandée explicitement et qu'archiver un
message qu'on s'apprête à jeter serait un appel d'API pour rien. Le résumé
l'emporte sur l'archivage simple parce qu'il archive aussi, en faisant davantage.
A priorité égale, la première règle du fichier gagne, pour que le plan ne dépende
pas de l'ordre d'insertion.

**Les actions sans effet sont écartées.** Chaque entrée du plan devient un appel
d'API compte dans le quota Gmail : un archivage sur un message déjà hors de la
boîte, ou une suppression sur un message déjà à la corbeille, ne sont pas
planifies.

### Limite connue : le vendredi manqué

La fenêtre de `tous_les_vendredis` à 18 h couvre le vendredi de 18 h à minuit —
ce qui couvre le « ou à la réouverture de l'application » du cahier des charges
tant que l'utilisateur ouvre MailFlow le vendredi soir.

Une semaine où l'application reste fermée ce soir-là est simplement sautée.
Rattraper demanderait de mémoriser la date de dernière exécution de chaque règle,
ce qui n'est pas fait. C'est un choix à confirmer, pas un oubli.

## 6. Authentification Google

Écrite en TDD dans `auth/`, découpée en cinq fichiers : 58 tests, plus 7 pour
`config.rs` et 1 pour la nouvelle variante d'erreur.

Le découpage suit une ligne : ce qui est testable sans réseau est séparé de ce qui
ne l'est pas, et la seconde catégorie est réduite au minimum. `flux.rs` construit
les requêtes et interprète les réponses — teste ; il ne reste comme code non
couvert que l'appel HTTP lui-même.

### Le serveur loopback

`serveur.rs` ouvre un port sur `127.0.0.1`, attribué par l'OS. **L'ordre compte** :
le serveur est ouvert avant la construction de l'URL d'autorisation, parce que
l'URI de redirection annoncée à Google doit contenir le port réellement écouté.
Construire l'URL d'abord obligerait à fixer un port à l'avance — donc un port
qu'un autre programme peut déjà occuper.

Ce port est joignable par tout processus de la session pendant que la fenêtre est
ouverte. C'est inherent au flux loopback, et ce qui protège est ailleurs :

- le `state` est imprévisible et comparé **à temps constant** ; un `==` classique
  s'arrête au premier octet différent, ce qui laissé reconstituer la valeur
  attendue par la mesure ;
- la fenêtre est de cinq minutes, pas d'une session entière ;
- la ligne de requête est plafonnée à 8 Kio et sa lecture à cinq secondes : une
  connexion muette ou bavarde ne bloque ni ne gonfle rien.

Une requête qui n'est pas la redirection attendue — le navigateur réclame
volontiers `/favicon.ico` — reçoit un 404 et ne compte pas. Un test le vérifie.

### Ce qui n'est jamais imprimable

`ReponseJeton`, `Jetons` et `DemandeAutorisation` ont un `Debug` écrit à la main.
Le `Debug` derive imprimerait `access_token`, `refresh_token` et `code_verifier`
en clair, et ce sont exactement les structures qu'on est tente de journaliser au
moment où un échange échoue. Quatre tests verrouillent la propriété.

Même logique sur les erreurs : `AppError::Auth` porte le détail de protocole côté
Rust et ne sérialise qu'un message neutre. Le corps d'erreur de Google contient un
`error_description` bavard, parfois porteur d'un identifiant de compte ; seul le
code court (`invalid_grant`) est retenu, et il reste dans les logs.

### Renouvellement : distinguer « révoque » de « hors ligne »

`session.rs` renouvelle à la demande, jamais en tâche de fond. Un timer qui
rafraîchit en permanence garde un jeton chaud sans raison.

La distinction critique est la réaction à un échec de renouvellement :

- **Google a répondu et refuse** (`AppError::Auth`) — le `refresh_token` est mort,
  l'utilisateur a révoqué l'accès ou changé son mot de passe. Il est effacé. Le
  garder ferait croire l'application connectée à chaque lancement sans jamais
  aboutir.
- **Google n'a pas répondu** (`AppError::Reseau`) — l'utilisateur est hors ligne,
  pas déconnecté. Le jeton est conservé : l'effacer obligerait à refaire tout le
  parcours Google au retour du réseau.

Deux tests couvrent ce couple, et deux autres le fait que Google peut faire
tourner le `refresh_token` (il faut alors réécrire le trousseau) et qu'une
première autorisation sans `refresh_token` est une erreur immediate — c'est ce
qu'on obtient si `access_type=offline` manque à l'URL, et l'échec surviendrait
sinon une heure plus tard, sans explication.

### Ce que le frontend peut déclencher

Deux commandes, `google_connecter` et `google_deconnecter`. Aucune ne rend de
jeton : le frontend apprend l'issue en relisant `app_health`. Le verrou de session
est tenu pendant tout le parcours, pour que deux connexions simultanées
n'ecrasent pas mutuellement leur `refresh_token`.

`google_deconnecter` révoque côté Google en plus d'effacer le trousseau. Le
trousseau est vide d'abord : si la révocation échoue faute de réseau,
l'utilisateur est quand même déconnecté localement.

### Les identifiants du client ne vont pas dans le trousseau

`config.rs` lit les deux valeurs dans le même ordre : variable d'environnement,
valeur figée à la compilation, puis fichier `.env`.

Aucune ne va dans le trousseau. L'identifiant apparaît de toute façon dans l'URL
d'autorisation. Le `client_secret`, malgré son nom, est documenté par Google
comme non traité en secret pour les applications installées, et reste extractible
de tout binaire distribué : le protéger comme un secret d'utilisateur coûterait
de l'ergonomie sans rien gagner. C'est de la configuration.

Il ne part que dans le corps des POST vers `oauth2.googleapis.com`, jamais dans
l'URL ouverte par le navigateur — celle-ci finit dans l'historique et les
journaux du système. Un test le verrouille, un autre vérifie que le `Debug` de
`ClientOAuth` le masque.

L'une des deux absente, l'application se lance quand même, nomme celle qui manque
dans ses journaux, et signale `clientGoogleConfigure` faux au frontend. L'écran
renvoie alors vers `docs/connexion-google.md` plutôt que d'afficher un bouton qui
ne peut pas aboutir.

## 7. Client Gmail

Écrit en TDD dans `gmail/`, en six fichiers. 62 tests, dont aucun ne touche le
réseau.

Le découpage suit la même règle qu'ailleurs : ce qui décide est séparé de ce qui
transporte. `transport.rs` ne fait qu'émettre et rapporter ; les décisions —
quand rejouer, comment paginer, que compter — vivent dans des modules testables
hors ligne. Deux traits posent la frontière, `Transport` et `SourceJeton`, ce qui
permet de rejouer un `429` ou un `401` dans un test sans attendre ni Google ni
l'horloge (`tokio::test(start_paused)`).

### La requête Gmail restreint, elle ne décide pas

C'est le point de conception le plus important de cette brique.

Lister toute la boîte puis lire les métadonnées de chaque message coûterait des
centaines de lectures par lancement, pour n'agir que sur quelques messages. On
demande donc à Gmail de restreindre en amont : une requête `in:inbox from:<adresse>`
par règle active.

**Mais la recherche de Gmail ne fait pas foi.** Son opérateur `from:` est large :
il inspecte aussi le nom affiché, que l'expéditeur choisit librement. S'y fier
rouvrirait exactement l'usurpation que `normaliser_adresse` ferme — un tiers
déclencherait la règle d'un autre en imitant son adresse dans son nom affiché.

La requête ne sert donc qu'à réduire le volume. La décision revient toujours au
moteur, qui compare l'adresse réelle extraite de l'en-tête `From`. Un test couvre
le cas : Gmail remonte un message dont le nom affiché imite l'adresse visée, et
aucune action n'est planifiée.

Effet de bord agréable : deux règles sur la même adresse à la casse près se
normalisent vers une seule interrogation. C'est un test qui l'a révélé — il
attendait deux appels, il en fallait un.

### Le coût en quota est une propriété testée

Le quota Gmail se compte en unités par utilisateur et par seconde, pas en
requêtes. `execution.rs` traduit le plan en appels et regroupe les archivages :
`batchModify` accepte mille identifiants, donc deux cents archivages coûtent un
appel. Les tests portent sur le nombre d'appels produits, pas seulement sur leur
contenu.

La mise à la corbeille, elle, reste un appel par message : `trash` ne traite
qu'un message à la fois. `batchDelete` existe et serait plus économique, mais il
supprime définitivement — il n'a pas sa place derrière une action déclenchée
automatiquement par une règle.

### Réessais : trois cas, pas deux

`reessai.rs` distingue ce qu'un simple « rejouer sur erreur » confondrait :

- `429` et `5xx` — condition passagère, recul exponentiel avec demi-gigue. Sans
  la part d'aléatoire, tous les clients qui ont pris un `429` ensemble repartent
  ensemble et reconstituent le pic.
- `401` — le jeton est refusé. Ni rejouer tel quel ni abandonner : il faut en
  redemander un. Google fait autorité contre notre calcul d'expiration.
- `403` — ambigu chez Google, qui l'utilise pour le quota **et** pour le refus de
  permission. Seul le `reason` du corps les sépare. Sans motif exploitable, on
  abandonne : marteler une permission refusée est pire que renoncer.

Un `Retry-After` est respecté quand Google en envoie un, mais ramené au plafond :
un en-tête erroné ne doit pas figer l'application.

### Ce qui traverse l'IPC

`gmail_synchroniser` rend un décompte — archivés, mis à la corbeille, échecs — et
rien d'autre. Aucun identifiant de message, aucun sujet, aucun jeton. Le verrou de
session n'est tenu que le temps d'obtenir un jeton, jamais pendant les appels
Gmail, qui durent plusieurs secondes.

Un échec sur une opération n'interrompt pas les suivantes, et le rapport le dit :
un message disparu entre la liste et l'action est un cas courant sur une boîte
vivante, pas une panne.

### Limite connue : les lectures restent séquentielles

Les métadonnées sont lues un message à la fois. Gmail expose un point d'entrée
`/batch` acceptant cent sous-requêtes en un appel HTTP, qui diviserait la latence
d'autant. La restriction par règle rend le nombre de lectures faible en usage
courant, donc ce n'est pas urgent — mais une règle posée sur un expéditeur très
bavard le fera sentir. `PLAFOND_PAR_REGLE` borne les dégâts à deux cents messages
par passe.

## 8. Suite

Les cinq vues du cahier des charges. Le backend leur fournit désormais tout ce
dont elles ont besoin, à l'exception des résumés de newsletters (`llm/`), dont le
fournisseur reste à choisir.
