# Mise en place de MailFlow — Tauri, backend Rust, securite

Date : 2026-08-13
Portee : socle technique. Ni les cinq vues, ni l'authentification Google, ni le
client Gmail ne sont implementes ici.

## 1. Decisions structurantes

### Tauri plutot qu'Electron

Le cahier des charges laissait le choix ouvert. Tauri est retenu pour une raison
qui tient a la nature de l'application : MailFlow affiche du HTML d'e-mail,
c'est-a-dire du contenu ecrit par des tiers inconnus, et detient en meme temps un
acces permanent a la boite mail de l'utilisateur.

Tauri permet de placer cette frontiere dans le processus : le webview ne peut
appeler que les commandes explicitement declarees, et ne detient aucun jeton. Une
injection dans le rendu d'un message donne acces au DOM, pas a Gmail.

Consequence assumee : plus de travail qu'avec Electron, ou l'ecosysteme Node
aurait fourni `googleapis` cle en main. Le client Gmail est a ecrire.

### Logique metier en Rust

OAuth2, appels Gmail, moteur de regles et acces disque vivent cote Rust. Le
frontend recoit des donnees deja triees et n'emet que des intentions
(`archive_message`, `apply_rules`).

La surface exposee reste volontairement etroite et specifique. Aucune commande
generique du type « lis ce fichier » ou « appelle cette URL » : chacune elargirait
ce qu'un webview compromis pourrait atteindre.

### Cibles de build

macOS et Linux. La machine de developpement est sous Linux, et Tauri ne sait pas
compiler vers macOS depuis Linux — la chaine de compilation Apple ne se
redistribue pas. Les artefacts macOS proviennent donc de runners GitHub Actions,
`macos-14` pour Apple Silicon et `macos-13` pour Intel.

Le runner Linux est fixe a `ubuntu-22.04` : la glibc du runner determine la
version minimale exigee chez l'utilisateur, et compiler sur une distribution
recente produit des binaires qui refusent de demarrer ailleurs.

## 2. Modeles de securite

### Le webview est une zone non fiable

Tout ce qui traverse l'IPC vers le frontend est traite comme public.

`AppError` porte le detail technique cote Rust, mais sa serialisation ne produit
que `{ code, message }` : un code machine stable pour le branchement logique, et
une phrase en francais destinee a un utilisateur non technique. Les chemins de
fichiers, les codes HTTP et les messages d'erreur des bibliotheques restent dans
les logs. La conversion depuis `reqwest::Error` est ecrite a la main pour cette
raison precise : le `Display` de reqwest inclut l'URL complete, donc
potentiellement des parametres de requete.

Trois tests verrouillent cette propriete, dont un qui verifie qu'un
`AppError::Config` contenant `client_secret=abc123` ne laisse rien passer.

### Les secrets ne touchent pas le disque

Le `refresh_token` Google et la cle d'API du LLM vont dans le trousseau systeme :
Keychain sur macOS, Secret Service sur Linux. L'acces passe par le trait
`SecretStore` plutot que par `keyring::Entry` en direct, pour que la logique
metier reste testable sans dependre du bureau de l'hote — une machine de CI n'a
pas de trousseau.

Cas limite traite : sur une session Linux sans agent Secret Service, le trousseau
est injoignable. `KeyringStore::disponible()` le detecte au demarrage et
l'interface le dit, plutot que de laisser echouer le flux de connexion Google au
milieu.

### OAuth2 : PKCE et redirection loopback

MailFlow est installe chez l'utilisateur et ne peut detenir aucun secret. Google
le reconnait pour les clients de type « Desktop app » : la securite repose sur
PKCE (RFC 7636), pas sur le `client_secret`.

Choix arretes, documentes dans `src-tauri/src/auth/mod.rs` :

- L'URL d'autorisation s'ouvre dans le **navigateur systeme**, jamais dans un
  webview de l'application. L'utilisateur voit la vraie barre d'adresse de Google
  et son gestionnaire de mots de passe fonctionne.
