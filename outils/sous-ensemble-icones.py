#!/usr/bin/env python3
"""Réduit la police d'icônes aux seuls glyphes utilisés.

La police Material Symbols complète pèse 5,1 Mio pour environ 3 000 icônes.
MailFlow en emploie une trentaine. Embarquer le reste alourdirait chaque paquet
distribué sans rien apporter.

# Points de code plutôt que ligatures

Material Symbols permet d'écrire `settings` en toutes lettres : la police
remplace la suite de lettres par le glyphe. C'est pratique à écrire, mais ça
échoue silencieusement dès que la table de ligatures ne survit pas au découpage
— l'application affiche alors « settings » à la place de l'icône, sans qu'aucune
erreur ne soit levée. C'est exactement ce qui s'est produit au premier essai.

Ce script écrit donc une table de points de code, que l'interface rend
directement. Il n'y a plus de substitution, donc plus rien à casser : soit le
glyphe est là, soit un carré vide le signale immédiatement.

    python3 outils/sous-ensemble-icones.py
"""

import pathlib
import re
import subprocess
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / "node_modules/material-symbols/material-symbols-rounded.woff2"
POLICE = RACINE / "src/assets/icones.woff2"
TABLE = RACINE / "src/composants/glyphes.ts"

# Les noms apparaissent sous plusieurs formes : attribut littéral, expression
# ternaire, champ d'un tableau de configuration.
MOTIFS = [
    r'nom="([a-z_0-9]+)"',
    r'icone="([a-z_0-9]+)"',
    r"icone[=:]\s*'([a-z_0-9]+)'",
    r"glyphe:\s*'([a-z_0-9]+)'",
]

# Les expressions du type `nom={x ? 'mail' : 'person_off'}` contiennent
# plusieurs noms : les extraire un par un, sinon la seconde branche manque et
# son icône n'entre pas dans le sous-ensemble.
EXPRESSIONS = r"(?:nom|icone)=\{([^}]*)\}"


def icones_utilisees() -> list[str]:
    """Relit les noms directement dans les sources.

    Pas de liste à tenir à jour : une icône ajoutée sans régénérer la police
    fait échouer ce script, plutôt que d'apparaître comme un carré vide.
    """
    trouvees: set[str] = set()
    for fichier in (RACINE / "src").rglob("*.tsx"):
        texte = fichier.read_text(encoding="utf-8")
        for motif in MOTIFS:
            trouvees |= set(re.findall(motif, texte))
        for expression in re.findall(EXPRESSIONS, texte):
            trouvees |= set(re.findall(r"'([a-z_0-9]+)'", expression))
    return sorted(trouvees)


def points_de_code(noms: list[str]) -> dict[str, int]:
    from fontTools.ttLib import TTFont

    inverse: dict[str, int] = {}
    for point, glyphe in TTFont(SOURCE, lazy=True).getBestCmap().items():
        inverse.setdefault(glyphe, point)

    absentes = [n for n in noms if n not in inverse]
    if absentes:
        raise SystemExit(f"icônes absentes de Material Symbols : {absentes}")

    return {n: inverse[n] for n in noms}


def ecrire_table(table: dict[str, int]) -> None:
    lignes = "\n".join(
        f"  {nom}: '\\u{point:04x}'," for nom, point in sorted(table.items())
    )
    TABLE.write_text(
        "// Généré par outils/sous-ensemble-icones.py — ne pas modifier à la main.\n"
        "//\n"
        "// Chaque icône est rendue par son point de code, pas par son nom : la\n"
        "// substitution par ligature échoue en silence si la table ne survit pas\n"
        "// au découpage de la police.\n\n"
        "export const GLYPHES = {\n"
        f"{lignes}\n"
        "} as const\n\n"
        "export type NomIcone = keyof typeof GLYPHES\n",
        encoding="utf-8",
    )


def verifier(table: dict[str, int]) -> None:
    """Un sous-ensemble incomplet ne se voit qu'à l'écran, trop tard."""
    from fontTools.ttLib import TTFont

    presents = set(TTFont(POLICE).getBestCmap())
    manquants = [n for n, p in table.items() if p not in presents]
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

    table = points_de_code(noms)
    POLICE.parent.mkdir(parents=True, exist_ok=True)
    TABLE.parent.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(SOURCE),
            "--unicodes=" + ",".join(f"U+{p:04X}" for p in table.values()),
            # Aucune fonctionnalité typographique n'est nécessaire : plus de
            # ligature à conserver, donc plus rien à perdre en chemin.
            "--layout-features=",
            "--flavor=woff2",
            f"--output-file={POLICE}",
        ],
        check=True,
    )

    verifier(table)
    ecrire_table(table)

    avant = SOURCE.stat().st_size / 1_048_576
    apres = POLICE.stat().st_size / 1024
    print(f"{len(noms)} icônes : {avant:.1f} Mio → {apres:.0f} Kio")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
