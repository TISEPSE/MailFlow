//! Modele de donnees du fichier `regles.json`.
//!
//! Les noms de champs sont en francais et calques a l'identique sur le format
//! decrit au cahier des charges : le fichier reste lisible et editable a la main
//! par un utilisateur technique (mode avance de la vue 5).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

/// Version du format de fichier. A incrementer a chaque changement cassant,
/// pour permettre une migration plutot qu'un echec de lecture.
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
    /// Regles actives concernant un expediteur donne.
    ///
    /// `expediteur_brut` est l'en-tete `From` tel que renvoye par Gmail ; il est
    /// normalise avant comparaison (voir [`normaliser_adresse`]).
    pub fn regles_pour(&self, expediteur_brut: &str) -> Vec<&Rule> {
        let Some(adresse) = normaliser_adresse(expediteur_brut) else {
            return Vec::new();
        };
        self.automations
            .iter()
            .filter(|r| r.active && r.adresse_normalisee().as_deref() == Some(adresse.as_str()))
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,

    /// Adresse e-mail de l'expediteur cible, telle que saisie.
    pub expediteur: String,

    /// Libelle affiche dans l'interface (ex. « TLDR AI Digest »).
    /// Purement cosmetique : ne sert jamais a decider d'une action.
    pub nom_affichage: String,

    pub categorie: Categorie,
    pub action: Action,
    pub active: bool,
    pub date_ajout: NaiveDate,

    /// Present uniquement pour les actions recurrentes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequence: Option<Frequence>,

    /// Heure locale d'execution, au format `HH:MM`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "serde_heure_hhmm"
    )]
    pub heure_execution: Option<NaiveTime>,
}

impl Rule {
    /// Adresse comparable de l'expediteur cible.
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
    /// Envoi systematique a la corbeille.
    SupprimerToujours,
    /// Resume par le LLM, puis retrait du tag INBOX.
    GenererResumeEtArchiver,
    /// Retrait du tag INBOX, eventuellement selon `frequence`.
    ArchiverAutomatique,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequence {
    TousLesVendredis,
}

/// Extrait l'adresse comparable d'un en-tete `From`.
///
/// Point de securite : un en-tete `From` s'ecrit `"Nom affiche" <adresse@x.fr>`,
/// et le nom affiche est entierement choisi par l'expediteur. Comparer la chaine
/// brute permettrait a `"contact@ma-banque.fr" <pirate@exemple.net>` de declencher
/// une regle visant la banque — ou, dans l'autre sens, a un expediteur d'echapper
/// a une regle de suppression en changeant son nom affiche. Seule la partie entre
/// chevrons fait foi.
///
/// La normalisation met aussi en minuscules : la partie domaine est insensible a
/// la casse, et Gmail traite egalement la partie locale ainsi.
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

/// `chrono` serialise `NaiveTime` en `HH:MM:SS`, alors que le cahier des charges
/// specifie `HH:MM`. Ce module fait la conversion dans les deux sens.
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
        // Le nom affiche imite une adresse de confiance ; l'adresse reelle est autre.
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
            "un expediteur usurpant le nom affiche ne doit declencher aucune regle"
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