- Redirection vers `127.0.0.1` et non `localhost` : la resolution de `localhost`
  peut passer par IPv6 ou par un fichier `hosts` modifie.
- Le serveur loopback n'accepte qu'une requete et compare le `state` avant tout
  traitement.
- Le scope demande est `gmail.modify`, sans `gmail.send`. Le bouton « Repondre »
  de la vue 1 ouvrira un brouillon dans le client par defaut plutot que d'obtenir
  le droit d'envoyer du courrier au nom de l'utilisateur.

### Comparaison d'expediteurs

Un en-tete `From` s'ecrit `"Nom affiche" <adresse@exemple.fr>`, et le nom affiche
est entierement choisi par l'expediteur. Comparer la chaine brute ouvrirait deux
failles symetriques : un expediteur pourrait declencher une regle visant
quelqu'un d'autre en imitant son adresse dans son nom affiche, ou echapper a une
regle de suppression en changeant ce nom.

`normaliser_adresse` n'extrait que la partie entre chevrons et la met en
minuscules. Le nom affiche est cosmetique et n'intervient jamais dans une
decision. Deux tests couvrent l'usurpation.

### Permissions du webview

Le fichier de capacites Tauri n'accorde que `core:default`. `tauri-plugin-opener`
est enregistre cote Rust — necessaire pour ouvrir le navigateur pendant OAuth —
mais n'est **pas** accorde au webview : c'est le backend qui declenche
l'ouverture, pas le frontend.

La CSP interdit `frame-src` et `object-src`, et limite `connect-src` a l'IPC. Le
mode developpement a sa propre CSP, elargie au strict necessaire pour le
rechargement a chaud de Vite.

Point laisse ouvert : `frame-src 'none'` devra etre desserre quand la vue 1
affichera le corps des messages. Le HTML d'e-mail ne doit jamais etre injecte
dans le DOM de l'application ; il ira dans une `iframe` en bac a sable, sans
acces au contexte parent. La regle CSP correspondante se decidera a ce
moment-la.

### Persistance de regles.json

Deux exigences, toutes deux testees :

- **Ecriture atomique.** Le fichier est reecrit a chaque modification de regle.
  Une coupure au mauvais moment laisserait un JSON tronque, donc toutes les
  automatisations perdues. L'ecriture passe par un fichier temporaire voisin,
  `sync_all`, puis `rename`.
- **Permissions `0600` sur Unix.** Le fichier liste les correspondants de
  l'utilisateur : qui lui ecrit, quels services il utilise. Le mode est pose a la
  creation via `OpenOptionsExt`, et non apres coup — entre un `create` en `0644`
  et un `set_permissions`, le contenu serait brievement lisible par les autres
  comptes de la machine.

Un fichier absent rend un jeu de regles vide : c'est l'etat normal au premier
lancement. Un fichier present mais illisible remonte une erreur et n'est pas
ecrase, pour ne pas effacer sans preavis toutes les automatisations.

### Le LLM recoit du courrier

Resumer une newsletter, c'est l'envoyer a un tiers. Trois contraintes inscrites
dans `src-tauri/src/llm/mod.rs` :

- Le corps transmis est nettoye : pas d'en-tetes, pas de pixels de suivi, pas
  d'URL de desabonnement — ces dernieres contiennent l'adresse de l'utilisateur,
  souvent en clair.
- Seuls les messages relevant d'une regle `newsletter` partent. Jamais un message
  de la vue 1.
- Sans cle d'API configuree, la vue 3 fonctionne sans resumes plutot que de
  tomber en panne.

Le contenu d'une newsletter est du texte non fiable, susceptible de contenir des
instructions destinees au modele. La reponse du modele ne declenche aucune action
Gmail : elle est affichee, pas executee.

## 3. Ce qui est livre

