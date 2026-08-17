/**
 * Enveloppes typées des commandes Tauri.
 *
 * Tout appel au backend passe par ce fichier : c'est le seul endroit où
 * `invoke` est importé, ce qui rend la surface backend visible d'un coup d'œil.
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  Apercu,
  ErreurBackend,
  EtatApplication,
  JeuDeRegles,
  MessageAffiche,
  CompteConnu,
  CorpsMessage,
  LibelleGmail,
  ProfilCompte,
  RapportExecution,
  RapportResumes,
  Regle,
  ReglesDuCompte,
  Resume,
  EtatLlm,
  Tableau,
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

/**
 * Regles d'un compte, telles qu'elles sont sur le disque.
 *
 * Chaque compte a les siennes : une meme adresse peut meriter un sort different
 * selon la boite qui la recoit. L'adresse du compte accompagne donc chaque
 * commande, et n'est jamais devinee cote Rust.
 */
export function reglesLister(compte: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regles_lister', { compte })
}

/** Regles de tous les comptes connus, pour la vue « Tous les comptes ». */
export function reglesToutes(): Promise<ReglesDuCompte[]> {
  return invoke<ReglesDuCompte[]>('regles_toutes')
}

/**
 * Enregistre une regle et rend le jeu complet du compte.
 *
 * Les commandes de regles rendent toujours l'ensemble plutot qu'un accuse de
 * reception : l'interface se reaffiche a partir de ce qui est reellement sur le
 * disque, au lieu de maintenir sa propre copie qui finirait par diverger.
 */
export function regleAjouter(compte: string, regle: Regle): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_ajouter', { compte, regle })
}

/** Remplace une règle désignée par son identifiant.
 *
 *  Distinct de `regleAjouter`, qui reconnaît une règle à son expéditeur : c'est
 *  souvent l'expéditeur lui-même qu'on vient corriger. */
export function regleModifier(
  compte: string,
  id: string,
  regle: Regle,
): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_modifier', { compte, id, regle })
}

export function regleSupprimer(compte: string, id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_supprimer', { compte, id })
}

