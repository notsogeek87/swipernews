#!/usr/bin/env python3
"""Fabrique tous les dérivés du logo SwiperNews à partir d'un PNG 1024×1024.

    python3 tools/gen_logo.py chemin/vers/logo-1024.png
    npm run android:assets     # puis, pour les ressources natives

Le logo source est une icône d'app : un carré à coins arrondis (donc à coins
transparents) rempli d'un dégradé vertical, portant un contenu au centre.
Trois formes en sortent, et la raison d'être de ce script est justement de
savoir laquelle va où (voir README, « Icône et écran de démarrage ») :

  - la forme SOURCE, coins arrondis compris — pour ce que personne ne masque :
    `logo-192/512.png`, les écrans de démarrage, les vignettes F-Droid ;
  - une forme PLEIN BORD, dégradé prolongé jusqu'aux bords du carré — pour tout
    ce qui subit un masque, dont le masque circulaire mordrait au-delà des
    coins arrondis en y laissant des encoches transparentes ;
  - le CONTENU seul, sur fond transparent — calque avant de l'icône adaptative
    Android, posé sur le dégradé du calque arrière.

Dépendance : Pillow (`pip install Pillow`). Volontairement hors `package.json` :
ce script ne tourne qu'à la main, le jour où le logo change.
"""

import math
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SPLASH_BG = (10, 10, 15)  # #0a0a0f, la couleur de thème de l'app
SPLASH_SIZE = 2732  # ce qu'attend @capacitor/assets
SPLASH_LOGO_SCALE = 0.163  # redimensionnement en « cover » : rester près du centre

# Zone de sécurité d'une icône maskable : seul un cercle de 80 % de diamètre
# est garanti visible, soit un rayon de 0,40 de la largeur.
MASKABLE_SAFE_RADIUS = 0.40

# Le dégradé s'échantillonne hors du contenu central, sur ces bandes latérales.
EDGE_BAND = 150

# Séparation contenu / dégradé : distance RVB en deçà de laquelle un pixel est
# tenu pour du dégradé pur, et au-delà de laquelle il est tenu pour du contenu.
D_LOW, D_HIGH = 6.0, 20.0


def build_gradient(px, w, h):
    """Le dégradé du fond, une couleur par ligne.

    Il est purement vertical (la colonne de gauche vaut celle de droite), on
    peut donc le résumer à une couleur par ligne, moyennée sur les bandes
    latérales — hors du contenu central, qui la fausserait.
    """
    rows = [None] * h
    for y in range(h):
        acc, n = [0, 0, 0], 0
        for x in list(range(0, EDGE_BAND)) + list(range(w - EDGE_BAND, w)):
            r, g, b, a = px[x, y]
            if a > 250:
                acc[0] += r
                acc[1] += g
                acc[2] += b
                n += 1
        if n:
            rows[y] = (acc[0] / n, acc[1] / n, acc[2] / n)

    # Les coins arrondis privent d'échantillon les premières et dernières
    # lignes. On y prolonge la PENTE locale : recopier la dernière couleur
    # connue aplatirait le dégradé juste aux bords, là où ça se voit.
    known = [y for y in range(h) if rows[y] is not None]
    if not known:
        raise SystemExit("Aucune ligne de dégradé exploitable : le logo est-il opaque ?")
    lo, hi = known[0], known[-1]
    span = min(60, hi - lo)
    slope_lo = [(rows[lo + span][c] - rows[lo][c]) / span for c in range(3)]
    slope_hi = [(rows[hi][c] - rows[hi - span][c]) / span for c in range(3)]
    for y in range(lo):
        rows[y] = tuple(rows[lo][c] - slope_lo[c] * (lo - y) for c in range(3))
    for y in range(hi + 1, h):
        rows[y] = tuple(rows[hi][c] + slope_hi[c] * (y - hi) for c in range(3))
    return rows


def extract_content(px, grad, w, h):
    """Le contenu seul, sur fond transparent.

    On a `source = a·contenu + (1−a)·dégradé` sans pouvoir séparer les deux
    inconnues. Une rampe sur la distance au dégradé suffit pourtant : recomposé
    sur le MÊME dégradé, le résultat est exact là où `a` vaut 0 ou 1, et l'écart
    sur la bande intermédiaire est borné par `D_HIGH` — invisible à l'œil. Le
    contrôle plus bas le vérifie chiffres en main.
    """
    content = Image.new("RGBA", (w, h))
    cp = content.load()
    for y in range(h):
        gr, gg, gb = grad[y]
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 250:  # coin arrondi : ni contenu ni dégradé
                cp[x, y] = (0, 0, 0, 0)
                continue
            alpha = (math.dist((r, g, b), (gr, gg, gb)) - D_LOW) / (D_HIGH - D_LOW)
            alpha = 0 if alpha <= 0 else (255 if alpha >= 1 else round(alpha * 255))
            cp[x, y] = (r, g, b, alpha)
    return content


