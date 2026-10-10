# Guide d'utilisation des skills Replica

Ce guide explique comment utiliser les 11 skills `replica-*` installées dans
`.claude/skills/`, et comment les appliquer à **MétréPro**.

Source : [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill)
(v1.0.0, licence MIT).

---

## 1. Le principe en deux minutes

Les skills Replica servent à **étudier une application existante et en
construire votre propre version** : mêmes fonctions et mêmes parcours
utilisateur, mais code, textes, logo et couleurs entièrement à vous.

Pour MétréPro, l'intérêt est double :

- **Étudier les concurrents** (JLogiciels, Attic+, etc.) : leurs écrans, leurs
  fonctions, ce que leurs utilisateurs détestent.
- **Mesurer et améliorer MétréPro** : score de parité avec un concurrent, plan
  de tests, système de design, puis lancement commercial le jour venu.

### Comment lancer une skill

Deux façons, au choix :

1. **La commande** : tapez `/replica-recon` (ou une autre) suivi de votre
   demande.
2. **En langage naturel** : « lis les avis sur JLogiciels », « qu'est-ce qui
   manque à MétréPro par rapport à X ? ». Claude choisit la skill qui
   correspond.

### Le dossier `replica/`

Chaque skill écrit ses résultats dans un dossier `replica/` à la racine du
projet, et la suivante relit ce que la précédente a écrit. **Ne supprimez pas
ce dossier** entre deux étapes. C'est un dossier de travail : il n'est jamais
livré avec l'application.

```
replica/
  recon.md            carte de l'application étudiée          (recon)
  features.csv        matrice des fonctionnalités             (recon, build, entrepreneur)
  screens/            captures de l'application d'origine     (recon)
  architecture.md     pile technique, schéma, API             (architect)
  design/             tokens.json, tokens.css, components.md  (design)
  build-log.md        journal de construction                 (build)
  clone-screens/      captures de votre version               (build)
  backend.md          checklist backend et sécurité           (backend)
  test-plan.md        plan de tests                           (test)
  bugs.md             bugs trouvés, par gravité               (test)
  parity.md           score de parité et ce qui manque        (diff)
  reviews.csv         avis réels collectés                    (entrepreneur)
  feedback.md         avis classés par thème                  (entrepreneur)
  fixes.md            plan d'amélioration et positionnement   (entrepreneur)
  brand.md / .json    nom, palette, logo, ton                 (brand)
  launch/             page d'accueil, prix, fiche store       (launch)
  deploy.md           checklist de mise en ligne              (deploy)
```

---

## 2. L'enchaînement complet

```
recon → architect → design → build → backend → test → diff → entrepreneur → brand → launch → deploy
```

Vous pouvez suivre toute la chaîne, ou lancer **une skill seule**. Seules
contraintes : `architect`, `build` et `diff` ont besoin des fichiers de
`recon` ; `launch` a besoin de `brand` ; `deploy` vérifie tout le reste.

| # | Skill | Rôle | Lit | Écrit |
|---|---|---|---|---|
| 1 | `/replica-recon` | Cartographie une application : écrans, parcours, composants, données | sources publiques, votre compte | `recon.md`, `features.csv` |
| 2 | `/replica-architect` | Choisit la pile technique, écrit le schéma de base et l'API | `recon.md` | `architecture.md`, `schema.sql` |
| 3 | `/replica-design` | Reconstruit le système de design en tokens et vérifie les contrastes | `recon.md`, `screens/` | `design/` |
| 4 | `/replica-build` | Construit écran par écran | recon, architecture, design | code, `build-log.md` |
| 5 | `/replica-backend` | Comptes, base de données, paiements, e-mails, sécurité | `architecture.md` | migrations, `backend.md` |
| 6 | `/replica-test` | Plan de tests, tests Playwright, rapports de bugs | `recon.md` | `test-plan.md`, `bugs.md`, `e2e/` |
| 7 | `/replica-diff` | Score de parité et liste de ce qui manque | `features.csv`, captures | `parity.md` |
| 8 | `/replica-entrepreneur` | Lit les vrais avis d'utilisateurs et en tire un plan d'amélioration | avis publics | `feedback.md`, `fixes.md` |
| 9 | `/replica-brand` | Nom, palette, brief de logo, ton, nettoyage des traces de l'original | `fixes.md` | `brand.md`, `brand.json` |
| 10 | `/replica-launch` | Page d'accueil, grille tarifaire, fiche App Store / Play | `fixes.md`, `brand.md` | `launch/` |
| 11 | `/replica-deploy` | Vérifications finales et mise en ligne sur votre domaine | tout `replica/` | `deploy.md` |

