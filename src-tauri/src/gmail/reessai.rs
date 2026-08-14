//! Quand rejouer un appel Gmail, et après combien de temps.
//!
//! Décision volontairement séparée du transport : c'est de la logique, elle est
//! testable sans réseau, et s'y tromper coûte cher dans les deux sens. Trop
//! rejouer brûle un quota partagé par toute l'application ; pas assez transforme
//! un ralentissement passager de Google en échec visible par l'utilisateur.

use std::time::Duration;

/// Au-delà, on renonce et on le dit.
///
/// Cinq tentatives couvrent une trentaine de secondes de perturbation, ce qui
/// absorbe les pics de quota sans laisser l'utilisateur devant une interface
/// figée.
pub const TENTATIVES_MAX: u32 = 5;

const RECUL_BASE: Duration = Duration::from_millis(500);
const RECUL_PLAFOND: Duration = Duration::from_secs(32);

/// Ce qu'il faut faire d'une réponse qui n'est pas un succès.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suite {
    /// Rejouer après ce délai.
    Reessayer(Duration),

    /// Le jeton d'accès n'est plus accepté : le renouveler puis rejouer une fois.
    Renouveler,

    /// Rien à espérer d'une nouvelle tentative.
    Abandonner,
}

/// Motifs `403` qui désignent un quota, donc une condition passagère.
///
/// Gmail répond `403` aussi bien pour « trop de requêtes » que pour « vous
/// n'avez pas le droit ». Les traiter pareil ferait soit abandonner sur un pic
/// de trafic, soit marteler une permission qui ne viendra jamais.
fn est_un_quota(motif: Option<&str>) -> bool {
    matches!(
        motif,
        Some(
            "rateLimitExceeded" | "userRateLimitExceeded" | "quotaExceeded" | "RESOURCE_EXHAUSTED"
        )
    )
}

/// Recul exponentiel, avec une part d'aléatoire.
///
/// `alea` est injecté dans `[0, 1)` plutôt que tiré ici : un délai calculé à
/// partir d'une source d'aléatoire interne n'est pas testable.
///
/// L'aléatoire n'est pas cosmétique. Sans lui, tous les clients qui ont pris un
/// `429` en même temps repartent en même temps et reconstituent le pic qu'ils
/// viennent de subir.
fn recul(tentative: u32, alea: f64) -> Duration {
    let facteur = 2u32.saturating_pow(tentative.saturating_sub(1));
    let calcule = RECUL_BASE.saturating_mul(facteur).min(RECUL_PLAFOND);

    // Demi-gigue : le délai reste entre la moitié et la totalité du calcul.
    // Une gigue totale peut produire un délai quasi nul, ce qui revient à ne pas
    // reculer du tout.
    let moitie = calcule / 2;
    moitie + moitie.mul_f64(alea.clamp(0.0, 1.0))
}

