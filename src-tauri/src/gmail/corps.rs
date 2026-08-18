//! Corps des messages : extraction MIME, décodage, désinfection.
//!
//! # Pourquoi ce module a mis si longtemps à exister
//!
//! Le corps d'un e-mail est du HTML écrit par un inconnu. L'afficher dans une
//! application de bureau, c'est lui donner une occasion de s'exécuter chez
//! l'utilisateur. MailFlow s'en est passé tant qu'il n'y avait pas de cadre sûr
//! pour le montrer.
//!
//! # Ce qui protège réellement
//!
//! Trois barrières, dans cet ordre d'importance.
//!
//! 1. **Le bac à sable du navigateur.** L'interface affiche ce HTML dans une
//!    `iframe` déclarée `sandbox` sans `allow-scripts` : le moteur refuse
//!    d'exécuter le moindre script, quoi que contienne le document. C'est une
//!    garantie du navigateur, pas une promesse de notre part.
//!
//! 2. **Une politique de sécurité dans le document lui-même.** `default-src
//!    'none'` interdit toute requête sortante. Les images distantes ne partent
//!    donc pas — et avec elles les pixels de suivi, qui signaleraient à
//!    l'expéditeur l'heure exacte à laquelle son message a été ouvert.
//!
//! 3. **Le nettoyage fait ici.** Il retire les scripts, les gestionnaires
//!    d'événements et les URL `javascript:`. C'est une précaution de plus, pas
//!    la barrière principale : un nettoyeur écrit à la main se contourne, un
//!    bac à sable non. Il ne faut donc jamais rien lui faire porter seul.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::gmail::modele::Charge;
use crate::html::{fin_de_balise, valeur_attribut};

/// Au-delà, on n'affiche pas : ce n'est plus une lettre, c'est un document.
const TAILLE_MAX: usize = 2 * 1024 * 1024;

/// Nombre d'images qu'on veut bien rapatrier pour un message.
///
/// Une lettre commerciale en compte une trentaine ; au-delà, on est face à un
/// document qui ferait attendre l'utilisateur sans rien lui apprendre de plus.
pub const IMAGES_MAX: usize = 40;

/// Un fichier joint au message.
///
/// Les images intégrées au corps n'en font pas partie : elles sont déjà dans le
/// document, et les lister reviendrait à proposer de télécharger ce qu'on est en
/// train de regarder.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceJointe {
    /// Nom tel que l'expéditeur l'a écrit. Jamais employé comme nom de fichier
    /// sans assainissement — voir `commands::piece_jointe_enregistrer`.
    pub nom: String,
    pub type_mime: String,
    pub taille: u64,
    /// Identifiant Gmail, à redemander pour obtenir le contenu.
    pub id: String,
}

/// Ce qu'on a su tirer d'un message.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CorpsMessage {
    pub html: Option<String>,
    pub texte: Option<String>,

    /// Les fichiers joints, sans leur contenu : une lettre peut en porter
    /// plusieurs mégaoctets, qu'on ne rapatrie que sur demande.
    #[serde(default)]
    pub pieces: Vec<PieceJointe>,
}

impl CorpsMessage {
    pub fn est_vide(&self) -> bool {
        self.html.is_none() && self.texte.is_none()
    }
}

/// Décode le `base64url` de Gmail.
///
/// Gmail emploie l'alphabet URL — `-` et `_` — et omet le remplissage. Le
/// décodeur standard échouerait sur les deux.
pub fn decoder(donnees: &str) -> Option<String> {
    use base64::Engine;

    let octets = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(donnees.trim_end_matches('='))
        .ok()?;

    if octets.len() > TAILLE_MAX {
        return None;
    }

    // Un corps mal étiqueté ne doit pas faire disparaître le message entier :
    // les octets invalides deviennent le caractère de remplacement.
    Some(String::from_utf8_lossy(&octets).into_owned())
}

/// Parcourt l'arbre MIME et retient la meilleure version de chaque type.
///
/// Un message `multipart/alternative` porte les deux, du plus pauvre au plus
/// riche ; un `multipart/related` cache le HTML sous un niveau de plus. On
/// descend donc partout plutôt que de supposer une forme.
pub fn extraire(charge: &Charge) -> CorpsMessage {
    let mut corps = CorpsMessage::default();
    collecter(charge, &mut corps);
    corps
}

fn collecter(charge: &Charge, corps: &mut CorpsMessage) {
    let mime = charge.mime_type.as_deref().unwrap_or("");

    // Une pièce jointe porte un nom de fichier. Son contenu n'est pas le corps
    // du message, même quand son type est `text/html`.
    let piece_jointe = charge.filename.as_deref().is_some_and(|f| !f.is_empty());

    if piece_jointe
        && let Some(nom) = charge.filename.as_deref()
        && let Some(body) = charge.body.as_ref()
        && let Some(id) = body.attachment_id.as_deref()
    {
        corps.pieces.push(PieceJointe {
            nom: nom.to_string(),
            type_mime: mime.to_string(),
            taille: body.size.unwrap_or(0),
            id: id.to_string(),
        });
    }

    if !piece_jointe && let Some(donnees) = charge.body.as_ref().and_then(|b| b.data.as_deref()) {
        match mime {
            "text/html" if corps.html.is_none() => corps.html = decoder(donnees),
            "text/plain" if corps.texte.is_none() => corps.texte = decoder(donnees),
            _ => {}
        }
    }

    for partie in &charge.parts {
        collecter(partie, corps);
    }
}

