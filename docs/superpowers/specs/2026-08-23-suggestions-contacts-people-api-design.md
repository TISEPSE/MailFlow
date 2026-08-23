# Suggestions de destinataires depuis le carnet Google

Date : 23 août 2026
État : validé, prêt pour le plan d'implémentation

## Le problème

Le champ destinataire propose aujourd'hui n'importe quelle adresse ayant croisé
la boîte, y compris celle d'un robot d'expédition ou d'une newsletter à laquelle
on ne répond jamais. La cause est dans `contacts_synchroniser`, qui relève deux
sources et les fusionne :

- `in:sent`, 150 messages, soit les gens à qui l'on a écrit ;
- `-in:trash -in:spam`, 100 messages, soit **tout ce qui arrive**.

La seconde source est celle qu'on ne veut plus. Écrire à quelqu'un est un geste
délibéré ; recevoir de lui ne l'est pas.

## La décision

Cesser de déduire le carnet des messages, et demander à Google le vrai, celui
que l'utilisateur voit dans Gmail. Deux portées supplémentaires :

| Portée | Ce qu'elle donne | Niveau Google |
| --- | --- | --- |
| `contacts.readonly` | Le carnet d'adresses : noms, adresses, photos | Sensible |
| `contacts.other.readonly` | Les adresses collectées automatiquement par Google quand on écrit à quelqu'un | Sensible |

Les deux sont nécessaires pour retrouver ce que Gmail affiche : des contacts
nommés avec photo, **et** des adresses seules du type `baceva1993@gmail.com`,
qui ne sont dans aucun carnet mais que Google mémorise.

### Ce que ça coûte au dossier de vérification

Le niveau d'audit ne bouge pas : `gmail.modify` place déjà MailFlow en catégorie
restreinte, et deux portées sensibles de plus n'y ajoutent rien. L'écran de
consentement s'allonge de deux lignes, et la justification écrite devra dire
pourquoi un client de messagerie lit un carnet d'adresses. C'est l'usage
canonique de cette portée, la justification s'écrit en deux phrases.

### Ce que ça rapporte, sans l'avoir demandé

La synchronisation actuelle coûte 250 relevés de messages à chaque démarrage.
Elle passera à deux ou trois appels paginés. Le quota Gmail consommé au
lancement s'effondre, et le carnet est prêt plus vite.

## Portée du changement

### Autorisations

`auth/mod.rs` gagne `SCOPE_CONTACTS` et `SCOPE_AUTRES_CONTACTS`, joints aux trois
existants dans `flux.rs`. Le commentaire de `SCOPE_PROFIL`, qui justifie
aujourd'hui par écrit le refus de la People API, devient faux et doit être
réécrit.

**Conséquence inévitable : les comptes déjà reliés doivent l'être à nouveau.**
Une autorisation Google est figée à l'instant où elle est accordée ; ajouter une
portée ne l'élargit pas rétroactivement. Le jeton existant continue de servir
pour Gmail, mais l'appel aux contacts reçoit un refus.

Le refus ne doit pas se traduire par un carnet vide et silencieux. `people.rs`
distingue ce cas précis — un 403 dont le motif porte sur la portée — et le
remonte comme une erreur nommée, que l'interface traduit en une invitation à
relier le compte. Toute autre panne (réseau, quota) laisse le carnet précédent
en place plutôt que de l'effacer.

### Backend

Un module `src-tauri/src/contacts/people.rs`, monté sur `TransportHttp` et
`JetonsDeSession` déjà en service : aucune plomberie HTTP ni gestion de jeton
nouvelle.

Deux points d'entrée, tous deux paginés par `nextPageToken` :

```
GET https://people.googleapis.com/v1/people/me/connections
    ?personFields=names,emailAddresses,photos&pageSize=1000
GET https://people.googleapis.com/v1/otherContacts
    ?readMask=names,emailAddresses&pageSize=1000
```

`otherContacts` ne sert pas de photos : c'est une limite de l'API, pas un oubli.
Ces entrées s'affichent donc avec une pastille à initiale, ce que fait aussi
Gmail.

Une personne peut porter plusieurs adresses. Chacune devient une entrée
distincte du carnet, comme dans Gmail, où l'on choisit l'adresse et non la
personne.

### Modèle de données

`ContactConnu` change de forme :

