#!/usr/bin/env python3
"""Extrait les icônes employées sous forme de tracés SVG.

# Pourquoi pas une police d'icônes

Deux tentatives ont échoué avant celle-ci, et de la pire façon : sans erreur.

La première écrivait le nom de l'icône et laissait Material Symbols le
remplacer par une ligature. Le découpage de la police a emporté la table de
substitution : l'application affichait « settings » en toutes lettres.

La seconde rendait le point de code directement. Le glyphe existait bien dans
le sous-ensemble, mais rien ne s'affichait — une police vectorielle réduite
dépend de tables de variations dont la survie ne se vérifie qu'à l'œil.

Un tracé SVG n'a aucune de ces dépendances. Il est dans le paquet JavaScript,
il se colore par `currentColor`, et une icône absente est une erreur de
compilation. Le poids est d'ailleurs moindre qu'une police découpée.

    python3 outils/extraire-icones.py
"""

import pathlib
import re
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / "node_modules/material-symbols/material-symbols-rounded.woff2"
TABLE = RACINE / "src/composants/glyphes.ts"

MOTIFS = [
    r'nom="([a-z_0-9]+)"',
    r'icone="([a-z_0-9]+)"',
    r"icone[=:]\s*'([a-z_0-9]+)'",
    r"glyphe:\s*'([a-z_0-9]+)'",
]

# `nom={x ? 'mail' : 'person_off'}` contient plusieurs noms : les lire un par
# un, sinon la seconde branche manque.
EXPRESSIONS = r"(?:nom|icone)=\{([^}]*)\}"


def icones_utilisees() -> list[str]:
    """Relit les noms directement dans les sources, sans liste à tenir."""
    trouvees: set[str] = set()
    for fichier in (RACINE / "src").rglob("*.tsx"):
        texte = fichier.read_text(encoding="utf-8")
        for motif in MOTIFS:
            trouvees |= set(re.findall(motif, texte))
        for expression in re.findall(EXPRESSIONS, texte):
            trouvees |= set(re.findall(r"'([a-z_0-9]+)'", expression))
    return sorted(trouvees)


def verifier_cadrage(nom: str, glyphes, transformation, em: int) -> None:
    """Vérifie que le tracé tient dans la boîte SVG, tel qu'il sera écrit.

    Un tracé hors cadre ne lève aucune erreur : il est simplement invisible.
    C'est précisément ce qui s'est produit en oubliant que les polices comptent
    l'axe vertical vers le haut et SVG vers le bas.

    La mesure applique la *même* transformation que l'extraction — la recalculer
    ici reviendrait à vérifier une hypothèse au lieu du résultat.
    """
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.transformPen import TransformPen

    mesure = BoundsPen(glyphes)
    glyphes[nom].draw(TransformPen(mesure, transformation))
    if mesure.bounds is None:
        raise SystemExit(f"tracé sans étendue : {nom}")

    xmin, ymin, xmax, ymax = mesure.bounds
    marge = 1
    dans_le_cadre = (
        -marge <= xmin
        and xmax <= em + marge
        and -em - marge <= ymin
        and ymax <= marge
    )
    if not dans_le_cadre:
        raise SystemExit(
            f"tracé hors du cadre pour « {nom} » : "
            f"x∈[{xmin:.0f},{xmax:.0f}] y∈[{ymin:.0f},{ymax:.0f}], "
            f"attendu x∈[0,{em}] y∈[-{em},0]"
        )


def main() -> int:
    if not SOURCE.exists():
        print(f"police absente : {SOURCE} — lancez `npm install`", file=sys.stderr)
        return 1

    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    noms = icones_utilisees()
    if not noms:
        print("aucune icône trouvée dans les sources", file=sys.stderr)
        return 1

    police = TTFont(SOURCE)
    glyphes = police.getGlyphSet()

    absentes = [n for n in noms if n not in glyphes]
    if absentes:
        raise SystemExit(f"icônes absentes de Material Symbols : {absentes}")

    # Une police compte l'axe vertical vers le haut, SVG vers le bas. Sans ce
    # retournement, le tracé sort du cadre et l'icône est invisible — sans
    # qu'aucune erreur ne soit levée, une fois de plus.
    retournement = (1, 0, 0, -1, 0, 0)

    em = police["head"].unitsPerEm

    def tracer(jeu, nom: str) -> str:
        pen = SVGPathPen(jeu)
        jeu[nom].draw(TransformPen(pen, retournement))
        trace = pen.getCommands()

        # Un tracé vide passerait inaperçu jusqu'à l'écran.
        if not trace:
            raise SystemExit(f"tracé vide pour l'icône : {nom}")

        verifier_cadrage(nom, jeu, retournement, em)
        return trace

    traces = {nom: tracer(glyphes, nom) for nom in noms}
    pleins = traces_pleins(traces, tracer)

    lignes = "\n".join(f"  {nom}: '{trace}'," for nom, trace in sorted(traces.items()))
    lignes_pleines = "\n".join(
        f"  {nom}: '{trace}'," for nom, trace in sorted(pleins.items())
    )

    TABLE.write_text(
        "// Généré par outils/extraire-icones.py — ne pas modifier à la main.\n"
        "//\n"
        "// Tracés SVG des icônes Material Symbols employées. Extraits plutôt\n"
        "// qu'embarqués sous forme de police : une police découpée peut cesser\n"
        "// d'afficher ses glyphes sans qu'aucune erreur ne soit levée.\n\n"
        f"/** Les tracés sont dessinés sur {em} unités, ligne de base en bas. */\n"
        f"export const BOITE = '0 -{em} {em} {em}'\n\n"
        "export const GLYPHES = {\n"
        f"{lignes}\n"
        "} as const\n\n"
        "export type NomIcone = keyof typeof GLYPHES\n\n"
        "/**\n"
        " * Variantes pleines, prises sur l'axe `FILL` de la police variable.\n"
        " *\n"
        " * Elles servent à marquer l'élément actif : une icône qui se remplit se\n"
        " * distingue même quand la couleur ne suffit pas — écran peu contrasté,\n"
        " * daltonisme, thème sombre.\n"
        " *\n"
        " * Certaines icônes sont identiques dans les deux variantes ; elles ne\n"
        " * sont alors pas répétées ici, et `Icone` retombe sur le tracé normal.\n"
        " */\n"
        "export const GLYPHES_PLEINS: Partial<Record<NomIcone, string>> = {\n"
        f"{lignes_pleines}\n"
        "}\n",
        encoding="utf-8",
    )

    poids = TABLE.stat().st_size / 1024
    print(
        f"{len(noms)} icônes extraites, dont {len(pleins)} avec variante pleine"
        f" — {poids:.0f} Kio de tracés"
    )
    return 0


def traces_pleins(traces: dict[str, str], tracer) -> dict[str, str]:
    """Tracés de la même police figée sur `FILL=1`.

    Sans cette passe, le paramètre `rempli` de `Icone` ne changeait rien : les
    variantes pleines n'existent que sur l'axe variable, jamais dans le fichier
    par défaut. Une icône dont le remplissage ne modifie pas le dessin n'est pas
    reprise, pour ne pas doubler le poids du fichier sans raison.
    """
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    pleine = instantiateVariableFont(
        TTFont(SOURCE), {"FILL": 1.0}, updateFontNames=False, inplace=False
    )
    jeu = pleine.getGlyphSet()

    return {
        nom: plein
        for nom, normal in traces.items()
        if (plein := tracer(jeu, nom)) != normal
    }


if __name__ == "__main__":
    raise SystemExit(main())
