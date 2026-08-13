# Autoriser MailFlow a acceder a votre Gmail

Il y a une etape que le code ne peut pas faire tout seul : declarer MailFlow
aupres de Google. Google doit savoir qu'une application nommee MailFlow existe
avant de la laisser toucher a une boite mail.

Cette page decrit cette declaration, pas a pas. Comptez une quinzaine de minutes,
une seule fois. Elle est gratuite et ne demande pas de carte bancaire.

## Ce que vous obtenez au bout

Une chaine de caracteres appelee **identifiant client**, qui ressemble a :

```
123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

Vous la collerez dans un fichier du projet. C'est tout ce qu'on attend de vous.

Ce n'est pas un mot de passe et ce n'est pas secret : Google sait qu'une
application installee sur un ordinateur ne peut rien cacher. La securite repose
sur autre chose, gere entierement par le code.

## Avant de commencer

Les noms des ecrans changent regulierement chez Google. Si un libelle ne
correspond pas exactement a ce qui est ecrit ici, cherchez celui qui a le meme
sens : l'ordre des etapes, lui, ne bouge pas.

## 1. Creer un projet

Allez sur <https://console.cloud.google.com>, connectez-vous avec le compte
Google dont vous voulez trier la boite mail.

En haut de la page, un menu deroulant affiche le projet courant. Ouvrez-le, puis
**Nouveau projet**. Nommez-le `MailFlow` et validez.

Attendez que le projet soit cree, puis verifiez qu'il est bien selectionne dans
ce menu du haut. Toute la suite se passe a l'interieur.

## 2. Activer l'API Gmail

Un projet neuf n'a acces a rien. Il faut ouvrir l'acces a Gmail explicitement.

Dans le menu de gauche : **APIs et services** > **Bibliotheque**. Cherchez
`Gmail API`, ouvrez le resultat, cliquez **Activer**.

## 3. Decrire l'application

Google demande qui vous etes et ce que fait l'application, pour l'afficher a
l'ecran de connexion.

Dans le menu de gauche, cherchez **Ecran de consentement OAuth** (parfois range
sous « Google Auth Platform » ou « Branding »).

- Type d'utilisateur : **Externe**. C'est le seul choix possible avec un compte
  Google ordinaire ; « Interne » est reserve aux comptes d'entreprise.
- Nom de l'application : `MailFlow`
- Adresse e-mail d'assistance : la votre
- Coordonnees du developpeur : la votre a nouveau

Le reste peut rester vide.

## 4. Declarer ce que MailFlow a le droit de faire

Toujours dans l'ecran de consentement, cherchez la section **Portees**
(ou « Scopes »). Ajoutez celle-ci :

```
https://www.googleapis.com/auth/gmail.modify
```

Elle autorise MailFlow a lire vos messages, a les archiver et a les mettre a la
corbeille. Elle **n'autorise pas** l'envoi de courrier en votre nom : c'est
volontaire.

## 5. Vous ajouter comme testeur

Tant que l'application n'est pas verifiee par Google, seules les adresses que
vous inscrivez ici peuvent s'en servir. C'est une limite de Google, pas du code.

Cherchez la section **Utilisateurs test** et ajoutez votre propre adresse Gmail.

Vous pouvez en inscrire jusqu'a 100. Au-dela, Google exige une procedure de
verification annuelle avec un audit de securite paye. Ca n'a d'interet que si
vous voulez distribuer MailFlow a des inconnus.

## 6. Creer l'identifiant client

C'est l'etape qui produit la chaine dont on a besoin.

Menu de gauche : **APIs et services** > **Identifiants**. Puis
**Creer des identifiants** > **ID client OAuth**.

- Type d'application : **Application de bureau**

  Ce choix compte. Il indique a Google que MailFlow tourne sur l'ordinateur de
  l'utilisateur, et non sur un serveur — le mecanisme de securite employe n'est
  pas le meme.

- Nom : `MailFlow Desktop`

Validez. Google affiche alors l'identifiant client. **Copiez-le.**

Si vous fermez la fenetre trop vite, ce n'est pas grave : l'identifiant reste
consultable dans la liste des identifiants.

## 7. Le donner a MailFlow

Dans le dossier du projet, un fichier `.env.example` sert de modele. Faites-en
une copie nommee `.env` :

```bash
cp .env.example .env
```

Ouvrez `.env` et collez votre identifiant apres le signe egal :

```
MAILFLOW_GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

Enregistrez. C'est fini.

Le fichier `.env` n'est pas envoye sur GitHub : il est explicitement exclu, pour
que votre configuration reste sur votre machine.

## Ce qui se passera au premier lancement

Vous cliquerez sur « Connecter mon compte Gmail ». Votre navigateur habituel
s'ouvrira sur la vraie page de connexion Google — pas une imitation affichee dans
l'application. Vous verrez l'adresse `accounts.google.com` dans la barre
d'adresse, et votre gestionnaire de mots de passe fonctionnera normalement.

Google affichera un avertissement du type « Cette application n'est pas
verifiee ». C'est attendu : c'est vous qui venez de la creer, et elle n'a pas
suivi la procedure de verification. Passez par **Parametres avances** puis
**Continuer**.

Apres votre accord, le navigateur reviendra vers MailFlow. L'autorisation est
conservee dans le trousseau de mots de passe de votre systeme — Keychain sur
macOS, le trousseau de votre session sur Linux. Vous n'aurez pas a recommencer a
chaque lancement.

## Revenir en arriere

Pour couper l'acces a tout moment, rendez-vous sur
<https://myaccount.google.com/permissions>, trouvez MailFlow, et retirez
l'acces. L'application ne pourra plus rien lire ni modifier.
