# Publication sur F-Droid

F-Droid ne fonctionne pas comme GitHub Releases ou le Play Store : il n'existe
aucun moyen de « pousser » un APK vers F-Droid. Le projet compile lui-même
chaque application depuis ses sources, à partir d'une recette de build
déclarée dans son propre dépôt, **gitlab.com/fdroid/fdroiddata** (sur GitLab,
hors de portée de cette session — aucun accès n'y est configuré ici).

Ce dossier prépare tout ce qui dépend du dépôt source, pour qu'une soumission
soit ensuite rapide à faire manuellement.

## Ce qui est prêt

- **`fastlane/metadata/android/en-US/` et `…/fr-FR/`** : titre, description
  courte, description longue, icône (512×512) et captures au format `fastlane`,
  que F-Droid (et d'autres stores) reprennent automatiquement pour la fiche de
  l'application. `en-US` est le dossier de repli : sans lui, un utilisateur dont
  la langue n'est pas le français voit une fiche vide — leur revue le réclame.
- **`fdroid/eu.lielu.news.yml`** : recette de build, épinglée sur le **hash
  complet** du commit de `v1.3.0`, à coller dans `metadata/eu.lielu.news.yml`
  sur `fdroiddata`.
- **Captures d'écran** dans
  `fastlane/metadata/android/fr-FR/images/phoneScreenshots/` : les deux modes,
  Actus et Apprendre. F-Droid en demande au moins une.
- **Le tag `v1.3.0`**, posé sur le `main` publié.
- Licence MIT, permission Android unique (`INTERNET`), aucune dépendance
  Google Play Services / Firebase / SDK propriétaire — l'app remplit déjà les
  critères de base d'inclusion (logiciel libre, buildable sans service tiers
  non libre pour la compilation elle-même).

## À refaire à chaque version publiée

F-Droid compile depuis un tag, avec un Gradle nu — pas de `-PversionCode` comme
en CI — puis **vérifie que l'APK obtenu porte bien la version annoncée par la
recette**. Trois endroits doivent donc dire la même chose, sans quoi le build
est rejeté :

1. `android/app/build.gradle` : `versionCode` et `versionName` dans
   `defaultConfig`, **écrits en clair** (c'est ce que produit le Gradle nu de
   F-Droid, et la seule forme que sait lire leur analyseur) ;
2. `fdroid/eu.lielu.news.yml` : `versionName`, `versionCode`, `commit` (le
   **hash complet**, pas le tag : un tag se déplace, ils le refusent),
   `CurrentVersion`, `CurrentVersionCode` ;
3. le tag git lui-même, `vX.Y.Z`, posé sur le commit publié.

L'ordre compte : le tag se pose **après** le commit qui aligne les deux
premiers, puisque F-Droid ne voit du dépôt que ce que contient le commit tagué.
Un tag posé trop tôt embarque l'ancienne version de `build.gradle` et fait échouer
la vérification de version — il faut alors le déplacer (`git tag -f`) plutôt
que de retoucher la recette.

Le `versionCode` se déduit de la version — majeur × 10⁸ + mineur × 10⁶ +
correctif × 10⁴, soit `103020000` pour 1.3.2 — donc il croît tout seul, sans
compteur à tenir. `package.json` suit aussi la version, mais seulement pour
nommer les APK produits par la CI.

Les quatre chiffres de queue sont laissés à zéro **à dessein** : c'est le
palier dans lequel `android.yml` range ses builds de `main`, sous le tag à
venir (`103020000 − 10000 + numéro de run`). Le barème d'origine était plus
serré — majeur × 10000 + mineur × 100 + correctif, `10300` pour 1.3.0 — et ne
laissait aucune place à ces préversions : un APK de `main` portait alors le
numéro de run nu, donc un `versionCode` inférieur à celui du dernier tag, donc
ininstallable par-dessus une version publiée. L'élargissement a eu lieu en
1.3.2 et fait sauter le `versionCode` de `10301` à `103020000`. Un saut est
sans conséquence côté F-Droid — seule la croissance compte — mais il est
**irréversible** : rien ne permet de revenir à des valeurs plus petites.
La recette ne garde qu'**une seule** entrée `Builds:`, celle de la version
courante — demandé en revue par licaon-kter, voir plus bas. Les entrées des
versions précédentes (1.3.0, 1.4.1) ont été retirées plutôt que conservées
comme preuve historique : `AutoUpdateMode: Version` ajoute de toute façon une
entrée par tag une fois la recette acceptée, la revue initiale n'a besoin que
d'un build qui marche pour la version courante.

## Build reproductible : l'APK publié doit exister, et coïncider

Depuis la revue de leur MR, la recette déclare `Binaries:` et
`AllowedAPKSigningKeys:`. F-Droid recompile alors le tag, **télécharge notre
APK** et compare les deux (signature exclue) :

- s'ils coïncident, c'est **notre** binaire, signé de **notre** clé, qui est
  distribué — un paquet installé depuis GitHub se met à jour depuis F-Droid, et
  réciproquement ;
- s'ils diffèrent, ou si l'URL ne répond pas, **le build échoue** et la version
  n'est pas publiée.

D'où deux obligations nouvelles à chaque version :

1. **`.github/workflows/release.yml` doit avoir tourné pour le tag.** Il compile
   avec un **Gradle nu**, sans `-PversionCode`/`-PversionName` — contrairement à
   `android.yml`, dont l'APK porte le numéro de run (`1.3.0.57`) et ne peut donc
   pas servir ici. Il publie le fichier à l'adresse exacte qu'attend
   `Binaries:` :
   `releases/download/vX.Y.Z/swipernews-X.Y.Z.apk`. Renommer l'un ou l'autre
   casse la vérification.
2. **La clé de signature ne change pas.** `AllowedAPKSigningKeys` porte
   l'empreinte SHA-256 du certificat des secrets `ANDROID_*`
   (`cc849a79…6238`) ; un APK signé d'une autre clé est rejeté. Se relit sur un
   APK publié avec `apksigner verify --print-certs`.

Un tag posé avant que ce workflow n'existe ne l'a évidemment pas déclenché
(Actions lit le fichier dans le ref choisi) : lancer alors le workflow à la main
depuis `main`, en renseignant l'entrée `tag` — c'est ce qui a servi à publier
l'APK de `v1.2.0` après coup.

## Ce qui reste à faire, à la main

La demande d'inclusion est **ouverte et en cours de revue** :
[fdroiddata!44729](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/44729).
GitLab est hors de portée de ce dépôt (aucun accès configuré ici) — ce qui suit
se fait donc à la main, sur `fdroiddata` :

> **La MR porte le libellé `waiting-for-upstream`** : pour F-Droid, la balle est
> dans notre camp, et aucun relecteur ne la reprendra tant qu'il y sera. Ce
> n'est donc pas une file d'attente, c'est une action à faire ici.

1. **Copier `fdroid/metadata/eu.lielu.news.yml`** dans
   `metadata/eu.lielu.news.yml` sur la branche de la MR, et pousser. Celui-là,
   et pas `fdroid/eu.lielu.news.yml` : c'est un copier-coller direct, sans
   retouche.

   Les DEUX fichiers portent la même recette, sous deux formes :

   | Fichier | À quoi il sert |
   | --- | --- |
   | `fdroid/eu.lielu.news.yml` | la référence **commentée** — le pourquoi de chaque champ, à lire et à modifier |
   | `fdroid/metadata/eu.lielu.news.yml` | la forme **canonique**, prête à coller chez eux |

   Toute modification se fait dans le fichier commenté PUIS se reporte dans le
   canonique. Ils doivent dire exactement la même chose ; le seul écart permis
   est la forme.

   La forme canonique est celle de `fdroid rewritemeta` : **aucun commentaire**,
   `versionName` et `CurrentVersion` **non quotés**. Deux détails relevés sur de
   VRAIS fichiers de `fdroiddata`, et que leur CI vérifie : la ligne `Binaries:`
   est **repliée** — « `Binaries:` », une espace EN FIN DE LIGNE, saut de ligne,
   l'URL indentée de deux espaces — parce que sa valeur dépasse 80 colonnes
   (voir `metadata/org.fossify.gallery.yml` chez eux) ; `AllowedAPKSigningKeys:`
   ne l'est pas, ses 64 caractères restant sous le seuil (voir
   `metadata/org.briarproject.briar.android.yml`). En cas de doute, `fdroid
   rewritemeta eu.lielu.news` tranche.
