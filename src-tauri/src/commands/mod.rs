//! Surface exposée au frontend.
//!
//! C'est la seule frontière par laquelle le webview peut déclencher quoi que ce
//! soit. Chaque commande ajoutée ici élargit ce que du HTML d'e-mail compromis
//! pourrait atteindre : on n'expose que ce dont une vue a besoin, et jamais un
//! primitif générique (« lire ce fichier », « appeler cette URL »).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use chrono::{Local, Utc};

use crate::auth::flux::ClientOAuth;
use crate::auth::session::SessionAuth;
use crate::auth::{DELAI_AUTORISATION, connecter};
use crate::cache;
use crate::comptes::{self, Annuaire};
use crate::config;
use crate::error::{AppError, Resultat};
use crate::gmail::apercu::{self, Apercu};
use crate::gmail::boite::{MessageAffiche, charger_boite_suivi};
use crate::gmail::client::{ClientGmail, SourceJeton};
use crate::gmail::execution::RapportExecution;
use crate::gmail::synchronisation::synchroniser;
use crate::gmail::transport::TransportHttp;
use crate::rules::{self, Rule, RuleSet, RulesStore};
use crate::secrets::{KeyringStore, SecretStore};

pub mod resumes;

/// État d'authentification partagé, géré par Tauri.
///
/// `client` vaut `None` tant que l'identifiant Google n'a pas été configuré :
/// l'application se lance quand même et l'explique, plutôt que de refuser de
/// démarrer sur un fichier `.env` incomplet.
pub struct EtatAuth {
    session: Mutex<SessionAuth<KeyringStore>>,
    client: Option<ClientOAuth>,

    /// Jetons d'accès des comptes qui ne sont pas l'actif, gardés le temps de
    /// leur validité — voir [`JetonsDuCompte`].
    ///
    /// En mémoire seulement : un jeton d'accès vit une heure, et l'écrire sur
    /// le disque n'apporterait qu'un secret de plus à protéger.
    autres_jetons: Mutex<std::collections::HashMap<String, crate::auth::jetons::Jetons>>,
}

impl EtatAuth {
    pub fn nouveau() -> Self {
        let client = match (config::client_id_google(), config::client_secret_google()) {
            (Some(id), Some(secret)) => ClientOAuth::nouveau(id, secret)
                .inspect_err(|e| log::error!("client OAuth inutilisable : {e}"))
                .ok(),
            (id, secret) => {
                // Nommer précisément ce qui manque : les deux valeurs viennent du
                // même fichier téléchargé chez Google, et n'en copier qu'une est
                // l'erreur la plus facile à commettre.
                let mut absents = Vec::new();
                if id.is_none() {
                    absents.push(config::VAR_CLIENT_ID);
                }
                if secret.is_none() {
                    absents.push(config::VAR_CLIENT_SECRET);
                }
                log::warn!(
                    "connexion Gmail indisponible, configuration absente : {}",
                    absents.join(", ")
                );
                None
            }
        };

        Self {
            session: Mutex::new(SessionAuth::nouvelle(KeyringStore::new())),
            client,
            autres_jetons: Mutex::new(std::collections::HashMap::new()),
        }
    }

    fn client(&self) -> Resultat<&ClientOAuth> {
        self.client
            .as_ref()
            .ok_or_else(|| AppError::Config(format!("{} non renseigné", config::VAR_CLIENT_ID)))
    }
}

/// Donne au client Gmail de quoi s'authentifier, sans rien lui apprendre
/// d'OAuth2.
///
/// Le verrou de session n'est pris que le temps d'obtenir un jeton, jamais
/// pendant les appels Gmail : une synchronisation dure plusieurs secondes, et
/// bloquer la session tout ce temps empêcherait toute autre commande.
struct JetonsDeSession<'a> {
    etat: &'a EtatAuth,
}

impl SourceJeton for JetonsDeSession<'_> {
    async fn jeton(&self, forcer: bool) -> Resultat<String> {
        let client = self.etat.client()?;
        let mut session = self.etat.session.lock().await;

        if forcer {
            session.oublier_le_jeton_courant();
        }
        session.access_token(client, Utc::now()).await
    }
}

/// Donne au client Gmail le jeton d'un compte **qui n'est pas l'actif**.
///
/// # Le défaut que cela corrige
///
/// Sous « Tous les comptes », la liste mélange les messages de toutes les
/// boîtes — mais un seul jeton existait, celui du compte actif. Ouvrir la pièce
/// jointe d'un message reçu sur une autre adresse revenait donc à la demander
/// avec les clés du voisin : Gmail répondait « demande impossible à traiter »,
/// et rien n'expliquait pourquoi, puisque la lettre, elle, venait du cache
/// disque et s'affichait très bien.
///
/// Le corps ne trahissait rien, la pièce jointe si — parce qu'elle seule
/// n'est jamais mise en cache.
///
/// # Comment
///
/// Chaque compte en réserve garde son `refresh_token` dans le trousseau, sur
/// son propre créneau ([`comptes::cle_compte`]). On l'échange contre un jeton
/// d'accès, qu'on garde en mémoire le temps de sa validité : sans ce cache,
/// précharger soixante corps mélangés ferait soixante échanges.
struct JetonsDuCompte<'a> {
    etat: &'a EtatAuth,
    adresse: String,
}

impl SourceJeton for JetonsDuCompte<'_> {
    async fn jeton(&self, forcer: bool) -> Resultat<String> {
        let client = self.etat.client()?;

        // Le verrou est tenu pendant l'échange : deux commandes lancées de
        // front sur le même compte doivent en faire un seul, pas deux.
        let mut cache = self.etat.autres_jetons.lock().await;

        if !forcer
            && let Some(connu) = cache.get(&self.adresse)
            && connu.utilisable(Utc::now())
        {
            return Ok(connu.access_token().to_string());
        }

        let creneau = comptes::cle_compte(&self.adresse);
        let magasin = KeyringStore::new();

        let refresh = magasin.get(&creneau)?.ok_or_else(|| {
            log::warn!("aucun jeton en réserve pour ce compte");
            AppError::NonAuthentifie
        })?;

        let reponse = client.renouveler(&refresh).await?;
        let jetons = crate::auth::jetons::Jetons::depuis(reponse, Utc::now());

        // Google peut faire tourner le jeton durable. Ne pas réécrire
        // laisserait le trousseau sur une valeur périmée, et le compte
        // deviendrait injoignable au prochain lancement.
        if let Some(nouveau) = jetons.refresh_token()
            && nouveau != refresh
        {
            magasin.set(&creneau, nouveau)?;
        }

        let acces = jetons.access_token().to_string();
        cache.insert(self.adresse.clone(), jetons);
        Ok(acces)
    }
}

/// L'une ou l'autre source de jeton, choisie selon le compte visé.
///
/// Une énumération plutôt qu'un objet de trait : [`SourceJeton`] a une méthode
/// `async`, et le rendre utilisable en objet demanderait de boxer chaque appel
/// pour un choix qui se fait une fois par commande.
enum JetonsAdaptes<'a> {
    Session(JetonsDeSession<'a>),
    Autre(JetonsDuCompte<'a>),
}

impl SourceJeton for JetonsAdaptes<'_> {
    async fn jeton(&self, forcer: bool) -> Resultat<String> {
        match self {
            Self::Session(source) => source.jeton(forcer).await,
            Self::Autre(source) => source.jeton(forcer).await,
        }
    }
}

/// Choisit avec quelles clés parler à Gmail pour un message donné.
///
/// Le compte actif garde le chemin historique — celui qui tient son jeton en
/// mémoire et sait le renouveler. Les autres passent par le trousseau.
/// Un compte inconnu retombe sur l'actif : c'est ce que faisait tout le code
/// avant, et rien n'est perdu à essayer.
fn jetons_pour<'a>(etat: &'a EtatAuth, actif: &str, compte: Option<&str>) -> JetonsAdaptes<'a> {
    match compte_a_viser(actif, compte) {
        Some(adresse) => JetonsAdaptes::Autre(JetonsDuCompte { etat, adresse }),
        None => JetonsAdaptes::Session(JetonsDeSession { etat }),
    }
}

/// Quel compte en réserve viser, ou `None` pour rester sur l'actif.
///
/// Séparé de [`jetons_pour`] pour être testable : la décision est tout ce qui
/// peut être faux ici, et elle ne demande ni trousseau ni réseau.
fn compte_a_viser(actif: &str, compte: Option<&str>) -> Option<String> {
    let vise = compte.map(str::trim).filter(|c| !c.is_empty())?;

    // La comparaison ignore la casse : Gmail rend parfois l'adresse telle que
    // l'utilisateur l'a tapée, l'annuaire la range en minuscules. Les croire
    // différentes ferait chercher dans le trousseau un compte qui est déjà là,
    // et le geste échouerait pour un « G » majuscule.
    if vise.eq_ignore_ascii_case(actif.trim()) {
        return None;
    }

    Some(vise.to_lowercase())
}

/// Table « identifiant de message → compte qui l'a reçu », lue dans les relevés
/// déjà rangés sur le disque.
///
/// C'est le backend qui répond à cette question, et non l'interface, bien que
/// celle-ci connaisse déjà le compte de chaque message : une réponse venue du
/// webview serait une réponse venue d'un endroit qui affiche du HTML
/// d'expéditeur. Le disque, lui, ne ment pas.
///
/// Construite d'un coup plutôt qu'interrogée message par message : le
/// préchargement en demande soixante d'affilée, et relire les mêmes fichiers
/// soixante fois pour cela serait absurde.
fn comptes_des_messages(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let mut table = std::collections::HashMap::new();

    let (Ok(dossier), Ok(racine)) = (dossier_config(app), dossier_cache(app)) else {
        return table;
    };

    for compte in comptes::charger(&dossier).connus {
        let Some(boite) = cache::lire_boite(&racine, &compte.adresse) else {
            continue;
        };
        for message in boite {
            table.insert(message.id, compte.adresse.clone());
        }
    }

    table
}

/// Le compte qui a reçu ce message, s'il est connu.
fn compte_du_message(app: &AppHandle, id: &str) -> Option<String> {
    comptes_des_messages(app).remove(id)
}

/// Les clés qu'il faut pour parler à Gmail d'un message précis.
///
/// Raccourci des deux appels précédents, employé par toutes les commandes qui
/// visent un seul message : c'est le geste qu'il ne faut pas oublier, donc il
/// tient en un mot.
fn jetons_du_message<'a>(app: &AppHandle, etat: &'a EtatAuth, id: &str) -> JetonsAdaptes<'a> {
    let compte = compte_du_message(app, id);
    jetons_pour(etat, &compte_actif(app), compte.as_deref())
}