/// Les `src` d'images d'un document, dans l'ordre d'apparition, sans doublon.
///
/// Sert deux besoins : relier un `cid:` à la pièce jointe qui le porte, et
/// dresser la liste des adresses distantes à rapatrier côté Rust — le cadre
/// d'affichage, lui, n'a le droit d'émettre aucune requête.
pub fn sources_d_images(html: &str) -> Vec<String> {
    let bas = html.to_lowercase();
    let mut trouvees: Vec<String> = Vec::new();
    let mut depuis = 0;

    while let Some(pos) = bas[depuis..].find("<img") {
        let debut = depuis + pos;
        let fin = fin_de_balise(&bas, debut);
        depuis = fin.max(debut + 4);

        // `<image>` n'est pas `<img>` ; sans ce contrôle, on capturerait des
        // balises qui n'en sont pas.
        if bas[debut + 4..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            continue;
        }

        let Some(src) = valeur_attribut(&html[debut..fin], "src") else {
            continue;
        };
        let src = src.trim().to_string();

        if src.is_empty() || src.starts_with("data:") || trouvees.contains(&src) {
            continue;
        }
        if trouvees.len() == IMAGES_MAX {
            break;
        }
        trouvees.push(src);
    }

    trouvees
}

/// Remplace les `src` d'images par les URI de données fournies.
///
/// Ce qui manque à la table reste tel quel : le cadre d'affichage n'a pas le
/// droit d'aller le chercher, et l'image montrera son texte de remplacement.
/// C'est préférable à une image vide sans explication.
pub fn substituer_images(html: &str, table: &HashMap<String, String>) -> String {
    if table.is_empty() {
        return html.to_string();
    }

    let mut sortie = String::with_capacity(html.len());
    let bas = html.to_lowercase();
    let mut i = 0;

    while let Some(pos) = bas[i..].find("<img") {
        let debut = i + pos;
        let fin = fin_de_balise(&bas, debut);
        sortie.push_str(&html[i..debut]);
        i = fin;

        let balise = &html[debut..fin];
        match valeur_attribut(balise, "src")
            .and_then(|src| table.get(src.trim()).map(|uri| (src, uri)))
        {
            Some((src, uri)) => sortie.push_str(&balise.replace(&src, uri)),
            None => sortie.push_str(balise),
        }
    }

    sortie.push_str(&html[i..]);
    sortie
}

/// Identifiants de pièces jointes, indexés par la référence `cid:` qui les
/// désigne dans le HTML.
///
/// Un `Content-ID` s'écrit `<abc@def>` dans l'en-tête et `cid:abc@def` dans le
/// document : les chevrons sont à retirer, sans quoi rien ne se relie.
pub fn pieces_par_cid(charge: &Charge) -> HashMap<String, String> {
    let mut table = HashMap::new();
    collecter_cid(charge, &mut table);
    table
}

fn collecter_cid(charge: &Charge, table: &mut HashMap<String, String>) {
    let identifiant = charge
        .headers
        .iter()
        .find(|e| e.name.eq_ignore_ascii_case("content-id"))
        .map(|e| e.value.trim().trim_start_matches('<').trim_end_matches('>'));

    if let Some(cid) = identifiant
        && !cid.is_empty()
        && let Some(piece) = charge
            .body
            .as_ref()
            .and_then(|b| b.attachment_id.as_deref())
    {
        table.insert(format!("cid:{cid}"), piece.to_string());
    }

    for partie in &charge.parts {
        collecter_cid(partie, table);
    }
}

/// Retire d'un HTML de tiers ce qui n'a rien à faire dans une lettre.
///
/// Précaution de plus, jamais la barrière principale : voir la documentation du
/// module. Le résultat reste destiné à une `iframe` en bac à sable.
pub fn assainir(html: &str) -> String {
    let mut sortie = String::with_capacity(html.len());
    let bas = html.to_lowercase();
    let mut i = 0;

    while let Some(pos) = bas[i..].find('<') {
        let debut = i + pos;
        sortie.push_str(&html[i..debut]);

        let reste = &bas[debut..];
        if let Some(nom) = balise_a_supprimer(reste) {
            // Le contenu de ces balises est du code, pas du texte : on saute
            // jusqu'à la fermeture plutôt que de le laisser s'afficher en clair.
            i = fin_de_bloc(&bas, debut, nom);
            continue;
        }

        let fin = fin_de_balise(&bas, debut);
        sortie.push_str(&nettoyer_attributs(&html[debut..fin]));
        i = fin;
    }

    sortie.push_str(&html[i..]);
    sortie
}

/// Balises dont le contenu entier doit disparaître.
fn balise_a_supprimer(reste: &str) -> Option<&'static str> {
    for nom in ["script", "iframe", "object", "embed", "frame", "frameset"] {
        let ouvrante = format!("<{nom}");
        if reste.starts_with(&ouvrante) {
            let apres = reste.as_bytes().get(ouvrante.len());
            // `<scriptural>` n'est pas `<script>`.
            if apres.is_none_or(|c| !c.is_ascii_alphanumeric()) {
                return Some(nom);
            }
        }
    }
    None
}

fn fin_de_bloc(bas: &str, debut: usize, nom: &str) -> usize {
    let fermeture = format!("</{nom}");
    match bas[debut..].find(&fermeture) {
        Some(pos) => fin_de_balise(bas, debut + pos),
        // Balise jamais refermée : tout ce qui suit lui appartient.
        None => bas.len(),
    }
}

