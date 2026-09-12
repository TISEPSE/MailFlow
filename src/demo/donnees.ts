/**
 * Données fictives du mode démo.
 *
 * Personnes, entreprises et adresses sont inventées. Les dates se calculent
 * depuis l'ouverture de la page : la boîte paraît fraîche quel que soit le jour
 * où l'on refait les captures.
 */

import type {
  CompteConnu,
  Connaissance,
  CorpsMessage,
  JeuDeRegles,
  LibelleGmail,
  MessageAffiche,
  PieceJointe,
  ProfilCompte,
  Resume,
  ResultatSynthese,
} from '../types/backend'

export const COMPTE = 'lea.fontaine@exemple.fr'
const MOI = { nom: 'Léa Fontaine', adresse: COMPTE }

const HEURE = 60
const JOUR = 24 * HEURE

/** Instant situé `minutes` avant l'ouverture, au format RFC 3339. */
function ilYA(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

interface Esquisse {
  id: string
  nom: string
  adresse: string
  sujet: string
  extrait: string
  categorie: MessageAffiche['categorie']
  /** Âge du message, en minutes. */
  age: number
  nonLu?: boolean
  libelles?: string[]
}

function message(e: Esquisse): MessageAffiche {
  return {
    id: e.id,
    nom: e.nom,
    adresse: e.adresse,
    destinataires: [MOI],
    copies: [],
    sujet: e.sujet,
    extrait: e.extrait,
    date: ilYA(e.age),
    nonLu: e.nonLu ?? false,
    categorie: e.categorie,
    compte: COMPTE,
    libelles: e.libelles ?? [],
  }
}

const ESQUISSES_BOITE: Esquisse[] = [
  // Mails directs
  {
    id: 'h1',
    nom: 'Camille Laurent',
    adresse: 'camille.laurent@atelier-lumen.fr',
    sujet: 'Nouvelles maquettes du site',
    extrait:
      "Salut Léa, je t'envoie les trois pistes pour la page d'accueil. La deuxième me plaît beaucoup, dis-moi ce que tu en penses.",
    categorie: 'humain',
    age: 25,
    nonLu: true,
  },
  {
    id: 'h2',
    nom: 'Julien Morel',
    adresse: 'julien.morel@exemple.fr',
    sujet: 'Dîner samedi ?',
    extrait:
      "On pensait se retrouver chez nous vers 20 h. Tu peux venir avec Hugo, il y aura de la place pour tout le monde.",
    categorie: 'humain',
    age: 1 * HEURE + 40,
    nonLu: true,
  },
  {
    id: 'h3',
    nom: 'Sophie Bernard',
    adresse: 's.bernard@cabinet-bernard.fr',
    sujet: 'Votre dossier est complet',
    extrait:
      "Bonjour Madame Fontaine, nous avons bien reçu l'ensemble des pièces. Vous trouverez le récapitulatif en pièce jointe.",
    categorie: 'humain',
    age: 3 * HEURE,
  },
  {
    id: 'h4',
    nom: 'Thomas Petit',
    adresse: 'thomas.petit@exemple.fr',
    sujet: 'Re: Local à vélos',
    extrait:
      "Le syndic est d'accord pour installer des arceaux supplémentaires. Il faudra juste voter la dépense à la prochaine assemblée.",
    categorie: 'humain',
    age: 1 * JOUR + 2 * HEURE,
  },
  {
    id: 'h5',
    nom: 'Inès Garcia',
    adresse: 'ines.garcia@exemple.fr',
    sujet: 'Photos du week-end à Annecy',
    extrait: 'Voilà les photos du lac ! Celle du ponton au lever du soleil est ma préférée.',
    categorie: 'humain',
    age: 1 * JOUR + 6 * HEURE,
  },
  {
    id: 'h6',
    nom: 'Marc Lefèvre',
    adresse: 'marc.lefevre@atelier-lumen.fr',
    sujet: 'Point projet jeudi 10 h',
    extrait:
      "Je propose qu'on fasse le point sur le calendrier de livraison jeudi à 10 h. Je réserve la petite salle.",
    categorie: 'humain',
    age: 2 * JOUR,
  },

  // Triage & publicités
  {
    id: 'p1',
    nom: 'Maison Verdure',
    adresse: 'offres@maisonverdure.fr',
    sujet: "-30 % sur toutes les plantes d'intérieur",
    extrait: 'Offre valable jusqu’à dimanche minuit, livraison offerte dès 49 €.',
    categorie: 'publicite',
    age: 50,
    nonLu: true,
  },
  {
    id: 'p2',
    nom: 'Rando Store',
    adresse: 'newsletter@randostore.fr',
    sujet: 'Les nouveautés automne sont arrivées',
    extrait: 'Vestes imperméables, chaussures de trail et sacs légers : découvrez la collection.',
    categorie: 'publicite',
    age: 4 * HEURE,
    nonLu: true,
  },
  {
    id: 'p3',
    nom: 'Café Mistral',
    adresse: 'bonjour@cafemistral.fr',
    sujet: 'Votre code de bienvenue : MISTRAL10',
    extrait: '10 % sur votre première commande de grains torréfiés cette semaine.',
    categorie: 'publicite',
    age: 9 * HEURE,
  },
  {
    id: 'p4',
    nom: 'Librairie des Quais',
    adresse: 'lettre@librairiedesquais.fr',
    sujet: 'Rentrée littéraire : nos coups de cœur',
    extrait: 'Douze romans choisis par l’équipe, à retirer en boutique ou livrés chez vous.',
    categorie: 'publicite',
    age: 1 * JOUR + 3 * HEURE,
  },
  {
    id: 'p5',
    nom: 'VéloCité',
    adresse: 'contact@velocite-atelier.fr',
    sujet: 'Dernier jour : révision offerte',
    extrait: 'Pour tout achat d’accessoire, la révision complète de votre vélo est offerte.',
    categorie: 'publicite',
    age: 2 * JOUR + 5 * HEURE,
  },

  // Newsletters
  {
    id: 'n1',
    nom: 'La Matinale Tech',
    adresse: 'matinale@lamatinaletech.fr',
    sujet: 'La Matinale Tech n°212 : les puces IA arrivent dans les portables',
    extrait: 'Ce matin : processeurs, autonomie et la fin annoncée des chargeurs propriétaires.',
    categorie: 'newsletter',
    age: 2 * HEURE,
    nonLu: true,
  },
  {
    id: 'n2',
    nom: 'Le Petit Économiste',
    adresse: 'lettre@petit-economiste.fr',
    sujet: 'Pourquoi les taux baissent enfin',
    extrait: 'La banque centrale a tranché. Ce que cela change pour votre crédit.',
    categorie: 'newsletter',
    age: 5 * HEURE,
    nonLu: true,
  },
  {
    id: 'n3',
    nom: 'Cuisine de saison',
    adresse: 'bonjour@cuisinedesaison.fr',
    sujet: '5 recettes avec les premières courges',
    extrait: 'Velouté, gratin, risotto : la courge butternut dans tous ses états.',
    categorie: 'newsletter',
    age: 1 * JOUR,
  },
  {
    id: 'n4',
    nom: 'Veille Design',
    adresse: 'hello@veilledesign.fr',
    sujet: 'Édition du 11 septembre : les polices variables',
    extrait: 'Un seul fichier pour toutes les graisses : la presse en ligne s’y met.',
    categorie: 'newsletter',
    age: 1 * JOUR + 4 * HEURE,
  },
  {
    id: 'n5',
    nom: 'La Matinale Tech',
    adresse: 'matinale@lamatinaletech.fr',
    sujet: 'La Matinale Tech n°211 : la bataille des navigateurs',
    extrait: 'Hier : nouveaux moteurs de rendu et extensions sous surveillance.',
    categorie: 'newsletter',
    age: 1 * JOUR + 2 * HEURE,
  },
  {
    id: 'n6',
    nom: 'Veille Design',
    adresse: 'hello@veilledesign.fr',
    sujet: 'Édition du 4 septembre : les couleurs OKLCH',
    extrait: 'Des palettes enfin cohérentes entre thème clair et thème sombre.',
    categorie: 'newsletter',
    age: 8 * JOUR,
  },

  // Rappels de formations
  {
    id: 'f1',
    nom: 'Académie Pixel',
    adresse: 'webinaires@academiepixel.fr',
    sujet: 'Rappel : webinaire « Figma avancé » demain à 18 h',
    extrait: 'Votre lien de connexion est prêt. Pensez à installer la dernière version.',
    categorie: 'formation',
    age: 3 * HEURE,
    nonLu: true,
  },
  {
    id: 'f2',
    nom: 'CoursLibres',
    adresse: 'notifications@courslibres.fr',
    sujet: 'Plus que 2 leçons pour terminer « Python pour débutants »',
    extrait: 'Vous avez validé 18 leçons sur 20. Le certificat vous attend.',
    categorie: 'formation',
    age: 1 * JOUR + 1 * HEURE,
  },
  {
    id: 'f3',
    nom: "Certif'Pro",
    adresse: 'examens@certifpro.fr',
    sujet: "Votre session d'examen est confirmée",
    extrait: 'Rendez-vous le 24 septembre à 9 h, en ligne. Une pièce d’identité sera demandée.',
    categorie: 'formation',
    age: 3 * JOUR,
  },
  {
    id: 'f4',
    nom: 'Université Ouverte',
    adresse: 'cours@universite-ouverte.fr',
    sujet: 'Nouveau module disponible : statistiques appliquées',
    extrait: 'Six séances filmées et des exercices corrigés, à suivre à votre rythme.',
    categorie: 'formation',
    age: 4 * JOUR,
  },
]

export const BOITE: MessageAffiche[] = ESQUISSES_BOITE.map(message)

export const LIBELLES: LibelleGmail[] = [
  { id: 'Label_factures', nom: 'Factures' },
  { id: 'Label_voyage', nom: 'Voyage Annecy' },
]

const ESQUISSES_ARCHIVES: Esquisse[] = [
  {
    id: 'a1',
    nom: 'Énergie Claire',
    adresse: 'factures@energieclaire.fr',
    sujet: 'Votre facture de septembre',
    extrait: 'Montant : 64,20 €, prélevé le 15 septembre.',
    categorie: 'humain',
    age: 3 * JOUR,
    libelles: ['Label_factures'],
  },
  {
    id: 'a2',
    nom: 'Nuage Mobile',
    adresse: 'facturation@nuagemobile.fr',
    sujet: 'Facture du mois d’août',
    extrait: 'Votre forfait 80 Go : 14,99 €.',
    categorie: 'humain',
    age: 12 * JOUR,
    libelles: ['Label_factures'],
  },
  {
    id: 'a3',
    nom: 'Assurance Horizon',
    adresse: 'contrats@assurance-horizon.fr',
    sujet: 'Attestation annuelle',
    extrait: 'Votre attestation d’assurance habitation est disponible.',
    categorie: 'humain',
    age: 20 * JOUR,
    libelles: ['Label_factures'],
  },
  {
    id: 'a4',
    nom: 'Hôtel du Lac',
    adresse: 'reservations@hoteldulac.fr',
    sujet: 'Confirmation de réservation',
    extrait: 'Deux nuits, chambre vue lac, arrivée le vendredi à partir de 15 h.',
    categorie: 'humain',
    age: 9 * JOUR,
    libelles: ['Label_voyage'],
  },
  {
    id: 'a5',
    nom: 'Rail Express',
    adresse: 'billets@railexpress.fr',
    sujet: 'Vos billets Paris – Annecy',
    extrait: 'Départ vendredi 17 h 42, voiture 14, places 61 et 62.',
    categorie: 'humain',
    age: 10 * JOUR,
    libelles: ['Label_voyage'],
  },
  {
    id: 'a6',
    nom: 'Camille Laurent',
    adresse: 'camille.laurent@atelier-lumen.fr',
    sujet: 'Devis signé',
    extrait: 'Le client a signé, on peut lancer la production lundi.',
    categorie: 'humain',
    age: 6 * JOUR,
  },
  {
    id: 'a7',
    nom: 'Marc Lefèvre',
    adresse: 'marc.lefevre@atelier-lumen.fr',
    sujet: 'Compte rendu de la réunion',
    extrait: 'Les décisions prises mardi, et qui s’occupe de quoi.',
    categorie: 'humain',
    age: 7 * JOUR,
  },
]

export const ARCHIVES: MessageAffiche[] = ESQUISSES_ARCHIVES.map(message)

/** Date `AAAA-MM-JJ` d'il y a `jours` jours. */
function jourDIlYA(jours: number): string {
  return ilYA(jours * JOUR).slice(0, 10)
}

export const REGLES: JeuDeRegles = {
  version: '1.0',
  last_updated: ilYA(2 * JOUR),
  automations: [
    {
      id: 'regle-1',
      expediteur: 'offres@maisonverdure.fr',
      nom_affichage: 'Maison Verdure',
      categorie: 'publicite',
      action: 'supprimer_toujours',
      active: true,
      date_ajout: jourDIlYA(12),
    },
    {
      id: 'regle-2',
      expediteur: 'newsletter@randostore.fr',
      nom_affichage: 'Rando Store',
      categorie: 'publicite',
      action: 'archiver_automatique',
      active: true,
      date_ajout: jourDIlYA(9),
    },
    {
      id: 'regle-3',
      expediteur: 'bonjour@cafemistral.fr',
      nom_affichage: 'Café Mistral',
      categorie: 'publicite',
      action: 'supprimer_toujours',
      active: false,
      date_ajout: jourDIlYA(30),
    },
    {
      id: 'regle-4',
      expediteur: 'matinale@lamatinaletech.fr',
      nom_affichage: 'La Matinale Tech',
      categorie: 'newsletter',
      action: 'generer_resume_et_archiver',
      active: true,
      date_ajout: jourDIlYA(21),
    },
    {
      id: 'regle-5',
      expediteur: 'lettre@petit-economiste.fr',
      nom_affichage: 'Le Petit Économiste',
      categorie: 'newsletter',
      action: 'generer_resume_et_archiver',
      active: true,
      date_ajout: jourDIlYA(18),
    },
    {
      id: 'regle-6',
      expediteur: 'webinaires@academiepixel.fr',
      nom_affichage: 'Académie Pixel',
      categorie: 'formation',
      action: 'archiver_automatique',
      active: true,
      date_ajout: jourDIlYA(5),
      frequence: 'vendredi',
      heure_execution: '18:00',
    },
    {
      id: 'regle-7',
      expediteur: 'camille.laurent@atelier-lumen.fr',
      nom_affichage: 'Camille Laurent',
      categorie: 'humain',
      action: 'classer_seulement',
      active: true,
      date_ajout: jourDIlYA(40),
    },
  ],
}

/** Résumés rangés sous le numéro le plus récent de chaque publication. */
export const RESUMES: Record<string, Resume> = {
  n1: {
    texte:
      "Les portables de la rentrée embarquent presque tous une puce dédiée à l'IA, avec une autonomie en nette hausse.",
    hashtags: ['IA', 'Matériel'],
  },
  n2: {
    texte:
      'Deuxième baisse de taux de l’année : les crédits immobiliers devraient suivre d’ici décembre.',
    hashtags: ['Économie', 'Immobilier'],
  },
  n3: {
    texte: 'Cinq recettes rapides autour de la butternut, du velouté au risotto.',
    hashtags: ['Cuisine'],
  },
  n4: {
    texte:
      'Les polices variables gagnent la presse en ligne : un seul fichier remplace une dizaine de graisses.',
    hashtags: ['Design', 'Web'],
  },
}

export const SYNTHESE: ResultatSynthese = {
  quoi: 'faite',
  points: [
    {
      texte:
        "Les portables de la rentrée misent sur une puce dédiée à l'IA, et gagnent en autonomie.",
      sources: ['lamatinaletech.fr'],
    },
    {
      texte: 'La baisse des taux se confirme et devrait alléger les crédits immobiliers.',
      sources: ['petit-economiste.fr'],
    },
    {
      texte:
        'Côté création, les polices variables s’imposent ; côté cuisine, les courges arrivent.',
      sources: ['veilledesign.fr', 'cuisinedesaison.fr'],
    },
  ],
  hashtags: ['IA', 'Économie', 'Design', 'Cuisine'],
  produiteLe: ilYA(30),
  publications: 4,
}

export const PROFIL: ProfilCompte = { adresse: COMPTE, nom: 'Léa Fontaine', photo: null }

export const COMPTES: CompteConnu[] = [
  { adresse: COMPTE, nom: 'Léa Fontaine', photo: null, actif: true },
  { adresse: 'lea@atelier-lumen.fr', nom: 'Léa · Atelier Lumen', photo: null, actif: false },
]

export const CONTACTS: Connaissance[] = [
  { adresse: 'camille.laurent@atelier-lumen.fr', nom: 'Camille Laurent', photo: null, origine: 'carnet' },
  { adresse: 'julien.morel@exemple.fr', nom: 'Julien Morel', photo: null, origine: 'carnet' },
  { adresse: 'ines.garcia@exemple.fr', nom: 'Inès Garcia', photo: null, origine: 'carnet' },
  { adresse: 'marc.lefevre@atelier-lumen.fr', nom: 'Marc Lefèvre', photo: null, origine: 'autre' },
]

const PIECES: Record<string, PieceJointe[]> = {
  h3: [
    { id: 'pj-dossier', nom: 'recapitulatif-dossier.pdf', typeMime: 'application/pdf', taille: 184_000 },
  ],
  h5: [
    { id: 'pj-lac', nom: 'lac-au-lever.jpg', typeMime: 'image/jpeg', taille: 2_400_000 },
    { id: 'pj-ponton', nom: 'ponton.jpg', typeMime: 'image/jpeg', taille: 1_900_000 },
  ],
}

const CORPS_ECRITS: Record<string, string> = {
  h1: `
    <p>Salut Léa,</p>
    <p>Je t'envoie les trois pistes pour la page d'accueil, comme promis.</p>
    <ul>
      <li><strong>Piste A</strong> : très sobre, grande photo et un seul appel à l'action.</li>
      <li><strong>Piste B</strong> : la grille de projets remonte en haut de page.</li>
      <li><strong>Piste C</strong> : plus éditoriale, avec le blog mis en avant.</li>
    </ul>
    <p>La deuxième me plaît beaucoup, elle montre le travail tout de suite. Dis-moi ce que tu en penses avant jeudi, que Marc puisse caler le calendrier.</p>
    <p>À très vite,<br>Camille</p>`,
}

/** Corps d'un message : écrit à la main pour quelques-uns, composé pour les autres. */
export function corpsDe(id: string): CorpsMessage {
  const m = BOITE.find((x) => x.id === id) ?? ARCHIVES.find((x) => x.id === id)
  const prenom = m?.nom.split(' ')[0] ?? ''
  const html =
    CORPS_ECRITS[id] ??
    `<p>Bonjour Léa,</p><p>${m?.extrait ?? ''}</p><p>Bonne journée,<br>${prenom}</p>`
  return {
    html,
    texte: null,
    pieces: PIECES[id] ?? [],
  }
}