/// Dossier de configuration applicatif de l'utilisateur.
pub fn dossier_config(app: &AppHandle) -> Resultat<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::Config(format!("dossier de configuration introuvable : {e}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatApplication {
    pub version: String,
    pub plateforme: &'static str,

    /// Faux quand aucun agent de trousseau n'est joignable (session Linux sans
    /// Secret Service, par exemple). La connexion Gmail est alors impossible et
    /// l'interface doit le dire clairement plutôt que d'échouer plus tard.
    pub trousseau_disponible: bool,

    /// Expose volontairement : le mode avancé de la vue 5 propose d'ouvrir le
    /// fichier brut. C'est un chemin appartenant à l'utilisateur, dans sa propre
    /// session — pas un secret.
    ///
    /// Celui du compte actif : chaque compte a désormais ses règles à lui.
    pub chemin_regles: String,

    /// `None` quand le fichier existe mais n'a pas pu être lu.
    ///
    /// Compte les règles du compte actif, pas de tous les comptes.
    pub nombre_de_regles: Option<usize>,

    pub compte_connecte: bool,

    /// Faux tant que l'identifiant client Google n'a pas été renseigné. La vue de
    /// connexion doit alors renvoyer vers `docs/connexion-google.md` au lieu de
    /// proposer un bouton qui ne peut pas fonctionner.
    pub client_google_configure: bool,
}

/// État de santé du backend, appelé au démarrage par le frontend.
///
/// Sert aussi de tranche verticale de bout en bout : elle touche le trousseau,
/// le système de fichiers et les chemins Tauri, donc elle échoue bruyamment si
/// l'un des trois est mal câblé.
#[tauri::command]
pub async fn app_health(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<EtatApplication> {
    let dossier = dossier_config(&app)?;
    let actif = compte_actif(&app);

    // Migration des règles d'avant le cloisonnement, ici parce que c'est le
    // premier appel au démarrage *et* celui que l'interface refait après une
    // connexion : le compte actif vient peut-être seulement d'exister.
    // L'opération est idempotente et ne fait rien dans le cas courant.
    if let Err(e) = rules::migration::cloisonner(&dossier, &actif) {
        // Un échec ne doit pas empêcher l'application de démarrer : l'ancien
        // fichier reste en place et sera retenté au prochain lancement.
        log::warn!("migration des règles impossible : {e}");
    }

    let store = RulesStore::pour_compte(&dossier, &actif);

    let nombre_de_regles = match store.charger() {
        Ok(regles) => Some(regles.automations.len()),
        Err(e) => {
            log::warn!("règles illisibles : {e}");
            None
        }
    };

    let trousseau_disponible = KeyringStore::disponible().is_ok();

    // Sans trousseau joignable, on ne peut rien affirmer sur la connexion.
    let compte_connecte = trousseau_disponible
        && etat
            .session
            .lock()
            .await
            .est_connecte()
            .inspect_err(|e| log::warn!("lecture du trousseau impossible : {e}"))
            .unwrap_or(false);

    let client_google_configure = etat.client.is_some();

    log::info!(
        "diagnostic : trousseau={trousseau_disponible}, client_google={client_google_configure}, \
         compte_connecte={compte_connecte}, regles={nombre_de_regles:?}"
    );

    Ok(EtatApplication {
        version: app.package_info().version.to_string(),
        plateforme: std::env::consts::OS,
        trousseau_disponible,
        chemin_regles: store.chemin().display().to_string(),
        nombre_de_regles,
        compte_connecte,
        client_google_configure,
    })
}

/// Lance le parcours de connexion Google et attend son issue.
///
/// Rend la main quand l'utilisateur a donné son accord, l'a refusé, ou n'a rien
/// fait dans le délai imparti. Aucun jeton ne remonte au frontend : il apprend le
/// résultat en rappelant `app_health`.
#[tauri::command]
pub async fn google_connecter(etat: State<'_, EtatAuth>) -> Resultat<()> {
    let client = etat.client()?;

    // Le verrou est pris pour toute la durée du parcours : deux connexions
    // simultanées écraseraient mutuellement leur `refresh_token`.
    let mut session = etat.session.lock().await;

    connecter(
        client,
        &mut session,
        |url| {
            // Navigateur système, jamais un webview de l'application : c'est ce
            // qui garantit à l'utilisateur qu'il tape son mot de passe chez
            // Google et non dans une page que MailFlow contrôle.
            tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
                .map_err(|e| AppError::Auth(format!("ouverture du navigateur impossible : {e}")))
        },
        DELAI_AUTORISATION,
    )
    .await
    .inspect_err(|e| log::warn!("connexion Google interrompue : {e}"))?;

    log::info!("compte Gmail connecté");
    Ok(())
}

/// Déconnecte le compte et révoque l'autorisation chez Google.
#[tauri::command]
pub async fn google_deconnecter(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<()> {
    let a_revoquer = etat.session.lock().await.fermer()?;

    // Le compte quitte aussi l'annuaire : son autorisation est rendue à Google,
    // le proposer encore dans la liste des comptes serait promettre une bascule
    // qui échouerait.
    if let Ok(dossier) = dossier_config(&app) {
        let mut annuaire = comptes::charger(&dossier);
        if let Some(actif) = annuaire.actif.clone() {
            annuaire.oublier(&actif);
            let _ = comptes::ecrire(&dossier, &annuaire);
        }
    }

    // Le trousseau est déjà vide à ce stade : même si la révocation échoue
    // (machine hors ligne), l'utilisateur est bien déconnecté localement.
    if let (Some(jeton), Ok(client)) = (a_revoquer, etat.client())
        && let Err(e) = client.revoquer(&jeton).await
    {
        log::warn!("révocation côté Google impossible : {e}");
    }

    log::info!("compte Gmail déconnecté");
    Ok(())
}

/// Applique les règles à la boîte Gmail et rend le compte de ce qui a été fait.
///
/// Le parcours entier vit côté Rust : le frontend déclenche et reçoit un
/// décompte, jamais des identifiants de messages ni des jetons.
#[tauri::command]
pub async fn gmail_synchroniser(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<RapportExecution> {
    let dossier = dossier_config(&app)?;
    // Les règles du compte qu'on synchronise, et d'aucun autre : celles d'une
    // autre boîte n'ont rien à dire sur celle-ci.
    let regles = RulesStore::pour_compte(&dossier, &compte_actif(&app)).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    let rapport = synchroniser(&client, &regles, Local::now())
        .await
        .inspect_err(|e| log::warn!("synchronisation interrompue : {e}"))?;

    log::info!(
        "synchronisation terminée : {} archivé(s), {} à la corbeille, {} échec(s)",
        rapport.archives,
        rapport.mis_a_la_corbeille,
        rapport.echecs
    );

    Ok(rapport)
}

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

/// Les règles d'un compte, telles qu'elles partent vers l'interface.
#[derive(Debug, Serialize)]
pub struct ReglesDuCompte {
    pub compte: String,
    pub regles: RuleSet,
}

/// Magasin des règles d'un compte, après vérification que le compte existe.
///
/// Les règles appartiennent à un compte : une commande qui n'en désigne aucun
/// n'a pas de sens, et un compte inconnu laisserait derrière lui un fichier que
/// plus rien ne rattache à une boîte. L'adresse arrive du webview, donc d'un
/// endroit qu'on ne suppose pas intègre — elle est confrontée à l'annuaire
/// plutôt que crue sur parole.
fn magasin_regles(app: &AppHandle, compte: &str) -> Resultat<RulesStore> {
    let dossier = dossier_config(app)?;

    if compte.trim().is_empty() || !comptes::charger(&dossier).est_connu(compte) {
        log::warn!("règles demandées pour un compte inconnu");
        return Err(AppError::NonAuthentifie);
    }

    Ok(RulesStore::pour_compte(&dossier, compte))
}

/// Chaque commande de règle rend le jeu complet du compte plutôt qu'un accusé
/// de réception. L'interface se réaffiche à partir de ce qui est réellement sur
/// le disque, au lieu de maintenir sa propre copie qui finirait par diverger.
#[tauri::command]
pub async fn regles_lister(app: AppHandle, compte: String) -> Resultat<RuleSet> {
    magasin_regles(&app, &compte)?.charger()
}

/// Les règles de tous les comptes connus, pour la vue « Tous les comptes ».
///
/// Un compte dont le fichier est illisible n'interrompt pas la lecture des
/// autres : il apparaît sans règle, et son propre écran dira pourquoi.
#[tauri::command]
pub async fn regles_toutes(app: AppHandle) -> Resultat<Vec<ReglesDuCompte>> {
    let dossier = dossier_config(&app)?;

    Ok(comptes::charger(&dossier)
        .connus
        .iter()
        .map(|c| ReglesDuCompte {
            compte: c.adresse.clone(),
            regles: RulesStore::pour_compte(&dossier, &c.adresse)
                .charger()
                .unwrap_or_else(|e| {
                    log::warn!("règles illisibles pour un compte : {e}");
                    RuleSet::default()
                }),
        })
        .collect())
}

#[tauri::command]
pub async fn regle_ajouter(app: AppHandle, compte: String, regle: Rule) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    regles.ajouter(regle);
    magasin.enregistrer(&regles)?;

    log::info!(
        "règle enregistrée, {} au total pour ce compte",
        regles.automations.len()
    );
    Ok(regles)
}

/// Remplace une règle existante, désignée par son identifiant.
///
/// Une commande à part plutôt qu'un `regle_ajouter` détourné : l'ajout
/// reconnaît une règle à son expéditeur, or c'est justement l'expéditeur qu'on
/// vient souvent corriger.
#[tauri::command]
pub async fn regle_modifier(
    app: AppHandle,
    compte: String,
    id: String,
    regle: Rule,
) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.modifier(&id, regle) {
        magasin.enregistrer(&regles)?;
        log::info!("règle {id} modifiée");
    } else {
        log::warn!("règle {id} introuvable, rien de modifié");
    }

    Ok(regles)
}

#[tauri::command]
pub async fn regle_supprimer(app: AppHandle, compte: String, id: String) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.supprimer(&id) {
        magasin.enregistrer(&regles)?;
        log::info!("règle {id} supprimée");
    }
    Ok(regles)
}

#[tauri::command]
pub async fn regle_basculer(app: AppHandle, compte: String, id: String) -> Resultat<RuleSet> {
    let magasin = magasin_regles(&app, &compte)?;
    let mut regles = magasin.charger()?;

    if regles.basculer(&id) {
        magasin.enregistrer(&regles)?;
    }
    Ok(regles)
}

// ---------------------------------------------------------------------------
// Boîte de réception
// ---------------------------------------------------------------------------

/// Nom de l'événement annonçant l'avancement du relevé.
///
/// Le relevé demande un appel par message : c'est la plus longue attente de
/// l'ouverture, et l'écran de chargement n'avait rien à en dire.
pub const EVENEMENT_RELEVE: &str = "messages-releves";

/// Dossier où le cache s'installe, durablement.
///
/// Le dossier de cache de l'application, et non `$XDG_RUNTIME_DIR` comme
/// autrefois : celui-ci survit à l'extinction de la machine, ce qui est tout
/// l'objet de la manœuvre. Voir [`crate::cache`] pour ce que ce choix coûte.
pub fn dossier_cache(app: &AppHandle) -> Resultat<PathBuf> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("boites"))
        .map_err(|e| AppError::Config(format!("dossier de cache introuvable : {e}")))
}

/// Adresse du compte actif, telle que l'annuaire la connaît.
///
/// Prise dans l'annuaire et non demandée à Gmail : c'est une lecture de
/// fichier, là où l'autre coûte un appel réseau, et le cache s'interroge à
/// chaque ouverture.
fn compte_actif(app: &AppHandle) -> String {
    comptes::charger(&dossier_config(app).unwrap_or_default())
        .actif
        .unwrap_or_default()
}

