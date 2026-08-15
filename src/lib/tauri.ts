/**
 * Enveloppes typées des commandes Tauri.
 *
 * Tout appel au backend passe par ce fichier : c'est le seul endroit où
 * `invoke` est importé, ce qui rend la surface backend visible d'un coup d'œil.
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  ErreurBackend,
  EtatApplication,
  JeuDeRegles,
  MessageAffiche,
  CompteConnu,
  CorpsMessage,
  LibelleGmail,
  ProfilCompte,
  RapportExecution,
  Regle,
  VerificationMaj,
} from '../types/backend'

/** Vrai lorsqu'une valeur rejetée a la forme d'une erreur backend. */
export function estErreurBackend(e: unknown): e is ErreurBackend {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as ErreurBackend).message === 'string'
  )
}

/**
 * Ramène n'importe quel rejet à un message affichable.
 *
 * Une panne inattendue ne doit pas exposer sa trace à un utilisateur non
 * technique : elle part dans la console et l'interface reste compréhensible.
 */
export function messageDErreur(e: unknown): string {
  if (estErreurBackend(e)) return e.message
  console.error('erreur inattendue du backend', e)
  return "Une erreur inattendue s'est produite."
}

/** État de santé du backend, appelé au démarrage. */
export function appHealth(): Promise<EtatApplication> {
  return invoke<EtatApplication>('app_health')
}

/**
 * Lance le parcours de connexion Google.
 *
 * La promesse ne se résout qu'à la fin du parcours — l'utilisateur passe par son
 * navigateur entre-temps. Aucun jeton ne revient ici : l'état de connexion se
 * relit avec `appHealth`.
 */
export function googleConnecter(): Promise<void> {
  return invoke<void>('google_connecter')
}

/** Déconnecte le compte et révoque l'autorisation chez Google. */
export function googleDeconnecter(): Promise<void> {
  return invoke<void>('google_deconnecter')
}

/**
 * Applique les règles à la boîte Gmail.
 *
 * Le parcours entier reste côté Rust : ne reviennent ici que des décomptes,
 * jamais des identifiants de messages.
 */
export function gmailSynchroniser(): Promise<RapportExecution> {
  return invoke<RapportExecution>('gmail_synchroniser')
}

/** Jeu de regles tel qu'il est sur le disque. */
export function reglesLister(): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regles_lister')
}

/**
 * Enregistre une regle et rend le jeu complet.
 *
 * Les commandes de regles rendent toujours l'ensemble plutot qu'un accuse de
 * reception : l'interface se reaffiche a partir de ce qui est reellement sur le
 * disque, au lieu de maintenir sa propre copie qui finirait par diverger.
 */
export function regleAjouter(regle: Regle): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_ajouter', { regle })
}

export function regleSupprimer(id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_supprimer', { id })
}

export function regleBasculer(id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_basculer', { id })
}

/** Releve la boite de reception chez Gmail, deja classee par vue. */
export function boiteLister(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('boite_lister')
}

/**
 * Dernier releve connu du compte actif, lu sur le disque.
 *
 * Aucun appel reseau : c'est ce qui s'affiche a l'ouverture, le temps que le
 * vrai releve aboutisse. Liste vide quand rien n'a encore ete range.
 */
export function boiteEnCache(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('boite_en_cache')
}

/**
 * Releves de tous les comptes connus, melanges et tries par date.
 *
 * Le compte fictif « Tous les comptes » : une vue, pas une boite. Tout vient du
 * disque, donc sans attente.
 */
export function boiteMelangee(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('boite_melangee')
}

/**
 * Releve la corbeille du compte actif.
 *
 * Rien n'est mis en cache : on y vient precisement pour verifier ce qui s'y
 * trouve, et un cache perime y serait plus genant qu'une attente.
 */
export function corbeilleLister(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('corbeille_lister')
}

/** Sort un message de la corbeille et le remet ou il etait. */
export function messageRestaurer(id: string): Promise<void> {
  return invoke<void>('message_restaurer', { id })
}

/** Efface tout le cache, releves et corps, tous comptes confondus. */
export function cacheVider(): Promise<void> {
  return invoke<void>('cache_vider')
}

/** Taille du cache sur le disque, en octets. */
export function cacheTaille(): Promise<number> {
  return invoke<number>('cache_taille')
}

/**
 * Corps d'un message.
 *
 * Le HTML rendu est desinfecte cote Rust, mais ce n'est pas ce qui protege : il
 * doit etre affiche dans une `iframe` en bac a sable. Voir `gmail::corps`.
 */
export function messageCorps(id: string): Promise<CorpsMessage> {
  return invoke<CorpsMessage>('message_corps', { id })
}

