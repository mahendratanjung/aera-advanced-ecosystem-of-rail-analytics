"""Turn the AERA wordmark and tagline into SVG outlines (brand/tools/wordmark.json).

The logo files must not depend on Plus Jakarta Sans being installed, so the text is converted to
paths once here. Needs the variable font from Google Fonts (OFL):
https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf

    uv run --with fonttools --with uharfbuzz python brand/tools/wordmark.py PlusJakartaSans.ttf
"""

import json
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

# (key, text, weight, tracking in thousandths of an em)
TEXTS = [
    ("wordmark", "AERA", 800, -10),
    ("tagline", "Advanced Ecosystem of Rail Analytics", 600, 0),
    ("taglineCaps", "ADVANCED ECOSYSTEM OF RAIL ANALYTICS", 700, 80),
]


def outline(font_path: Path, text: str, weight: int, tracking: int) -> dict:
    data = font_path.read_bytes()
    face = hb.Face(data)
    hfont = hb.Font(face)
    hfont.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hfont, buf, {"kern": True, "liga": True})

    tt = instantiateVariableFont(TTFont(font_path), {"wght": weight})
    glyphs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    upm = tt["head"].unitsPerEm
    track = tracking * upm / 1000

    pen = SVGPathPen(glyphs)
    x = 0.0
    infos, positions = buf.glyph_infos, buf.glyph_positions
    for i, (info, pos) in enumerate(zip(infos, positions)):
        name = order[info.codepoint]
        # flip y: font units grow upwards, SVG grows downwards
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)))
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)

    os2 = tt["OS/2"]
    return {
        "d": pen.getCommands(),
        "width": round(x, 1),
        "capHeight": os2.sCapHeight,
        "xHeight": os2.sxHeight,
        "upm": upm,
    }


def main() -> None:
    font_path = Path(sys.argv[1])
    out = {key: outline(font_path, text, w, t) | {"text": text, "weight": w} for key, text, w, t in TEXTS}
    target = Path(__file__).with_name("wordmark.json")
    target.write_text(json.dumps(out, indent=1))
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