/// Relève la boîte et classe les messages par vue.
///
/// Ne rend ni corps de message ni identifiant de fil : le HTML d'un e-mail est
/// écrit par un inconnu et ne traversera l'IPC que le jour où une `iframe` en
/// bac à sable saura l'afficher sans risque.
///
/// Le relevé est rangé au passage : c'est lui qui s'affichera à la prochaine
/// ouverture, sans attendre le réseau.
#[tauri::command]
pub async fn boite_lister(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<MessageAffiche>> {
    use tauri::Emitter;

    let compte = compte_actif(&app);
    let regles = RulesStore::pour_compte(&dossier_config(&app)?, &compte).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let boite = charger_boite_suivi(&client, &regles, &compte, |faits, total| {
        let _ = app.emit(EVENEMENT_RELEVE, Avancement { faits, total });
    })
    .await
    .inspect_err(|e| log::warn!("relevé de la boîte interrompu : {e}"))?;

    if let Ok(racine) = dossier_cache(&app) {
        cache::ranger_boite(&racine, &compte, &boite);
    }

    log::info!("{} message(s) relevé(s)", boite.len());
    Ok(boite)
}

/// Rend le dernier relevé connu du compte actif, sans toucher au réseau.
///
/// C'est ce qui s'affiche à l'ouverture, le temps que le relevé aboutisse. Rend
/// une liste vide plutôt qu'une erreur quand rien n'a encore été rangé : une
/// première ouverture n'est pas une panne.
#[tauri::command]
pub async fn boite_en_cache(app: AppHandle) -> Resultat<Vec<MessageAffiche>> {
    let racine = dossier_cache(&app)?;
    let compte = compte_actif(&app);
    let mut boite = cache::lire_boite(&racine, &compte).unwrap_or_default();

    // Les règles sont rejouées à la lecture : sans cela, une règle créée depuis
    // le dernier relevé resterait sans effet jusqu'au suivant.
    let regles = RulesStore::pour_compte(&dossier_config(&app)?, &compte).charger()?;
    cache::reclasser(&mut boite, &regles);

    log::info!("{} message(s) relus du cache", boite.len());
    Ok(boite)
}

/// Rend les relevés de tous les comptes connus, mélangés et triés par date.
///
/// C'est le compte fictif « Tous les comptes » : une vue, pas une boîte. Tout
/// vient du disque — aucun appel réseau, donc aucune attente. Les comptes qui
/// n'ont jamais été relevés n'y figurent simplement pas encore.
#[tauri::command]
pub async fn boite_melangee(app: AppHandle) -> Resultat<Vec<MessageAffiche>> {
    let dossier = dossier_config(&app)?;
    let racine = dossier_cache(&app)?;

    // Chaque boîte est reclassée avec les règles de son propre compte avant
    // d'être versée au tas commun. C'est tout l'intérêt du cloisonnement : la
    // vue mélange les messages, pas les décisions qui les concernent.
    let mut tout: Vec<MessageAffiche> = Vec::new();

    for compte in comptes::charger(&dossier).connus {
        let Some(mut boite) = cache::lire_boite(&racine, &compte.adresse) else {
            continue;
        };

        let regles = RulesStore::pour_compte(&dossier, &compte.adresse)
            .charger()
            .unwrap_or_else(|e| {
                log::warn!("règles illisibles, boîte laissée telle quelle : {e}");
                RuleSet::default()
            });

        cache::reclasser(&mut boite, &regles);
        tout.extend(boite);
    }

    // Décroissant : le plus récent en tête, comme dans chaque boîte prise
    // séparément. Une date absente part en fin de liste plutôt que de prendre
    // la première place.
    tout.sort_by(|a, b| b.date.cmp(&a.date));

    log::info!("{} message(s) dans la vue mélangée", tout.len());
    Ok(tout)
}

/// Les messages archivés depuis MailFlow, pour la table.
///
/// # Aucun appel réseau, et c'est le fond de l'affaire
///
/// Cette commande demandait à Gmail « tout ce qui n'est pas dans la boîte de
/// réception ». C'était la définition juste d'une archive au sens de Gmail — et
/// la mauvaise pour cette page : elle ramenait des messages de 2024 triés par
/// un filtre, des notifications Instagram, un courriel de ChatGPT, tout ce qui
/// a quitté la boîte depuis toujours. Deux cents appels pour couvrir la table
/// de tuiles que personne n'y avait posées.
///
/// La table est un plan de travail : on y met ce qu'on archive, on l'y classe.
/// Elle se lit donc dans le registre que le geste d'archivage écrit
/// ([`crate::archives`]), en une lecture de fichier, sans réseau et sans délai.
#[tauri::command]
pub async fn archives_lister(app: AppHandle) -> Resultat<Vec<MessageAffiche>> {
    let compte = compte_actif(&app);
    let config = dossier_config(&app)?;
    let mut archives = crate::archives::charger(&config, &compte);

    // Les règles peuvent avoir changé depuis l'archivage : la tuile doit porter
    // la même couleur que partout ailleurs.
    let regles = RulesStore::pour_compte(&config, &compte).charger()?;
    cache::reclasser(&mut archives, &regles);

    log::info!("{} message(s) sur la table des archives", archives.len());
    Ok(archives)
}

/// Requête des messages que l'utilisateur a **lui-même** classés chez Gmail.
///
/// `has:userlabels` ne retient que les libellés créés à la main : les marques du
/// système — `INBOX`, `CATEGORY_PROMOTIONS`, `IMPORTANT` — n'en sont pas. Un
/// message qui la satisfait a donc été rangé par quelqu'un, délibérément, et sa
/// place est sur la table.
///
/// C'est tout l'écart avec l'ancienne requête de cette page, qui demandait « ce
/// qui n'est pas dans la boîte » et ramenait tout ce qui en était sorti depuis
/// toujours, filtres automatiques compris.
const CLASSES_CHEZ_GMAIL: &str = "has:userlabels -in:trash -in:spam -in:draft";

/// Combien on en rapporte. Au-delà, ce n'est plus une table de travail.
const PLAFOND_CLASSES: usize = 100;

/// Fait entrer sur la table ce qui a été classé **depuis Gmail**.
///
/// # Le sens qui manquait
///
/// Nommer un tas crée un libellé chez Gmail : ce sens-là fonctionnait déjà.
/// L'autre non — un libellé posé depuis le téléphone ou depuis le web ne se
/// voyait nulle part ici, et la table prétendait classer alors qu'elle ignorait
/// la moitié du classement.
///
/// Les messages rapportés rejoignent le registre, libellés compris. Ceux qui
/// s'y trouvaient déjà sont mis à jour plutôt que dupliqués — c'est le rôle de
/// [`crate::archives::poser`] — si bien qu'un libellé retiré depuis Gmail
/// disparaît aussi de la tuile.
///
/// Rend le nombre de messages sur la table après coup.
#[tauri::command]
pub async fn archives_synchroniser(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<MessageAffiche>> {
    let compte = compte_actif(&app);
    let config = dossier_config(&app)?;
    let regles = RulesStore::pour_compte(&config, &compte).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    let classes = crate::gmail::boite::relever_requete(
        &client,
        &regles,
        &compte,
        CLASSES_CHEZ_GMAIL,
        PLAFOND_CLASSES,
    )
    .await
    .inspect_err(|e| log::warn!("classement Gmail non relu : {e}"))?;

    let mut registre = crate::archives::charger(&config, &compte);
    for message in classes {
        registre = crate::archives::poser(registre, message);
    }

    crate::archives::enregistrer(&config, &compte, &registre)?;

    let mut archives = registre;
    cache::reclasser(&mut archives, &regles);

    log::info!(
        "{} message(s) sur la table après relecture du classement Gmail",
        archives.len()
    );
    Ok(archives)
}

/// Retire un message de la table, sans toucher à Gmail.
///
/// # La différence avec « Supprimer »
///
/// Supprimer met à la corbeille : le message quitte Gmail. Retirer ne fait que
/// l'ôter du plan de travail — il reste archivé chez Gmail, ses libellés
/// compris, et se retrouve dans « Tous les messages ».
///
/// Sans ce geste, la table n'avait qu'une sortie et c'était la corbeille. On
/// n'avait donc aucun moyen de dire « celui-là est classé, je n'ai plus à m'en
/// occuper » sans le jeter.
#[tauri::command]
pub async fn archive_retirer(app: AppHandle, id: String) -> Resultat<()> {
    let config = dossier_config(&app)?;
    let compte = compte_du_message(&app, &id).unwrap_or_else(|| compte_actif(&app));

    let registre = crate::archives::retirer(crate::archives::charger(&config, &compte), &id);
    crate::archives::enregistrer(&config, &compte, &registre)?;

    log::info!("message retiré de la table, toujours archivé chez Gmail");
    Ok(())
}

/// Disposition de la table des archives du compte actif.
#[tauri::command]
pub async fn tableau_lire(app: AppHandle) -> Resultat<crate::tableau::Tableau> {
    Ok(crate::tableau::charger(
        &dossier_config(&app)?,
        &compte_actif(&app),
    ))
}

/// Enregistre la disposition de la table.
///
/// Ne porte que des positions : ce qui classe réellement les messages, ce sont
/// les libellés Gmail, posés par [`message_ranger`]. Perdre ce fichier fait
/// perdre une mise en page, jamais un rangement.
#[tauri::command]
pub async fn tableau_ecrire(app: AppHandle, tableau: crate::tableau::Tableau) -> Resultat<()> {
    crate::tableau::enregistrer(&dossier_config(&app)?, &compte_actif(&app), &tableau)
}

/// Pose un libellé sur un message déjà archivé.
///
/// C'est le geste du tableau : déposer une tuile sur un tas. Il ne faut surtout
/// pas passer par [`message_ranger`], qui retire `INBOX` — le message est déjà
/// hors de la boîte, et ce serait dire à Gmail d'archiver ce qui l'est déjà.
#[tauri::command]
pub async fn libelle_poser(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
    libelle: String,
) -> Resultat<()> {
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &id),
    );
    client.poser_libelle(&id, &libelle).await?;
    noter_le_libelle(&app, &id, |libelles| {
        if !libelles.iter().any(|l| l == &libelle) {
            libelles.push(libelle.clone());
        }
    });

    log::info!("message déposé sur un tas");
    Ok(())
}

/// Retire un libellé d'un message, sans rien archiver ni supprimer.
///
/// C'est le geste inverse du dépôt sur un tas : sortir une tuile d'une pile la
/// laisse sur la table, elle ne retourne pas dans la boîte de réception.
#[tauri::command]
pub async fn libelle_retirer(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
    libelle: String,
) -> Resultat<()> {
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &id),
    );
    client.retirer_libelle(&id, &libelle).await?;
    noter_le_libelle(&app, &id, |libelles| libelles.retain(|l| l != &libelle));

    log::info!("message sorti d'un tas");
    Ok(())
}

