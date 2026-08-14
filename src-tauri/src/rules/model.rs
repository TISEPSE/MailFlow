//! Modele de données du fichier `regles.json`.
//!
//! Les noms de champs sont en français et calqués à l'identique sur le format
//! décrit au cahier des charges : le fichier reste lisible et éditable à la main
//! par un utilisateur technique (mode avancé de la vue 5).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

/// Version du format de fichier. À incrémenter à chaque changement cassant,
/// pour permettre une migration plutôt qu'un échec de lecture.
pub const VERSION_FORMAT: &str = "1.0";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleSet {
    pub version: String,
    pub last_updated: DateTime<Utc>,
    pub automations: Vec<Rule>,
}

impl Default for RuleSet {
    fn default() -> Self {
        Self {
            version: VERSION_FORMAT.to_string(),
            last_updated: Utc::now(),
            automations: Vec::new(),
        }
    }
}

impl RuleSet {
    /// Règles actives concernant un expéditeur donné.
    ///
    /// `expediteur_brut` est l'en-tête `From` tel que renvoyé par Gmail ; il est
    /// normalisé avant comparaison (voir [`normaliser_adresse`]).
    pub fn regles_pour(&self, expediteur_brut: &str) -> Vec<&Rule> {
        let Some(adresse) = normaliser_adresse(expediteur_brut) else {
            return Vec::new();
        };
        self.automations
            .iter()
            .filter(|r| r.active && r.adresse_normalisee().as_deref() == Some(adresse.as_str()))
            .collect()
    }

    /// Ajoute une règle, ou remplace celle qui vise déjà le même expéditeur.
    ///
    /// Deux règles sur une même adresse se contrediraient sans que l'interface
    /// puisse le montrer clairement. La plus récente gagne : c'est le geste que
    /// l'utilisateur vient de faire.
    pub fn ajouter(&mut self, regle: Rule) {
        let cible = regle.adresse_normalisee();

        match self
            .automations
            .iter()
            .position(|r| cible.is_some() && r.adresse_normalisee() == cible)
        {
            Some(i) => self.automations[i] = regle,
            None => self.automations.insert(0, regle),
        }
    }

    /// Retire une règle. Rend `false` si l'identifiant n'existe pas.
    pub fn supprimer(&mut self, id: &str) -> bool {
        let avant = self.automations.len();
        self.automations.retain(|r| r.id != id);
        self.automations.len() != avant
    }

    /// Active ou désactive une règle sans la supprimer.
    ///
    /// Désactiver plutôt que supprimer permet de suspendre une automatisation
    /// sans perdre son paramétrage.
    pub fn basculer(&mut self, id: &str) -> bool {
        match self.automations.iter_mut().find(|r| r.id == id) {
            Some(r) => {
                r.active = !r.active;
                true
            }
            None => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,

    /// Adresse e-mail de l'expéditeur cible, telle que saisie.
    pub expediteur: String,

    /// Libelle affiche dans l'interface (ex. « TLDR AI Digest »).
    /// Purement cosmétique : ne sert jamais à décider d'une action.
    pub nom_affichage: String,

    pub categorie: Categorie,
    pub action: Action,
    pub active: bool,
    pub date_ajout: NaiveDate,

    /// Present uniquement pour les actions récurrentes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequence: Option<Frequence>,

    /// Heure locale d'exécution, au format `HH:MM`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "serde_heure_hhmm"
    )]
    pub heure_execution: Option<NaiveTime>,
}