/// Retire d'une balise ses gestionnaires d'événements et ses URL exécutables.
fn nettoyer_attributs(balise: &str) -> String {
    let bas = balise.to_lowercase();
    if !bas.contains("on") && !bas.contains("javascript:") {
        return balise.to_string();
    }

    let mut sortie = String::with_capacity(balise.len());
    let mut i = 0;

    while i < balise.len() {
        let reste = &bas[i..];
        let saut = reste.find([' ', '\t', '\n', '\r']).map(|p| i + p + 1);

        let Some(debut_attribut) = saut else {
            sortie.push_str(&balise[i..]);
            break;
        };

        sortie.push_str(&balise[i..debut_attribut]);
        let attribut = &bas[debut_attribut..];

        if commence_par_gestionnaire(attribut)
            || attribut.starts_with("href=\"javascript:")
            || attribut.starts_with("href='javascript:")
            || attribut.starts_with("src=\"javascript:")
            || attribut.starts_with("src='javascript:")
        {
            i = fin_d_attribut(&bas, debut_attribut);
            continue;
        }

        i = debut_attribut;
        let fin = fin_d_attribut(&bas, debut_attribut);
        sortie.push_str(&balise[i..fin]);
        i = fin;
    }

    sortie
}

/// Tout attribut dont le nom commence par `on` suivi de lettres.
///
/// Volontairement large : aucun attribut HTML standard ne commence par `on`
/// hormis les gestionnaires d'événements. Chercher à distinguer `onclick` d'un
/// hypothétique `once` reviendrait à tenir la liste de tous les événements
/// existants — et à laisser passer le premier qui manquerait.
fn commence_par_gestionnaire(attribut: &str) -> bool {
    let Some(reste) = attribut.strip_prefix("on") else {
        return false;
    };
    let nom: String = reste
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    !nom.is_empty() && reste[nom.len()..].trim_start().starts_with('=')
}

/// Fin d'un attribut, valeur entre guillemets comprise.
fn fin_d_attribut(bas: &str, debut: usize) -> usize {
    let reste = &bas[debut..];
    let Some(egal) = reste.find('=') else {
        return reste
            .find([' ', '\t', '\n', '\r', '>'])
            .map_or(bas.len(), |p| debut + p);
    };

    let apres = reste[egal + 1..].trim_start();
    let decalage = debut + egal + 1 + (reste[egal + 1..].len() - apres.len());

    for guillemet in ['"', '\''] {
        if apres.starts_with(guillemet) {
            return bas[decalage + 1..]
                .find(guillemet)
                .map_or(bas.len(), |p| decalage + 1 + p + 1);
        }
    }

    bas[decalage..]
        .find([' ', '\t', '\n', '\r', '>'])
        .map_or(bas.len(), |p| decalage + p)
}

/// Dossier où déposer les corps déjà chargés.
///
/// Le dossier de cache de l'application, qui survit à l'extinction de la
/// machine. Les corps vivaient auparavant dans `$XDG_RUNTIME_DIR`, effacé à
/// chaque démarrage : c'était un choix de confidentialité assumé, renversé
/// sciemment parce qu'il faisait tout recommencer à chaque redémarrage. Voir
/// [`crate::cache`] pour ce que ce renversement coûte et comment on le limite.
pub fn dossier_cache_dans(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    app.path()
        .app_cache_dir()
        .map(|d| d.join("corps"))
        .unwrap_or_else(|_| std::env::temp_dir().join("mailflow").join("corps"))
}

/// Chemin du fichier d'un message.
///
/// L'identifiant vient de Gmail, mais il ne sert jamais tel quel comme nom de
/// fichier : la même précaution que pour les logos, pour la même raison.
pub fn chemin_cache(dossier: &Path, id: &str) -> PathBuf {
    dossier.join(format!("{}.json", assaini(id)))
}

