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
use crate::comptes::{self, Annuaire};
use crate::config;
use crate::error::{AppError, Resultat};
use crate::gmail::boite::{MessageAffiche, charger_boite};
use crate::gmail::client::{ClientGmail, SourceJeton};
use crate::gmail::execution::RapportExecution;
use crate::gmail::synchronisation::synchroniser;
use crate::gmail::transport::TransportHttp;
use crate::rules::{Rule, RuleSet, RulesStore};
use crate::secrets::KeyringStore;

/// État d'authentification partagé, géré par Tauri.
///
/// `client` vaut `None` tant que l'identifiant Google n'a pas été configuré :
/// l'application se lance quand même et l'explique, plutôt que de refuser de
/// démarrer sur un fichier `.env` incomplet.
pub struct EtatAuth {
    session: Mutex<SessionAuth<KeyringStore>>,
    client: Option<ClientOAuth>,
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
    pub chemin_regles: String,

    /// `None` quand le fichier existe mais n'a pas pu être lu.
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
    let store = RulesStore::new(&dossier);

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
    let regles = RulesStore::new(&dossier).charger()?;

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

/// Chaque commande de règle rend le jeu complet plutôt qu'un accusé de
/// réception. L'interface se réaffiche à partir de ce qui est réellement sur le
/// disque, au lieu de maintenir sa propre copie qui finirait par diverger.
fn ecrire_regles(app: &AppHandle, regles: &RuleSet) -> Resultat<()> {
    RulesStore::new(&dossier_config(app)?).enregistrer(regles)
}

#[tauri::command]
pub async fn regles_lister(app: AppHandle) -> Resultat<RuleSet> {
    RulesStore::new(&dossier_config(&app)?).charger()
}

#[tauri::command]
pub async fn regle_ajouter(app: AppHandle, regle: Rule) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    regles.ajouter(regle);
    ecrire_regles(&app, &regles)?;

    log::info!("règle enregistrée, {} au total", regles.automations.len());
    Ok(regles)
}

#[tauri::command]
pub async fn regle_supprimer(app: AppHandle, id: String) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    if regles.supprimer(&id) {
        ecrire_regles(&app, &regles)?;
        log::info!("règle {id} supprimée");
    }
    Ok(regles)
}

#[tauri::command]
pub async fn regle_basculer(app: AppHandle, id: String) -> Resultat<RuleSet> {
    let mut regles = RulesStore::new(&dossier_config(&app)?).charger()?;
    if regles.basculer(&id) {
        ecrire_regles(&app, &regles)?;
    }
    Ok(regles)
}

// ---------------------------------------------------------------------------
// Boîte de réception
// ---------------------------------------------------------------------------

/// Relève la boîte et classe les messages par vue.
///
/// Ne rend ni corps de message ni identifiant de fil : le HTML d'un e-mail est
/// écrit par un inconnu et ne traversera l'IPC que le jour où une `iframe` en
/// bac à sable saura l'afficher sans risque.
#[tauri::command]
pub async fn boite_lister(
    app: AppHandle,
    etat: State<'_, EtatAuth>,
) -> Resultat<Vec<MessageAffiche>> {
    let regles = RulesStore::new(&dossier_config(&app)?).charger()?;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let boite = charger_boite(&client, &regles)
        .await
        .inspect_err(|e| log::warn!("relevé de la boîte interrompu : {e}"))?;

    log::info!("{} message(s) relevé(s)", boite.len());
    Ok(boite)
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
    etat: State<'_, EtatAuth>,
    id: String,
) -> Resultat<crate::gmail::corps::CorpsMessage> {
    use crate::gmail::corps;

    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    let message = client.message_complet(&id).await?;

    let mut trouve = message
        .payload
        .as_ref()
        .map(corps::extraire)
        .unwrap_or_default();

    trouve.html = trouve.html.as_deref().map(corps::assainir);

    log::info!(
        "corps lu : {}",
        match (&trouve.html, &trouve.texte) {
            (Some(_), _) => "html",
            (None, Some(_)) => "texte seul",
            _ => "aucun",
        }
    );
    Ok(trouve)
}

/// Signale un message comme indésirable.
///
/// Même geste que dans Gmail : le message rejoint les indésirables et quitte la
/// boîte de réception. Aucune règle locale n'est créée — Google apprend du
/// signalement, et deux mécanismes qui filtrent le même expéditeur finiraient
/// par se contredire.
#[tauri::command]
pub async fn message_signaler_spam(etat: State<'_, EtatAuth>, id: String) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
    client.marquer_spam(&[id]).await?;

    log::info!("message signalé comme indésirable");
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
pub async fn message_marquer_lu(etat: State<'_, EtatAuth>, id: String) -> Resultat<()> {
    let client = ClientGmail::nouveau(TransportHttp::nouveau()?, JetonsDeSession { etat: &etat });
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

    let mut session = etat.session.lock().await;
    session.basculer(|secrets| comptes::basculer(secrets, &mut annuaire, &adresse))?;
    comptes::ecrire(&dossier, &annuaire)?;

    log::info!("compte actif changé");
    Ok(())
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
            crate::gmail::logos::image_distante(&http, url).await
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
