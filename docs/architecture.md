# Architecture

Le backend Rust détient tout ce qui est sensible : jetons OAuth, appels à l'API
Gmail, moteur de règles, accès disque. Le frontend React n'a accès qu'aux
commandes déclarées dans `src-tauri/src/commands/`.

Cette séparation est la raison du choix de Tauri sur ce projet. L'application
affiche du HTML d'e-mail, c'est-à-dire du contenu écrit par des tiers inconnus.
Une injection dans le rendu ne doit pas suffire à lire la boîte mail.

## Arborescence

```
src/                  Frontend React + TypeScript + Tailwind
  lib/tauri.ts        Seul point d'appel du backend
  types/backend.ts    Miroir TypeScript des types Rust
  vues/               Pages : courrier, newsletters, règles, archives,
                      messages envoyés, paramètres
  composants/         Briques partagées (liste de messages, rédaction, modales)
  demo/               Mode démo : fausse boîte pour les captures d'écran

src-tauri/src/
  commands/           Surface exposée au webview
  error.rs            Erreurs, et leur réduction avant passage à l'IPC
  secrets.rs          Trousseau système (Keychain / Secret Service)
  auth/               OAuth2 PKCE Google
  config.rs           Identifiant client Google
  comptes.rs          Comptes autorisés, et bascule de l'un à l'autre
  gmail/              Client API Gmail : relevé, classement, corps, envoi,
                      réponses, brouillons
  rules/              Règles : modèle, persistance et moteur de planification
  llm/                Résumés de newsletters (Gemini)
  contacts/           Carnet d'adresses Google
  cadre.rs            Protocole du cadre isolé où s'affiche le corps des messages
  cache.rs            Relevés et corps gardés sur le disque
  archives.rs         Registre des messages archivés depuis MailFlow
  tableau.rs          Disposition de la table des archives

outils/
  captures.mjs        Refait les captures d'écran du README
  extraire-icones.py  Génère la liste des icônes Material utilisées
```

## Le corps des messages

Le HTML de l'expéditeur est désinfecté côté Rust, puis affiché dans une `iframe`
servie par un protocole à part, `mailflow-corps://`. Le cadre a sa propre
origine et sa propre politique de sécurité : aucun script de l'expéditeur ne s'y
exécute, et rien n'en sort. Le détail est dans `src-tauri/src/cadre.rs`.

## Les résumés par IA

Seules les newsletters partent vers le modèle de langage. Les mails écrits par
des personnes et les rappels de formation ne quittent jamais la machine : la
garantie est tenue dans l'interface et vérifiée de nouveau côté Rust.

## Le mode démo

`npm run demo` sert l'interface dans un navigateur, sans backend ni compte.
`src/demo/` répond à chaque commande Tauri avec des données inventées. Il n'est
chargé que sous `vite --mode demo` et n'entre pas dans le bundle livré.

Voir aussi [`specs/`](specs/) pour les décisions de conception, et le
[cahier des charges](cahier-des-charges.md) pour la spécification fonctionnelle.

## Les brouillons

Le message en cours d'écriture est déposé chez Gmail — `users.drafts`, qui relève
du scope `gmail.modify` déjà accordé, donc sans nouveau consentement. C'est là
qu'on le cherchera : il apparaît dans Gmail sur le web et sur le téléphone, et il
survit à la réinstallation.

La fenêtre de rédaction n'avait auparavant aucune mémoire, et un Échap de trop
suffisait à perdre une lettre. Trois choses s'y opposent désormais : un
enregistrement après quelques secondes sans frappe, une question posée avant
toute fermeture qui perdrait quelque chose, et le fait qu'Échap ne ferme plus
rien depuis une zone de texte — sur macOS, cette touche appartient à la
correction automatique du système.

Le délai d'enregistrement suit le poids des pièces jointes : l'API des brouillons
n'a pas de mise à jour partielle, chaque enregistrement renvoie donc le message
entier. Voir `lib/redaction.ts`.

## Répondre

Répondre et Répondre à tous ouvrent la fenêtre de rédaction, comme Transférer.
Ils passaient auparavant par un `mailto:`, donc par le client de courrier du
système : sur une machine où Gmail est le gestionnaire par défaut, écrire une
réponse faisait sortir de l'application. C'était un reste d'avant que MailFlow
sache envoyer, et la commande `repondre_au_message` a disparu avec son
constructeur d'URL.

La réponse se rattache à sa conversation. `message_corps` fait remonter le
`Message-Id`, le `References` et le `threadId` du message lu ; `composer` en tire
les en-têtes `In-Reply-To` et `References`, et l'envoi passe le `threadId` à
Gmail. Les deux vont ensemble : Google refuse un `threadId` que les en-têtes ne
désignent pas.

Deux réserves, inscrites dans le code à l'endroit où elles jouent. Les corps
rangés avant l'arrivée de ces champs n'ont pas de référence : `message_corps` les
redemande à Gmail plutôt que de les servir amputés. Et une réponse de plus d'un
mégaoctet part par l'endpoint de téléversement, qui n'accepte que du MIME brut,
sans champ où glisser le `threadId` : elle se rattache alors par ses seuls
en-têtes.

## Les fichiers sur le disque

Tout ce que MailFlow écrit lui-même (annuaire des comptes, registre des
archives, disposition de la table, carnet, cache) passe par
`cache::ecrire_prive` : un fichier voisin créé en `0600`, forcé sur le disque,
puis renommé à la place de l'ancien. Écrire en place vidait le fichier avant de
le remplir, et un arrêt entre les deux faisait disparaître la table des
archives ou la liste des comptes.

Les règles et le registre des archives se modifient par `RulesStore::modifier`
et `archives::modifier`, sous verrou. Archiver plusieurs messages d'affilée
lance des commandes en parallèle ; sans verrou, chacune relisait le fichier
avant que la précédente l'ait écrit, et une partie des archives se perdait.

## Les erreurs à l'écran

`AppError` est réduit à `{ code, message }` avant l'IPC, et le message est en
général une phrase fixe : un détail technique peut porter des fragments de
requête. `AppError::Refus` est l'exception : son texte est écrit par nous pour
l'écran (« Indiquez au moins un destinataire. ») et passe tel quel. N'y mettre
jamais un détail venu de Google ou du système.
