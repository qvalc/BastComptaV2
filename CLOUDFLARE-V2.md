# BastCompta V2 locale — adaptation du stockage

Lancer `npm run preview:v2` puis ouvrir `http://127.0.0.1:4173`. Node.js 22 ou supérieur est requis. L’ouverture directe de `index.html` en `file://` ne fonctionne pas avec les modules JavaScript et Firebase.

Les pages, styles, menus, calculs, formulaires, PDF et ZIP d’origine sont conservés. Les libellés du fournisseur de stockage deviennent Cloudflare. La V1 en ligne, le dépôt V1 et les données Drive ne sont pas modifiés. La publication de test concerne uniquement la V2.

## Stockage distant

`js/core/cloudflare-files.js` utilise le Worker staging existant. Une connexion Firebase validée par `/v1/me` est nécessaire. Tant que l’index V2 n’existe pas, le client lit le manifeste vérifié `migration-copy-20261117` et ses 82 fichiers. Une connexion seule ne crée pas d’index.

Les sauvegardes créent des objets R2 immuables, vérifient leur taille et leur SHA-256 puis les relisent avant de confirmer l’index D1 `bastcompta-v2-files`. Les mises à jour conservent les identifiants de fichiers attendus par les pièces jointes. Les suppressions placent un indicateur `trashed` dans cet index ; les octets initiaux et le manifeste d’import ne sont jamais supprimés ou modifiés. Les anciennes versions D1 restent gérées par les déclencheurs du Worker existant.

L’index utilise les préconditions `If-Match` / `If-None-Match`. Un conflit entre sessions provoque une erreur explicite et conserve la copie locale ; aucun remplacement automatique d’un index concurrent. Un objet envoyé avant un conflit peut rester orphelin dans R2, sans perte d’une version précédente.

Le Worker existant limite les fichiers à 10 Mio. Le client signale les fichiers trop volumineux. Le relais local n’autorise que les routes prévues : lectures du compte, du manifeste, de l’index V2 et des fichiers ; créations R2 ; mises à jour de l’index V2. Il refuse les écritures sur le manifeste d’import et les suppressions physiques.

## Intégration à l’application existante

`cloudflare-bootstrap.js` est chargé avant les scripts de chaque page. Il adapte les anciennes opérations de fichiers à Cloudflare, notamment les appels directs des modules Personnel, Terrain, Photos et ZIP. Les URL historiques présentes dans les scripts sont des identifiants de compatibilité, interceptés avant le réseau ; elles ne contactent pas Drive. Les SDK Google OAuth/Drive ont été retirés du HTML. Les anciens points d’entrée gapi/OAuth sont des adaptateurs locaux utilisant la session Firebase.

Le serveur local ajoute une CSP qui interdit les connexions à `www.googleapis.com`, donc à Drive. Firebase conserve ses hôtes propres. Les styles existants n’ont pas été réécrits. Le serveur écoute uniquement sur 127.0.0.1 et ne journalise ni mot de passe ni jeton.

Les données locales portent un préfixe V2 et UID. Le miroir IndexedDB utilise `BastComptaDB-v2-<UID>`. Les clés et bases V1 restent intactes. La persistance Firebase de l’instance nommée V2 utilise un espace d’authentification V2 séparé pour survivre à la transition entre l’écran de connexion et le compte connecté. Les événements de stockage sont transposés vers les noms logiques attendus par les modules. Au premier chargement d’un compte, les fichiers de synchronisation Cloudflare alimentent les clés attendues par les modules. Une copie V2 locale existante est conservée pour éviter de perdre une saisie non sauvegardée. Les modules continuent d’utiliser leur synchronisation et leurs commandes d’origine.

L’authentification Firebase utilise une instance nommée `bastcompta-v2`, commune au portail et au Terrain. Les profils et abonnements Firestore existants sont lus pour conserver les accès, mais les écritures de profil V2 sont orientées vers `bastcompta-v2-account.json` dans le catalogue Cloudflare. La collection Firestore de la V1 n’est pas écrite.