export function regleBasculer(compte: string, id: string): Promise<JeuDeRegles> {
  return invoke<JeuDeRegles>('regle_basculer', { compte, id })
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

/** Enregistre une pièce jointe et rend le chemin du fichier écrit.
 *
 *  Enregistrée, jamais ouverte : ouvrir un fichier venu d'un e-mail laisserait
 *  un expéditeur choisir quel programme démarre. L'utilisateur ouvre lui-même
 *  ce qu'il a décidé de garder. */
export function pieceJointeEnregistrer(
  message: string,
  piece: string,
  nom: string,
): Promise<string> {
  return invoke<string>('piece_jointe_enregistrer', { message, piece, nom })
}

/** Prepare l'apercu d'une piece jointe, sans rien ecrire sur le disque.
 *
 *  Ce qui revient n'est jamais le fichier recu : une image est decodee puis
 *  re-encodee cote Rust, un texte est valide, un PDF ne part que vers le cadre
 *  isole qui sait le lire. Voir `gmail::apercu`. */
export function pieceJointeApercu(message: string, piece: string): Promise<Apercu> {
  return invoke<Apercu>('piece_jointe_apercu', { message, piece })
}

/** Vignette d'une piece jointe, ou `null` quand ce n'en est pas une image.
 *
 *  Fabriquee cote Rust a partir des seuls pixels du fichier, puis rangee sur le
 *  disque avec le corps du message : une photo pese plusieurs megaoctets qu'on
 *  ne retelechargera pas a chaque ouverture. */
export function pieceJointeVignette(
  message: string,
  piece: string,
): Promise<string | null> {
  return invoke<string | null>('piece_jointe_vignette', { message, piece })
}

/** Libelles crees par l'utilisateur, par ordre alphabetique. */
export function libellesLister(): Promise<LibelleGmail[]> {
  return invoke<LibelleGmail[]>('libelles_lister')
}

/** Cree un libelle et rend la liste complete, a jour. */
export function libelleCreer(nom: string): Promise<LibelleGmail[]> {
  return invoke<LibelleGmail[]>('libelle_creer', { nom })
}

/**
 * Pose un libellé sur un message déjà archivé, sans l'archiver à nouveau.
 *
 * C'est le geste de la table : déposer une tuile sur un tas. Distinct de
 * `messageRanger`, qui retire le message de la boîte de réception du même
 * mouvement — ici il en est déjà sorti.
 */
export function libellePoser(id: string, libelle: string): Promise<void> {
  return invoke<void>('libelle_poser', { id, libelle })
}

/**
 * Retire un libellé d'un message.
 *
 * Sortir une tuile d'une pile la laisse sur la table : elle ne revient pas
 * dans la boîte de réception, ce que personne n'a demandé.
 */
export function libelleRetirer(id: string, libelle: string): Promise<void> {
  return invoke<void>('libelle_retirer', { id, libelle })
}

/**
 * Défait un tas : ses messages en sortent, et le libellé disparaît de Gmail.
 *
 * Le seul appel de MailFlow qui détruise quelque chose chez Google. Aucun
 * message n'est supprimé — Gmail retire l'étiquette, rien de plus — mais le
 * libellé ne se restaure pas, et les messages qui le portaient ailleurs le
 * perdent aussi. D'où la confirmation qui le nomme, côté interface.
 */
export function tasDefaire(libelle: string, ids: string[]): Promise<void> {
  return invoke<void>('tas_defaire', { libelle, ids })
}

/**
 * Les messages archives depuis MailFlow, pour la table.
 *
 * Aucun appel reseau : c'est le geste d'archivage qui ecrit le registre, et
 * cette commande le relit. La table demandait auparavant a Gmail « tout ce qui
 * n'est pas dans la boite », ce qui ramenait des messages de 2024 tries par un
 * filtre et des notifications que personne n'y avait posees.
 */
export function archivesLister(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('archives_lister')
}

/**
 * Fait entrer sur la table ce qui a ete classe **depuis Gmail**.
 *
 * Nommer un tas cree un libelle chez Gmail : ce sens-la fonctionnait deja.
 * L'autre non — un libelle pose depuis le telephone ne se voyait nulle part
 * ici, et la table pretendait classer en ignorant la moitie du classement.
 *
 * Rend la table complete, registre et classement Gmail reunis.
 */
export function archivesSynchroniser(): Promise<MessageAffiche[]> {
  return invoke<MessageAffiche[]>('archives_synchroniser')
}

/**
 * Retire un message de la table, sans toucher a Gmail.
 *
 * Distinct de `messageCorbeille` : le message reste archive chez Gmail, ses
 * libelles compris. Sans ce geste, la table n'avait qu'une sortie et c'etait la
 * corbeille — impossible de dire « celui-la est classe » sans le jeter.
 */
export function archiveRetirer(id: string): Promise<void> {
  return invoke<void>('archive_retirer', { id })
}

/** Disposition de la table des archives du compte actif. */
export function tableauLire(): Promise<Tableau> {
  return invoke<Tableau>('tableau_lire')
}

/** Enregistre la disposition de la table. Ne porte que des positions. */
export function tableauEcrire(tableau: Tableau): Promise<void> {
  return invoke<void>('tableau_ecrire', { tableau })
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

/** Nom de l'evenement emis pendant la production des resumes. */
export const EVENEMENT_RESUMES = 'resumes-produits'

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

/**
 * Ouvre dans le navigateur du système un lien cliqué dans un message.
 *
 * L'adresse vient d'un e-mail : elle n'est pas ouverte telle quelle, mais
 * confrontée côté Rust à une liste blanche de schémas. Un `file://` ou un
 * schéma déposé par une application installée est refusé — sans quoi un
 * expéditeur choisirait quel programme démarre sur la machine.
 */
export function lienOuvrir(url: string): Promise<void> {
  return invoke<void>('lien_ouvrir', { url })
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

// ---------------------------------------------------------------------------
// Resumes de newsletters
// ---------------------------------------------------------------------------

/** Ce que l'interface sait du moteur de resumes. La cle n'en sort jamais. */
export function llmEtat(): Promise<EtatLlm> {
  return invoke<EtatLlm>('llm_etat')
}

/**
 * Verifie une cle puis l'enregistre dans le trousseau.
 *
 * L'ordre compte : une cle fausse n'est jamais rangee, si bien que la promesse
 * « une cle est configuree » vaut promesse qu'elle fonctionnait. La
 * verification fait un vrai appel — une cle bien formee mais revoquee
 * passerait n'importe quel controle de syntaxe.
 */
export function llmCleEnregistrer(cle: string): Promise<void> {
  return invoke<void>('llm_cle_enregistrer', { cle })
}

export function llmCleEffacer(): Promise<void> {
  return invoke<void>('llm_cle_effacer')
}

/** Resumes deja produits, lus sur le disque et sans aucun appel reseau. */
export function resumesConnus(ids: string[]): Promise<Record<string, Resume>> {
  return invoke<Record<string, Resume>>('resumes_connus', { ids })
}

/** Une publication et ses numeros, du plus recent au plus ancien. */
export interface GroupeAResumer {
  cle: string
  ids: string[]
}

/**
 * Troisieme phase : produit les resumes manquants, **une publication a la fois**.
 *
 * Un appel par emetteur et non par numero : trente newsletters faisaient trente
 * appels, et le palier gratuit s'epuisait avant la fin de la page. La question
 * que l'on se pose devant cette page n'est pas « que dit ce numero » mais
 * « est-ce que je lis cette publication ».
 *
 * Ne fait rien sans cle configuree — ce n'est pas une panne, c'est le cas de
 * tout utilisateur qui n'a pas voulu de l'IA.
 */
export function resumesProduire(groupes: GroupeAResumer[]): Promise<RapportResumes> {
  return invoke<RapportResumes>('resumes_produire', { groupes })
}


/** Demande l'arret : lu entre deux messages, jamais en plein appel. */
export function resumesArreter(): Promise<void> {
  return invoke<void>('resumes_arreter')
}
