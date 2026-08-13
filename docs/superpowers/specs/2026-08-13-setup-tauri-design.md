# Mise en place de MailFlow — Tauri, backend Rust, securite

Date : 2026-08-13
Portee : socle technique, moteur de regles, authentification Google. Ni les cinq
vues ni le client Gmail ne sont implementes ici.

Ce document grandit avec le projet : les sections 5 et 6 ont ete ajoutees apres
la mise en place initiale.

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
- `rules/engine.rs` — planification des actions Gmail, 14 tests (section 5).
- `auth/` — flux OAuth2 PKCE complet : serveur loopback, echange et
  renouvellement de jetons, session adossee au trousseau, 58 tests (section 6).
- `config.rs` — resolution de l'identifiant client Google, 7 tests.
- `commands/` — `app_health`, `google_connecter`, `google_deconnecter`.
  `app_health` sert de tranche verticale React → IPC → Rust, touchant le
  trousseau, le disque et les chemins Tauri.
- `gmail/`, `llm/` — surfaces declarees : constantes, trait, et les contraintes
  d'implementation documentees. Aucune fausse implementation.
- CI (lint, types, tests des deux cotes, `cargo audit`) et workflow de release
  en matrice trois plateformes.

Total apres les briques 5 et 6 : 106 tests Rust, 5 tests TypeScript,
clippy sans avertissement.

## 4. Decisions reportees

| Sujet | Quand trancher |
|---|---|
| Fournisseur LLM (Anthropic / OpenAI / Ollama) | Avant la vue 3. Le trait `LlmProvider` isole le choix. |
| CSP du rendu des corps d'e-mail | Avec la vue 1, en meme temps que l'iframe en bac a sable. |
| Signature et notarisation macOS | Avant toute distribution. Demande un compte Apple Developer. |
| Verification Google du scope restreint | Avant de depasser 100 utilisateurs. Audit de securite annuel par un tiers. |
| Politique de reessai sur quotas Gmail | Avec le client Gmail. Recul exponentiel sur 429 et 5xx uniquement. |
| Rattrapage d'un vendredi manque | Voir section 5. Demande de memoriser la date de derniere execution. |
| Affichage de l'adresse du compte connecte | Avec la vue de connexion. Le scope `userinfo.email` est deja demande. |

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

## 6. Authentification Google

Ecrite en TDD dans `auth/`, decoupee en cinq fichiers : 58 tests, plus 7 pour
`config.rs` et 1 pour la nouvelle variante d'erreur.

Le decoupage suit une ligne : ce qui est testable sans reseau est separe de ce qui
ne l'est pas, et la seconde categorie est reduite au minimum. `flux.rs` construit
les requetes et interprete les reponses — teste ; il ne reste comme code non
couvert que l'appel HTTP lui-meme.

### Le serveur loopback

`serveur.rs` ouvre un port sur `127.0.0.1`, attribue par l'OS. **L'ordre compte** :
le serveur est ouvert avant la construction de l'URL d'autorisation, parce que
l'URI de redirection annoncee a Google doit contenir le port reellement ecoute.
Construire l'URL d'abord obligerait a fixer un port a l'avance — donc un port
qu'un autre programme peut deja occuper.

Ce port est joignable par tout processus de la session pendant que la fenetre est
ouverte. C'est inherent au flux loopback, et ce qui protege est ailleurs :

- le `state` est imprevisible et compare **a temps constant** ; un `==` classique
  s'arrete au premier octet different, ce qui laisse reconstituer la valeur
  attendue par la mesure ;
- la fenetre est de cinq minutes, pas d'une session entiere ;
- la ligne de requete est plafonnee a 8 Kio et sa lecture a cinq secondes : une
  connexion muette ou bavarde ne bloque ni ne gonfle rien.

Une requete qui n'est pas la redirection attendue — le navigateur reclame
volontiers `/favicon.ico` — recoit un 404 et ne compte pas. Un test le verifie.

### Ce qui n'est jamais imprimable

`ReponseJeton`, `Jetons` et `DemandeAutorisation` ont un `Debug` ecrit a la main.
Le `Debug` derive imprimerait `access_token`, `refresh_token` et `code_verifier`
en clair, et ce sont exactement les structures qu'on est tente de journaliser au
moment ou un echange echoue. Quatre tests verrouillent la propriete.

Meme logique sur les erreurs : `AppError::Auth` porte le detail de protocole cote
Rust et ne serialise qu'un message neutre. Le corps d'erreur de Google contient un
`error_description` bavard, parfois porteur d'un identifiant de compte ; seul le
code court (`invalid_grant`) est retenu, et il reste dans les logs.

### Renouvellement : distinguer « revoque » de « hors ligne »

`session.rs` renouvelle a la demande, jamais en tache de fond. Un timer qui
rafraichit en permanence garde un jeton chaud sans raison.

La distinction critique est la reaction a un echec de renouvellement :

- **Google a repondu et refuse** (`AppError::Auth`) — le `refresh_token` est mort,
  l'utilisateur a revoque l'acces ou change son mot de passe. Il est efface. Le
  garder ferait croire l'application connectee a chaque lancement sans jamais
  aboutir.
- **Google n'a pas repondu** (`AppError::Reseau`) — l'utilisateur est hors ligne,
  pas deconnecte. Le jeton est conserve : l'effacer obligerait a refaire tout le
  parcours Google au retour du reseau.

Deux tests couvrent ce couple, et deux autres le fait que Google peut faire
tourner le `refresh_token` (il faut alors reecrire le trousseau) et qu'une
premiere autorisation sans `refresh_token` est une erreur immediate — c'est ce
qu'on obtient si `access_type=offline` manque a l'URL, et l'echec surviendrait
sinon une heure plus tard, sans explication.

### Ce que le frontend peut declencher

Deux commandes, `google_connecter` et `google_deconnecter`. Aucune ne rend de
jeton : le frontend apprend l'issue en relisant `app_health`. Le verrou de session
est tenu pendant tout le parcours, pour que deux connexions simultanees
n'ecrasent pas mutuellement leur `refresh_token`.

`google_deconnecter` revoque cote Google en plus d'effacer le trousseau. Le
trousseau est vide d'abord : si la revocation echoue faute de reseau,
l'utilisateur est quand meme deconnecte localement.

### L'identifiant client n'est pas un secret

`config.rs` le lit dans l'ordre : variable d'environnement, valeur figee a la
compilation, puis fichier `.env`. Il ne va **pas** dans le trousseau : Google le
publie de fait dans l'URL d'autorisation, et le traiter comme un secret rendrait
la mise en place inutilement penible sans rien proteger.

Absent, l'application se lance quand meme et le dit (`clientGoogleConfigure`
faux). La vue de connexion pourra renvoyer vers `docs/connexion-google.md` plutot
que d'afficher un bouton qui ne peut pas aboutir.

## 7. Suite

Le client Gmail (`gmail/`) est la brique suivante : appels a l'API, execution du
plan produit par le moteur de regles, politique de reessai sur les quotas. Elle
debloque les vues.