/// Nom de fichier assaini, commun aux corps et aux vignettes.
fn assaini(brut: &str) -> String {
    brut.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Chemin de la vignette d'une pièce jointe.
///
/// Le nom porte l'identifiant du message **puis** celui de la pièce, séparés
/// par deux tirets bas : c'est ce préfixe qui permet au nettoyage de rattacher
/// une vignette au message dont elle dépend.
pub fn chemin_vignette(dossier: &Path, message: &str, piece: &str) -> PathBuf {
    dossier.join(format!("{}__{}.png", assaini(message), assaini(piece)))
}

/// Lit une vignette déjà rangée, ou `None`.
pub fn lire_vignette(dossier: &Path, message: &str, piece: &str) -> Option<String> {
    std::fs::read_to_string(chemin_vignette(dossier, message, piece)).ok()
}

/// Range une vignette. Comme pour un corps, un échec d'écriture ne fait rien
/// échouer : la vignette sera simplement refaite la prochaine fois.
pub fn ranger_vignette(dossier: &Path, message: &str, piece: &str, png: &str) {
    let _ = std::fs::create_dir_all(dossier);
    if let Err(e) = crate::cache::ecrire_prive(&chemin_vignette(dossier, message, piece), png) {
        log::info!("vignette non mise en cache : {e}");
    }
}

/// Texte d'un corps, tel qu'on le donne à résumer.
///
/// La partie `text/plain` quand l'expéditeur en a joint une — c'est la même
/// lettre, sans le balisage. À défaut, le HTML dépouillé de ses balises :
/// envoyer le balisage coûterait des jetons pour du bruit, et le quota gratuit
/// se compte en jetons.
pub fn texte_lisible(corps: &CorpsMessage) -> String {
    if let Some(texte) = &corps.texte
        && !texte.trim().is_empty()
    {
        return texte.clone();
    }
    corps.html.as_deref().map(sans_balises).unwrap_or_default()
}

/// Retire les balises et rend les entités les plus courantes.
///
/// Les entités comptent : un extrait qui dit « l&#39;examen » se résume mal,
/// et le modèle reproduirait la graphie plutôt que de la corriger.
fn sans_balises(html: &str) -> String {
    let mut texte = String::with_capacity(html.len());
    let mut dans_balise = false;

    for c in html.chars() {
        match c {
            '<' => dans_balise = true,
            // Une balise vaut une séparation : sans cet espace, « fin</p><p>début »
            // donnerait « findébut ».
            '>' => {
                dans_balise = false;
                texte.push(' ');
            }
            _ if !dans_balise => texte.push(c),
            _ => {}
        }
    }

    for (entite, remplacement) in [
        ("&nbsp;", " "),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&quot;", "\""),
        ("&lt;", "<"),
        ("&gt;", ">"),
        // En dernier : sinon « &amp;#39; » deviendrait une apostrophe.
        ("&amp;", "&"),
    ] {
        texte = texte.replace(entite, remplacement);
    }

    texte.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Chemin du résumé d'un message.
///
/// Une extension à part, et non un `.json` de plus : le balayage reconnaît les
/// corps à leur extension `.json` et efface tout `.json` qu'il ne rattache pas
/// à un message vivant. Un résumé nommé `<id>.resume.json` aurait donc été
/// effacé à la seconde même où il venait d'être écrit.
pub fn chemin_resume(dossier: &Path, id: &str) -> PathBuf {
    dossier.join(format!("{}.resume", assaini(id)))
}

/// De quoi le résumé parle : d'un numéro, ou de la publication entière.
///
/// Les deux se rangent sous le **même identifiant** — celui du numéro le plus
/// récent — et ne se distinguent que par leur extension. Sans cette
/// distinction, résumer une publication écraserait le résumé de son dernier
/// numéro, et le lecteur qui a payé un appel pour ce numéro précis le
/// retrouverait remplacé par une phrase qui parle d'autre chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Portee {
    Numero,
    Publication,
    /// La journée entière, rangée sous une empreinte et non sous un message.
    ///
    /// Elle ne parle d'aucun message en particulier : sa péremption ne peut donc
    /// pas venir de la disparition de l'un d'eux. Elle vient de l'empreinte —
    /// la liste des publications qui l'ont produite — qui change dès qu'un
    /// numéro nouveau arrive. Voir `commands::resumes`.
    Synthese,
}

impl Portee {
    fn extension(self) -> &'static str {
        match self {
            Self::Numero => "resume",
            Self::Publication => "resume-groupe",
            Self::Synthese => "synthese",
        }
    }
}

/// Chemin d'un résumé, selon ce dont il parle.
pub fn chemin_resume_de(dossier: &Path, id: &str, portee: Portee) -> PathBuf {
    dossier.join(format!("{}.{}", assaini(id), portee.extension()))
}

/// Lit un résumé déjà produit, ou `None`.
///
/// Un résumé illisible vaut un résumé absent : il sera simplement refait. On
/// ne remonte pas d'erreur pour ça — la page a sa ligne composée localement.
pub fn lire_resume(dossier: &Path, id: &str) -> Option<crate::llm::Resume> {
    lire_resume_de(dossier, id, Portee::Numero)
}

/// Même lecture, pour une portée choisie.
pub fn lire_resume_de(dossier: &Path, id: &str, portee: Portee) -> Option<crate::llm::Resume> {
    let texte = std::fs::read_to_string(chemin_resume_de(dossier, id, portee)).ok()?;
    let resume: crate::llm::Resume = serde_json::from_str(&texte).ok()?;

    // Un résumé produit sous une consigne antérieure est traité comme absent :
    // il sera refait une fois, puis plus jamais. Sans cela, ceux d'hier
    // restaient à l'écran avec le vocabulaire d'hier, et aucun geste de
    // l'utilisateur ne pouvait les rafraîchir.
    (resume.generation == crate::llm::GENERATION_RESUME).then_some(resume)
}

/// Range un résumé. Un échec d'écriture ne fait rien échouer : le résumé sera
/// refait au prochain relevé, ce qui coûte un appel et rien d'autre.
pub fn ranger_resume(dossier: &Path, id: &str, resume: &crate::llm::Resume) {
    ranger_resume_de(dossier, id, Portee::Numero, resume);
}

/// Même rangement, pour une portée choisie.
pub fn ranger_resume_de(dossier: &Path, id: &str, portee: Portee, resume: &crate::llm::Resume) {
    let _ = std::fs::create_dir_all(dossier);
    let Ok(json) = serde_json::to_string(resume) else {
        return;
    };
    if let Err(e) = crate::cache::ecrire_prive(&chemin_resume_de(dossier, id, portee), &json) {
        log::info!("résumé non mis en cache : {e}");
    }
}

/// Lit un corps déjà rangé, ou `None`.
pub fn lire(dossier: &Path, id: &str) -> Option<CorpsMessage> {
    let texte = std::fs::read_to_string(chemin_cache(dossier, id)).ok()?;
    serde_json::from_str(&texte).ok()
}