/// Reporte dans le registre des archives un changement de libellé.
///
/// # Ce qui se perdait sans cela
///
/// Les tas de la table **sont** des libellés Gmail, mais la tuile qu'on y
/// dépose est lue depuis le registre local. Sans ce report, le libellé était
/// bien posé chez Google — vérifiable depuis le téléphone — et pourtant le tas
/// se défaisait au redémarrage suivant : le registre, lui, n'avait rien vu
/// passer, et rendait la tuile telle qu'elle était au moment de l'archivage.
///
/// Un échec ne fait rien échouer : le libellé est posé là où il compte, chez
/// Gmail. Un relevé suivant remettra les deux d'accord.
fn noter_le_libelle(app: &AppHandle, id: &str, changer: impl FnOnce(&mut Vec<String>)) {
    let Ok(config) = dossier_config(app) else {
        return;
    };
    let compte = compte_du_message(app, id).unwrap_or_else(|| compte_actif(app));

    let registre = crate::archives::charger(&config, &compte);
    let Some(message) = registre.iter().find(|m| m.id == id) else {
        return;
    };

    let mut libelles = message.libelles.clone();
    changer(&mut libelles);

    let registre = crate::archives::noter_les_libelles(registre, id, libelles);
    if let Err(e) = crate::archives::enregistrer(&config, &compte, &registre) {
        log::warn!("libellé non reporté au registre : {e}");
    }
}

/// Défait un tas : ses messages en sortent, et le libellé disparaît de Gmail.
///
/// # L'ordre des deux opérations n'est pas indifférent
///
/// Le retrait en lot **d'abord**, la suppression du libellé **ensuite**. Si la
/// seconde échoue, les messages sont déjà sortis : la table est cohérente avec
/// ce que l'utilisateur voit, et il ne reste qu'un libellé vide qu'il peut
/// supprimer depuis Gmail. L'ordre inverse laisserait des messages étiquetés
/// d'un libellé qui n'existe plus — un état que Gmail nettoie tout seul, mais
/// que rien ici ne saurait rattraper si l'appel suivant échouait à son tour.
///
/// # Le seul geste sans retour de MailFlow
///
/// Aucun message n'est détruit, et c'est ce que la confirmation doit dire :
/// Gmail se contente de retirer l'étiquette. Mais le libellé, lui, ne se
/// restaure pas, et les messages qui le portaient **ailleurs** — dans la boîte
/// de réception, par exemple — le perdent aussi. C'est pourquoi l'interface le
/// nomme avant de l'exécuter.
///
/// Les archives appartiennent toujours au compte actif ([`archives_lister`] ne
/// relève que celui-là), d'où les jetons de session plutôt qu'une résolution
/// message par message : il n'y a ici qu'une boîte à qui parler.
#[tauri::command]
pub async fn tas_defaire(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    libelle: String,
    ids: Vec<String>,
) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    client.retirer_libelle_lot(&ids, &libelle).await?;
    client.supprimer_libelle(&libelle).await?;

    for id in &ids {
        noter_le_libelle(&app, id, |libelles| libelles.retain(|l| l != &libelle));
    }

    // Le nom du libellé n'est pas journalisé : il est écrit par l'utilisateur et
    // peut nommer un correspondant, un dossier médical, un litige.
    log::info!("tas défait, {} message(s) libéré(s)", ids.len());
    Ok(())
}

/// Tout ce que MailFlow pose sur le disque et sait refaire seul.
///
/// # Pourquoi une liste, et pourquoi celle-ci
///
/// Le bouton d'effacement ne couvrait que deux dossiers sur cinq. Il annonçait
/// 33 Mo et en laissait 51 derrière lui — le cache du moteur d'affichage, que
/// personne ne voit et que rien ne nettoie, et qui grossit à chaque image de
/// message ouverte. « Effacer » doit vouloir dire effacer.
///
/// La même liste sert à **compter** et à **effacer**. Deux listes séparées
/// auraient fini par diverger, et le bouton aurait de nouveau menti sur ce
/// qu'il libère.
///
/// # Ce qui n'y figure pas, et ne doit pas y figurer
///
/// Les comptes connus, les règles, la disposition des tables, la clé de résumé
/// dans le trousseau. Ce ne sont pas des copies de ce qui est chez Gmail : ce
/// sont les choix de l'utilisateur, quelques dizaines de kilooctets, et les
/// effacer ne nettoierait aucun disque — cela déconnecterait le compte.
fn dossiers_jetables(app: &AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    let mut dossiers = Vec::new();

    // Relevés, corps de messages, logos d'expéditeurs : tout se retélécharge.
    if let Ok(cache) = app.path().app_cache_dir() {
        dossiers.push(cache);
    }

    if let Ok(donnees) = app.path().app_local_data_dir() {
        // Le cache de WebKitGTK — les images, les feuilles de style et les
        // polices des messages ouverts. C'est de loin le plus gros, et il n'a
        // jamais été compté ni effacé.
        dossiers.push(donnees.join("WebKitCache"));
        dossiers.push(donnees.join("CacheStorage"));
        // Le journal se relit à chaque panne ; il se réécrit dès la ligne
        // suivante, et l'utilisateur qui veut « tout » nettoyer le veut aussi.
        dossiers.push(donnees.join("logs"));
    }

    dossiers
}

/// Efface tout ce qui est refaisable, tous comptes confondus.
///
/// Les échecs partiels ne sont pas remontés comme des pannes : un dossier
/// verrouillé par le moteur d'affichage sera repris au prochain passage, et
/// interrompre l'effacement au premier refus laisserait sur le disque tout ce
/// qui venait après.
#[tauri::command]
pub async fn cache_vider(app: AppHandle) -> Resultat<()> {
    let mut libere = 0;

    for dossier in dossiers_jetables(&app) {
        libere += cache::taille(&dossier);
        if let Err(e) = std::fs::remove_dir_all(&dossier)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("dossier non effacé ({}) : {e}", dossier.display());
        }
    }

    log::info!("effacement demandé, {} Mo libérés", libere / 1_048_576);
    Ok(())
}

/// Taille sur le disque de ce que le bouton d'effacement va libérer, en octets.
#[tauri::command]
pub async fn cache_taille(app: AppHandle) -> Resultat<u64> {
    Ok(dossiers_jetables(&app)
        .iter()
        .map(|d| cache::taille(d))
        .sum())
}

/// Corps d'un message, prêt à être affiché en bac à sable.
///
/// Le HTML est désinfecté ici, mais ce n'est pas ce qui protège : il est
/// destiné à une `iframe` déclarée `sandbox`, où le navigateur refuse
/// d'exécuter le moindre script. Voir [`crate::gmail::corps`].
///
/// N'est demandé que pour le message ouvert : `format=full` rapatrie le HTML
/// entier, quand le tri se contente de quelques en-têtes.
#[tauri::command]
pub async fn message_corps(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
) -> Resultat<crate::gmail::corps::CorpsMessage> {
    use crate::gmail::corps;

    // Déjà rangé : ni appel Gmail, ni images à retélécharger. Le dossier
    // survit au redémarrage de la machine — voir `crate::cache`.
    let dossier = corps::dossier_cache_dans(&app);
    if let Some(connu) = corps::lire(&dossier, &id) {
        return Ok(connu);
    }

    // Sous « Tous les comptes », ce message peut appartenir à une autre boîte
    // que celle qui est active. Le demander avec le jeton de l'actif ferait
    // répondre à Gmail qu'il ne connaît pas ce message.
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &id),
    );
    lire_le_corps(&client, &dossier, &id).await
}

/// Va chercher un corps chez Gmail, l'assainit, rapatrie ses images, le range.
///
/// Séparé de la commande pour que le préchargement puisse réutiliser un seul
/// client sur toute la boîte : `TransportHttp::nouveau` construit un client
/// HTTP, donc une réserve de connexions. En construire un par message faisait
/// repayer la poignée de main TLS soixante fois.
async fn lire_le_corps<T, J>(
    client: &ClientGmail<T, J>,
    dossier: &std::path::Path,
    id: &str,
) -> Resultat<crate::gmail::corps::CorpsMessage>
where
    T: crate::gmail::client::Transport,
    J: SourceJeton,
{
    use crate::gmail::corps;

    let message = client.message_complet(id).await?;

    let mut trouve = message
        .payload
        .as_ref()
        .map(corps::extraire)
        .unwrap_or_default();

    trouve.html = trouve.html.as_deref().map(corps::assainir);

    if let Some(html) = trouve.html.as_deref() {
        let pieces = message
            .payload
            .as_ref()
            .map(corps::pieces_par_cid)
            .unwrap_or_default();

        let table = rapatrier_les_images(client, id, html, &pieces).await;
        trouve.html = Some(corps::substituer_images(html, &table));

        // Une image intégrée au document est une pièce jointe pour Gmail, mais
        // pas pour le lecteur : elle est déjà sous ses yeux. La proposer au
        // téléchargement reviendrait à offrir d'enregistrer ce qu'il regarde.
        let integrees: std::collections::HashSet<&str> = table
            .keys()
            .filter_map(|source| pieces.get(source).map(String::as_str))
            .collect();

        trouve.pieces.retain(|p| !integrees.contains(p.id.as_str()));
    }

    log::info!(
        "corps lu : {}",
        match (&trouve.html, &trouve.texte) {
            (Some(_), _) => "html",
            (None, Some(_)) => "texte seul",
            _ => "aucun",
        }
    );
    corps::ranger(dossier, id, &trouve);
    Ok(trouve)
}

/// Enregistre une pièce jointe dans le dossier de téléchargement.
///
/// Elle est **enregistrée, jamais ouverte**. Ouvrir un fichier venu d'un e-mail
/// reviendrait à laisser un expéditeur choisir quel programme démarre sur la
/// machine — c'est précisément ce que la liste blanche de schémas interdit par
/// ailleurs. L'utilisateur ouvre lui-même ce qu'il a décidé d'enregistrer.
///
/// Le nom vient de l'expéditeur : il est assaini avant de toucher au disque.
/// `../../.bashrc` doit devenir un nom de fichier, pas un chemin.
#[tauri::command]
pub async fn piece_jointe_enregistrer(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
    nom: String,
) -> Resultat<String> {
    let dossier = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| AppError::Config(format!("dossier de téléchargement introuvable : {e}")))?;

    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &message),
    );
    let octets = client.piece_jointe(&message, &piece).await?;

    std::fs::create_dir_all(&dossier)
        .map_err(|e| AppError::Config(format!("dossier de téléchargement inutilisable : {e}")))?;

    let chemin = chemin_libre(&dossier, &nom_de_fichier_sur(&nom));

    std::fs::write(&chemin, &octets)
        .map_err(|e| AppError::Config(format!("enregistrement impossible : {e}")))?;

    log::info!("pièce jointe enregistrée, {} octets", octets.len());
    Ok(chemin.display().to_string())
}

