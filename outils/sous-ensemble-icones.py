#!/usr/bin/env python3
"""Réduit la police d'icônes aux seuls glyphes utilisés.

La police Material Symbols complète pèse 5,2 Mo pour environ 3 000 icônes.
MailFlow en emploie une trentaine. Embarquer le reste alourdirait chaque
paquet distribué sans rien apporter.

Le script relit les noms d'icônes directement dans les sources : il n'y a pas
de liste à tenir à jour, et une icône ajoutée sans regénérer la police se voit
tout de suite — elle ne s'affiche pas.

    python3 outils/sous-ensemble-icones.py
"""

import pathlib
import re
import subprocess
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / "node_modules/material-symbols/material-symbols-rounded.woff2"
SORTIE = RACINE / "src/assets/icones.woff2"

# Les noms apparaissent sous plusieurs formes : attribut littéral, expression
# ternaire, champ d'un tableau de configuration.
MOTIFS = [
    r'nom="([a-z_0-9]+)"',
    r"nom=\{[^}]*?'([a-z_0-9]+)'",
    r"icone[=:]\s*'([a-z_0-9]+)'",
    r'icone="([a-z_0-9]+)"',
    r"glyphe:\s*'([a-z_0-9]+)'",
]


def icones_utilisees() -> list[str]:
    trouvees: set[str] = set()
    for fichier in (RACINE / "src").rglob("*.tsx"):
        texte = fichier.read_text(encoding="utf-8")
        for motif in MOTIFS:
            trouvees |= set(re.findall(motif, texte))
    return sorted(trouvees)


def verifier(noms: list[str]) -> None:
    """Un sous-ensemble muet est pire qu'une police entière : les icônes
    s'afficheraient en toutes lettres, sans que rien n'échoue."""
    from fontTools.ttLib import TTFont

    presents = set(TTFont(SORTIE).getGlyphOrder())
    manquants = [n for n in noms if n not in presents]
    if manquants:
        raise SystemExit(f"glyphes absents du sous-ensemble : {manquants}")


def main() -> int:
    if not SOURCE.exists():
        print(f"police absente : {SOURCE} — lancez `npm install`", file=sys.stderr)
        return 1

    noms = icones_utilisees()
    if not noms:
        print("aucune icône trouvée dans les sources", file=sys.stderr)
        return 1

    SORTIE.parent.mkdir(parents=True, exist_ok=True)

    # Trois choses doivent survivre au découpage :
    #
    # - les glyphes d'icônes eux-mêmes, dont le nom est celui de l'icône, plus
    #   leur variante `.fill` employée par les éléments actifs ;
    # - les lettres qui composent le nom, puisque le glyphe s'obtient par
    #   ligature à partir du texte « settings » ou « check_circle » ;
    # - la table de ligatures, que Material Symbols range sous `rlig` et non
    #   sous le `liga` habituel. L'oublier produit une police qui affiche les
    #   noms d'icônes en toutes lettres.
    # Toutes les icônes n'ont pas de variante pleine : demander celles qui
    # n'existent pas ferait échouer le découpage.
    from fontTools.ttLib import TTFont

    disponibles = set(TTFont(SOURCE, lazy=True).getGlyphOrder())
    inconnues = [n for n in noms if n not in disponibles]
    if inconnues:
        raise SystemExit(f"icônes absentes de Material Symbols : {inconnues}")

    glyphes = [n for n in noms]
    glyphes += [f"{n}.fill" for n in noms if f"{n}.fill" in disponibles]

    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(SOURCE),
            f"--text={' '.join(noms)}",
            f"--glyphs={','.join(glyphes)}",
            "--layout-features=rlig,rclt",
            # Sans cela, la fermeture des ligatures ramene toutes les icones
            # atteignables depuis les lettres conservees, soit la police entiere.
            "--no-layout-closure",
            # Sans cela, fontTools renomme les glyphes en sortie et la
            # vérification ci-dessous ne pourrait plus les retrouver. Le coût
            # est de l'ordre du kilooctet.
            "--glyph-names",
            "--flavor=woff2",
            f"--output-file={SORTIE}",
        ],
        check=True,
    )

    verifier(noms)

    avant = SOURCE.stat().st_size / 1_048_576
    apres = SORTIE.stat().st_size / 1024
    print(f"{len(noms)} icônes : {avant:.1f} Mio → {apres:.0f} Kio")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