---

## 3. Chaque skill en détail

### 3.1 `/replica-recon` — cartographier une application

**À quoi ça sert** : produire la « carte » complète d'une application. Tout le
reste en dépend, donc prenez le temps ici.

**Ce qu'elle va vous demander** (ou vous proposer) :
1. Quelle application et quelle plateforme (web, Windows, mobile).
2. Quelle partie : pas « tout JLogiciels », mais par exemple « le métré sur
   plan et le devis ».
3. Pour qui : votre entreprise, une niche, un produit à vendre.

**Sources utilisées**, par ordre de valeur : centre d'aide / documentation,
page de tarifs, notes de version, fiche store, vidéos de démonstration
publiques, site commercial, **votre propre compte**, documentation d'API
publique.

**Ce qu'elle produit** :
- un inventaire des écrans (S01, S02…) avec leurs états (vide, chargement,
  erreur, mobile…) ;
- les parcours utilisateur (F01, F02…) avec le nombre de clics — c'est le
  chiffre à battre ;
- la liste des composants d'interface ;
- le modèle de données déduit, avec un niveau de confiance ;
- `features.csv` : la matrice des fonctionnalités ;
- ce qui ne peut pas être copié (bibliothèques sous licence, réseau
  d'utilisateurs…) ;
- une estimation de taille : S (un week-end), M (quelques semaines),
  L (un trimestre), XL (à redécouper).

**Exemple pour MétréPro** :
> `/replica-recon` Étudie la partie « métré sur plan PDF/DWG + devis » de
> JLogiciels à partir de leur site, de leur documentation et de leurs vidéos
> publiques. C'est pour améliorer MétréPro. Plateforme : Windows/web.

**Le format de `features.csv`** (une ligne par fonctionnalité) :

```csv
feature,area,priority,original,clone,notes
Import d'un plan PDF,import,must,yes,yes,
Import DWG natif,import,must,yes,no,nécessite un backend
Métré de surfaces au clic,métré,must,yes,yes,
Quantitatif matériaux,quantitatif,should,yes,partial,composition codée en dur
Bibliothèque d'ouvrages partagée,bibliothèque,could,yes,no,
```

- `priority` : `must` (indispensable), `should` (important), `could` (bonus).
- `clone` : `yes`, `partial` (avec une note), `no`, ou `skip` (avec une
  raison).

> **Astuce** : vous pouvez remplir `features.csv` vous-même, à la main, à
> partir de ce que vous savez du marché. C'est déjà très utile pour
> `/replica-diff`.

---

### 3.2 `/replica-architect` — planifier la technique

**À quoi ça sert** : transformer la carte en plan technique : pile, schéma de
base de données SQL, liste des routes d'API, ordre de construction.

**Par défaut**, elle propose Next.js + Postgres (Supabase) + Stripe + Vercel.
**Pour MétréPro, dites-lui de garder votre pile actuelle** (JavaScript sans
framework, 100 % navigateur) ou précisez celle que vous visez pour le
backend.

**Exemple** :
> `/replica-architect` Garde la pile actuelle de MétréPro (vanilla JS, sans
> framework). Planifie la persistance des projets (export/import JSON puis
> IndexedDB) et le futur backend de conversion DWG → DXF.

**Ce qu'elle produit** : `architecture.md`, le schéma SQL, les parties
délicates (unités, arrondis, gros fichiers…) et l'ordre de construction, en
commençant par une « tranche verticale » : le parcours principal de bout en
bout.

---

### 3.3 `/replica-design` — le système de design

**À quoi ça sert** : mesurer couleurs, typographie, espacements et composants,
et les écrire sous forme de **tokens** (variables de design).

**Règles** : jamais les logos, icônes, illustrations ou polices payantes de
l'original. Icônes libres (Lucide, Phosphor…), polices libres (Inter, IBM
Plex…).