```rust
pub struct ContactConnu {
    pub adresse: String,
    pub nom: String,
    pub photo: Option<String>,   // URL fournie par Google, absente sur otherContacts
    pub origine: Origine,        // Carnet | Autre
}
```

`apparitions` disparaît. Ce compteur n'avait de sens que pour un carnet déduit
des messages ; People API ne fournit aucun équivalent, et inventer un chiffre
pour garder le champ serait un mensonge de nommage. Son rôle de départage passe
à `origine` : à correspondance égale, un contact du carnet précède une adresse
collectée.

Le fichier `contacts.json` existant n'est pas migré. Il est réécrit à la
première synchronisation, laquelle survient au démarrage. Un fichier d'ancienne
forme se relit en carnet vide plutôt qu'en erreur.

### Code qui disparaît

Deux fonctions perdent leur objet et doivent partir plutôt que de rester en
sédiment :

- `contacts::fusionner` (Rust), qui agrégeait les messages en carnet ;
- `carnet()` (`src/lib/contacts.ts`), son équivalent frontend.

Leurs tests suivent. Le doublon de l'interface `Connaissance`, déclarée à la
fois dans `types/backend.ts` et dans `lib/contacts.ts`, est ramené à une seule
déclaration dans `types/backend.ts` — c'est ce doublon qui a produit l'erreur
`Cannot find name 'Connaissance'` en intégration continue.

### Frontend

Le classement ne change pas. `proposer()` s'appuie sur `rangDeCorrespondance`
(`lib/recherche.ts`), qui ordonne déjà par qualité : début de texte, puis début
de mot, puis contenu. Seul le départage secondaire passe de `apparitions` à
`origine`.

`ChampDestinataires` affiche un avatar : la photo quand Google en donne une,
sinon l'initiale sur pastille colorée, la couleur étant dérivée de l'adresse
pour rester stable d'une session à l'autre. La portion saisie est mise en gras
dans le nom comme dans l'adresse.

Les photos sont servies par `googleusercontent.com`. La politique de sécurité
de contenu de `tauri.conf.json` n'autorise aujourd'hui que `'self'`, `data:`,
`blob:` et `asset:` en `img-src` : elle doit accepter cet hôte, faute de quoi
les avatars resteront vides sans erreur visible.

### Documents à corriger

Quatre textes affirment aujourd'hui le contraire de ce qui sera vrai :

1. `site/confidentialite.html`, paragraphe 3 : « il ne demande rien concernant
   [...] vos contacts » ;
2. le tableau des portées du même document, qui n'en liste que trois ;
3. `src-tauri/src/auth/mod.rs`, qui justifie le refus de la People API ;
4. `src/lib/contacts.ts`, dont l'en-tête explique d'où vient le carnet.

`docs/connexion-google.md` gagne l'activation de la People API et les deux
portées à déclarer.

## Étapes manuelles pour l'éditeur

Deux gestes uniques, aucun récurrent, aucun visible par les utilisateurs :

1. Activer la **People API** dans la console Google Cloud, comme l'API Gmail
   l'a été. Sans cela, Google refuse les appels quel que soit le consentement.
2. Relier son propre compte à nouveau, une fois, pour obtenir les portées.

Après quoi, et pour tout nouvel utilisateur dès sa première connexion, le
carnet se remplit sans qu'on ait rien à cliquer : `App.tsx` appelle déjà
`contactsSynchroniser()` au démarrage.

## Tests

- `people.rs` : analyse des réponses, pagination sur deux pages, personne à
  plusieurs adresses, entrée sans nom, entrée sans photo, réponse vide. Le
  transport est simulé, aucun test ne touche le réseau.
- Refus de portée : un 403 de portée produit l'erreur nommée ; une panne
  réseau laisse le carnet précédent intact.
- `proposer()` : le départage par origine remplace celui par apparitions, à
  rang de correspondance égal.
- Les tests de `carnet()` et de `fusionner` sont supprimés avec elles.

## Ce que ce design ne fait pas

Il ne reproduit pas l'ordre exact de Gmail. Gmail pondère ses suggestions par
une affinité que la People API n'expose pas. Le classement retenu est
prévisible et explicable ; il ne sera pas identique au sien.

Il n'écrit rien dans les contacts : les deux portées sont en lecture seule, et
c'est délibéré.