def save(im, path, size=None):
    if size and im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    out = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # Pas de quantification par palette ici, contrairement à l'ancien logo :
    # un dégradé sur 256 couleurs se met à border franchement.
    im.save(out, "PNG", optimize=True)
    print(f"  {path:52s} {im.size[0]}×{im.size[1]}  {os.path.getsize(out) // 1024} Ko")


def main(src_path):
    src = Image.open(src_path).convert("RGBA")
    w, h = src.size
    if w != h:
        raise SystemExit(f"Logo source non carré : {w}×{h}")
    px = src.load()

    grad = build_gradient(px, w, h)

    full = Image.new("RGBA", (w, h))
    fp = full.load()
    for y in range(h):
        r, g, b = (max(0, min(255, round(v))) for v in grad[y])
        for x in range(w):
            fp[x, y] = (r, g, b, 255)

    # Plein bord : le dégradé comble les coins transparents du source.
    bleed = Image.alpha_composite(full, src)
    content = extract_content(px, grad, w, h)
    cp = content.load()

    check = Image.alpha_composite(full, content).load()
    err = max(
        max(abs(a - b) for a, b in zip(check[x, y][:3], px[x, y][:3]))
        for y in range(0, h, 3)
        for x in range(0, w, 3)
        if px[x, y][3] > 250
    )
    print(f"écart max contenu recomposé / source : {err}/255")

    cx = cy = (w - 1) / 2
    rmax = max(
        math.hypot(x - cx, y - cy)
        for y in range(h)
        for x in range(w)
        if cp[x, y][3] > 128
    )
    print(f"rayon max du contenu : {rmax / w:.3f} de la largeur")

    print("\nRacine (web) :")
    save(src, "logo-192.png", 192)
    save(src, "logo-512.png", 512)

    # Maskable : ramener le contenu dans la zone de sécurité, sur le plein bord.
    # Réduire l'image entière créerait une couture — le dégradé intérieur ne
    # coïnciderait plus avec celui du fond. D'où le passage par le contenu seul.
    scale = min(1.0, math.floor(MASKABLE_SAFE_RADIUS / (rmax / w) * 1000) / 1000)
    print(f"  (contenu réduit à {scale:.3f} pour tenir dans la zone de sécurité)")
    side = round(w * scale)
    maskable = full.copy()
    maskable.alpha_composite(
        content.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2)
    )
    save(maskable, "logo-maskable-512.png", 512)

    print("\nresources/ (sources de @capacitor/assets) :")
    # icon.png sert l'icône héritée ET l'icône ronde, que @capacitor/assets
    # découpe au cercle inscrit : il lui faut le plein bord.
    save(bleed, "resources/icon.png", 1024)
    save(full, "resources/icon-background.png", 1024)
    save(content, "resources/icon-foreground.png", 1024)

    print("\nÉcrans de démarrage :")
    logo_w = round(SPLASH_SIZE * SPLASH_LOGO_SCALE)
    splash = Image.new("RGBA", (SPLASH_SIZE,) * 2, SPLASH_BG + (255,))
    splash.alpha_composite(
        src.resize((logo_w, logo_w), Image.LANCZOS), ((SPLASH_SIZE - logo_w) // 2,) * 2
    )
    splash = splash.convert("RGB")
    save(splash, "resources/splash.png")
    save(splash, "resources/splash-dark.png")

    print("\nFastlane (vignettes F-Droid) :")
    save(src, "fastlane/metadata/android/en-US/images/icon.png", 512)
    save(src, "fastlane/metadata/android/fr-FR/images/icon.png", 512)

    print(
        "\nReste à faire à la main :\n"
        "  - npm run android:assets   (mipmaps et écrans de démarrage natifs)\n"
        "  - incrémenter le ?v= des logos dans index.html, manifest.webmanifest\n"
        "    et sw.js — /logo-*.png est servi en Cache-Control immutable un an"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"usage : {sys.argv[0]} chemin/vers/logo-1024.png")
    main(sys.argv[1])