**Exemple pour MétréPro** :
> `/replica-design` Extrais les tokens du thème sombre actuel de
> `src/styles.css` et vérifie que tous les contrastes texte/fond respectent
> WCAG AA.

**L'outil inclus** vérifie les contrastes (4,5:1 minimum pour le texte
normal, 3:1 pour le gros texte et les bordures de champs) :

```bash
python3 .claude/skills/replica-design/contrast.py replica/design/tokens.json
```

---

### 3.4 `/replica-build` — construire écran par écran

**À quoi ça sert** : construire l'application écran par écran à partir de la
carte : d'abord le squelette, puis le parcours principal, puis chaque écran
avec **tous ses états**.

**Pour chaque écran, la skill vérifie** : tous les états (vide, erreur,
chargement), largeur 390 px et 1440 px, utilisable au clavier seul, aucune
erreur en console, aucun texte copié de l'original, `features.csv` mis à
jour, capture enregistrée pour la comparaison.

**Exemple** :
> `/replica-build` Construis l'écran S04 (bibliothèque d'ouvrages) avec
> l'éditeur de composition matériaux.

---

### 3.5 `/replica-backend` — comptes, base de données, paiements

**À quoi ça sert** : authentification, base de données avec règles d'accès,
paiements Stripe, e-mails, tâches planifiées, intégrations, checklist de
sécurité.

**Important** : Claude ne crée **jamais** de compte à votre place et ne tape
jamais de mot de passe, de carte ou de clé secrète. C'est vous qui créez les
comptes (Stripe, Supabase…) et mettez les clés dans `.env.local`. Claude écrit
seulement `.env.example` avec les noms des variables.

**Pour MétréPro** : utile quand vous attaquerez les comptes utilisateurs et
le service de conversion DWG (points 3 et 5 de la feuille de route).

---

### 3.6 `/replica-test` — tester et trouver les bugs

**À quoi ça sert** : écrire un plan de tests à partir des parcours, des tests
Playwright automatiques et des rapports de bugs.

**Pour chaque parcours** : chemin normal, cas limites (champ vide, texte très
long, accents, double clic, retour arrière, rafraîchissement, mobile, clavier
seul…) et cas d'erreur. Chaque cas est numéroté (F01-H1, F01-E3…).

**Gravité des bugs** :

| | Signification |
|---|---|
| S1 | perte de données, faille de sécurité, calcul faux, parcours principal bloqué |
| S2 | fonction cassée sans contournement |
| S3 | cassé avec contournement, ou visiblement faux |
| S4 | cosmétique |

**Exemple pour MétréPro** (cohérent avec les tests décrits dans `CLAUDE.md`) :
> `/replica-test` Écris le plan de tests de MétréPro et les specs Playwright
> en `file://` : un rectangle 5×4 m doit donner 20 m², 1 m³ de béton = 350 kg
> de ciment, analyse auto, calcul structure, changement de devise, édition
> de ligne. Échec si `pageerror`.

Règle de la skill : pour chaque correction, écrire d'abord le test qui
échoue, corriger, puis vérifier qu'il passe.

---

### 3.7 `/replica-diff` — mesurer l'écart

**À quoi ça sert** : donner un **score de parité** honnête et la liste de ce
qui manque, dans l'ordre où le construire.

**Calcul** : `must` compte 3, `should` 2, `could` 1 ; `partial` compte pour
moitié ; les lignes `skip` et vos fonctions en plus ne comptent pas.

```bash
python3 .claude/skills/replica-diff/parity.py replica/features.csv
```

**Comparaison de captures** : le second outil compare la *disposition* de deux
captures (même taille de fenêtre, même état) en ignorant les couleurs :

```bash
python3 .claude/skills/replica-diff/imgdiff.py replica/screens/S07.png replica/clone-screens/S07.png --out replica/diffs/S07.png
```

**Verdict** :
- **pas livrable** : un `must` manque, ou un bug S1 est ouvert ;
- **livrable** : tous les `must` faits, score ≥ 80, aucun S1 ni S2 ouvert ;
- **mieux que l'original** : livrable + les améliorations
  d'`entrepreneur`. C'est l'objectif.