/// Range un corps. Un échec d'écriture n'est pas une raison de ne rien rendre.
///
/// Lisible du seul propriétaire, comme les relevés. Ces fichiers portent le
/// texte intégral des messages : ils étaient écrits en `0644`, donc lisibles par
/// tout autre compte de la machine, là où la simple liste des expéditeurs, elle,
/// était bien protégée. C'était l'inverse de ce qu'il fallait.
pub fn ranger(dossier: &Path, id: &str, corps: &CorpsMessage) {
    let _ = std::fs::create_dir_all(dossier);
    if let Ok(texte) = serde_json::to_string(corps)
        && let Err(e) = crate::cache::ecrire_prive(&chemin_cache(dossier, id), &texte)
    {
        log::info!("corps non mis en cache : {e}");
    }
}

/// Oublie les corps — et les vignettes — dont le message n'est plus dans
/// aucune boîte.
///
/// Sans cela, le dossier ne fait que grossir : un corps y entre à chaque
/// message reçu et n'en sort jamais, images comprises — jusqu'à deux mégaoctets
/// l'image. Mesuré à trente-cinq mégaoctets après quelques jours d'usage, sans
/// aucune limite en vue.
///
/// Les boîtes sont plafonnées ([`crate::gmail::boite::PLAFOND_BOITE`]), donc le
/// dossier converge vers une taille stable au lieu de croître indéfiniment.
///
/// Rend le nombre de fichiers effacés.
pub fn oublier_les_absents(dossier: &Path, vivants: &std::collections::HashSet<String>) -> usize {
    let Ok(entrees) = std::fs::read_dir(dossier) else {
        return 0;
    };

    // Les noms de fichiers sont des identifiants assainis : on compare donc sur
    // le chemin attendu de chaque message vivant, et non sur l'identifiant brut.
    let gardes: std::collections::HashSet<PathBuf> =
        vivants.iter().map(|id| chemin_cache(dossier, id)).collect();

    // Les vignettes se reconnaissent à leur préfixe : `<message>__<piece>.png`.
    // Une photo jointe pèse le double d'un corps de message ; les oublier avec
    // lui est ce qui empêche le dossier de gonfler sans fin.
    let prefixes_vivants: std::collections::HashSet<String> =
        vivants.iter().map(|id| assaini(id)).collect();

    let mut effaces = 0;
    for entree in entrees.flatten() {
        let chemin = entree.path();

        let a_effacer = match chemin.extension().and_then(|e| e.to_str()) {
            Some("json") => !gardes.contains(&chemin),
            // Un résumé n'a pas de sens sans le message qu'il résume, et il a
            // coûté un appel à un service tiers : il part avec lui.
            //
            // Le résumé d'une publication entière suit la même règle, parce
            // qu'il est rangé sous l'identifiant de son numéro le plus récent.
            // C'est ce qui lui donne sa date de péremption sans qu'on ait à en
            // inventer une : un numéro plus récent arrive, la clé change, et le
            // résumé d'hier s'en va avec le message qui le portait.
            Some("resume") | Some("resume-groupe") => !chemin
                .file_stem()
                .and_then(|n| n.to_str())
                .is_some_and(|n| prefixes_vivants.contains(n)),
            // La synthèse du jour, elle, n'est rangée sous aucun message : son
            // nom est une empreinte de la liste des publications, et c'est
            // cette liste qui la périme. `commands::resumes` n'en garde jamais
            // qu'une ; il n'y a rien à balayer ici, et la juger sur les
            // identifiants vivants l'effacerait à chaque passage.
            Some("synthese") => false,
            Some("png") => !chemin
                .file_stem()
                .and_then(|n| n.to_str())
                .and_then(|n| n.split_once("__"))
                .is_some_and(|(message, _)| prefixes_vivants.contains(message)),
            _ => false,
        };

        // Un fichier qu'on ne sait pas effacer sera repris au prochain
        // démarrage : rien ne justifie d'interrompre le nettoyage.
        if a_effacer && std::fs::remove_file(&chemin).is_ok() {
            effaces += 1;
        }
    }

    if effaces > 0 {
        log::info!("{effaces} fichier(s) oublié(s), faute de message");
    }
    effaces
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::modele::{Charge, CorpsPartie};

    fn encoder(texte: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(texte)
    }

    fn partie(mime: &str, contenu: &str) -> Charge {
        Charge {
            mime_type: Some(mime.into()),
            body: Some(CorpsPartie {
                data: Some(encoder(contenu)),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn l_alphabet_url_de_gmail_est_decode() {
        // Le décodeur standard échouerait sur `-`, `_` et l'absence de
        // remplissage.
        let brut = "PGI-w6nDoDwvYj4";

        assert_eq!(decoder(brut).as_deref(), Some("<b>éà</b>"));
    }

    #[test]
    fn un_corps_illisible_ne_fait_pas_disparaitre_le_message() {
        use base64::Engine;
        let invalide = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0xff, 0xfe]);

        assert!(decoder(&invalide).is_some());
    }

    #[test]
    fn le_html_est_prefere_mais_le_texte_est_conserve() {
        let message = Charge {
            mime_type: Some("multipart/alternative".into()),
            parts: vec![
                partie("text/plain", "bonjour"),
                partie("text/html", "<p>bonjour</p>"),
            ],
            ..Default::default()
        };

        let corps = extraire(&message);

        assert_eq!(corps.html.as_deref(), Some("<p>bonjour</p>"));
        assert_eq!(corps.texte.as_deref(), Some("bonjour"));
    }

    #[test]
    fn le_html_est_trouve_meme_imbrique() {
        // `multipart/related` range le HTML sous un niveau de plus, avec les
        // images qu'il référence.
        let message = Charge {
            mime_type: Some("multipart/mixed".into()),
            parts: vec![Charge {
                mime_type: Some("multipart/related".into()),
                parts: vec![partie("text/html", "<p>ici</p>")],
                ..Default::default()
            }],
            ..Default::default()
        };

        assert_eq!(extraire(&message).html.as_deref(), Some("<p>ici</p>"));
    }

    #[test]
    fn un_message_simple_sans_parties_est_lu() {
        assert_eq!(
            extraire(&partie("text/plain", "juste du texte"))
                .texte
                .as_deref(),
            Some("juste du texte")
        );
    }

    #[test]
    fn une_piece_jointe_n_est_pas_prise_pour_le_corps() {
        // Une facture en HTML jointe au message remplacerait sinon le message.
        let mut jointe = partie("text/html", "<p>facture</p>");
        jointe.filename = Some("facture.html".into());

        let message = Charge {
            mime_type: Some("multipart/mixed".into()),
            parts: vec![jointe, partie("text/html", "<p>le vrai corps</p>")],
            ..Default::default()
        };

        assert_eq!(
            extraire(&message).html.as_deref(),
            Some("<p>le vrai corps</p>")
        );
    }

    #[test]
    fn un_message_sans_corps_ne_rend_rien() {
        let corps = extraire(&Charge::default());

        assert!(corps.est_vide());
    }

    #[test]
    fn les_scripts_disparaissent_avec_leur_contenu() {
        // Laisser le contenu afficherait du code en clair au milieu de la
        // lettre, ce qui est laid autant que suspect.
        let sale = "<p>avant</p><script>alert(1)</script><p>après</p>";

        assert_eq!(assainir(sale), "<p>avant</p><p>après</p>");
    }

    #[test]
    fn un_script_jamais_referme_emporte_toute_la_suite() {
        // Le navigateur ferait de même : mieux vaut perdre la fin du message
        // que de la rendre exécutable.
        let sale = "<p>avant</p><script>tout ce qui suit";

        assert_eq!(assainir(sale), "<p>avant</p>");
    }

    #[test]
    fn les_cadres_imbriques_sont_retires() {
        let sale = "<iframe src=\"https://ailleurs.fr\"></iframe><p>reste</p>";

        assert_eq!(assainir(sale), "<p>reste</p>");
    }

    #[test]
    fn une_balise_qui_commence_comme_script_est_conservee() {
        // `<scriptural>` n'existe pas, mais la règle doit porter sur le nom
        // entier : autrement, une balise inconnue emporterait la page.
        let html = "<scriptural>gardé</scriptural>";

        assert_eq!(assainir(html), html);
    }

    #[test]
    fn les_gestionnaires_d_evenements_sont_retires() {
        let sale = r#"<img src="x" onerror="alert(1)" alt="a">"#;

        let propre = assainir(sale);

        assert!(!propre.contains("onerror"));
        assert!(propre.contains(r#"src="x""#));
        assert!(propre.contains(r#"alt="a""#));
    }

    #[test]
    fn tout_attribut_en_on_est_retire() {
        // La règle est large à dessein : aucun attribut HTML standard ne
        // commence par `on`. Tenir la liste des événements pour épargner un
        // `once=` inventé, c'est se condamner à rater celui qui manquera.
        let sale = r#"<div onclick="x" once="1" class="c">texte</div>"#;

        let propre = assainir(sale);

        assert!(!propre.contains("onclick"));
        assert!(!propre.contains("once"));
        assert!(propre.contains(r#"class="c""#));
        assert!(propre.contains("texte"));
    }

    #[test]
    fn les_liens_executables_sont_retires() {
        let sale = r#"<a href="javascript:alert(1)">clic</a>"#;

        assert!(!assainir(sale).contains("javascript:"));
    }

    #[test]
    fn un_message_ordinaire_traverse_sans_dommage() {
        // La désinfection ne doit pas abîmer ce qu'elle ne comprend pas : la
        // plupart des lettres sont des tableaux et des styles en ligne.
        let sain = r#"<table style="width:100%"><tr><td class="a">
            <a href="https://exemple.fr">Voir</a><img src="cid:logo"></td></tr></table>"#;

        assert_eq!(assainir(sain), sain);
    }

    #[test]
    fn les_sources_d_images_sont_relevees_dans_l_ordre_sans_doublon() {
        let html = r#"<img src="cid:logo"><p>x</p><img src='https://a.fr/1.png'>
            <img src="cid:logo"><img src="data:image/png;base64,AA">"#;

        assert_eq!(sources_d_images(html), ["cid:logo", "https://a.fr/1.png"]);
    }

    #[test]
    fn le_nombre_d_images_relevees_est_borne() {
        // Sans borne, un document de mille images ferait attendre l'utilisateur
        // sans rien lui apprendre de plus.
        let html: String = (0..IMAGES_MAX + 20)
            .map(|i| format!(r#"<img src="https://a.fr/{i}.png">"#))
            .collect();

        assert_eq!(sources_d_images(&html).len(), IMAGES_MAX);
    }

    #[test]
    fn une_balise_qui_commence_comme_img_n_est_pas_relevee() {
        assert!(sources_d_images(r#"<image src="https://a.fr/1.png"/>"#).is_empty());
    }

    #[test]
    fn les_images_connues_sont_substituees_et_les_autres_laissees() {
        let html = r#"<img src="cid:logo" alt="a"><img src="https://a.fr/2.png">"#;
        let table = HashMap::from([(
            "cid:logo".to_string(),
            "data:image/png;base64,AA".to_string(),
        )]);

        let sortie = substituer_images(html, &table);

        assert!(sortie.contains(r#"src="data:image/png;base64,AA" alt="a""#));
        // Celle qu'on n'a pas su rapatrier garde son adresse : le cadre ne la
        // chargera pas, mais son texte de remplacement s'affichera.
        assert!(sortie.contains(r#"src="https://a.fr/2.png""#));
    }

    #[test]
    fn un_content_id_est_debarrasse_de_ses_chevrons() {
        // L'en-tête écrit `<abc@def>`, le document écrit `cid:abc@def`.
        let charge = Charge {
            mime_type: Some("multipart/related".into()),
            parts: vec![Charge {
                mime_type: Some("image/png".into()),
                headers: vec![crate::gmail::modele::Entete {
                    name: "Content-ID".into(),
                    value: "<abc@def>".into(),
                }],
                body: Some(CorpsPartie {
                    attachment_id: Some("piece-1".into()),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        };

        let table = pieces_par_cid(&charge);

        assert_eq!(
            table.get("cid:abc@def").map(String::as_str),
            Some("piece-1")
        );
    }

    #[test]
    fn une_partie_sans_piece_jointe_n_entre_pas_dans_la_table() {
        // Le corps HTML lui-même porte parfois un `Content-ID` ; le prendre pour
        // une image produirait une substitution absurde.
        let charge = Charge {
            headers: vec![crate::gmail::modele::Entete {
                name: "Content-ID".into(),
                value: "<corps>".into(),
            }],
            body: Some(CorpsPartie {
                data: Some("AA".into()),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(pieces_par_cid(&charge).is_empty());
    }

    #[test]
    fn un_corps_range_se_relit() {
        let dossier = tempfile::tempdir().unwrap();
        let corps = CorpsMessage {
            html: Some("<p>a</p>".into()),
            texte: None,
            pieces: Vec::new(),
        };

        ranger(dossier.path(), "m1", &corps);

        assert_eq!(lire(dossier.path(), "m1"), Some(corps));
        assert_eq!(lire(dossier.path(), "inconnu"), None);
    }

    #[test]
    fn le_nom_de_fichier_ne_peut_pas_sortir_du_dossier() {
        // L'identifiant vient de Gmail : il ne sert jamais tel quel.
        let dossier = Path::new("/tmp/corps");
        let chemin = chemin_cache(dossier, "../../etc/passwd");

        assert_eq!(chemin.parent(), Some(dossier));
        let nom = chemin.file_name().unwrap().to_string_lossy();
        assert!(!nom.contains('/') && !nom.contains(".."), "nom : {nom}");
    }

    #[test]
    fn un_corps_demesure_est_refuse() {
        use base64::Engine;
        let enorme =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(vec![b'a'; TAILLE_MAX + 1]);

        assert!(decoder(&enorme).is_none());
    }

    /// Le nettoyage efface des fichiers : ce qu'il garde compte autant que ce
    /// qu'il enlève.
    mod oubli {
        use super::*;
        use std::collections::HashSet;

        fn un_corps() -> CorpsMessage {
            CorpsMessage {
                html: Some("<p>bonjour</p>".into()),
                texte: None,
                pieces: Vec::new(),
            }
        }

        #[test]
        fn le_corps_d_un_message_disparu_est_efface_celui_d_un_message_vivant_reste() {
            let dossier = tempfile::tempdir().unwrap();
            ranger(dossier.path(), "vivant", &un_corps());
            ranger(dossier.path(), "disparu", &un_corps());

            let vivants = HashSet::from(["vivant".to_string()]);
            assert_eq!(oublier_les_absents(dossier.path(), &vivants), 1);

            assert!(lire(dossier.path(), "vivant").is_some());
            assert!(lire(dossier.path(), "disparu").is_none());
        }

        fn un_resume() -> crate::llm::Resume {
            crate::llm::Resume {
                texte: "Le prix du blé grimpe.".into(),
                hashtags: vec!["agriculture".into()],
                generation: crate::llm::GENERATION_RESUME,
            }
        }

        #[test]
        fn un_resume_ecrit_sous_une_ancienne_consigne_est_refait() {
            // La consigne du modèle change — d'une phrase à trois, de
            // « numéros » à « mails ». Les résumés d'hier restaient sinon à
            // l'écran avec le vocabulaire d'hier, et aucun geste de
            // l'utilisateur ne pouvait les rafraîchir.
            let dossier = tempfile::tempdir().unwrap();
            let perime = crate::llm::Resume {
                generation: crate::llm::GENERATION_RESUME - 1,
                ..un_resume()
            };
            ranger_resume(dossier.path(), "m1", &perime);

            assert!(lire_resume(dossier.path(), "m1").is_none());
        }

        #[test]
        fn un_resume_de_la_generation_courante_est_garde() {
            // L'autre moitié de la garantie : un résumé coûte un appel, et on
            // ne le refait pas sans raison.
            let dossier = tempfile::tempdir().unwrap();
            ranger_resume(dossier.path(), "m1", &un_resume());

            assert!(lire_resume(dossier.path(), "m1").is_some());
        }

        #[test]
        fn un_resume_de_publication_ne_recouvre_pas_celui_d_un_numero() {
            // Ils se rangent sous le même identifiant — celui du mail le plus
            // récent — et ne se distinguent que par leur extension.
            let dossier = tempfile::tempdir().unwrap();
            let publication = crate::llm::Resume {
                texte: "Trois offres à Rennes.".into(),
                ..un_resume()
            };

            ranger_resume(dossier.path(), "m1", &un_resume());
            ranger_resume_de(dossier.path(), "m1", Portee::Publication, &publication);

            assert_eq!(
                lire_resume(dossier.path(), "m1").map(|r| r.texte),
                Some("Le prix du blé grimpe.".to_string())
            );
            assert_eq!(
                lire_resume_de(dossier.path(), "m1", Portee::Publication).map(|r| r.texte),
                Some("Trois offres à Rennes.".to_string())
            );
        }

        #[test]
        fn un_resume_survit_au_balayage_qui_efface_les_corps() {
            // Le piège évité : nommer le résumé `<id>.resume.json` l'aurait
            // rangé parmi les corps, et le balayage l'aurait effacé à la
            // seconde même où il venait d'être écrit — un appel payé pour rien
            // à chaque relevé.
            let dossier = tempfile::tempdir().unwrap();
            ranger(dossier.path(), "vivant", &un_corps());
            ranger_resume(dossier.path(), "vivant", &un_resume());

            oublier_les_absents(dossier.path(), &HashSet::from(["vivant".to_string()]));

            assert_eq!(
                lire_resume(dossier.path(), "vivant").map(|r| r.texte),
                Some("Le prix du blé grimpe.".to_string())
            );
        }

        #[test]
        fn un_resume_disparait_avec_le_message_qu_il_resumait() {
            let dossier = tempfile::tempdir().unwrap();
            ranger_resume(dossier.path(), "vivant", &un_resume());
            ranger_resume(dossier.path(), "disparu", &un_resume());

            oublier_les_absents(dossier.path(), &HashSet::from(["vivant".to_string()]));

            assert!(lire_resume(dossier.path(), "vivant").is_some());
            assert!(lire_resume(dossier.path(), "disparu").is_none());
        }

        #[test]
        fn un_resume_illisible_vaut_un_resume_absent() {
            // Il sera simplement refait ; la page a sa ligne composée
            // localement en attendant, et rien ne doit remonter en erreur.
            let dossier = tempfile::tempdir().unwrap();
            std::fs::write(chemin_resume(dossier.path(), "abime"), "{ pas du json").unwrap();

            assert!(lire_resume(dossier.path(), "abime").is_none());
        }

        #[test]
        fn une_vignette_disparait_avec_le_message_qui_la_portait() {
            // Une photo jointe pèse davantage qu'un corps de message : la
            // laisser derrière rendrait le nettoyage inutile.
            let dossier = tempfile::tempdir().unwrap();
            ranger(dossier.path(), "vivant", &un_corps());
            ranger_vignette(dossier.path(), "vivant", "p1", "png-de-la-vivante");
            ranger_vignette(dossier.path(), "disparu", "p1", "png-de-la-disparue");

            let vivants = std::collections::HashSet::from(["vivant".to_string()]);
            oublier_les_absents(dossier.path(), &vivants);

            assert_eq!(
                lire_vignette(dossier.path(), "vivant", "p1").as_deref(),
                Some("png-de-la-vivante")
            );
            assert!(lire_vignette(dossier.path(), "disparu", "p1").is_none());
        }

        #[cfg(unix)]
        #[test]
        fn une_vignette_n_est_lisible_que_par_son_proprietaire() {
            // Elle porte l'image d'une pièce jointe : la même donnée
            // personnelle que le corps du message, la même protection.
            use std::os::unix::fs::PermissionsExt;

            let dossier = tempfile::tempdir().unwrap();
            ranger_vignette(dossier.path(), "m1", "p1", "png");

            let mode = std::fs::metadata(chemin_vignette(dossier.path(), "m1", "p1"))
                .unwrap()
                .permissions()
                .mode();

            assert_eq!(mode & 0o777, 0o600, "mode obtenu : {:o}", mode & 0o777);
        }

        #[test]
        fn le_cache_cesse_de_grossir_au_fil_des_releves() {
            // Le défaut d'origine : chaque relevé ajoutait des corps, aucun n'en
            // retirait. Ici, dix relevés successifs de deux messages chacun —
            // le dossier doit rester à deux fichiers, pas monter à vingt.
            let dossier = tempfile::tempdir().unwrap();

            for tour in 0..10 {
                let ids = [format!("m{}", tour * 2), format!("m{}", tour * 2 + 1)];
                for id in &ids {
                    ranger(dossier.path(), id, &un_corps());
                }
                oublier_les_absents(dossier.path(), &ids.iter().cloned().collect());
            }

            let restants = std::fs::read_dir(dossier.path()).unwrap().count();
            assert_eq!(restants, 2, "le dossier doit se stabiliser, pas gonfler");
        }

        #[test]
        fn un_dossier_absent_ne_fait_pas_echouer_le_nettoyage() {
            let vide = Path::new("/tmp/mailflow-dossier-qui-n-existe-pas");
            assert_eq!(oublier_les_absents(vide, &HashSet::new()), 0);
        }

        #[test]
        #[cfg(unix)]
        fn le_texte_des_messages_n_est_lisible_que_par_son_proprietaire() {
            // Ces fichiers portent le contenu intégral du courrier. Ils étaient
            // écrits en 0644, quand la simple liste des expéditeurs, elle, était
            // bien en 0600 : exactement l'inverse de ce qu'il fallait.
            use std::os::unix::fs::PermissionsExt;

            let dossier = tempfile::tempdir().unwrap();
            ranger(dossier.path(), "m1", &un_corps());

            let droits = std::fs::metadata(chemin_cache(dossier.path(), "m1"))
                .unwrap()
                .permissions()
                .mode();

            assert_eq!(droits & 0o777, 0o600, "droits : {:o}", droits & 0o777);
        }
    }
}
