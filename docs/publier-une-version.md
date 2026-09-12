# Publier une version

## Builds locaux

```bash
npm run tauri:build
```

Produit un AppImage et un `.deb` sur Linux, un `.app` et un `.dmg` sur macOS.
Tauri ne sait pas compiler vers macOS depuis Linux : les artefacts macOS
viennent de la chaîne de publication.

## La chaîne de publication

Les trois plateformes sont compilées par
[`.github/workflows/release.yml`](../.github/workflows/release.yml) : un `.dmg`
macOS universel, qui tourne aussi bien sur Intel que sur Apple Silicon, un
AppImage plus un `.deb` pour Linux x86\_64, et un installeur `.exe` pour
Windows x64. La publication reste un **brouillon** de release GitHub : rien
n'est visible tant qu'on ne l'a pas relu et publié à la main.

**Une fois pour toutes**, dans *Settings > Secrets and variables > Actions* du
dépôt :

| Secret | Rôle |
| --- | --- |
| `MAILFLOW_GOOGLE_CLIENT_ID` | Identifiant du client OAuth de bureau |
| `MAILFLOW_GOOGLE_CLIENT_SECRET` | Son secret, exigé par l'endpoint de jetons |

Ils sont figés dans le binaire à la compilation : une application installée n'a
pas de `.env` à côté d'elle, et l'utilisateur final n'a pas à créer un projet
Google Cloud pour lire son courrier. Ce ne sont pas des secrets au sens strict :
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
complète (lint, types, tests, clippy, audit des dépendances) tourne avant toute
compilation, car un tag ne déclenche pas les workflows attachés aux branches.

`workflow_dispatch` permet un build d'essai sans tag : il produit une
préversion en brouillon, sans contrôle de version.

## Le cas de macOS

Les binaires macOS ne sont pas signés à ce stade, et Gatekeeper les bloque au
premier lancement. Depuis macOS 15, le clic droit puis « Ouvrir » ne suffit plus :
Apple a retiré ce raccourci. Il faut lancer l'application une première fois,
la voir refusée, puis ouvrir  > Réglages Système > Confidentialité et sécurité
et cliquer sur **Ouvrir quand même** sous « Sécurité ». Une seule fois.

Pour un public non technique, ce détour est rédhibitoire : c'est exactement le
geste qu'on apprend aux gens à ne pas faire. La signature demande un compte
Apple Developer (99 $/an) ; les secrets se branchent alors dans le workflow sans
toucher au reste.

## Site public

Les pages exigées par Google pour la vérification OAuth vivent dans `site/` et
sont publiées par le workflow `pages.yml` : page d'accueil, politique de
confidentialité et conditions d'utilisation. Le déploiement échoue tant qu'une
mention à renseigner subsiste dans ces pages, plutôt que de publier une
politique de confidentialité trouée.

GitHub Pages exige un dépôt public sur un compte gratuit.