**Exemple** :
> `/replica-diff` Donne-moi le score de parité de MétréPro et les 5 choses à
> construire en priorité.

---

### 3.8 `/replica-entrepreneur` — ce que les utilisateurs détestent

**C'est la plus utile pour vous dès maintenant.** Elle lit les avis publics
sur les logiciels concurrents et en tire ce qu'il faut faire mieux.

**Sources** : App Store, Google Play, G2, Capterra, Trustpilot, Reddit,
Hacker News, forums, tableau de suggestions de l'éditeur, notes de version.
Objectif : 100 avis ou plus, sur au moins 3 sources.

**Règles strictes** : aucun avis inventé, chaque citation est **mot pour mot
avec son lien**, l'échantillon est toujours indiqué (« 14 avis » si c'est 14).

**Ce qu'elle produit** — trois listes classées :
1. **Ce qu'ils détestent** (ce que le logiciel fait mal) ;
2. **Ce qui manque** (fonctions demandées par leur nom) ;
3. **Ce qui n'est pas résolu** (des besoins ou des métiers ignorés) — c'est
   votre positionnement.

Puis un plan de 5 à 8 améliorations (taille S/M/L), ajoutées à
`features.csv`, et 3 propositions de positionnement :

```
Pour {qui} qui {déteste ceci chez l'original},
MétréPro {fait ceci à la place}.
Preuve : {thème}, {n} avis sur {n} sources.
```

**Exemple** :
> `/replica-entrepreneur` Lis les avis publics sur les logiciels de métré
> et de devis bâtiment (JLogiciels, Attic+, Onaya, Batappli…) et dis-moi ce
> que les utilisateurs détestent et ce qui leur manque.

**Le format de `reviews.csv`** si vous collectez des avis vous-même :

```csv
source,url,date,rating,text
capterra,https://…,2026-03-12,2,"Le texte exact de l'avis"
forum,https://…,2026-05,,"Le texte exact du message"
```

Une ligne sans lien ou sans texte est rejetée. Puis :

```bash
python3 .claude/skills/replica-entrepreneur/reviews.py replica/reviews.csv --out replica/feedback.md
```

Les thèmes de classement sont dans `replica-entrepreneur/themes.json` (en
anglais) : demandez à Claude de les adapter au métré / devis en français.

---

### 3.9 `/replica-brand` — nom et identité

**À quoi ça sert** : vérifier que votre application a sa propre identité.
Pour MétréPro, le nom existe déjà : la skill sert surtout à **vérifier le
nom** (marques déposées, domaine, réseaux) et à faire un **brief de logo**, une
palette et un ton.

**Vérifications à lancer** (jamais supposées) : INPI / EUIPO / TMview, WIPO,
domaine, stores, réseaux sociaux. Ce sont des vérifications préalables, pas un
avis juridique.

**L'outil de nettoyage** cherche toute trace de l'original (nom, domaine,
couleurs) dans votre code :

```bash
python3 .claude/skills/replica-brand/sweep.py . --avoid "JLogiciels" --domains jlogiciels.fr
```

**Exemple** :
> `/replica-brand` Vérifie le nom « MétréPro » (marques, domaine .fr/.com,
> stores) et propose un brief de logo et un ton de marque.

---

### 3.10 `/replica-launch` — page d'accueil, prix, fiche store

**À quoi ça sert** : la page d'accueil (construite sur le positionnement),
la grille tarifaire (comparée aux prix publics des concurrents, avec la date)
et la fiche App Store / Google Play.

**Règles** : pas de faux témoignages, pas de faux chiffres d'utilisateurs, pas
d'avis de concurrents utilisés comme témoignages, pas le nom d'un concurrent
dans votre fiche.

```bash
python3 .claude/skills/replica-launch/listing.py replica/launch/listing.json
```

**Exemple** :
> `/replica-launch` Propose une grille tarifaire pour MétréPro face aux
> logiciels de métré du marché, et écris la page d'accueil.

---

### 3.11 `/replica-deploy` — mise en ligne