/** Libelles crees par l'utilisateur, par ordre alphabetique. */
export function libellesLister(): Promise<LibelleGmail[]> {
  return invoke<LibelleGmail[]>('libelles_lister')
}

/** Cree un libelle et rend la liste complete, a jour. */
export function libelleCreer(nom: string): Promise<LibelleGmail[]> {
  return invoke<LibelleGmail[]>('libelle_creer', { nom })
}

/** Range un message sous un libelle, ou l'archive quand `libelle` est absent. */
export function messageRanger(id: string, libelle?: string): Promise<void> {
  return invoke<void>('message_ranger', { id, libelle: libelle ?? null })
}

/**
 * Ouvre un brouillon de reponse dans le client de courrier du systeme.
 *
 * MailFlow n'a pas le droit d'envoyer du courrier en votre nom : la portee
 * `gmail.send` est ecartee depuis le debut.
 */
export function repondreAuMessage(
  destinataire: string,
  sujet: string,
  /** Renseignee par « Repondre a tous » ; vide par « Repondre ». */
  copies: string[] = [],
): Promise<void> {
  return invoke<void>('repondre_au_message', { destinataire, sujet, copies })
}

/** Avancement du prechargement, tel que l'evenement le porte. */
export interface Avancement {
  faits: number
  total: number
}

/** Nom de l'evenement emis pendant le prechargement. */
export const EVENEMENT_PRECHARGEMENT = 'corps-precharges'

/** Nom de l'evenement emis pendant le releve de la boite. */
export const EVENEMENT_RELEVE = 'messages-releves'

/**
 * Charge d'avance le corps de tous les messages donnes.
 *
 * L'attente est groupee au demarrage, avec une barre de progression, au lieu
 * d'etre subie message par message.
 */
export function corpsPrecharger(ids: string[]): Promise<number> {
  return invoke<number>('corps_precharger', { ids })
}

/**
 * Met un message a la corbeille.
 *
 * Le geste du bouton Supprimer de Gmail : le message quitte la boite et reste
 * recuperable trente jours. Rien n'est detruit.
 */
export function messageCorbeille(id: string): Promise<void> {
  return invoke<void>('message_corbeille', { id })
}

/**
 * Marque un message comme lu chez Gmail.
 *
 * Modifie reellement la boite : le libelle `UNREAD` est retire. Gmail sait
 * remettre un message en non-lu, l'operation n'est donc pas definitive.
 */
export function messageMarquerLu(id: string): Promise<void> {
  return invoke<void>('message_marquer_lu', { id })
}

/**
 * Demande a GitHub s'il existe une version plus recente.
 *
 * Rien n'est telecharge ni installe : la commande rend un constat. La mise a
 * jour silencieuse supposerait une paire de cles de signature.
 */
export function majVerifier(): Promise<VerificationMaj> {
  return invoke<VerificationMaj>('maj_verifier')
}

/** Ouvre la page de la publication dans le navigateur du systeme. */
export function majOuvrir(): Promise<void> {
  return invoke<void>('maj_ouvrir')
}

/** Adresse du compte relié, ou `null` si aucun ne l'est. */
export function compteAdresse(): Promise<string | null> {
  return invoke<string | null>('compte_adresse')
}

/**
 * Profil du compte relié : adresse, nom affiché, photo.
 *
 * La photo arrive en URI de données parce que la politique de sécurité de
 * l'interface interdit les images d'origine externe.
 */
export function compteProfil(): Promise<ProfilCompte | null> {
  return invoke<ProfilCompte | null>('compte_profil')
}

/** Comptes deja autorises, l'actif en tete. */
export function comptesLister(): Promise<CompteConnu[]> {
  return invoke<CompteConnu[]>('comptes_lister')
}

/** Bascule sur un compte deja autorise, sans repasser par Google. */
export function compteBasculer(adresse: string): Promise<void> {
  return invoke<void>('compte_basculer', { adresse })
}

/** Met le compte actif de cote et lance l'autorisation d'un autre. */
export function compteAjouter(): Promise<void> {
  return invoke<void>('compte_ajouter')
}

/** Retire un compte inactif de la liste et rend son autorisation a Google. */
export function compteOublier(adresse: string): Promise<void> {
  return invoke<void>('compte_oublier', { adresse })
}

/**
 * Logos des expediteurs, indexes par domaine.
 *
 * Chaque logo est demande au domaine de l'expediteur, jamais a un service
 * tiers : un agregateur d'icones apprendrait la liste complete des
 * correspondants de l'utilisateur.
 */
export function logosExpediteurs(
  adresses: string[],
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('logos_expediteurs', { adresses })
}