/// Décide de la suite à donner à une réponse en échec.
///
/// `retry_after` vient de l'en-tête du même nom : quand Google dit lui-même
/// combien de temps attendre, il en sait plus que notre calcul.
pub fn suite_apres(
    statut: u16,
    motif: Option<&str>,
    tentative: u32,
    retry_after: Option<Duration>,
    alea: f64,
) -> Suite {
    if tentative > TENTATIVES_MAX {
        return Suite::Abandonner;
    }

    let rejouable = match statut {
        401 => return Suite::Renouveler,
        429 => true,
        403 => est_un_quota(motif),
        500..=599 => true,
        _ => false,
    };

    if !rejouable {
        return Suite::Abandonner;
    }

    // Un `Retry-After` démesuré figerait l'application : on le respecte, mais
    // pas au-delà de notre propre plafond.
    Suite::Reessayer(match retry_after {
        Some(impose) => impose.min(RECUL_PLAFOND),
        None => recul(tentative, alea),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suite(statut: u16, tentative: u32) -> Suite {
        suite_apres(statut, None, tentative, None, 0.5)
    }

    #[test]
    fn un_429_est_rejoue() {
        assert!(matches!(suite(429, 1), Suite::Reessayer(_)));
    }

    #[test]
    fn les_pannes_serveur_sont_rejouees() {
        for statut in [500, 502, 503, 504] {
            assert!(
                matches!(suite(statut, 1), Suite::Reessayer(_)),
                "{statut} devrait être rejoué"
            );
        }
    }

    #[test]
    fn les_erreurs_de_requete_ne_sont_jamais_rejouees() {
        // Elles ne passeront pas davantage à la seconde tentative, et chaque
        // tentative consomme du quota.
        for statut in [400, 404, 409, 413] {
            assert_eq!(suite(statut, 1), Suite::Abandonner, "statut {statut}");
        }
    }

    #[test]
    fn un_401_demande_un_renouvellement_de_jeton() {
        // L'accès a pu être révoqué, ou le jeton expirer entre la vérification
        // et l'arrivée de la requête chez Google.
        assert_eq!(suite(401, 1), Suite::Renouveler);
    }

    #[test]
    fn un_403_de_quota_est_rejoue_mais_pas_un_403_de_permission() {
        let quota = suite_apres(403, Some("userRateLimitExceeded"), 1, None, 0.5);
        assert!(matches!(quota, Suite::Reessayer(_)));

        let quota = suite_apres(403, Some("rateLimitExceeded"), 1, None, 0.5);
        assert!(matches!(quota, Suite::Reessayer(_)));

        let permission = suite_apres(403, Some("insufficientPermissions"), 1, None, 0.5);
        assert_eq!(permission, Suite::Abandonner);

        // Sans motif exploitable, on ne rejoue pas : marteler une permission
        // refusée est pire que renoncer.
        assert_eq!(suite_apres(403, None, 1, None, 0.5), Suite::Abandonner);
    }

    #[test]
    fn le_recul_croit_avec_les_tentatives() {
        let delais: Vec<Duration> = (1..=4)
            .map(|n| match suite_apres(429, None, n, None, 0.5) {
                Suite::Reessayer(d) => d,
                autre => panic!("réessai attendu, obtenu {autre:?}"),
            })
            .collect();

        for paire in delais.windows(2) {
            assert!(
                paire[1] > paire[0],
                "le recul doit croître : {:?} puis {:?}",
                paire[0],
                paire[1]
            );
        }
    }

    #[test]
    fn le_recul_est_plafonne() {
        // Sans plafond, la huitième tentative attendrait plus d'une minute.
        let Suite::Reessayer(d) = suite_apres(429, None, TENTATIVES_MAX, None, 1.0) else {
            panic!("réessai attendu");
        };
        assert!(d <= RECUL_PLAFOND, "{d:?} dépasse le plafond");
    }

    #[test]
    fn l_aleatoire_ecarte_les_clients_qui_reessaient_ensemble() {
        let bas = suite_apres(429, None, 3, None, 0.0);
        let haut = suite_apres(429, None, 3, None, 0.99);

        assert_ne!(
            bas, haut,
            "deux clients doivent repartir à des moments différents"
        );
    }

    #[test]
    fn le_recul_n_est_jamais_nul() {
        // Même avec le tirage le plus favorable : rejouer immédiatement, c'est
        // ne pas rejouer du tout.
        let Suite::Reessayer(d) = suite_apres(429, None, 1, None, 0.0) else {
            panic!("réessai attendu");
        };
        assert!(d >= Duration::from_millis(100), "{d:?} est trop court");
    }

    #[test]
    fn retry_after_prime_sur_notre_calcul() {
        // Google sait mieux que nous quand il sera de nouveau disponible.
        let impose = Duration::from_secs(7);
        let s = suite_apres(429, None, 1, Some(impose), 0.5);

        assert_eq!(s, Suite::Reessayer(impose));
    }

    #[test]
    fn un_retry_after_demesure_est_ramene_au_plafond() {
        // Un en-tête hostile ou erroné ne doit pas figer l'application.
        let s = suite_apres(429, None, 1, Some(Duration::from_secs(3600)), 0.5);

        assert_eq!(s, Suite::Reessayer(RECUL_PLAFOND));
    }

    #[test]
    fn on_abandonne_passe_le_nombre_maximal_de_tentatives() {
        assert_eq!(suite(429, TENTATIVES_MAX + 1), Suite::Abandonner);
        assert_eq!(suite(503, TENTATIVES_MAX + 1), Suite::Abandonner);
    }

    #[test]
    fn un_renouvellement_ne_se_repete_pas_indefiniment() {
        // Sinon un jeton définitivement refusé boucle sans fin.
        assert_eq!(suite(401, TENTATIVES_MAX + 1), Suite::Abandonner);
    }
}