**À quoi ça sert** : vérifications finales (tests verts, `must` faits,
nettoyage propre, pages légales), puis base de production, hébergeur,
enregistrements DNS de votre domaine, Stripe en mode réel, surveillance.

**Règles** : **rien n'est mis en ligne sans votre accord explicite**. C'est
vous qui achetez le domaine et vous connectez aux services ; Claude vous
donne les commandes et les enregistrements exacts.

**Pour MétréPro** : à garder pour plus tard, quand l'application aura un
backend et des comptes.

---

## 4. Par où commencer avec MétréPro

Parcours recommandé, du plus utile au moins urgent :

1. **`/replica-entrepreneur`** sur les logiciels de métré concurrents →
   ce que les utilisateurs détestent, ce qui manque. Vous en tirez des
   priorités appuyées sur des preuves.
2. **`/replica-recon`** sur le concurrent le plus proche (partie métré +
   devis) → `features.csv`.
3. Mettez à jour la colonne `clone` de `features.csv` avec l'état réel de
   MétréPro (ou demandez à Claude de le faire en lisant `src/app.js`).
4. **`/replica-diff`** → score de parité et top 5 à construire.
5. **`/replica-test`** → filet de sécurité avant d'attaquer la feuille de
   route (persistance, éditeur de composition…).
6. **`/replica-build`** pour chaque fonction manquante, puis retour à
   `/replica-test` et `/replica-diff`.
7. Plus tard, quand vous voudrez vendre : `brand` → `launch` → `deploy`.

---

## 5. Les outils Python

Six petits scripts, **bibliothèque standard uniquement** (Python 3.8+, rien à
installer, aucun accès réseau). Chemins depuis la racine du projet :

| Commande | Rôle |
|---|---|
| `python3 .claude/skills/replica-diff/parity.py replica/features.csv` | score de parité + liste des manques |
| `python3 .claude/skills/replica-diff/imgdiff.py a.png b.png --out diff.png` | compare la disposition de deux captures |
| `python3 .claude/skills/replica-entrepreneur/reviews.py replica/reviews.csv` | classe les avis par thème |
| `python3 .claude/skills/replica-design/contrast.py replica/design/tokens.json` | contrastes WCAG |
| `python3 .claude/skills/replica-brand/sweep.py . --avoid "Nom"` | traces de l'original dans le code |
| `python3 .claude/skills/replica-launch/listing.py replica/launch/listing.json` | vérifie une fiche store |

> **Dans une session Claude Code dans le cloud**, l'exécution de code
> téléchargé peut être bloquée par les permissions. Claude vous demandera
> alors l'autorisation ; vous pouvez aussi lancer ces scripts vous-même sur
> votre ordinateur.

---

## 6. Les règles que les skills appliquent toujours

- **Fonctions et parcours, pas la propriété des autres** : jamais le code, les
  logos, les icônes, les textes ni les polices payantes d'un concurrent.
- **Sources publiques et votre propre compte uniquement** : pas de
  contournement de connexion ou de paywall, pas de robots d'aspiration.
- **Pas de données inventées** : avis, chiffres et citations sont réels et
  sourcés.
- **Vous gardez la main** : comptes, clés, paiements et mise en ligne passent
  toujours par vous.
- **Vérifiez avant de vendre** : marques déposées, conditions d'utilisation
  des outils utilisés, et un avocat si de l'argent est en jeu. Ce guide n'est
  pas un avis juridique.

---

## 7. Questions fréquentes

**Dois-je lancer les 11 skills dans l'ordre ?** Non. Chacune fonctionne
seule ; l'ordre sert seulement quand on construit une application de zéro.

**Une skill dit qu'il manque `replica/recon.md`.** Lancez d'abord
`/replica-recon`, ou créez `replica/features.csv` à la main pour
`/replica-diff`.

**La skill propose Next.js alors que MétréPro est en JavaScript simple.**
Dites-lui de garder la pile existante : elle s'adapte.

**Les skills ne répondent pas en français.** Elles sont écrites en anglais,
mais suivent la langue de votre demande. Précisez « réponds en français » si
besoin.

**Comment désinstaller ?** Supprimez les dossiers `.claude/skills/replica-*`
et les lignes correspondantes de `.claude/skills/SOURCE.md`.
