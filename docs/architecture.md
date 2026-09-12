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
  vues/               Pages : courrier, newsletters, règles, archives, paramètres
  composants/         Briques partagées (liste de messages, rédaction, modales)
  demo/               Mode démo : fausse boîte pour les captures d'écran

src-tauri/src/
  commands/           Surface exposée au webview
  error.rs            Erreurs, et leur réduction avant passage à l'IPC
  secrets.rs          Trousseau système (Keychain / Secret Service)
  auth/               OAuth2 PKCE Google
  config.rs           Identifiant client Google
  comptes.rs          Comptes autorisés, et bascule de l'un à l'autre
  gmail/              Client API Gmail : relevé, classement, corps, envoi
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
