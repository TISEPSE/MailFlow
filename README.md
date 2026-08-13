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
et une commande de diagnostic. Les cinq vues du cahier des charges et le client
Gmail restent à implémenter.

Pour connecter votre compte, une étape se fait de votre côté, chez Google : voir
[`docs/connexion-google.md`](docs/connexion-google.md).

Voir [`Cahier-des-Charges-MailFlow.md`](Cahier-des-Charges-MailFlow.md) pour la
spécification fonctionnelle, et
[`docs/superpowers/specs/`](docs/superpowers/specs/) pour les décisions
d'architecture.

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
  gmail/              Client API Gmail (surface déclarée)
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
viennent du workflow `.github/workflows/release.yml`, qui compile sur des
runners `macos-14` (Apple Silicon) et `macos-13` (Intel).

Les binaires macOS ne sont pas signés à ce stade. Au premier lancement,
Gatekeeper les bloque et l'utilisateur doit passer par clic droit puis
« Ouvrir ». La signature demande un compte Apple Developer.
