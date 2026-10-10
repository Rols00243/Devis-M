# Ce que les utilisateurs reprochent aux logiciels de métré — et ce que MétréPro peut faire mieux

Produit par `/replica-entrepreneur` le 2026-10-10.

## Échantillon : petit, à lire avec prudence

- **12 extraits d'avis** sur **5 logiciels** (Attic+, Batappli, PlanSwift, Bluebeam Revu,
  On-Screen Takeoff), venant de **3 types de sources** : un forum, un blog de test et Capterra.
- L'objectif de la méthode est 100 avis ou plus. Il n'est **pas atteint**. Dans cette session,
  le réseau bloque l'ouverture des sites d'avis : les citations viennent des extraits renvoyés
  par le moteur de recherche. Elles n'ont pas été revérifiées sur la page elle-même, et la date
  et la note de chaque avis manquent.
- **Aucun avis utilisateur trouvé pour JLogiciels métré** : les annuaires (Appvizer) indiquent
  « aucun avis ».
- Les avis sur PlanSwift, Bluebeam et On-Screen Takeoff viennent du marché américain : ce sont
  des logiciels de métré sur plan comparables, mais pas des concurrents directs en France.
- Le classement a été fait à la main : le script `reviews.py` n'a pas pu être exécuté
  (permissions de la session).

Avec 12 extraits, **tous les thèmes ci-dessous sont « minces »** au sens de la méthode. Ce sont
des pistes, pas des tendances prouvées.

## 1. Ce qu'ils détestent

| # | Problème | Extraits | Logiciels | Exemple (verbatim) |
|---|---|---|---|---|
| H1 | Trop cher, modules payants en plus | 2 | Attic+, PlanSwift | « très inabordable à mon goût » ([forum](https://www.technicien-territorial.fr/viewtopic.php?t=2400)) ; « most of the plug-ins should be part of the base program » ([Capterra](https://www.capterra.com/p/70808/PlanSwift/reviews/)) |
| H2 | Difficile à prendre en main, interface confuse | 3 | Bluebeam, On-Screen Takeoff | « The software had lots of menus and was sometimes confusing and difficult to navigate. » ([Capterra](https://www.capterra.com/p/121585/On-Screen-Takeoff/reviews/)) |
| H3 | Support et mises à jour lents | 3 | Attic+, PlanSwift, On-Screen Takeoff | « it could take up to 3 days to have someone call back to resolve the issue » ([Capterra](https://www.capterra.com/p/70808/PlanSwift/reviews/)) |
| H4 | Installation lourde, logiciel lié à un seul poste | 2 | Batappli, PlanSwift | « you usually have to be at your specific workstation where the software is installed » ([Capterra](https://www.capterra.com/p/70808/PlanSwift/reviews/)) |

## 2. Ce qui manque

| # | Manque | Extraits | Exemple (verbatim) |
|---|---|---|---|
| M1 | Le métré n'est pas relié au chiffrage : les quantités ne se mettent pas à jour | 1 | « The takeoff page of Planswift is not linked to the workbook. Hence the quantities in workbook does not update itself. » ([Capterra](https://www.capterra.com/p/70808/PlanSwift/reviews/)) |
| M2 | Bon pour mesurer, faible pour chiffrer | 1 | « It was good for document control, but not very good for estimating. » ([Capterra](https://www.capterra.com/p/70808/PlanSwift/reviews/)) |

## 3. Ce qui n'est pas résolu

- **L'artisan ou la petite entreprise qui veut mesurer ET chiffrer sans gros budget.** Les outils
  complets sont chers (H1) et compliqués (H2). Les outils simples mesurent mais ne chiffrent pas
  (M1, M2). Mince : déduit de 5 extraits.

## 4. Plan d'amélioration pour MétréPro

| # | À faire | Taille | Skill | Appui |
|---|---|---|---|---|
| F1 | **Enregistrer / rouvrir un projet** (JSON, puis IndexedDB). Sans ça, MétréPro ne peut pas rivaliser. | M | `/replica-build` | feuille de route n°1 |
| F2 | **Garder le métré relié en direct au devis et au quantitatif** (déjà le cas) et le protéger par des tests | S | `/replica-test` | M1, M2 |
| F3 | **Prise en main guidée** : plan d'exemple, étapes numérotées, aide au survol | M | `/replica-build` | H2 |
| F4 | **Bibliothèque d'ouvrages fournie et modifiable** (éditeur de composition) | M | `/replica-build` | feuille de route n°2 |
| F5 | **Mettre en avant « dans le navigateur, sans installation, sur n'importe quel poste »** | S | `/replica-launch` | H4 |
| F6 | **Prix simple, toutes les fonctions incluses** | S | `/replica-launch` | H1 |

Ces 6 lignes sont ajoutées dans `replica/features.csv`.

## 5. Positionnement proposé

**Option recommandée :**
> Pour les artisans et petites entreprises du bâtiment qui trouvent les logiciels de métré trop
> chers et trop compliqués, MétréPro mesure sur le plan et sort le devis et la liste des
> matériaux en même temps, directement dans le navigateur.
> Appui : H1 + H2 + M1, 6 extraits sur 4 logiciels (mince).

Autres options :
- « Le métré qui chiffre » : pour ceux dont l'outil de mesure ne fait pas le devis (M1, M2 —
  2 extraits, mince).
- « Sans installation » : pour ceux qui travaillent sur plusieurs postes ou sur chantier (H4 —
  2 extraits, mince).

## Pour rendre ce résultat solide

Collectez des avis vous-même : avis Google des éditeurs, Trustpilot, groupes Facebook
d'artisans, forums du bâtiment, ou en demandant à 5 à 10 artisans de votre entourage. Ajoutez
chaque avis dans `replica/reviews.csv` (une ligne : source, lien, date, note, texte exact), puis
relancez `/replica-entrepreneur`.
