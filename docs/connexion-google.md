# Autoriser MailFlow à accéder à votre Gmail

Il y a une étape que le code ne peut pas faire tout seul : déclarer MailFlow
auprès de Google. Google doit savoir qu'une application nommée MailFlow existe
avant de la laisser toucher à une boîte mail.

Cette page décrit cette déclaration, pas à pas. Comptez une quinzaine de minutes,
une seule fois. Elle est gratuite et ne demande pas de carte bancaire.

## Ce que vous obtenez au bout

Une chaîne de caractères appelée **identifiant client**, qui ressemble à :

```
123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

Vous la collerez dans un fichier du projet. C'est tout ce qu'on attend de vous.

Ce n'est pas un mot de passe et ce n'est pas secret : Google sait qu'une
application installée sur un ordinateur ne peut rien cacher. La sécurité repose
sur autre chose, géré entièrement par le code.

## Avant de commencer

Les noms des écrans changent régulièrement chez Google. Si un libellé ne
correspond pas exactement à ce qui est écrit ici, cherchez celui qui a le même
sens : l'ordre des étapes, lui, ne bouge pas.

## 1. Créer un projet

Allez sur <https://console.cloud.google.com>, connectez-vous avec le compte
Google dont vous voulez trier la boîte mail.

En haut de la page, un menu déroulant affiche le projet courant. Ouvrez-le, puis
**Nouveau projet**. Nommez-le `MailFlow` et validez.

Attendez que le projet soit créé, puis vérifiez qu'il est bien sélectionné dans
ce menu du haut. Toute la suite se passe à l'intérieur.

## 2. Activer l'API Gmail

Un projet neuf n'a accès à rien. Il faut ouvrir l'accès à Gmail explicitement.

Dans le menu de gauche : **APIs et services** > **Bibliothèque**. Cherchez
`Gmail API`, ouvrez le résultat, cliquez **Activer**.

## 3. Décrire l'application

Google demande qui vous êtes et ce que fait l'application, pour l'afficher à
l'écran de connexion.

Dans le menu de gauche, cherchez **Écran de consentement OAuth** (parfois rangé
sous « Google Auth Platform » ou « Branding »).

- Type d'utilisateur : **Externe**. C'est le seul choix possible avec un compte
  Google ordinaire ; « Interne » est réservé aux comptes d'entreprise.
- Nom de l'application : `MailFlow`
- Adresse e-mail d'assistance : la vôtre
- Coordonnées du développeur : la vôtre à nouveau

Le reste peut rester vide.

## 4. Déclarer ce que MailFlow a le droit de faire

Toujours dans l'écran de consentement, cherchez la section **Portées**
(ou « Scopes »). Ajoutez celle-ci :

```
https://www.googleapis.com/auth/gmail.modify
```

Elle autorise MailFlow à lire vos messages, à les archiver et à les mettre à la
corbeille. Elle **n'autorise pas** l'envoi de courrier en votre nom : c'est
volontaire.

## 5. Vous ajouter comme testeur

Tant que l'application n'est pas vérifiée par Google, seules les adresses que
vous inscrivez ici peuvent s'en servir. C'est une limite de Google, pas du code.

Cherchez la section **Utilisateurs test** et ajoutez votre propre adresse Gmail.

Vous pouvez en inscrire jusqu'à 100. Au-delà, Google exige une procédure de
vérification annuelle avec un audit de sécurité payé. Ça n'a d'intérêt que si
vous voulez distribuer MailFlow à des inconnus.

## 6. Créer l'identifiant client

C'est l'étape qui produit la chaîne dont on a besoin.

Menu de gauche : **APIs et services** > **Identifiants**. Puis
**Créer des identifiants** > **ID client OAuth**.

- Type d'application : **Application de bureau**

  Ce choix compte. Il indique à Google que MailFlow tourne sur l'ordinateur de
  l'utilisateur, et non sur un serveur — le mécanisme de sécurité employé n'est
  pas le même.

- Nom : `MailFlow Desktop`

Validez. Google affiche alors l'identifiant client. **Copiez-le.**

Si vous fermez la fenêtre trop vite, ce n'est pas grave : l'identifiant reste
consultable dans la liste des identifiants.

## 7. Le donner à MailFlow

Dans le dossier du projet, un fichier `.env.example` sert de modèle. Faites-en
une copie nommée `.env` :

```bash
cp .env.example .env
```

Ouvrez `.env` et collez votre identifiant après le signe égal :

```
MAILFLOW_GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

Enregistrez. C'est fini.

Le fichier `.env` n'est pas envoyé sur GitHub : il est explicitement exclu, pour
que votre configuration reste sur votre machine.

## Ce qui se passera au premier lancement

Vous cliquerez sur « Connecter mon compte Gmail ». Votre navigateur habituel
s'ouvrira sur la vraie page de connexion Google — pas une imitation affichée dans
l'application. Vous verrez l'adresse `accounts.google.com` dans la barre
d'adresse, et votre gestionnaire de mots de passe fonctionnera normalement.

Google affichera un avertissement du type « Cette application n'est pas
vérifiée ». C'est attendu : c'est vous qui venez de la créer, et elle n'a pas
suivi la procédure de vérification. Passez par **Paramètres avancés** puis
**Continuer**.

Après votre accord, le navigateur reviendra vers MailFlow. L'autorisation est
conservée dans le trousseau de mots de passe de votre système — Keychain sur
macOS, le trousseau de votre session sur Linux. Vous n'aurez pas à recommencer à
chaque lancement.

## Revenir en arrière

Pour couper l'accès à tout moment, rendez-vous sur
<https://myaccount.google.com/permissions>, trouvez MailFlow, et retirez
l'accès. L'application ne pourra plus rien lire ni modifier.