impl Rule {
    /// Adresse comparable de l'expéditeur cible.
    pub fn adresse_normalisee(&self) -> Option<String> {
        normaliser_adresse(&self.expediteur)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Categorie {
    Publicite,
    Newsletter,
    Formation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Envoi systématique à la corbeille.
    SupprimerToujours,
    /// Resume par le LLM, puis retrait du tag INBOX.
    GenererResumeEtArchiver,
    /// Retrait du tag INBOX, éventuellement selon `frequence`.
    ArchiverAutomatique,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequence {
    TousLesVendredis,
}

/// Extrait l'adresse comparable d'un en-tête `From`.
///
/// Point de sécurité : un en-tête `From` s'écrit `"Nom affiche" <adresse@x.fr>`,
/// et le nom affiché est entièrement choisi par l'expéditeur. Comparer la chaîne
/// brute permettrait à `"contact@ma-banque.fr" <pirate@exemple.net>` de déclencher
/// une règle visant la banque — ou, dans l'autre sens, à un expéditeur d'échapper
/// à une règle de suppression en changeant son nom affiché. Seule la partie entre
/// chevrons fait foi.
///
/// La normalisation met aussi en minuscules : la partie domaine est insensible à
/// la casse, et Gmail traite également la partie locale ainsi.
pub fn normaliser_adresse(entete_from: &str) -> Option<String> {
    let brut = entete_from.trim();

    let adresse = match (brut.rfind('<'), brut.rfind('>')) {
        (Some(debut), Some(fin)) if debut < fin => &brut[debut + 1..fin],
        _ => brut,
    };

    let adresse = adresse.trim().trim_matches('"').trim();

    // Une adresse valide a exactement un `@`, avec du texte de part et d'autre.
    let (locale, domaine) = adresse.split_once('@')?;
    if locale.is_empty() || domaine.is_empty() || domaine.contains('@') {
        return None;
    }

    Some(adresse.to_lowercase())
}

/// Nom affiché d'un en-tête `From`, ou l'adresse à défaut.
///
/// Purement cosmétique — il est choisi par l'expéditeur et ne doit jamais
/// intervenir dans une décision, voir [`normaliser_adresse`]. Il sert à
/// l'affichage, où montrer « Karim Belhadj » vaut mieux que
/// `karim.belhadj@atelier-nord.fr`.
pub fn nom_affiche(entete_from: &str) -> String {
    let brut = entete_from.trim();

    if let Some(debut) = brut.rfind('<')
        && brut.rfind('>').is_some_and(|fin| debut < fin)
    {
        let nom = brut[..debut].trim().trim_matches('"').trim();
        if !nom.is_empty() {
            return nom.to_string();
        }
    }

    // Sans nom affiché, on montre la partie locale plutôt que l'adresse
    // entière : « karim.belhadj » tient dans une liste, l'adresse non.
    normaliser_adresse(brut)
        .and_then(|a| a.split_once('@').map(|(locale, _)| locale.to_string()))
        .unwrap_or_else(|| brut.to_string())
}

/// `chrono` sérialise `NaiveTime` en `HH:MM:SS`, alors que le cahier des charges
/// spécifie `HH:MM`. Ce module fait la conversion dans les deux sens.
mod serde_heure_hhmm {
    use chrono::NaiveTime;
    use serde::{Deserialize, Deserializer, Serializer};

    const FORMAT: &str = "%H:%M";

    pub fn serialize<S: Serializer>(heure: &Option<NaiveTime>, s: S) -> Result<S::Ok, S::Error> {
        match heure {
            Some(h) => s.serialize_str(&h.format(FORMAT).to_string()),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<NaiveTime>, D::Error> {
        let Some(texte) = Option::<String>::deserialize(d)? else {
            return Ok(None);
        };
        NaiveTime::parse_from_str(&texte, FORMAT)
            .map(Some)
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn regle(expediteur: &str, action: Action) -> Rule {
        Rule {
            id: "rule_test".into(),
            expediteur: expediteur.into(),
            nom_affichage: "Test".into(),
            categorie: Categorie::Publicite,
            action,
            active: true,
            date_ajout: NaiveDate::from_ymd_opt(2026, 8, 13).unwrap(),
            frequence: None,
            heure_execution: None,
        }
    }

    #[test]
    fn le_nom_affiche_est_extrait_de_l_entete() {
        assert_eq!(
            nom_affiche("\"Karim Belhadj\" <karim@atelier.fr>"),
            "Karim Belhadj"
        );
        assert_eq!(
            nom_affiche("Sophie Renard <s@clinique.fr>"),
            "Sophie Renard"
        );
    }

    #[test]
    fn sans_nom_affiche_on_montre_la_partie_locale() {
        // L'adresse entière déborderait d'une colonne de liste.
        assert_eq!(
            nom_affiche("karim.belhadj@atelier-nord.fr"),
            "karim.belhadj"
        );
        assert_eq!(nom_affiche("<promo@offres.fr>"), "promo");
    }

    #[test]
    fn un_nom_affiche_usurpateur_reste_cosmetique() {
        // Il s'affiche tel quel, mais `normaliser_adresse` — seule à décider —
        // rend bien l'adresse réelle.
        let from = "\"contact@ma-banque.fr\" <pirate@exemple.net>";

        assert_eq!(nom_affiche(from), "contact@ma-banque.fr");
        assert_eq!(
            normaliser_adresse(from).as_deref(),
            Some("pirate@exemple.net")
        );
    }

    #[test]
    fn ajouter_place_la_nouvelle_regle_en_tete() {
        let mut jeu = RuleSet {
            automations: vec![regle("ancien@x.fr", Action::SupprimerToujours)],
            ..Default::default()
        };

        jeu.ajouter(regle("nouveau@x.fr", Action::ArchiverAutomatique));

        assert_eq!(jeu.automations.len(), 2);
        assert_eq!(jeu.automations[0].expediteur, "nouveau@x.fr");
    }

    #[test]
    fn ajouter_remplace_la_regle_visant_le_meme_expediteur() {
        // Deux règles sur une même adresse se contrediraient en silence.
        let mut jeu = RuleSet {
            automations: vec![regle("promo@x.fr", Action::ArchiverAutomatique)],
            ..Default::default()
        };

        jeu.ajouter(regle("PROMO@X.FR", Action::SupprimerToujours));

        assert_eq!(jeu.automations.len(), 1);
        assert_eq!(jeu.automations[0].action, Action::SupprimerToujours);
    }

    #[test]
    fn supprimer_signale_un_identifiant_inconnu() {
        let mut jeu = RuleSet {
            automations: vec![regle("a@b.fr", Action::SupprimerToujours)],
            ..Default::default()
        };
        let id = jeu.automations[0].id.clone();

        assert!(jeu.supprimer(&id));
        assert!(jeu.automations.is_empty());
        assert!(!jeu.supprimer(&id), "un second appel ne trouve plus rien");
    }

    #[test]
    fn basculer_suspend_sans_perdre_le_parametrage() {
        let mut jeu = RuleSet {
            automations: vec![regle("a@b.fr", Action::ArchiverAutomatique)],
            ..Default::default()
        };
        let id = jeu.automations[0].id.clone();

        assert!(jeu.basculer(&id));
        assert!(!jeu.automations[0].active);
        assert_eq!(jeu.automations[0].action, Action::ArchiverAutomatique);

        assert!(jeu.basculer(&id));
        assert!(jeu.automations[0].active);
    }

    #[test]
    fn le_format_du_cahier_des_charges_se_deserialise() {
        let json = r#"{
          "version": "1.0",
          "last_updated": "2026-08-13T14:00:00Z",
          "automations": [
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
        }"#;

        let set: RuleSet = serde_json::from_str(json).unwrap();
        let r = &set.automations[0];

        assert_eq!(r.categorie, Categorie::Formation);
        assert_eq!(r.action, Action::ArchiverAutomatique);
        assert_eq!(r.frequence, Some(Frequence::TousLesVendredis));
        assert_eq!(r.heure_execution, NaiveTime::from_hms_opt(18, 0, 0));
    }

    #[test]
    fn l_heure_se_reserialise_en_hh_mm() {
        let mut r = regle("a@b.fr", Action::ArchiverAutomatique);
        r.heure_execution = NaiveTime::from_hms_opt(18, 0, 0);

        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["heure_execution"], "18:00");
    }

    #[test]
    fn les_champs_optionnels_absents_ne_sont_pas_serialises() {
        let json = serde_json::to_value(regle("a@b.fr", Action::SupprimerToujours)).unwrap();

        assert!(!json.as_object().unwrap().contains_key("frequence"));
        assert!(!json.as_object().unwrap().contains_key("heure_execution"));
    }

    #[test]
    fn un_aller_retour_json_preserve_le_jeu_de_regles() {
        let set = RuleSet {
            version: VERSION_FORMAT.into(),
            last_updated: "2026-08-13T14:00:00Z".parse().unwrap(),
            automations: vec![regle("promo@offres-tech.fr", Action::SupprimerToujours)],
        };

        let texte = serde_json::to_string(&set).unwrap();
        assert_eq!(serde_json::from_str::<RuleSet>(&texte).unwrap(), set);
    }

    #[test]
    fn l_adresse_est_extraite_des_chevrons() {
        assert_eq!(
            normaliser_adresse("TLDR AI <dan@tldr.tech>").as_deref(),
            Some("dan@tldr.tech")
        );
    }

    #[test]
    fn une_adresse_nue_est_acceptee() {
        assert_eq!(
            normaliser_adresse("dan@tldr.tech").as_deref(),
            Some("dan@tldr.tech")
        );
    }

    #[test]
    fn la_casse_est_ignoree() {
        assert_eq!(
            normaliser_adresse("Dan@TLDR.Tech").as_deref(),
            Some("dan@tldr.tech")
        );
    }

    #[test]
    fn un_nom_affiche_usurpant_une_adresse_ne_trompe_pas_la_normalisation() {
        // Le nom affiché imite une adresse de confiance ; l'adresse réelle est autre.
        let usurpation = "\"contact@ma-banque.fr\" <pirate@exemple.net>";

        assert_eq!(
            normaliser_adresse(usurpation).as_deref(),
            Some("pirate@exemple.net")
        );
    }

    #[test]
    fn une_regle_ne_se_declenche_pas_sur_un_nom_affiche_usurpe() {
        let set = RuleSet {
            automations: vec![regle("contact@ma-banque.fr", Action::SupprimerToujours)],
            ..Default::default()
        };

        let correspondances = set.regles_pour("\"contact@ma-banque.fr\" <pirate@exemple.net>");

        assert!(
            correspondances.is_empty(),
            "un expéditeur usurpant le nom affiché ne doit déclencher aucune règle"
        );
    }

    #[test]
    fn une_regle_desactivee_ne_correspond_pas() {
        let mut r = regle("promo@offres-tech.fr", Action::SupprimerToujours);
        r.active = false;

        let set = RuleSet {
            automations: vec![r],
            ..Default::default()
        };

        assert!(set.regles_pour("promo@offres-tech.fr").is_empty());
    }

    #[test]
    fn une_entree_sans_arobase_est_rejetee() {
        assert_eq!(normaliser_adresse("pas une adresse"), None);
        assert_eq!(normaliser_adresse(""), None);
        assert_eq!(normaliser_adresse("@domaine.fr"), None);
        assert_eq!(normaliser_adresse("locale@"), None);
    }
}