/// Prépare l'aperçu d'une pièce jointe, sans rien écrire sur le disque.
///
/// Le fichier est demandé à Gmail puis **reconstruit** avant de partir vers
/// l'interface : une image est décodée et ré-encodée, un texte est validé, et
/// tout le reste est refusé. Voir [`crate::gmail::apercu`] pour ce que chaque
/// famille de fichiers subit au passage, et pourquoi.
///
/// Rien n'est mis en cache : l'aperçu vit le temps qu'on le regarde. C'est ce
/// qui distingue « consulter » de « garder », et l'enregistrement reste un geste
/// délibéré.
#[tauri::command]
pub async fn piece_jointe_apercu(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
) -> Resultat<Apercu> {
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &message),
    );
    let octets = client.piece_jointe(&message, &piece).await?;

    let apercu = apercu::preparer(&octets);

    log::info!(
        "aperçu préparé pour {} octets reçus : {}",
        octets.len(),
        match &apercu {
            Apercu::Image { .. } => "image ré-encodée",
            Apercu::Pdf { .. } => "pdf",
            Apercu::Texte { .. } => "texte",
            Apercu::Impossible { .. } => "aucun",
        }
    );

    Ok(apercu)
}

/// Vignette d'une pièce jointe, ou `None` quand ce n'en est pas une image.
///
/// Sert la bande de miniatures sous l'en-tête du message. Comme l'aperçu, elle
/// est décodée puis ré-encodée ici : ce qui atteint l'interface n'est jamais le
/// fichier reçu.
///
/// Rangée sur le disque, contrairement à l'aperçu. La différence n'est pas de
/// principe mais de fait : la vignette est demandée à chaque ouverture du
/// message, et une photo jointe pèse plusieurs mégaoctets qu'on ne
/// retéléchargera pas pour montrer trois centimètres carrés. Elle disparaît
/// avec le corps du message, quand celui-ci quitte la boîte.
#[tauri::command]
pub async fn piece_jointe_vignette(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    message: String,
    piece: String,
) -> Resultat<Option<String>> {
    use crate::gmail::corps;

    let dossier = corps::dossier_cache_dans(&app);

    if let Some(deja) = corps::lire_vignette(&dossier, &message, &piece) {
        return Ok(Some(deja));
    }

    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &message),
    );
    let octets = client.piece_jointe(&message, &piece).await?;

    let Some(png) = apercu::vignette(&octets) else {
        return Ok(None);
    };

    corps::ranger_vignette(&dossier, &message, &piece, &png);
    Ok(Some(png))
}

/// Réduit un nom fourni par un tiers à un nom de fichier inoffensif.
///
/// Seul le dernier segment est retenu, et les caractères qui ont un sens pour un
/// système de fichiers sont remplacés. Un nom qui ne laisserait rien devient
/// `piece-jointe`, plutôt qu'un fichier caché ou sans nom.
pub fn nom_de_fichier_sur(brut: &str) -> String {
    let dernier = brut.rsplit(['/', '\\']).next().unwrap_or(brut);

    let nettoye: String = dernier
        .chars()
        .map(|c| match c {
            // Les caractères de contrôle et ceux que Windows refuse.
            c if c.is_control() => '_',
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();

    let nettoye = nettoye.trim().trim_matches('.').trim();

    if nettoye.is_empty() {
        "piece-jointe".to_string()
    } else {
        // Les systèmes de fichiers courants s'arrêtent à 255 octets.
        nettoye.chars().take(120).collect()
    }
}

/// Un chemin qui n'écrase rien : `facture.pdf`, puis `facture (2).pdf`.
pub fn chemin_libre(dossier: &std::path::Path, nom: &str) -> PathBuf {
    let direct = dossier.join(nom);
    if !direct.exists() {
        return direct;
    }

    let (base, extension) = match nom.rsplit_once('.') {
        Some((b, e)) if !b.is_empty() => (b, format!(".{e}")),
        _ => (nom, String::new()),
    };

    // Borné : au-delà, on écrase plutôt que de boucler sans fin sur un dossier
    // qui contiendrait déjà mille homonymes.
    for n in 2..1000 {
        let essai = dossier.join(format!("{base} ({n}){extension}"));
        if !essai.exists() {
            return essai;
        }
    }
    direct
}

/// Avancement du préchargement, envoyé à l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Avancement {
    pub faits: usize,
    pub total: usize,
}

/// Nom de l'événement écouté par l'interface.
pub const EVENEMENT_PRECHARGEMENT: &str = "corps-precharges";

/// Charge d'avance le corps de tous les messages de la boîte.
///
/// L'attente est ainsi groupée au démarrage, avec une barre de progression, au
/// lieu d'être subie message par message. Les corps déjà rangés sont comptés
/// sans appel : relancer l'application ne recommence rien.
///
/// Un message qui échoue n'interrompt pas les autres : il sera simplement
/// rechargé à l'ouverture.
#[tauri::command]
pub async fn corps_precharger(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    ids: Vec<String>,
) -> Resultat<usize> {
    use crate::gmail::corps;
    use tauri::Emitter;

    use futures_util::StreamExt;

    let dossier = corps::dossier_cache_dans(&app);
    let total = ids.len();

    // Les corps déjà rangés sont écartés ici, sur la seule présence du fichier :
    // les lire pour savoir qu'ils existent reviendrait à décoder soixante
    // documents pour rien.
    let (a_lire, deja): (Vec<String>, Vec<String>) = ids
        .into_iter()
        .partition(|id| !corps::chemin_cache(&dossier, id).exists());

    // Les corps déjà rangés sont comptés sans appel : relancer l'application ne
    // recommence rien, mais la barre doit tout de même partir d'où il faut.
    let mut faits = deja.len();
    let _ = app.emit(EVENEMENT_PRECHARGEMENT, Avancement { faits, total });

    // Sous « Tous les comptes », la liste mêle les boîtes. On regroupe donc par
    // compte : un client, donc un jeton, par boîte visée. Tout demander avec le
    // jeton de l'actif ne rapporterait que les siens, et les autres seraient
    // rechargés un à un — chacun échouant à son tour — à chaque ouverture.
    let actif = compte_actif(&app);
    let proprietaires = comptes_des_messages(&app);

    let mut par_compte: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();

    for id in a_lire {
        let compte = proprietaires
            .get(&id)
            .cloned()
            .unwrap_or_else(|| actif.clone());
        par_compte.entry(compte).or_default().push(id);
    }

    for (compte, ids) in par_compte {
        // Un seul client par boîte, et non un par message : voir
        // [`lire_le_corps`].
        let client = ClientGmail::nouveau(
            TransportHttp::nouveau()?,
            jetons_pour(&etat, &actif, Some(&compte)),
        );

        // Même parallélisme que le relevé, pour la même raison : c'est la
        // latence qui domine, pas le débit. Chaque corps entraîne en outre le
        // rapatriement de ses images, qui a déjà son propre plafond dans
        // `gmail::logos`.
        let mut lectures = futures_util::stream::iter(ids)
            .map(|id| {
                let dossier = &dossier;
                let client = &client;
                async move {
                    // Un corps illisible n'arrête pas les autres : il sera
                    // simplement rechargé à l'ouverture du message.
                    if let Err(e) = lire_le_corps(client, dossier, &id).await {
                        log::info!("corps de {id} non préchargé : {e}");
                    }
                }
            })
            .buffered(crate::gmail::boite::PARALLELISME);

        while lectures.next().await.is_some() {
            faits += 1;
            let _ = app.emit(EVENEMENT_PRECHARGEMENT, Avancement { faits, total });
        }
    }

    // Le dossier des corps ne se vidait jamais de lui-même. C'est le moment de
    // le faire : la boîte vient d'être relevée, on sait donc exactement quels
    // messages existent encore.
    oublier_les_corps_sans_message(&app, &dossier);

    log::info!("{faits} corps de message prêts");
    Ok(faits)
}

/// Efface les corps dont plus aucune boîte ne parle.
///
/// La liste des messages vivants est prise sur **tous** les comptes connus, et
/// non sur le seul compte courant : autrement, chaque bascule de compte
/// effacerait le cache de l'autre, et la bascule redeviendrait l'attente qu'on
/// cherche justement à supprimer.
///
/// Purement opportuniste : si l'annuaire ou un relevé sont illisibles, on ne
/// supprime rien. Garder un fichier de trop est sans conséquence ; en effacer un
/// qui servait encore se paierait en attente.
fn oublier_les_corps_sans_message(app: &AppHandle, dossier_corps: &std::path::Path) {
    let (Ok(config), Ok(racine)) = (dossier_config(app), dossier_cache(app)) else {
        return;
    };

    let mut vivants = std::collections::HashSet::new();
    for compte in comptes::charger(&config).connus {
        let Some(boite) = cache::lire_boite(&racine, &compte.adresse) else {
            // Un compte dont le relevé n'est pas en cache a peut-être des corps
            // rangés : on renonce au nettoyage plutôt que de les prendre pour
            // des orphelins.
            return;
        };
        vivants.extend(boite.into_iter().map(|m| m.id));
    }

    crate::gmail::corps::oublier_les_absents(dossier_corps, &vivants);
}

/// Rapatrie les images d'un message et les rend indexées par leur `src`.
///
/// Tout passe par Rust, jamais par le webview. Deux raisons : la politique de
/// sécurité du cadre d'affichage lui interdit toute requête sortante, et une
/// requête émise depuis le webview emporterait cookies et empreinte de
/// navigateur — le serveur d'en face en apprendrait bien plus que l'ouverture
/// du message.
///
/// Ce que ça coûte reste réel : l'expéditeur apprend l'adresse IP et l'heure de
/// lecture. C'est le comportement d'un client mail ordinaire, choisi
/// explicitement.
///
/// Une image qu'on ne sait pas rapatrier n'entre pas dans la table : son texte
/// de remplacement s'affichera, ce qui vaut mieux qu'un cadre vide.
async fn rapatrier_les_images<T, J>(
    client: &ClientGmail<T, J>,
    message: &str,
    html: &str,
    pieces: &std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String>
where
    T: crate::gmail::client::Transport,
    J: SourceJeton,
{
    use crate::gmail::logos::{TAILLE_MAX_IMAGE, en_data_uri, image_distante};

    let sources = crate::gmail::corps::sources_d_images(html);
    if sources.is_empty() {
        return std::collections::HashMap::new();
    }

    let mut table = std::collections::HashMap::new();
    let mut distantes = Vec::new();

    for source in sources {
        match pieces.get(&source) {
            // Jointe au message : rien de tiers n'est contacté.
            Some(piece) => {
                if let Ok(octets) = client.piece_jointe(message, piece).await
                    && let Some(uri) = en_data_uri(&octets, TAILLE_MAX_IMAGE)
                {
                    table.insert(source, uri);
                }
            }
            None if source.starts_with("https://") => distantes.push(source),
            // `http://` en clair et `cid:` sans pièce : rien à aller chercher.
            None => {}
        }
    }

    // Un client HTTP indisponible n'est pas une raison de perdre les images
    // déjà intégrées : on rend ce qu'on a.
    if let (false, Ok(http)) = (distantes.is_empty(), client_http()) {
        for paquet in distantes.chunks(IMAGES_DE_FRONT) {
            let mut travaux = tokio::task::JoinSet::new();
            for url in paquet {
                let (http, url) = (http.clone(), url.clone());
                travaux.spawn(async move {
                    let uri = image_distante(&http, &url, TAILLE_MAX_IMAGE).await;
                    (url, uri)
                });
            }
            while let Some(Ok((url, Some(uri)))) = travaux.join_next().await {
                table.insert(url, uri);
            }
        }
    }

    log::info!("{} image(s) intégrée(s) au message", table.len());
    table
}

/// Images distantes demandées de front. Bornées : ce sont des serveurs tiers.
const IMAGES_DE_FRONT: usize = 6;

/// Un libellé Gmail, tel que l'interface le propose.
#[derive(Debug, Serialize)]
pub struct LibelleAffiche {
    pub id: String,
    pub nom: String,
}

/// Libellés créés par l'utilisateur, par ordre alphabétique.
#[tauri::command]
pub async fn libelles_lister(etat: State<'_, EtatAuth>) -> Resultat<Vec<LibelleAffiche>> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });

    Ok(client
        .libelles()
        .await?
        .into_iter()
        .map(|l| LibelleAffiche {
            id: l.id,
            nom: l.name,
        })
        .collect())
}

/// Crée un libellé Gmail et rend la liste complète, à jour.
///
/// Rendre la liste plutôt qu'un accusé : l'interface se réaffiche à partir de
/// ce que Gmail connaît réellement, au lieu d'entretenir sa propre copie qui
/// finirait par diverger.
#[tauri::command]
pub async fn libelle_creer(
    etat: State<'_, EtatAuth>,
    nom: String,
) -> Resultat<Vec<LibelleAffiche>> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let cree = client.creer_libelle(&nom).await?;

    log::info!("libellé créé");
    Ok(client
        .libelles()
        .await
        .unwrap_or_else(|_| vec![cree])
        .into_iter()
        .map(|l| LibelleAffiche {
            id: l.id,
            nom: l.name,
        })
        .collect())
}

/// Range un message sous un libellé, ou l'archive simplement.
///
/// # Le libellé traverse la frontière des comptes
///
/// L'interface propose les libellés du compte actif, et n'en connaît pas
/// d'autres. Sous « Tous les comptes », ranger un message reçu ailleurs
/// enverrait donc à Gmail l'identifiant d'un libellé qui n'existe pas dans
/// cette boîte-là — un identifiant Gmail n'a de sens que dans le compte qui l'a
/// émis.
///
/// L'identifiant est donc traduit en **nom**, puis retrouvé ou créé sous ce nom
/// dans la boîte visée. C'est ce que l'utilisateur veut dire : « range ceci dans
/// mes Factures » désigne les Factures de la boîte concernée, pas un numéro.
#[tauri::command]
pub async fn message_ranger(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
    libelle: Option<String>,
) -> Resultat<()> {
    let actif = compte_actif(&app);
    let proprietaire = compte_du_message(&app, &id);
    let ailleurs = compte_a_viser(&actif, proprietaire.as_deref()).is_some();

    // Archiver depuis la vue mélangée doit agir sur la boîte qui a reçu le
    // message, pas sur celle qui est active.
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_pour(&etat, &actif, proprietaire.as_deref()),
    );

    let vise = match libelle {
        Some(origine) if ailleurs => {
            let chez_l_actif =
                ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
            transposer_le_libelle(&chez_l_actif, &client, &origine).await?
        }
        autre => autre,
    };

    client
        .ranger(std::slice::from_ref(&id), vise.as_deref())
        .await?;

    // Le geste d'archivage **est** ce qui remplit la table.
    //
    // Elle demandait auparavant à Gmail « tout ce qui n'est pas dans la boîte »,
    // ce qui ramenait des messages de 2024 triés par un filtre, des
    // notifications Instagram, un courriel de ChatGPT — des centaines de choses
    // que personne n'avait posées là. Une table de travail montre ce qu'on y a
    // mis, sinon elle n'est pas une table de travail.
    let compte = proprietaire.unwrap_or(actif);
    inscrire_aux_archives(&app, &compte, &id, vise.as_deref());

    log::info!("message rangé hors de la boîte de réception");
    Ok(())
}