## Validation et limites restantes

`npm run check` vérifie les calculs existants, le maintien des structures HTML et les nouvelles opérations Cloudflare avec des réponses fictives : intégrité, création, mise à jour, suppression logique, conflit concurrent, limite de taille, isolation V1/V2 et restriction du relais.

Une validation des vrais écrans après connexion Firebase reste nécessaire avant de considérer la migration comme terminée : ouverture des deux exercices, devis/factures, PDF/photos, personnel, fournisseurs, Terrain, sauvegarde et restauration ZIP. Aucun mail réel ne doit être envoyé pour les essais.

Les paramètres IPP et autres données présents uniquement dans le stockage local de la V1 ou le ZIP ne figurent pas dans les 82 fichiers Drive. Ils doivent être repris via une copie de la sauvegarde, avec le mécanisme de restauration existant, avant de valider les résultats fiscaux de V2. Aucun réglage absent n’a été inventé.

### Essai de restauration isolé du 18 novembre 2026

Le ZIP réel a été contrôlé avec JSZip 3.10.1 et ses CRC. Ses 20 réglages IPP (revenus 2025, exercice 2026) sont repris exactement dans une copie privée séparée ; le module IPP réel charge ces valeurs et rend son résumé. Aucun réglage n’a été appliqué à la V2 actuelle.

Le test utilise le gestionnaire de restauration V2 et le Repository réels dans une VM Node, avec un transport D1/R2 exclusivement en mémoire et sans accès réseau. Ce n’est pas un essai de restauration sur les services Cloudflare réels. Les 81 fichiers présents dans le ZIP sont restaurés, les contenus JSON sont comparés à la source après transposition des identifiants et les autres contenus sont comparés octet par octet. Les 33 références de pièces jointes contrôlées sont résolues. La sauvegarde de départ reste inchangée. Les 82 fichiers actuels Cloudflare ne sont pas remplacés par cette archive plus ancienne.

Le restaurateur précédent recréait les fichiers sans actualiser leurs références. Le correctif local prépare tous les contenus avant écriture, ajoute des copies sous de nouveaux identifiants, transpose les références dans les données locales et distantes, puis confirme le catalogue en une seule mise à jour conditionnelle après relecture de chaque objet. Il ne supprime plus de fichiers par leur nom lors de la restauration. Les contrôles incluent le propriétaire, l’annulation, le changement de session et l’échec d’envoi ; les valeurs locales sont rétablies en cas d’échec d’écriture locale. Des objets R2 non référencés peuvent subsister si l’envoi échoue avant la confirmation du catalogue.

Le correctif de restauration peut être publié indépendamment des essais : la publication du code ne lance aucune restauration. Les essais décrits ci-dessus sont restés isolés. Le comportement de création des ZIP (notamment noms en double et fichiers ignorés) n’a pas changé.

Le Worker staging reste limité au compte déjà autorisé. L’inscription d’autres comptes ne leur donne pas automatiquement accès à Cloudflare. La publication de test conserve cette restriction ; elle ne constitue pas une ouverture du service aux autres inscrits.

## Préparation d’une préproduction en ligne séparée

`npm run build:preview` crée un dossier public filtré dans `.v2-preview/assets`. Seuls le code de l’application, ses styles, pages, logo et manifeste statique sont inclus. Les ZIP, inventaires privés, configurations et dossiers Git/Codex sont exclus. Les pages préparées et les réponses du serveur demandent aux moteurs de ne pas indexer cette préproduction.