2. **Reprendre la description de la MR avec leur gabarit « App inclusion »** et
   cocher toutes les cases obligatoires — demandé en revue, et cela ne concerne
   que GitLab, pas ce dépôt. Le gabarit vit dans
   `.gitlab/merge_request_templates/App inclusion.md` de `fdroiddata`.
   Il n'y a **aucune issue RFP** pour cette app (vérifié : la recherche ne rend
   rien) : la ligne `Closes rfp#…` est donc à supprimer, comme le gabarit le
   demande lui-même.
3. **Poster un commentaire** après avoir poussé. Une description modifiée ne
   notifie PERSONNE : sans commentaire, la MR reste invisible pour eux, quoi
   qu'on ait poussé.

   **Ne pas compter sur `/unlabel ~"waiting-for-upstream"`** : gérer les
   libellés demande le rôle Reporter sur `fdroiddata`, qu'un contributeur
   externe n'a pas. La commande rapide échoue silencieusement. Il faut donc
   DEMANDER le retrait du libellé dans le commentaire — c'est un membre qui
   l'ôtera.

   Mentionner un relecteur par son identifiant lui pose une tâche GitLab, ce
   qui est le signal le plus efficace. `@licaon-kter` est vérifié ; en revanche
   `duckniii`, cité plus bas dans ce fichier, n'est PAS un identifiant GitLab
   valide (l'API ne le connaît pas) — le reprendre tel quel donnerait une
   mention inerte. Copier l'identifiant exact depuis le fil de la MR.

## Ce que la revue de la MR a demandé (et où c'est corrigé)

| Demande | De qui | Corrigé dans |
| --- | --- | --- |
| `commit:` = hash complet, pas le tag `v1.2.0` | duckniii | `eu.lielu.news.yml` |
| Supprimer `output:` | duckniii | **non applicable** — il est indispensable ici (voir ci-dessous) |
| Ajouter `Binaries` et `AllowedAPKSigningKeys` (build reproductible) | duckniii | `eu.lielu.news.yml` + `.github/workflows/release.yml` |
| Ajouter un dossier `en-US` dans `fastlane` | duckniii | `fastlane/metadata/android/en-US/` |
| Utiliser le gabarit « App inclusion » et cocher les cases | duckniii | à faire sur GitLab (voir ci-dessus) |
| Node depuis Debian `forky`, pas depuis un script NodeSource | licaon-kter | `eu.lielu.news.yml` |
| `prebuild:` au lieu d'`init:`, `scandelete:` plutôt qu'une liste de `scanignore:` | licaon-kter | `eu.lielu.news.yml` |
| Les binaires de `sharp`/vips ne devraient pas être là | licaon-kter | contournés par `scandelete:` ; à supprimer pour de bon en sortant `@capacitor/assets` des `devDependencies`, une fois la MR acceptée |
| Ne garder qu'une seule entrée `Builds:` (la dernière), pas l'historique des versions publiées | licaon-kter | `eu.lielu.news.yml` — 1.3.0 et 1.4.1 retirées, seule 1.5.0 reste |

Le bloc de suggestion de licaon-kter reconduisait `output:` — il l'avait
simplement recopié du fichier d'alors. Ne pas l'appliquer tel quel : duckniii
avait justement demandé sa suppression.

## Ce que le premier build F-Droid a appris

`f-droid.org` est bloqué depuis l'environnement de développement de ce dépôt,
mais les sources de `fdroidserver` sont lisibles sur GitLab — c'est la référence
à consulter en cas de doute sur un champ de recette.

- **`init:` comme `prebuild:` s'exécutent dans `subdir:`**, donc dans
  `android/`, et non à la racine du dépôt (`INFO: Running 'init' commands in
  build/eu.lielu.news/android`). `npm ci` fonctionne quand même, npm remontant
  jusqu'au `package.json` le plus proche ; ne pas « corriger » par un `cd ..`,
  qui ne marcherait plus si leur outil changeait de répertoire de travail. La
  recette utilise `prebuild:`, demandé en revue : il s'exécute plus tard, juste
  avant le scan et la compilation.
- **Le scanner refuse tout binaire pré-compilé dans l'arbre des sources**, et
  `npm ci` en dépose une poignée dans `node_modules` (sharp, `tsc`, les JAR de
  `@trapezedev/gradle-parse`, les gabarits `.tar.gz` de la CLI Capacitor). Deux
  parades, et la recette utilise les deux :
  - `scanignore:` désigne un fichier à ne pas signaler. Il est strict dans les
    deux sens : un chemin qui n'existe pas **et** un chemin qui ne masque
    aucune erreur sont tous deux des erreurs.
  - `scandelete:` **ne supprime pas le dossier** qu'on lui donne — le scanner
    efface uniquement les fichiers qu'il incrimine dedans (`scanner.py`,
    `removeproblem`). Sans danger ici : le scan tourne après `prebuild` (donc
    après `cap sync`), et `@capacitor/android` — le seul module de
    `node_modules` dont Gradle dépende, via `android/capacitor.settings.gradle`
    — ne contient aucun binaire.

  `scanignore` est testé **avant** `scandelete` (`scanner.py`, `scanproblem`) :
  un chemin couvert par les deux compte comme « utilisé » du côté `scanignore`,
  et aucun des deux ne remonte d'erreur « unused ».