/// Inscrit au registre des archives le message qu'on vient de ranger.
///
/// Le message est repris du relevé en cache plutôt que redemandé à Gmail : il
/// est sous les yeux de l'utilisateur à la seconde où il clique, un appel de
/// plus n'apprendrait rien et ferait attendre.
///
/// Un échec n'interrompt rien : le message est déjà archivé chez Gmail, et
/// c'est ce qui compte. Il manquera sur la table, ce qui se répare en le
/// réarchivant — bien moins grave qu'une erreur devant un geste qui a réussi.
fn inscrire_aux_archives(app: &AppHandle, compte: &str, id: &str, libelle: Option<&str>) {
    let (Ok(config), Ok(cache_racine)) = (dossier_config(app), dossier_cache(app)) else {
        return;
    };

    let Some(mut message) = cache::lire_boite(&cache_racine, compte)
        .unwrap_or_default()
        .into_iter()
        .find(|m| m.id == id)
    else {
        log::info!("message archivé absent du relevé en cache, pas inscrit à la table");
        return;
    };

    // Le libellé posé du même geste : sans lui, la tuile arriverait seule sur
    // la table alors qu'elle appartient déjà à un tas.
    if let Some(pose) = libelle
        && !message.libelles.iter().any(|l| l == pose)
    {
        message.libelles.push(pose.to_string());
    }

    let registre = crate::archives::poser(crate::archives::charger(&config, compte), message);
    if let Err(e) = crate::archives::enregistrer(&config, compte, &registre) {
        log::warn!("registre des archives non écrit : {e}");
    }
}

/// Retrouve, dans la boîte visée, le libellé que l'utilisateur a désigné dans
/// celle qu'il regardait.
///
/// Rend `None` — donc « archiver sans libellé » — plutôt que d'échouer quand la
/// correspondance ne se fait pas : le geste demandé était d'abord de sortir le
/// message de la boîte de réception, et le manquer entièrement pour un libellé
/// introuvable serait la mauvaise moitié à sacrifier.
async fn transposer_le_libelle<T, J, T2, J2>(
    origine: &ClientGmail<T, J>,
    cible: &ClientGmail<T2, J2>,
    identifiant: &str,
) -> Resultat<Option<String>>
where
    T: crate::gmail::client::Transport,
    J: SourceJeton,
    T2: crate::gmail::client::Transport,
    J2: SourceJeton,
{
    let Some(nom) = origine
        .libelles()
        .await?
        .into_iter()
        .find(|l| l.id == identifiant)
        .map(|l| l.name)
    else {
        log::warn!("libellé introuvable dans le compte actif, message simplement archivé");
        return Ok(None);
    };

    // La comparaison ignore la casse : Gmail refuse deux libellés dont les noms
    // ne diffèrent que par elle, et en créer un second échouerait.
    if let Some(deja) = cible
        .libelles()
        .await?
        .into_iter()
        .find(|l| l.name.eq_ignore_ascii_case(&nom))
    {
        return Ok(Some(deja.id));
    }

    log::info!("libellé créé dans la boîte visée pour y ranger le message");
    Ok(Some(cible.creer_libelle(&nom).await?.id))
}

/// Ouvre un brouillon de réponse dans le client de courrier du système.
///
/// MailFlow n'a pas — et ne demande pas — le droit d'envoyer du courrier en
/// votre nom : la portée `gmail.send` est écartée depuis le début. La réponse
/// s'écrit donc là où l'utilisateur écrit déjà son courrier, et part de son
/// compte, pas du nôtre.
#[tauri::command]
pub async fn repondre_au_message(
    destinataire: String,
    sujet: String,
    // Renseignée par « Répondre à tous », vide par « Répondre ». Le frontend a
    // seul de quoi la calculer : il sait quelle adresse est celle du compte, et
    // ne doit pas se répondre à lui-même.
    copies: Option<Vec<String>>,
) -> Resultat<()> {
    let url = url_mailto(&destinataire, &sujet, &copies.unwrap_or_default())?;

    // Même chemin que les liens : depuis une AppImage, le client de courrier
    // hériterait des bibliothèques embarquées et ne démarrerait pas.
    crate::sortie::ouvrir(&url)?;

    log::info!("brouillon de réponse ouvert dans le client du système");
    Ok(())
}

/// Vrai quand la chaîne peut servir d'adresse dans un `mailto:`.
///
/// Les chevrons sont refusés parce qu'ils marquent la frontière entre nom
/// affiché et adresse : les laisser passer permettrait de glisser une seconde
/// adresse dans un champ qui n'en attend qu'une.
fn adresse_utilisable(adresse: &str) -> bool {
    !adresse.is_empty() && adresse.contains('@') && !adresse.contains(['<', '>'])
}

/// Construit un `mailto:` à partir d'une adresse, d'un sujet et des copies.
///
/// Le sujet vient d'un tiers : il passe par l'encodage de requête, sans quoi un
/// `&` ou un saut de ligne y ajouterait des champs — `bcc`, `body` — que
/// l'utilisateur n'a pas voulus. Les adresses en copie viennent du même endroit
/// et subissent le même traitement.
fn url_mailto(destinataire: &str, sujet: &str, copies: &[String]) -> Resultat<String> {
    let destinataire = destinataire.trim();
    if !adresse_utilisable(destinataire) {
        return Err(AppError::Config("adresse de réponse inutilisable".into()));
    }

    let encoder = |v: &str| url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>();
    let sujet = sujet.trim();
    let prefixe = if sujet.to_lowercase().starts_with("re:") || sujet.is_empty() {
        String::new()
    } else {
        "Re: ".to_string()
    };

    let mut url = format!(
        "mailto:{}?subject={}",
        encoder(destinataire),
        encoder(&format!("{prefixe}{sujet}"))
    );

    // Une adresse illisible est écartée plutôt que de faire échouer la réponse
    // entière : mieux vaut un destinataire en copie de moins qu'un bouton qui
    // ne fait rien.
    let copies: Vec<&str> = copies
        .iter()
        .map(|c| c.trim())
        .filter(|c| adresse_utilisable(c) && !c.eq_ignore_ascii_case(destinataire))
        .collect();

    if !copies.is_empty() {
        url.push_str("&cc=");
        url.push_str(&encoder(&copies.join(",")));
    }

    Ok(url)
}

/// Demande à GitHub s'il existe une version plus récente.
///
/// Rien n'est téléchargé ni installé : la commande rend un constat, et c'est
/// l'utilisateur qui décide d'aller voir. La mise à jour silencieuse
/// supposerait une paire de clés de signature — voir [`crate::maj`].
#[tauri::command]
pub async fn maj_verifier(app: AppHandle) -> Resultat<crate::maj::Verification> {
    let verification = crate::maj::verifier(&app.package_info().version.to_string()).await?;

    log::info!(
        "mise à jour : publiée={:?}, disponible={}",
        verification.version_publiee,
        verification.disponible
    );
    Ok(verification)
}