- Projet Tauri v2 + React 19 + TypeScript + Tailwind v4 qui compile et se lance.
- `error.rs` — erreurs typees, reduction avant IPC, 3 tests.
- `secrets.rs` — trait `SecretStore`, implementations trousseau et memoire, 5 tests.
- `rules/model.rs` — format `regles.json` conforme au cahier des charges,
  comparaison d'expediteurs, 11 tests.
- `rules/store.rs` — persistance atomique en `0600`, 7 tests.
- `commands/app_health` — tranche verticale React → IPC → Rust, touchant le
  trousseau, le disque et les chemins Tauri.
- `auth/`, `gmail/`, `llm/` — surfaces declarees : constantes, trait, et les
  contraintes d'implementation documentees. Aucune fausse implementation.
- CI (lint, types, tests des deux cotes, `cargo audit`) et workflow de release
  en matrice trois plateformes.

Total : 26 tests Rust, 5 tests TypeScript, clippy sans avertissement.

## 4. Decisions reportees

| Sujet | Quand trancher |
|---|---|
| Fournisseur LLM (Anthropic / OpenAI / Ollama) | Avant la vue 3. Le trait `LlmProvider` isole le choix. |
| CSP du rendu des corps d'e-mail | Avec la vue 1, en meme temps que l'iframe en bac a sable. |
| Signature et notarisation macOS | Avant toute distribution. Demande un compte Apple Developer. |
| Verification Google du scope restreint | Avant de depasser 100 utilisateurs. Audit de securite annuel par un tiers. |
| Politique de reessai sur quotas Gmail | Avec le client Gmail. Recul exponentiel sur 429 et 5xx uniquement. |
| Rattrapage d'un vendredi manque | Voir section 5. Demande de memoriser la date de derniere execution. |

## 5. Moteur de regles

Ecrit en TDD apres la mise en place, dans `rules/engine.rs`. 14 tests.

**Le moteur produit un plan, il ne l'execute pas.** `planifier` est une fonction
pure : jeu de regles + metadonnees de messages + horodatage → liste d'actions.
Aucun reseau, aucun effet de bord. L'execution Gmail sera une couche distincte.
Deux benefices : le moteur est integralement testable sans reseau, et l'interface
pourra montrer ce qui va se passer avant que ca se passe.

**L'horodatage est injecte**, pas lu depuis `Local::now()`. Les regles
recurrentes dependent du jour et de l'heure ; un moteur qui consulte l'horloge en
interne n'est pas testable.

**Un message ne recoit qu'une action**, meme si plusieurs regles le visent. La
priorite : suppression > resume+archivage > archivage simple. La suppression
l'emporte parce que l'utilisateur l'a demandee explicitement et qu'archiver un
message qu'on s'apprete a jeter serait un appel d'API pour rien. Le resume
l'emporte sur l'archivage simple parce qu'il archive aussi, en faisant davantage.
A priorite egale, la premiere regle du fichier gagne, pour que le plan ne depende
pas de l'ordre d'insertion.

**Les actions sans effet sont ecartees.** Chaque entree du plan devient un appel
d'API compte dans le quota Gmail : un archivage sur un message deja hors de la
boite, ou une suppression sur un message deja a la corbeille, ne sont pas
planifies.

### Limite connue : le vendredi manque

La fenetre de `tous_les_vendredis` a 18 h couvre le vendredi de 18 h a minuit —
ce qui couvre le « ou a la reouverture de l'application » du cahier des charges
tant que l'utilisateur ouvre MailFlow le vendredi soir.

Une semaine ou l'application reste fermee ce soir-la est simplement sautee.
Rattraper demanderait de memoriser la date de derniere execution de chaque regle,
ce qui n'est pas fait. C'est un choix a confirmer, pas un oubli.

## 6. Suite

Le client Gmail (`gmail/`) et l'authentification (`auth/`) sont les briques
suivantes. Elles debloquent l'execution du plan, puis les vues.