- **Le nodejs de Debian stable est trop vieux** pour la CLI Capacitor 8 (Node 22
  minimum), d'où le dépôt `forky` (testing) dans `sudo:`. Ne pas revenir à un
  `curl https://deb.nodesource.com/… | bash` : faire exécuter un script tiers à
  l'aveugle dans leur buildserver leur a été reproché en revue.
- **La reproductibilité a été mesurée, pas supposée** : l'APK produit par leur
  CI pour `10200` et celui publié par `release.yml` ont **490 entrées
  identiques** — mêmes noms, même ordre, mêmes CRC, mêmes tailles, mêmes
  horodatages, même compression. Seule diffère la signature. C'est exactement
  ce que compare `fdroid verify`. À refaire à chaque version, avant de taguer
  si possible :

  ```bash
  python3 - <<'EOF'
  import zipfile, re
  SIG = re.compile(r'^META-INF/[^/]*\.(SF|RSA|DSA|EC)$|^META-INF/MANIFEST\.MF$')
  sig = lambda p: [(i.filename, i.CRC) for i in zipfile.ZipFile(p).infolist()
                   if not SIG.match(i.filename)]
  print(sig("swipernews-X.Y.Z.apk") == sig("eu.lielu.news_NNNNN.signed.apk"))
  EOF
  ```