/// Ouvre dans le navigateur du système un lien cliqué dans un message.
///
/// # Pourquoi cette commande existe
///
/// Le corps d'un message s'affiche dans un cadre en bac à sable, sans
/// `allow-scripts` ni `allow-popups`. Un clic sur un lien n'y produisait donc
/// rien du tout : la fenêtre surgissante est refusée par le moteur, et le
/// garde-fou de navigation de l'application ne voit pas les navigations de
/// sous-cadre. L'interception se fait maintenant côté application — voir
/// `CadreIsole` — et aboutit ici.
///
/// # Ce qui est vérifié
///
/// L'adresse vient d'un e-mail, c'est-à-dire de n'importe qui, et elle a
/// traversé l'IPC. Elle est donc soumise à la même liste blanche de schémas que
/// tout ce qui sort vers le système : `http`, `https`, `mailto`. Sans quoi un
/// expéditeur choisirait quel programme démarre sur la machine — `file://` sur
/// un dossier local, un schéma déposé par une application installée, ou pire.
///
/// Une adresse relative n'a pas de sens hors de son site d'origine : elle ne
/// s'analyse pas et se voit refusée, plutôt que d'être devinée.
#[tauri::command]
pub async fn lien_ouvrir(url: String) -> Resultat<()> {
    let sortie = tauri::Url::parse(&url)
        .ok()
        .filter(crate::sortie_autorisee)
        .ok_or_else(|| {
            log::warn!("lien de message refusé : schéma non autorisé ou adresse relative");
            AppError::Config("Ce lien ne peut pas être ouvert.".into())
        })?;

    // Le journal ne porte que le schéma et l'hôte : une adresse complète de
    // newsletter contient couramment un identifiant de suivi, et parfois
    // l'adresse de l'utilisateur en clair.
    log::info!(
        "lien de message ouvert : {}://{}",
        sortie.scheme(),
        sortie.host_str().unwrap_or("-")
    );

    // Passe par `crate::sortie` et non par le greffon : depuis une AppImage,
    // l'enfant hériterait des bibliothèques embarquées et mourrait au
    // démarrage, sans un mot. Voir le module pour le détail.
    crate::sortie::ouvrir(sortie.as_str())
}

/// Ouvre la page d'une publication dans le navigateur du système.
///
/// L'adresse n'est pas reçue du frontend mais redemandée à GitHub : une adresse
/// qui traverserait l'IPC pourrait être remplacée en chemin, et ce bouton
/// ouvrirait alors une page choisie par quelqu'un d'autre.
#[tauri::command]
pub async fn maj_ouvrir(app: AppHandle) -> Resultat<()> {
    let verification = crate::maj::verifier(&app.package_info().version.to_string()).await?;

    let Some(adresse) = verification.adresse else {
        return Err(AppError::Reseau("aucune version publiée".into()));
    };

    // L'adresse vient de la réponse de GitHub. Elle est donc extérieure, et
    // passe par la même garde que les liens d'e-mail : la confiance accordée à
    // une source ne dispense pas de vérifier ce qu'elle envoie.
    let sortie = tauri::Url::parse(&adresse)
        .ok()
        .filter(crate::sortie_autorisee)
        .ok_or_else(|| AppError::Reseau("adresse de publication inattendue".into()))?;

    crate::sortie::ouvrir(sortie.as_str())
}

/// Met un message à la corbeille.
///
/// Le geste du bouton Supprimer de Gmail : le message quitte la boîte et reste
/// récupérable trente jours. Rien n'est détruit — la suppression définitive
/// demanderait une autorisation Google bien plus large, pour un geste sur
/// lequel on ne peut pas revenir.
#[tauri::command]
pub async fn message_corbeille(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
) -> Resultat<()> {
    // Supprimer depuis la vue mélangée doit atteindre la bonne boîte : avec le
    // jeton de l'actif, Gmail ne trouvait pas le message et le geste échouait
    // sans que la tuile disparaisse.
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &id),
    );
    client.mettre_a_la_corbeille(&id).await?;

    // Il quitte aussi la table : proposer de classer un message qui n'existe
    // plus serait une invitation à un geste sans effet.
    if let Ok(config) = dossier_config(&app) {
        let compte = compte_du_message(&app, &id).unwrap_or_else(|| compte_actif(&app));
        let registre = crate::archives::retirer(crate::archives::charger(&config, &compte), &id);
        let _ = crate::archives::enregistrer(&config, &compte, &registre);
    }

    log::info!("message mis à la corbeille");
    Ok(())
}

/// Marque un message comme lu chez Gmail.
///
/// C'est la seule commande qui modifie la boîte sans passer par une règle. Le
/// geste est celui de l'utilisateur — il vient d'ouvrir le message — et Gmail
/// sait remettre un message en non-lu.
///
/// À noter : MailFlow n'affiche que l'extrait fourni par Gmail, jamais le corps.
/// Ouvrir un message ici en dit donc moins que l'ouvrir dans Gmail, mais le
/// marque tout autant comme lu.
#[tauri::command]
pub async fn message_marquer_lu(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    id: String,
) -> Resultat<()> {
    let client = ClientGmail::nouveau(
        TransportHttp::nouveau()?,
        jetons_du_message(&app, &etat, &id),
    );
    client.marquer_lu(&[id]).await
}

/// Adresse du compte relié, ou `None` si aucun ne l'est.
///
/// Séparée de `app_health` : celle-ci s'appelle à chaque rafraîchissement, y
/// compris hors connexion, et n'a pas à consommer du quota Gmail pour ça.
#[tauri::command]
pub async fn compte_adresse(etat: State<'_, EtatAuth>) -> Resultat<Option<String>> {
    if !etat.session.lock().await.est_connecte()? {
        return Ok(None);
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.adresse_du_compte().await.map(Some)
}

/// Un compte connu de l'annuaire, tel que l'interface le liste.
#[derive(Debug, Serialize)]
pub struct CompteConnu {
    pub adresse: String,
    pub nom: Option<String>,
    /// URI de données, jamais une adresse distante.
    pub photo: Option<String>,
    pub actif: bool,
}

/// Comptes déjà autorisés, le premier étant l'actif.
///
/// Ne consomme aucun quota et ne touche pas au réseau : la liste vient du
/// fichier d'annuaire, les jetons restent dans le trousseau.
#[tauri::command]
pub async fn comptes_lister(app: AppHandle) -> Resultat<Vec<CompteConnu>> {
    let annuaire = comptes::charger(&dossier_config(&app)?);
    Ok(en_liste(&annuaire))
}

fn en_liste(annuaire: &Annuaire) -> Vec<CompteConnu> {
    let mut liste: Vec<CompteConnu> = annuaire
        .connus
        .iter()
        .map(|c| CompteConnu {
            adresse: c.adresse.clone(),
            nom: c.nom.clone(),
            photo: c.photo.clone(),
            actif: annuaire.actif.as_deref() == Some(c.adresse.as_str()),
        })
        .collect();

    // L'actif d'abord : c'est celui dont l'interface parle au présent.
    liste.sort_by_key(|c| !c.actif);
    liste
}

/// Bascule sur un compte déjà autorisé, sans repasser par Google.
///
/// C'est tout l'intérêt de garder les jetons : l'utilisateur retrouve son autre
/// boîte immédiatement, sans navigateur ni mot de passe.
#[tauri::command]
pub async fn compte_basculer(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    adresse: String,
) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);
    identifier_l_actif(&etat, &mut annuaire).await;

    let mut session = etat.session.lock().await;
    session.basculer(|secrets| comptes::basculer(secrets, &mut annuaire, &adresse))?;
    comptes::ecrire(&dossier, &annuaire)?;

    log::info!("compte actif changé");
    Ok(())
}

/// Complète l'annuaire quand il ignore à qui appartient le jeton en place.
///
/// L'annuaire peut perdre ce renseignement — un ajout de compte interrompu, une
/// installation antérieure à son existence. Sans lui, déplacer le jeton actif
/// reviendrait à le détruire. Gmail, lui, sait toujours répondre : une unité de
/// quota vaut mieux qu'un compte perdu.
async fn identifier_l_actif(etat: &State<'_, EtatAuth>, annuaire: &mut Annuaire) {
    if annuaire.actif.is_some() {
        return;
    }
    let Ok(true) = etat.session.lock().await.est_connecte() else {
        return;
    };

    let client = match TransportHttp::nouveau() {
        Ok(t) => ClientGmail::nouveau(t, JetonsDeSession { etat }),
        Err(_) => return,
    };

    if let Ok(adresse) = client.adresse_du_compte().await {
        log::info!("compte actif identifié auprès de Gmail");
        annuaire.retenir(&adresse, None, None);
    }
}

/// Met le compte actif de côté et lance l'autorisation d'un autre.
///
/// Le jeton du compte courant n'est pas révoqué : on veut pouvoir y revenir
/// d'un clic. C'est la différence avec `google_deconnecter`, qui, lui, rend
/// l'autorisation à Google.
#[tauri::command]
pub async fn compte_ajouter(app: AppHandle, etat: State<'_, EtatAuth>) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);
    identifier_l_actif(&etat, &mut annuaire).await;

    {
        let mut session = etat.session.lock().await;
        session.basculer(|secrets| comptes::mettre_de_cote(secrets, &mut annuaire))?;
    }
    comptes::ecrire(&dossier, &annuaire)?;

    // Si l'autorisation échoue ou est refusée, l'application se retrouve sans
    // compte actif — mais l'ancien est en réserve, et la liste le propose
    // toujours. Rien n'est perdu.
    google_connecter(etat).await
}

/// Retire un compte de la liste et efface son autorisation.
///
/// Refuse le compte actif : le déconnecter passe par `google_deconnecter`, qui
/// rend aussi l'autorisation à Google.
#[tauri::command]
pub async fn compte_oublier(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
    adresse: String,
) -> Resultat<()> {
    let dossier = dossier_config(&app)?;
    let mut annuaire = comptes::charger(&dossier);

    if annuaire.actif.as_deref() == Some(adresse.trim().to_lowercase().as_str()) {
        return Err(AppError::Auth(
            "ce compte est le compte actif : déconnectez-le d'abord".into(),
        ));
    }

    let cle = comptes::cle_compte(&adresse);
    let jeton = etat.session.lock().await.secret(&cle)?;

    // Effacé localement quoi qu'il arrive : laisser l'entrée derrière soi
    // signifierait qu'un compte « oublié » garde une autorisation vivante.
    etat.session.lock().await.effacer_secret(&cle)?;
    annuaire.oublier(&adresse);
    comptes::ecrire(&dossier, &annuaire)?;

    // Les règles suivent le compte : les garder ferait ressurgir de vieilles
    // automatisations le jour où la même adresse serait rebranchée, sans que
    // personne ne se souvienne les avoir posées. Un échec ici ne remet pas en
    // cause le retrait du compte, qui est déjà fait.
    if let Err(e) = RulesStore::pour_compte(&dossier, &adresse).effacer() {
        log::warn!("règles du compte retiré non effacées : {e}");
    }

    if let (Some(jeton), Ok(client)) = (jeton, etat.client())
        && let Err(e) = client.revoquer(&jeton).await
    {
        log::warn!("révocation côté Google impossible : {e}");
    }

    log::info!("compte retiré de la liste");
    Ok(())
}

/// Qui est relié : adresse, nom affiché, photo.
#[derive(Debug, Default, serde::Serialize)]
pub struct ProfilCompte {
    pub adresse: String,
    pub nom: Option<String>,
    /// URI de données, jamais une adresse distante : la politique de sécurité
    /// de l'interface interdit les origines externes dans une balise `<img>`.
    pub photo: Option<String>,
}