`wrangler.v2-preview.jsonc` cible uniquement le nouveau Worker `bastcompta-v2-preview`, sur le compte Cloudflare existant. Il ne déclare aucune route ou domaine de la V1, aucune liaison D1/R2 supplémentaire et ne remplace pas `bastcompta-api-staging`. Son code `deployment/v2-preview-worker.mjs` relaie les seules opérations V2 prévues, avec le jeton Firebase, via une liaison de service vers l’API de test existante. Il ne sert pas une seconde interface : sa racine redirige vers l’adresse GitHub V2. Le service API continue de contrôler le compte autorisé. Sa configuration CORS reste inchangée.

Le `CNAME` qui désignait le domaine V1 a été retiré de la V2. Aucun changement DNS n’est nécessaire pour publier sur l’adresse workers.dev indépendante. Le déploiement se lance avec `npm run deploy:preview` après authentification officielle Wrangler. Une préparation ou un test local ne constitue pas une publication réussie : l’URL distante doit être vérifiée après déploiement.

L’adresse publique demandée reste `https://qvalc.github.io/BastComptaV2/`. Depuis cette adresse précise, le client utilise le relais séparé `https://bastcompta-v2-preview.seb-n.workers.dev/__cloudflare`. Le relais autorise le CORS de l’origine GitHub et expose les ETag nécessaires aux sauvegardes ; il exige toujours le jeton Firebase et le service API existant vérifie toujours l’UID. La politique CORS ne distingue pas les chemins des dépôts GitHub sur une même origine : l’autorisation réelle repose sur Firebase, jamais sur le CORS. La V1 et le Worker de données existant ne sont pas reconfigurés.


Le menu « Fichiers Cloudflare » utilise le catalogue privé de la V2 pour les catégories, la recherche, les aperçus et les téléchargements. Les réglages IPP récupérés séparément sont conservés dans `bastcompta-impots-ipp-settings.json` ; la connexion peut les reprendre si la clé fiscale locale est absente, sans remplacer une saisie locale existante.

## Suivi des emprunts

L’onglet Comptabilité → Emprunts conserve les prêts et leurs mensualités dans la propriété `loans` des fichiers comptables V2 existants, sans nouvelle route ni accès Drive. Les champs inconnus restent vides. Un solde bancaire confirmé exactement à la date du bilan, ou un échéancier complet explicitement confirmé jusqu’à cette date et correctement ventilé, permet de calculer la dette professionnelle. Le taux professionnel est appliqué une seule fois au capital restant dû total, jamais une seconde fois à la valeur d’actif déjà professionnelle.

Les intérêts, assurances et mensualités ne sont ni déduits automatiquement de la banque ni ajoutés automatiquement aux charges. Il faut rapprocher ces paiements avec les écritures déjà saisies. Les prêts incomplets sont signalés au bilan et dans le rapport ; le total passif connu reste partiel. Le changement d’exercice conserve les historiques de prêt, mais requiert une nouvelle confirmation de solde à la date suivante.

Le rapprochement des amortissements compare les deux listes par date, montant et durée sans les modifier. La différence observée de 109,42 € correspond aux quatre outils du 15 juillet 2026 (38,85 + 19,91 + 45,02 + 5,64), déjà comptabilisés dans les achats Braconnier en frais généraux. Elle ne doit pas être ajoutée automatiquement aux charges d’amortissement.

Chaque prêt peut aussi porter une date de fin prévue (`endDate`). La date automatique du bilan suit le calendrier belge à l’ouverture et lors du retour dans l’application ; une date manuelle existante reste respectée. La fin du prêt ne clôture pas automatiquement la dette.

Les mensualités marquées `planned: true` sont des échéances prévues, jamais des paiements confirmés. Le suivi affiche les échéances arrivées à terme à confirmer, la prochaine échéance et, si le tableau bancaire est renseigné et sa couverture confirmée, une projection du capital à la date courante. Cette projection est distincte de la dette confirmée et n’a aucun effet sur le passif, la banque ou les charges. Les montants inconnus restent inconnus ; la date de fin et la mensualité totale seules ne permettent pas d’estimer les intérêts. Aucun échéancier réel n’a été créé ou complété automatiquement.