- **`UpdateCheckMode: Tags` accepte une expression régulière** en argument
  (`checkupdates.py` : `pattern = mode[5:]`).
- **L'AGP ajoute un bloc de signature que F-Droid refuse.** Symptôme, au stade
  du scan et non du build : `found extra signing block 'Dependency metadata'`,
  sur `tmp/binaries/…binary.apk`, c'est-à-dire **notre** APK téléchargé pour la
  vérification. C'est la liste chiffrée des dépendances que Gradle destine à
  Google Play. Elle n'apparaît **que lorsque Gradle signe lui-même** : l'APK non
  signé que compile F-Droid ne l'a pas, le nôtre si — d'où un rejet qui ne peut
  pas se voir avant d'avoir publié un binaire. Le remède est dans les sources,
  au niveau `android` de `android/app/build.gradle` (pas dans `defaultConfig`,
  Gradle n'y connaît pas la méthode) :

  ```gradle
  dependenciesInfo {
      includeInApk = false
      includeInBundle = false
  }
  ```

  Le bloc vit entre les entrées du zip et le catalogue central : il n'est donc
  **pas** une entrée d'archive, et son retrait ne change rien à la comparaison
  du build reproductible. Pour vérifier ce que contient un APK :

  ```bash
  python3 - <<'EOF'
  import struct
  d=open("swipernews-X.Y.Z.apk","rb").read(); i=d.rfind(b"APK Sig Block 42")
  size=struct.unpack_from("<Q",d,i-8)[0]; q=i+16-8-size+8; ids=[]
  while q < i-8:
      ln=struct.unpack_from("<Q",d,q)[0]; q+=8
      ids.append(hex(struct.unpack_from("<I",d,q)[0])); q+=ln
  print(ids)   # 0x504b4453 = « Dependency metadata », à ne pas y trouver
  EOF
  ```
- **`output:` est indispensable, même si on demande de l'enlever.** Le retirer
  fait échouer le build sur `Failed to find any output apks` — *après* un
  `BUILD SUCCESSFUL` de Gradle, ce qui égare. Sans ce champ, fdroidserver ne
  cherche l'APK que dans trois répertoires, tous relatifs à `subdir` (build.py,
  `omethod == 'gradle'`) : `build/outputs/apk/release`, `build/outputs/apk`,
  `build/apk`. Or un projet Capacitor produit le sien un niveau plus bas, dans
  le module `app`. Renseigner `output:` bascule sur `omethod == 'raw'`, qui
  prend le chemin tel quel — c'est le seul moyen de désigner un APK hors de ces
  trois dossiers.