/// Profil du compte relié, ou `None` si aucun ne l'est.
///
/// Le nom et la photo ne sont pas indispensables : s'ils manquent — compte sans
/// photo, autorisation accordée avant l'ajout de la portée `profile`, réseau
/// capricieux — l'adresse est rendue seule et l'interface retombe sur le logo
/// Google. Échouer ici priverait l'utilisateur de l'information principale pour
/// une décoration.
#[tauri::command]
pub async fn compte_profil(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Option<ProfilCompte>> {
    if !etat.session.lock().await.est_connecte()? {
        return Ok(None);
    }

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let adresse = client.adresse_du_compte().await?;

    let Ok(infos) = client.renseignements_du_compte().await else {
        log::info!("renseignements du compte indisponibles, adresse seule");
        retenir_le_compte(&app, &adresse, None, None);
        return Ok(Some(ProfilCompte {
            adresse,
            ..Default::default()
        }));
    };

    // C'est le seul endroit où l'adresse du compte relié est connue : c'est
    // donc ici que l'annuaire apprend qu'il existe, sans quoi la bascule ne
    let photo = match infos.picture.as_deref() {
        Some(url) => {
            let http = client_http()?;
            crate::gmail::logos::image_distante(&http, url, crate::gmail::logos::TAILLE_MAX_IMAGE)
                .await
        }
        None => None,
    };

    // C'est le seul endroit où l'on connaît à la fois l'adresse, le nom et la
    // photo du compte relié : c'est donc ici que l'annuaire les apprend, sans
    // quoi la liste des comptes n'aurait jamais rien à montrer.
    retenir_le_compte(&app, &adresse, infos.name.clone(), photo.clone());

    log::info!(
        "profil du compte lu, photo {}",
        if photo.is_some() {
            "comprise"
        } else {
            "absente"
        }
    );
    Ok(Some(ProfilCompte {
        adresse,
        nom: infos.name,
        photo,
    }))
}

/// Note le compte actif dans l'annuaire.
///
/// Sans conséquence en cas d'échec : l'annuaire est un confort, pas une
/// condition d'accès à la boîte. Faire échouer l'affichage du profil parce que
/// le disque est plein serait disproportionné.
fn retenir_le_compte(app: &AppHandle, adresse: &str, nom: Option<String>, photo: Option<String>) {
    let Ok(dossier) = dossier_config(app) else {
        return;
    };

    let mut annuaire = comptes::charger(&dossier);
    let deja_a_jour = annuaire.actif.as_deref() == Some(adresse)
        && annuaire.est_connu(adresse)
        && nom.is_none()
        && photo.is_none();
    if deja_a_jour {
        return;
    }

    annuaire.retenir(adresse, nom, photo);
    if let Err(e) = comptes::ecrire(&dossier, &annuaire) {
        log::warn!("annuaire des comptes non enregistré : {e}");
    }
}

/// Client HTTP pour les images : hors API, sans jeton, HTTPS obligatoire.
fn client_http() -> Resultat<reqwest::Client> {
    reqwest::Client::builder()
        .https_only(true)
        .build()
        .map_err(|e| AppError::Config(format!("client HTTP inutilisable : {e}")))
}

/// Logos des expéditeurs, un par domaine.
///
/// Chaque logo est demandé au domaine de l'expéditeur, jamais à un service
/// tiers : un agrégateur d'icônes apprendrait la liste complète des
/// correspondants de l'utilisateur. Voir [`crate::gmail::logos`].
#[tauri::command]
pub async fn logos_expediteurs(
    app: AppHandle,
    adresses: Vec<String>,
) -> Resultat<std::collections::HashMap<String, String>> {
    let domaines: std::collections::BTreeSet<String> = adresses
        .iter()
        .filter_map(|a| crate::gmail::logos::domaine(a))
        .map(str::to_string)
        .collect();

    let dossier = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Config(format!("dossier de cache introuvable : {e}")))?
        .join("logos");

    let http = client_http()?;

    let trouves =
        crate::gmail::logos::logos(&http, &dossier, &domaines.into_iter().collect::<Vec<_>>())
            .await?;

    log::info!("{} logo(s) d'expéditeur disponibles", trouves.len());
    Ok(trouves)
}

#[cfg(test)]
mod tests {
    use super::url_mailto;

    /// Réponse simple : sans personne en copie.
    fn mailto(destinataire: &str, sujet: &str) -> crate::error::Resultat<String> {
        url_mailto(destinataire, sujet, &[])
    }

    fn copies(liste: &[&str]) -> Vec<String> {
        liste.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn le_sujet_est_prefixe_une_seule_fois() {
        let url = mailto("a@b.fr", "Disponibilités").unwrap();

        assert!(url.contains("subject=Re%3A+Disponibilit"), "{url}");
        assert!(
            !mailto("a@b.fr", "Re: déjà")
                .unwrap()
                .contains("Re%3A+Re%3A")
        );
    }

    #[test]
    fn un_sujet_hostile_n_ajoute_pas_de_champs() {
        // Sans encodage, ce sujet glisserait une copie cachée dans le brouillon
        // que l'utilisateur s'apprête à envoyer.
        let url = mailto("a@b.fr", "Bonjour&bcc=espion@ailleurs.fr").unwrap();

        assert!(!url.contains("&bcc="), "{url}");
    }

    #[test]
    fn une_adresse_inutilisable_est_refusee() {
        // Mieux vaut le dire que d'ouvrir un client de courrier sur un vide.
        assert!(mailto("", "x").is_err());
        assert!(mailto("sans-arobase", "x").is_err());
        assert!(mailto("Nom <a@b.fr>", "x").is_err());
    }

    #[test]
    fn repondre_a_tous_place_les_autres_en_copie() {
        let url = url_mailto("a@b.fr", "Réunion", &copies(&["c@d.fr", "e@f.fr"])).unwrap();

        assert!(url.starts_with("mailto:a%40b.fr?"), "{url}");
        assert!(url.contains("&cc=c%40d.fr%2Ce%40f.fr"), "{url}");
    }

    #[test]
    fn le_destinataire_principal_ne_se_retrouve_pas_aussi_en_copie() {
        // Il est souvent dans le `To` d'origine : l'y laisser lui enverrait deux
        // fois la même réponse.
        let url = url_mailto("a@b.fr", "x", &copies(&["A@B.fr", "c@d.fr"])).unwrap();

        assert_eq!(url.matches("a%40b.fr").count(), 1, "{url}");
        assert!(url.contains("&cc=c%40d.fr"), "{url}");
    }

    #[test]
    fn une_copie_illisible_est_ecartee_sans_faire_echouer_la_reponse() {
        let url = url_mailto("a@b.fr", "x", &copies(&["Nom <c@d.fr>", "e@f.fr"])).unwrap();

        assert!(url.contains("&cc=e%40f.fr"), "{url}");
        assert!(!url.contains("Nom"), "{url}");
    }

    #[test]
    fn sans_copie_valable_aucun_champ_cc_n_est_ajoute() {
        let url = url_mailto("a@b.fr", "x", &copies(&["a@b.fr"])).unwrap();

        assert!(!url.contains("&cc="), "{url}");
    }
}

#[cfg(test)]
mod tests_pieces_jointes {
    use super::{chemin_libre, nom_de_fichier_sur};

    #[test]
    fn un_nom_ordinaire_est_conserve() {
        assert_eq!(
            nom_de_fichier_sur("Facture été 2026.pdf"),
            "Facture été 2026.pdf"
        );
    }

    #[test]
    fn un_nom_ne_peut_pas_sortir_du_dossier() {
        // Le nom vient de l'expéditeur : c'est la seule chaîne de ce module qui
        // désigne un fichier sans que l'utilisateur l'ait tapée.
        for hostile in [
            "../../.bashrc",
            "../../../etc/passwd",
            "..\\..\\Windows\\System32\\cmd.exe",
            "/etc/shadow",
        ] {
            let sur = nom_de_fichier_sur(hostile);
            assert!(
                !sur.contains('/') && !sur.contains('\\') && !sur.starts_with('.'),
                "« {hostile} » a donné « {sur} »"
            );
        }
    }

    #[test]
    fn un_nom_qui_ne_laisse_rien_reste_nommable() {
        // Sans repli, on écrirait un fichier sans nom, ou pire un fichier caché.
        for vide in ["", "   ", "...", "/", "../"] {
            assert_eq!(nom_de_fichier_sur(vide), "piece-jointe", "pour « {vide} »");
        }
    }

    #[test]
    fn un_nom_demesure_est_ramene_a_ce_qu_un_disque_accepte() {
        let long = "a".repeat(500) + ".pdf";
        assert!(nom_de_fichier_sur(&long).chars().count() <= 120);
    }

    #[test]
    fn deux_pieces_du_meme_nom_ne_s_ecrasent_pas() {
        let dossier = tempfile::tempdir().unwrap();
        let premier = chemin_libre(dossier.path(), "facture.pdf");
        std::fs::write(&premier, b"un").unwrap();

        let second = chemin_libre(dossier.path(), "facture.pdf");
        assert_ne!(premier, second);
        assert_eq!(second.file_name().unwrap(), "facture (2).pdf");
    }
}

#[cfg(test)]
mod tests_routage_des_comptes {
    use super::*;

    #[test]
    fn un_message_du_compte_actif_garde_le_chemin_historique() {
        // La session tient déjà son jeton en mémoire et sait le renouveler :
        // passer par le trousseau pour rien coûterait un échange à chaque
        // ouverture de message.
        assert_eq!(compte_a_viser("moi@gmail.com", Some("moi@gmail.com")), None);
    }

    #[test]
    fn un_message_d_un_autre_compte_reclame_son_propre_jeton() {
        // C'est le défaut corrigé : sous « Tous les comptes », la pièce jointe
        // d'un message reçu ailleurs était demandée avec les clés de l'actif,
        // et Gmail répondait qu'il ne connaissait pas ce message.
        assert_eq!(
            compte_a_viser("moi@gmail.com", Some("boulot@exemple.fr")),
            Some("boulot@exemple.fr".to_string())
        );
    }

    #[test]
    fn une_majuscule_ne_fait_pas_croire_a_un_autre_compte() {
        // Gmail rend parfois l'adresse telle qu'elle a été tapée ; l'annuaire
        // la range en minuscules.
        assert_eq!(compte_a_viser("moi@gmail.com", Some("Moi@Gmail.com")), None);
        assert_eq!(compte_a_viser("Moi@Gmail.com", Some("moi@gmail.com")), None);
    }

    #[test]
    fn un_compte_inconnu_retombe_sur_l_actif() {
        // C'est ce que faisait tout le code auparavant : rien n'est perdu à
        // essayer, et un message dont on ignore la boîte n'a pas à échouer
        // avant même d'avoir demandé.
        assert_eq!(compte_a_viser("moi@gmail.com", None), None);
        assert_eq!(compte_a_viser("moi@gmail.com", Some("   ")), None);
    }

    #[test]
    fn l_adresse_visee_est_normalisee_avant_de_chercher_dans_le_trousseau() {
        // Le créneau du trousseau est construit sur l'adresse en minuscules —
        // voir `comptes::cle_compte`. Chercher sur une autre forme ne
        // trouverait rien.
        let vise = compte_a_viser("moi@gmail.com", Some("  Boulot@Exemple.FR  ")).unwrap();

        assert_eq!(vise, "boulot@exemple.fr");
        assert_eq!(
            comptes::cle_compte(&vise),
            comptes::cle_compte("  Boulot@Exemple.FR  ")
        );
    }
}
