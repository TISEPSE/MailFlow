# MailFlow

Client email de bureau qui automatise le tri d'une boite Gmail : separation du
courrier humain, nettoyage des publicites, resumes de newsletters et rappels de
formations. Destine a un public non technique — aucune configuration ne passe
par du code.

Cibles : macOS et Linux.

## Etat du projet

Mise en place terminee, moteur de regles ecrit. Le backend expose sa surface
d'erreurs, le stockage des secrets, la persistance des regles, le calcul du plan
d'actions et une commande de diagnostic. Les cinq vues du cahier des charges,
l'authentification Google et le client Gmail restent a implementer.

Voir [`Cahier-des-Charges-MailFlow.md`](Cahier-des-Charges-MailFlow.md) pour la
specification fonctionnelle, et
[`docs/superpowers/specs/`](docs/superpowers/specs/) pour les decisions
d'architecture.

## Architecture

Le backend Rust detient tout ce qui est sensible : jetons OAuth, appels a l'API
Gmail, moteur de regles, acces disque. Le frontend React n'a acces qu'aux
commandes declarees dans `src-tauri/src/commands/`.

Cette separation est la raison du choix de Tauri sur ce projet. L'application
affiche du HTML d'e-mail, c'est-a-dire du contenu ecrit par des tiers inconnus.
Une injection dans le rendu ne doit pas suffire a lire la boite mail.

```
src/                  Frontend React + TypeScript + Tailwind
  lib/tauri.ts        Seul point d'appel du backend
  types/backend.ts    Miroir TypeScript des types Rust
  views/              Les cinq vues (a venir)

src-tauri/src/
  commands/           Surface exposee au webview
  error.rs            Erreurs, et leur reduction avant passage a l'IPC
  secrets.rs          Trousseau systeme (Keychain / Secret Service)
  rules/              Modele, persistance et moteur de planification
  auth/               OAuth2 PKCE Google (surface declaree)
  gmail/              Client API Gmail (surface declaree)
  llm/                Resumes de newsletters (surface declaree)
```

## Prerequis

- Node.js 24+
- Rust 1.88+
- Sur Linux :

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev \
    build-essential pkg-config
  ```

- Un agent de trousseau actif (GNOME Keyring, KWallet). Sans lui, MailFlow ne
  peut pas conserver la connexion Gmail ; l'ecran de diagnostic le signale.

## Developpement

```bash
npm install
cp .env.example .env     # renseigner MAILFLOW_GOOGLE_CLIENT_ID
npm run tauri:dev
```

## Verifications

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

Les binaires macOS ne sont pas signes a ce stade. Au premier lancement,
Gatekeeper les bloque et l'utilisateur doit passer par clic droit puis
« Ouvrir ». La signature demande un compte Apple Developer.
