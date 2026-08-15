# MailFlow

Client email de bureau qui automatise le tri d'une boîte Gmail : séparation du
courrier humain, nettoyage des publicités, résumés de newsletters et rappels de
formations. Destiné à un public non technique — aucune configuration ne passe
par du code.

Cibles : macOS et Linux.

## État du projet

Mise en place terminée, moteur de règles écrit, authentification Google en
place. Le backend expose sa surface d'erreurs, le stockage des secrets, la
persistance des règles, le calcul du plan d'actions, le flux OAuth2 PKCE complet
et le client Gmail. Les cinq vues du cahier des charges et les résumés de
newsletters restent à implémenter.

Pour connecter votre compte, une étape se fait de votre côté, chez Google : voir
[`docs/connexion-google.md`](docs/connexion-google.md).

Voir [`Cahier-des-Charges-MailFlow.md`](Cahier-des-Charges-MailFlow.md) pour la
spécification fonctionnelle, et
[`docs/specs/`](docs/specs/) pour les décisions d'architecture.

## Architecture

Le backend Rust détient tout ce qui est sensible : jetons OAuth, appels à l'API
Gmail, moteur de règles, accès disque. Le frontend React n'a accès qu'aux
commandes déclarées dans `src-tauri/src/commands/`.

Cette séparation est la raison du choix de Tauri sur ce projet. L'application
affiche du HTML d'e-mail, c'est-à-dire du contenu écrit par des tiers inconnus.
Une injection dans le rendu ne doit pas suffire à lire la boîte mail.

```
src/                  Frontend React + TypeScript + Tailwind
  lib/tauri.ts        Seul point d'appel du backend
  types/backend.ts    Miroir TypeScript des types Rust
  views/              Les cinq vues (à venir)

src-tauri/src/
  commands/           Surface exposée au webview
  error.rs            Erreurs, et leur réduction avant passage à l'IPC
  secrets.rs          Trousseau système (Keychain / Secret Service)
  rules/              Modèle, persistance et moteur de planification
  auth/               OAuth2 PKCE Google
  config.rs           Identifiant client Google
  gmail/              Client API Gmail
  llm/                Résumés de newsletters (surface déclarée)
```

## Prérequis

- Node.js 24+
- Rust 1.88+
- Sur Linux :

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev \
    build-essential pkg-config
  ```

- Un agent de trousseau actif (GNOME Keyring, KWallet). Sans lui, MailFlow ne
  peut pas conserver la connexion Gmail ; l'écran de diagnostic le signale.

## Développement

```bash
npm install
cp .env.example .env     # renseigner MAILFLOW_GOOGLE_CLIENT_ID
npm run tauri:dev
```

## Vérifications

```bash
npm run lint             # oxlint
npm test                 # vitest
npm run build            # types + bundle frontend

cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Builds

```bash
npm run tauri:build
```

Produit un AppImage et un `.deb` sur Linux, un `.app` et un `.dmg` sur macOS.
Tauri ne sait pas compiler vers macOS depuis Linux : les artefacts macOS
viennent de la chaîne de publication.

## Publier une version

Les deux plateformes sont compilées par
[`.github/workflows/release.yml`](.github/workflows/release.yml) : un `.dmg`
macOS universel, qui tourne aussi bien sur Intel que sur Apple Silicon, et un
AppImage plus un `.deb` pour Linux x86\_64. La publication reste un **brouillon**
de release GitHub : rien n'est visible tant qu'on ne l'a pas relu et publié à la
main.

**Une fois pour toutes**, dans *Settings > Secrets and variables > Actions* du
dépôt :

| Secret | Rôle |
| --- | --- |
| `MAILFLOW_GOOGLE_CLIENT_ID` | Identifiant du client OAuth de bureau |
| `MAILFLOW_GOOGLE_CLIENT_SECRET` | Son secret, exigé par l'endpoint de jetons |

Ils sont figés dans le binaire à la compilation : une application installée n'a
pas de `.env` à côté d'elle, et l'utilisateur final n'a pas à créer un projet
Google Cloud pour lire son courrier. Ce ne sont pas des secrets au sens strict —
Google admet qu'une application de bureau ne peut rien cacher dans un binaire
distribué, et la sécurité du flux repose sur PKCE. Sans eux la compilation
réussit quand même, mais la version publiée ne pourra pas se connecter : le
workflow le signale par un avertissement.

**À chaque version**, le même numéro dans les trois fichiers qui le portent,
puis le tag :

```bash
# package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
git commit -am "chore: version 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Un travail dédié refuse le tag si l'un des trois fichiers ne suit pas : un
installeur dont le nom ment sur son contenu se remarque trop tard. La CI
complète — lint, types, tests, clippy, audit des dépendances — tourne avant
toute compilation, car un tag ne déclenche pas les workflows attachés aux
branches.

`workflow_dispatch` permet un build d'essai sans tag : il produit une
préversion en brouillon, sans contrôle de version.

### Le cas de macOS

Les binaires macOS ne sont pas signés à ce stade, et Gatekeeper les bloque au
premier lancement. Depuis macOS 15, le clic droit puis « Ouvrir » ne suffit plus
— Apple a retiré ce raccourci. Il faut lancer l'application une première fois,
la voir refusée, puis ouvrir  > Réglages Système > Confidentialité et sécurité
et cliquer sur **Ouvrir quand même** sous « Sécurité ». Une seule fois.

Pour un public non technique, ce détour est rédhibitoire : c'est exactement le
geste qu'on apprend aux gens à ne pas faire. La signature demande un compte
Apple Developer (99 $/an) ; les secrets se branchent alors dans le workflow sans
toucher au reste.