- **Leur CI impose la forme canonique de `fdroid rewritemeta`**, au caractère
  près : elle rejoue l'outil et refuse le moindre écart (« These files need
  rewritemeta »). Trois règles s'en déduisent, toutes rencontrées :
  - **l'ordre des champs** est celui de `yaml_app_field_order` (metadata.py) —
    `Binaries` juste après `Repo`, `AllowedAPKSigningKeys` **après** le bloc
    `Builds`, et dans un build : `sudo`, `gradle`, `prebuild`, `scanignore`,
    `scandelete` ;
  - **les lignes de plus de 80 colonnes sont repliées** : la valeur passe à la
    ligne, indentée de deux espaces, et la clé garde **une espace finale**
    (`Binaries: ` puis saut de ligne). Invisible à l'œil, fatal pour leur
    comparaison — leur `.yamllint` ne classe d'ailleurs `trailing-spaces` qu'en
    avertissement, justement parce que leur propre outil en produit ;
  - **le fichier se termine par un saut de ligne.**

  Se vérifier soi-même sans installer `fdroidserver` (impossible ici, `clint` ne
  se compile plus) : leur image Debian trixie embarque `ruamel.yaml` 0.18.10, et
  `write_yaml` n'est qu'un aller-retour avec des réglages précis. Le reproduire
  suffit — attention, une autre version de `ruamel` replie *plus* de lignes et
  donne un faux positif :

  ```bash
  pip install "ruamel.yaml==0.18.10"
  python3 - <<'EOF'
  import io, ruamel.yaml
  src = open("metadata/eu.lielu.news.yml").read()
  y = ruamel.yaml.YAML(typ="rt"); y.indent(mapping=2, sequence=4, offset=2)
  out = io.StringIO(); y.dump(y.load(src), out)
  print("canonique :", out.getvalue() == src)
  EOF
  ```
- **Le fichier de recette est validé par un schéma JSON**, `schemas/metadata.json`
  dans `fdroiddata` — la référence à consulter avant d'inventer une valeur. Il
  donne la liste exacte des catégories (108 aujourd'hui, `News` comprise) et
  n'accepte plus `AutoUpdateMode: Version v%v`, seulement `Version` : le motif
  du tag se déduit désormais d'`UpdateCheckMode`. Se valider soi-même évite un
  aller-retour de pipeline :

  ```bash
  curl -sO https://gitlab.com/fdroid/fdroiddata/-/raw/master/schemas/metadata.json
  check-jsonschema --schemafile metadata.json metadata/eu.lielu.news.yml
  ```
- **La version doit être un littéral dans `build.gradle`.** Leur analyseur
  (`common.py`, `vcsearch_g` / `vnsearch_g`) ne lit que `versionCode 10200` et
  `versionName "1.2.0"` ; toute expression Groovy — une variable, un
  `project.findProperty(…) ?: …` — lui fait rendre un charabia et
  `fdroid checkupdates` s'arrête sur « Couldn't find any version information ».
  D'où l'écrasement par la CI écrit **après** le bloc `android`, et non dedans.
  C'est aussi ce qui rend `AutoUpdateMode: Version` possible : une fois la
  version lisible, F-Droid ajoute lui-même l'entrée `Builds` de chaque nouveau
  tag, et une version publiée ne demande plus de merge request.

## Anti-fonctionnalités à déclarer

Aucune identifiée : les polices (Inter, Source Serif 4, licence OFL) sont
auto-hébergées dans `fonts/` depuis [le remplacement de Google Fonts](../fonts/),
donc plus de dépendance réseau à un service non-libre. Pas de pub, pas de
tracking, pas de dépendance propriétaire dans le code embarqué sur Android.
