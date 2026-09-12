Cahier des Charges Technique & Spécifications — MailFlow Desktop Client
1. Vision & Philosophie du Projet
MailFlow Desktop Client est un client email natif macOS/Desktop conçu pour automatiser le tri des e-mails, éliminer la surcharge cognitive liée aux newsletters et spams/promotions, et gérer intelligemment les rappels de formation. L'application s'adresse à un public grand public / non-informatique : toutes les interactions de configuration se font via des interfaces visuelles simples sans jamais manipuler du code.
Principes Clés :
Gmail comme Unique Source de Vérité : Aucune base de données externe (ni PostgreSQL, ni Firebase). Tout l'état des e-mails repose sur l'API Gmail (Labels, Trash, Archive/Inbox).
Persistance Locale Minimaliste : Seules les règles d'automatisation créées par l'utilisateur sont sauvegardées localement dans un fichier regles.json invisible pour l'utilisateur lambda.
Interface No-Code pour les Règles : Les règles sont gérées via un panneau visuel simple (boutons activé/désactivé, cartes par catégorie, suppression en un clic).
Traitement Automatique au Lancement : Dès que l'application s'ouvre (ou lors d'une synchronisation), elle lit regles.json et exécute immédiatement les actions sur les e-mails correspondants via l'API Gmail.
2. Architecture Technique Recommandée
Framework App Desktop : Electron.js ou Tauri (React / Tailwind CSS pour le UI).
Intégrations Backend/Services :
Gmail API (OAuth 2.0) : Récupération des messages, gestion des labels, suppression (TRASH), archivage (retrait du tag INBOX).
LLM API (OpenAI GPT-4o-mini / Anthropic Claude Haiku / Ollama Local) : Génération automatique des résumés de newsletters et extraction d'informations clés (dates, liens) pour les formations.
Fichier de Configuration Local : regles.json (stocké de façon transparente dans le dossier applicatif utilisateur).
3. Structure du Fichier regles.json (Sous le capot)
Le fichier regles.json gère toutes les automatisations de manière déterministe en arrière-plan.
{
  "version": "1.0",
  "last_updated": "2026-08-13T14:00:00Z",
  "automations": [
    {
      "id": "rule_01",
      "expediteur": "promo@offres-tech.fr",
      "nom_affichage": "Offres Tech Flash",
      "categorie": "publicite",
      "action": "supprimer_toujours",
      "active": true,
      "date_ajout": "2026-08-13"
    },
    {
      "id": "rule_02",
      "expediteur": "dan@tldr.tech",
      "nom_affichage": "TLDR AI Digest",
      "categorie": "newsletter",
      "action": "generer_resume_et_archiver",
      "active": true,
      "date_ajout": "2026-08-12"
    },
    {
      "id": "rule_03",
      "expediteur": "notification@openclassrooms.com",
      "nom_affichage": "OpenClassrooms",
      "categorie": "formation",
      "action": "archiver_automatique",
      "frequence": "tous_les_vendredis",
      "heure_execution": "18:00",
      "active": true,
      "date_ajout": "2026-08-13"
    }
  ]
}



4. Spécification Détaillée des 5 Vues (Interfaces)
Vue 1 : Mails Directs (Humains)
Objectif : Ne présenter que les e-mails émis par de vraies personnes.
Filtre API Gmail : Mails dans INBOX SANS en-tête List-Unsubscribe, excluant les catégories Promotions, Social, Updates et les expéditeurs enregistrés comme newsletters/pubs dans les règles.
Fonctionnalités : Split-view (liste à gauche, aperçu du message à droite), bouton Répondre, bouton Archiver.
Vue 2 : Triage & Publicités
Objectif : Traiter rapidement la masse promotionnelle et configurer des règles de nettoyage automatique.
Filtre API Gmail : Mails de la catégorie Promotions ou identifiés comme publicitaires.
Actions par ligne/mail :
Archiver : Retire le mail de l'Inbox.
Supprimer & Automatiser : Envoie le mail à la corbeille ET crée automatiquement une règle de suppression systématique pour cet expéditeur.
Action Globale : Bouton "Tout supprimer & Automatiser" pour nettoyer l'ensemble du tableau et enregistrer toutes les règles en un clic.
Vue 3 : Newsletters & Résumés IA
Objectif : Prendre connaissance du contenu des newsletters sans perdre de temps à les lire individuellement.
Composant 1 - Synthèse IA Globale (Filtre / Digest de la journée) :
Récupère le texte de toutes les newsletters reçues le jour même.
L'envoie au LLM avec un prompt : "Fais un résumé synthétique de ces newsletters en 3 points majeurs avec des hashtags thématiques (#IA, #Tech, etc.)".
Permet de filtrer la liste des cartes par hashtag.
Composant 2 - Cartes Individuelles :
Affiche le nom, l'expéditeur et le résumé IA du mail spécifique.
Bouton Garder & Archiver : Marque comme lu, conserve et archive le mail.
Bouton Supprimer : Envoie le mail à la corbeille.
Vue 4 : Rappels de Formations
Objectif : Regrouper les notifications de webinaires, cours en ligne, échéances et certifications.
Filtre API Gmail : Mails d'expéditeurs éducatifs (OpenClassrooms, Udemy, Coursera...) ou contenant des mots-clés d'apprentissage/webinaire.
Fonctionnalités :
Extraire la date/heure pour l'ajouter à l'agenda système (iCal/Apple Calendar).
Fonctionnalité spéciale d'archivage du Vendredi : Bouton "Règle : Archiver chaque Vendredi" sur chaque carte + bouton global "Tout automatiser (Archivage le Vendredi)".
Comportement : Enregistre une règle d'archivage hebdomadaire. Le vendredi à 18h00 (ou à la réouverture de l'application), tous ces e-mails sont automatiquement archivés.
Vue 5 : Gestionnaire des Règles (Interface Grand Public)
Objectif : Permettre au grand public d'afficher, d'activer/désactiver ou de supprimer facilement toutes les règles d'automatisation créées.
Fonctionnalités Visuelles :
Onglets/Filtres par Categorie : Filtrer entre Publicités, Newsletters, et Formations.
Cartes de Règles Intelligentes :
Affichage en français clair (ex: "Supprimer systématiquement les mails de promo@offres-tech.fr" ou "Archiver automatiquement les formations OpenClassrooms tous les vendredis à 18h").
Interrupteur On/Off (Toggle Switch) : Permet de désactiver temporairement une règle sans la supprimer.
Bouton Corbeille/Supprimer : Efface la règle de l'application en un clic avec confirmation.
Recherche rapide : Barre de recherche pour trouver une règle par nom ou adresse e-mail.
Mode Avancé (Optionnel) : Un bouton "Voir le fichier JSON" réservé aux utilisateurs techniques qui souhaitent exporter ou éditer le fichier brut.
5. Algorithme de Synchronisation au Démarrage
Lors du lancement de l'application :
Authentification Gmail via token OAuth2 enregistré.
Lecture transparente du fichier regles.json.
Interrogation de l'API Gmail (List Messages dans INBOX).
Pour chaque message reçu :
Si l'expéditeur correspond à une règle active "supprimer_toujours" : Appel API Gmail batchDelete ou suppression instantanée.
Si l'expéditeur correspond à une règle active "archiver_automatique" (ex: Vendredi) : Vérification du jour. Si la condition est remplie, retrait du tag INBOX.
Si le message est une newsletter : Génération du résumé IA via l'API LLM et affichage dans la Vue 3.
Sinon : Classement dans la Vue 1 (Mails Directs) ou Vue 2 (Pubs) selon l'analyse des métadonnées.
6. Prompt Prêt à l'Emploi pour Claude (Développement)
Instructions à copier-coller à Claude pour démarrer le code :
"Act en tant qu'Ingénieur Software Senior spécialisé en Node.js, Electron/Tauri, React et intégrations d'API.
Je souhaite construire une application desktop conviviale de gestion de boîte mail Gmail nommée MailFlow Client Desktop, destinée à un public grand public non-technique.
L'application doit utiliser l'API Gmail comme unique source de données et un fichier local caché regles.json pour la persistance des règles.
Voici les exigences de développement :
Crée la structure du projet (Electron + React + Tailwind CSS).
Configure la stratégie OAuth2 pour la connexion sécurisée à l'API Gmail.
Implémente le moteur de lecture et d'écriture du fichier local regles.json.
Développe les 5 vues utilisateurs selon le cahier des charges :
Vue Mails Directs (Humains) : Uniquement les vraies personnes.
Vue Triage & Pubs : Boutons 'Supprimer & Automatiser' créant des règles graphiques.
Vue Newsletters & IA : Synthèse globale du jour générée par LLM + cartes individuelles avec résumés.
Vue Formations & Rappels : Bouton d'automatisation pour archiver les e-mails de formation sélectionnés chaque vendredi.
Vue Gestionnaire de Règles (No-Code UI) : Interface graphique claire avec cartes de règles, filtres par catégorie, toggles Activer/Désactiver et boutons de suppression (avec option masquée pour voir le JSON brut).
Implémente l'algorithme de synchronisation automatique au démarrage qui applique les règles directement via l'API Gmail.
Commence par me proposer l'architecture des fichiers du projet et le code du module d'interaction avec l'API Gmail et la gestion graphique des règles."
