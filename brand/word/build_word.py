"""Build the AERA Word report template with the A1 "Plain frame" border.

Writes into brand/word/:
  AERA_Report_Template.dotx  double-click for a new report with the frame, styles and font
  AERA_Report_Blank.docx     the same as a document, ready to type into
  AERA_Report_Sample.docx    two filled pages showing every style
  fonts/                     static Plus Jakarta Sans (Regular, Bold, ExtraBold) + OFL licence

The frame is a native Word shape and the mark a small picture (SVG with a PNG fallback), anchored
behind the text in the header so they repeat on every page. The page number is a PAGE field in a
navy pill shape. Plus Jakarta Sans Regular, Bold and ExtraBold (its own family, used by headings
and labels) are embedded so the report looks the same on machines without the font.

    node brand/build.mjs   # makes the logo files this script reads
    uv run --no-project --with python-docx --with fonttools \\
        python brand/word/build_word.py PlusJakartaSans[wght].ttf OFL.txt
"""

import io
import re
import sys
import uuid
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).parent
BRAND = HERE.parent
FONT = "Plus Jakarta Sans"
HEAVY = "Plus Jakarta Sans ExtraBold"
INK = RGBColor(0x0E, 0x17, 0x26)
NAVY = RGBColor(0x0A, 0x31, 0x80)
SKY_DEEP = RGBColor(0x02, 0x84, 0xC7)
MUTED = RGBColor(0x64, 0x74, 0x8B)
EMU = 36000  # per millimetre

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
)

# ---------------------------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------------------------


def static_fonts(variable: Path, licence: Path) -> dict[str, Path]:
    """Static instances of the variable font, named so Word groups Regular and Bold as one family."""
    out = HERE / "fonts"
    out.mkdir(exist_ok=True)
    (out / "OFL.txt").write_bytes(licence.read_bytes())
    faces = {"Regular": 400, "Bold": 700, "ExtraBold": 800}
    paths = {}
    for style, weight in faces.items():
        path = out / f"PlusJakartaSans-{style}.ttf"
        font = instantiateVariableFont(TTFont(variable), {"wght": weight})
        family = FONT if style in ("Regular", "Bold") else f"{FONT} ExtraBold"
        sub = style if style in ("Regular", "Bold") else "Regular"
        name = font["name"]
        for rec in list(name.names):
            if rec.nameID in (1, 2, 3, 4, 6, 16, 17):
                name.removeNames(nameID=rec.nameID)
        name.setName(family, 1, 3, 1, 0x409)
        name.setName(sub, 2, 3, 1, 0x409)
        name.setName(f"AERA;PlusJakartaSans-{style}", 3, 3, 1, 0x409)
        name.setName(f"{FONT} {style}", 4, 3, 1, 0x409)
        name.setName(f"PlusJakartaSans-{style}", 6, 3, 1, 0x409)
        os2 = font["OS/2"]
        os2.usWeightClass = weight
        bold = style == "Bold"
        os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if bold else 0b1000000)
        font["head"].macStyle = 1 if bold else 0
        font.save(path)
        paths[style] = path
    return paths


def obfuscate(data: bytes, key: str) -> bytes:
    """Word's font obfuscation: XOR the first 32 bytes with the GUID's bytes, read from the end."""
    hexkey = key.strip("{}").replace("-", "")
    k = [int(hexkey[i : i + 2], 16) for i in range(30, -2, -2)]
    head = bytes(b ^ k[i % 16] for i, b in enumerate(data[:32]))
    return head + data[32:]


# ---------------------------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------------------------


def set_font(style_or_run, size=None, bold=None, color=None, caps=False, spacing=None, family=FONT):
    font = style_or_run.font
    font.name = family
    rpr = style_or_run.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    for attr in ("asciiTheme", "hAnsiTheme", "cstheme", "eastAsiaTheme"):
        rfonts.attrib.pop(qn(f"w:{attr}"), None)
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        rfonts.set(qn(f"w:{attr}"), family)
    if size:
        font.size = Pt(size)
    if bold is not None:
        font.bold = bold
        rpr_bcs = rpr.find(qn("w:bCs"))
        if rpr_bcs is not None and not bold:
            rpr.remove(rpr_bcs)
    if color is not None:
        font.color.rgb = color
    font.all_caps = caps
    font.italic = False
    if spacing is not None:
        el = rpr.makeelement(qn("w:spacing"), {qn("w:val"): str(spacing)})
        later = ("w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:lang")
        rpr.insert_element_before(el, *later)


DOC_DEFAULTS = f"""<w:docDefaults xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:rPrDefault><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}" w:eastAsia="{FONT}"/><w:color w:val="0E1726"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="312" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>"""


# Headings and labels use the ExtraBold face as its own family (no bold flag), so they never depend
# on Word pairing an embedded Regular and Bold, which Word for Mac does not always do.
TABLE_STYLE = f"""<w:style xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:type="table" w:customStyle="1" w:styleId="AERATable">
<w:name w:val="AERA Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="40"/><w:qFormat/>
<w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr>
<w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CFD6E3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E6EAF2"/></w:tblBorders>
<w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="113" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="113" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblStylePr w:type="firstRow"><w:rPr><w:rFonts w:ascii="{HEAVY}" w:hAnsi="{HEAVY}" w:cs="{HEAVY}"/><w:color w:val="0A3180"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EAF1FF"/></w:tcPr></w:tblStylePr>
</w:style>"""


def styles(doc):
    st = doc.styles
    normal = st["Normal"]
    # Base font, colour and spacing live in the document defaults, not in Normal: Word lets Normal
    # override a table style, which would undo the AERA Table's smaller text and tighter rows.
    defaults = st.element.find(qn("w:docDefaults"))
    st.element.remove(defaults)
    st.element.insert(0, parse_xml(DOC_DEFAULTS))

    for name, size, color, before, after in [
        ("Title", 30, INK, 0, 6),
        ("Heading 1", 22, INK, 0, 10),
        ("Heading 2", 13.5, INK, 14, 4),
        ("Heading 3", 11, NAVY, 10, 3),
    ]:
        s = st[name]
        set_font(s, size, bold=False, color=color, family=HEAVY)
        s.paragraph_format.space_before = Pt(before)
        s.paragraph_format.space_after = Pt(after)
        s.paragraph_format.line_spacing = 1.1
        ppr = s.element.get_or_add_pPr()
        for b in ppr.findall(qn("w:pBdr")):
            ppr.remove(b)

    kicker = st.add_style("Kicker", WD_STYLE_TYPE.PARAGRAPH)
    kicker.base_style = normal
    kicker.next_paragraph_style = st["Heading 1"]
    kicker.quick_style = True
    set_font(kicker, 8, bold=False, color=SKY_DEEP, caps=True, spacing=28, family=HEAVY)
    kicker.paragraph_format.space_after = Pt(2)
    kicker.paragraph_format.keep_with_next = True

    strong = st.add_style("Strong AERA", WD_STYLE_TYPE.CHARACTER)
    strong.quick_style = True
    set_font(strong, family=HEAVY)

    for name in ("Subtitle", "Caption", "Header", "Footer", "List Bullet", "List Number", "Quote"):
        try:
            s = st[name]
        except KeyError:
            continue
        if name == "Subtitle":
            set_font(s, 13, color=MUTED)
        elif name == "Caption":
            set_font(s, 8.5, bold=False, color=MUTED)
            s.paragraph_format.space_before = Pt(3)
            s.paragraph_format.space_after = Pt(10)
        elif name in ("Header", "Footer"):
            set_font(s, 7.5, color=MUTED)
        elif name == "Quote":
            set_font(s, 11, color=NAVY)
        else:
            set_font(s, 10.5, color=INK)

    doc.styles.element.append(parse_xml(TABLE_STYLE))


# ---------------------------------------------------------------------------------------------
# Page frame: native Word shapes, so it stays sharp on screen, in print and in PDF exports.
# One navy path with gaps for the mark and the page number, the mark as a small picture, and the
# PAGE field in a navy pill.
# ---------------------------------------------------------------------------------------------


def anchor(id_: int, name: str, x: float, y: float, w: float, h: float, z: int, behind: bool, graphic: str) -> str:
    X, Y, W, H = (round(v * EMU) for v in (x, y, w, h))
    return f"""<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{z}" behindDoc="{int(behind)}" locked="1" layoutInCell="1" allowOverlap="1">
<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>{X}</wp:posOffset></wp:positionH>
<wp:positionV relativeFrom="page"><wp:posOffset>{Y}</wp:posOffset></wp:positionV><wp:extent cx="{W}" cy="{H}"/>
<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="{id_}" name="{name}"/><wp:cNvGraphicFramePr/>
<a:graphic>{graphic.replace("__W__", str(W)).replace("__H__", str(H))}</a:graphic></wp:anchor>"""


def shape_run(id_, name, x, y, w, h, z, behind, geom, fill, line, txbx="", body='<wps:bodyPr/>') -> str:
    wsp = f"""<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>
<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="__W__" cy="__H__"/></a:xfrm>{geom}{fill}{line}</wps:spPr>{txbx}{body}</wps:wsp></a:graphicData>"""
    return f'<w:r {NS}><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>{anchor(id_, name, x, y, w, h, z, behind, wsp)}</w:drawing></mc:Choice></mc:AlternateContent></w:r>'


def picture_run(id_, name, x, y, w, h, z, png_rid, svg_rid) -> str:
    pic = f"""<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="{id_}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{png_rid}"><a:extLst><a:ext uri="{{96DAC541-7B7A-43D3-8B79-37D633B846F1}}"><asvg:svgBlip r:embed="{svg_rid}"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="__W__" cy="__H__"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData>"""
    return f'<w:r {NS}><w:rPr><w:noProof/></w:rPr><w:drawing>{anchor(id_, name, x, y, w, h, z, True, pic)}</w:drawing></w:r>'


NAVY_FILL = '<a:solidFill><a:srgbClr val="0A3180"/></a:solidFill>'
NO_LINE = "<a:ln><a:noFill/></a:ln>"


def frame_path() -> str:
    """The frame as one path, 10 mm in from the page edge, with 5 mm corners. It leaves a gap at the
    top-left corner for the mark and one on the bottom edge for the page-number pill."""
    W, H, r = 190 * EMU, 277 * EMU, 5 * EMU
    pt = lambda x, y: f'<a:pt x="{round(x)}" y="{round(y)}"/>'  # noqa: E731
    arc = lambda start: f'<a:arcTo wR="{r}" hR="{r}" stAng="{start}" swAng="5400000"/>'  # noqa: E731
    path = (
        f"<a:moveTo>{pt(16 * EMU, 0)}</a:moveTo><a:lnTo>{pt(W - r, 0)}</a:lnTo>{arc(16200000)}"
        f"<a:lnTo>{pt(W, H - r)}</a:lnTo>{arc(0)}<a:lnTo>{pt(105 * EMU, H)}</a:lnTo>"
        f"<a:moveTo>{pt(85 * EMU, H)}</a:moveTo><a:lnTo>{pt(r, H)}</a:lnTo>{arc(5400000)}<a:lnTo>{pt(0, 13 * EMU)}</a:lnTo>"
    )
    return (
        '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>'
        f'<a:pathLst><a:path w="{W}" h="{H}" fill="none">{path}</a:path></a:pathLst></a:custGeom>'
    )


def frame_runs(png_rid: str, svg_rid: str) -> list[str]:
    frame_line = '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="0A3180"/></a:solidFill></a:ln>'
    rpr = f'<w:rPr><w:rFonts w:ascii="{HEAVY}" w:hAnsi="{HEAVY}" w:cs="{HEAVY}"/><w:color w:val="FFFFFF"/><w:sz w:val="16"/></w:rPr>'
    field = "".join(
        f"<w:r>{rpr}{part}</w:r>"
        for part in (
            '<w:fldChar w:fldCharType="begin"/>',
            '<w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText>',
            '<w:fldChar w:fldCharType="separate"/>',
            "<w:t>1</w:t>",
            '<w:fldChar w:fldCharType="end"/>',
        )
    )
    txbx = f'<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>{rpr}</w:pPr>{field}</w:p></w:txbxContent></wps:txbx>'
    centred = '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr>'
    pill_geom = '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>'
    return [
        shape_run(9001, "AERA frame", 10, 10, 190, 277, 251658240, True, frame_path(), "<a:noFill/>", frame_line),
        picture_run(9002, "AERA mark", 11, 9, 12, 12, 251659264, png_rid, svg_rid),
        shape_run(9003, "AERA page number", 100, 284.5, 10, 5, 251660288, False, pill_geom, NAVY_FILL, NO_LINE, txbx, centred),
    ]


def page(doc, running_head: str):
    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.PORTRAIT
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.top_margin, sec.bottom_margin = Mm(30), Mm(28)
    sec.left_margin, sec.right_margin = Mm(25), Mm(25)
    sec.header_distance, sec.footer_distance = Mm(13), Mm(12)

    header = sec.header
    hpart = header.part
    png_rid, _ = hpart.get_or_add_image(str(BRAND / "logo" / "png" / "aera-mark-512.png"))
    svg = Part(PackURI("/word/media/aera-mark.svg"), "image/svg+xml", (BRAND / "logo" / "svg" / "aera-mark.svg").read_bytes(), hpart.package)
    svg_rid = hpart.relate_to(svg, RT.IMAGE)

    p = header.paragraphs[0]
    p.style = doc.styles["Header"]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for run in frame_runs(png_rid, svg_rid):
        p._p.append(parse_xml(run))
    p.add_run(running_head)


# ---------------------------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------------------------


def blank(doc):
    doc.add_paragraph("Chapter 1", style="Kicker")
    doc.add_paragraph("Chapter title", style="Heading 1")
    doc.add_paragraph(
        "Start writing here. Use the styles in the Home tab: Kicker for the small label above a "
        "chapter, Heading 1 to 3 for titles, Caption under figures and tables, and the AERA Table "
        "style for tables. The frame, logo and page number are in the header and repeat on every page."
    )


LEVELS = [
    ("Quiet", "under 20%", "Plenty of seats"),
    ("Comfortable", "20 to 50%", "Some seats, easy standing"),
    ("Busy", "50 to 75%", "Standing, room to move"),
    ("Crowded", "75 to 95%", "Tight standing"),
    ("Packed", "95% and over", "Consider the next train"),
]


def sample(doc):
    doc.add_paragraph("Chapter 3", style="Kicker")
    doc.add_paragraph("System design", style="Heading 1")
    doc.add_paragraph(
        "AERA is a digital twin of the LRT Kelana Jaya Line. It runs every train on the published "
        "timetable at real Kuala Lumpur time and predicts how crowded each train, and each car, will "
        "be. Predictions come from twelve weeks of origin-destination ridership published on "
        "data.gov.my, shaped by hour of day."
    )
    doc.add_paragraph("3.1 Crowding model", style="Heading 2")
    doc.add_paragraph(
        "Each train's load is the passenger flow on its track segment multiplied by the scheduled "
        "headway and divided by the train's capacity of 800 riders. The result is shown as one of "
        "five crowding levels, always with a label and an icon so it never relies on colour alone."
    )
    doc.add_picture(str(BRAND / "mockups" / "02-splash-and-app.png"), width=Mm(130))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("Figure 3.1: Splash screen and app bar in the AERA rider app.", style="Caption")
    table = doc.add_table(rows=1, cols=3)
    table.style = doc.styles["AERA Table"]
    for cell, text in zip(table.rows[0].cells, ("Level", "Load", "What riders see")):
        cell.text = text
    for row in LEVELS:
        cells = table.add_row().cells
        for cell, text in zip(cells, row):
            cell.text = text
    doc.add_paragraph("Table 3.1: Crowding levels and what riders see.", style="Caption")

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_paragraph("3.2 Data sources", style="Heading 2")
    doc.add_paragraph("The twin combines three kinds of data:")
    for text in (
        "Prasarana's published timetable (GTFS Static) for every train and station.",
        "Daily origin-destination ridership from data.gov.my, over a twelve-week window.",
        "Rider reports and in-train sensors where they exist, weighted by age and reliability.",
    ):
        doc.add_paragraph(text, style="List Bullet")
    doc.add_paragraph("3.3 Validation", style="Heading 2")
    doc.add_paragraph(
        "A back-test against held-out days gives a median daily error of 4.7%. Peaks are shaped by "
        "KTM Komuter's hourly pattern, smoothed over three hours, which may overstate LRT peaks."
    )
    doc.add_paragraph("Riders choose a quieter car when they can see one.", style="Quote")


# ---------------------------------------------------------------------------------------------
# Package tweaks: embedded fonts, theme fonts, no thumbnail, template content type
# ---------------------------------------------------------------------------------------------


def finish(data: bytes, fonts: dict[str, Path], template: bool) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(data))
    files = {n: src.read(n) for n in src.namelist() if n != "docProps/thumbnail.jpeg"}

    faces = [("Regular", FONT, "embedRegular"), ("Bold", FONT, "embedBold"), ("ExtraBold", HEAVY, "embedRegular")]
    rels, entries = [], {}
    for i, (style, family, tag) in enumerate(faces, 1):
        key = "{" + str(uuid.uuid4()).upper() + "}"
        files[f"word/fonts/font{i}.odttf"] = obfuscate(fonts[style].read_bytes(), key)
        rels.append(f'<Relationship Id="rIdF{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font{i}.odttf"/>')
        entries.setdefault(family, []).append(f'<w:{tag} r:id="rIdF{i}" w:fontKey="{key}"/>')
    files["word/_rels/fontTable.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>"
    ).encode()
    table = files["word/fontTable.xml"].decode()
    entry = "".join(
        f'<w:font w:name="{family}"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>{"".join(tags)}</w:font>'
        for family, tags in entries.items()
    )
    if "xmlns:r=" not in table.split(">", 2)[1]:
        table = table.replace("<w:fonts ", '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
    files["word/fontTable.xml"] = table.replace("</w:fonts>", entry + "</w:fonts>").encode()

    settings = files["word/settings.xml"].decode()
    early = r"<w:(?:writeProtection|view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|displayBackgroundShape|printPostScriptOverText|printFractionalCharacterWidth|printFormsData)\b[^>]*/>"
    found = list(re.finditer(early, settings))
    at = found[-1].end() if found else settings.index(">", settings.index("<w:settings")) + 1
    files["word/settings.xml"] = (settings[:at] + "<w:embedTrueTypeFonts/>" + settings[at:]).encode()

    theme = files["word/theme/theme1.xml"].decode()
    theme = re.sub(r'(<a:(?:major|minor)Font>\s*<a:latin typeface=")[^"]*', rf"\g<1>{FONT}", theme)
    files["word/theme/theme1.xml"] = theme.encode()

    rels = files["_rels/.rels"].decode()
    files["_rels/.rels"] = re.sub(r'<Relationship [^>]*Target="docProps/thumbnail.jpeg"[^>]*/>', "", rels).encode()

    ct = files["[Content_Types].xml"].decode()
    ct = ct.replace("<Default Extension=\"xml\"", '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default Extension="xml"', 1)
    if 'Extension="svg"' not in ct:
        ct = ct.replace("<Default Extension=\"xml\"", '<Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="xml"', 1)
    ct = re.sub(r'<Override PartName="/docProps/thumbnail.jpeg"[^>]*/>', "", ct)
    if template:
        ct = ct.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")
    files["[Content_Types].xml"] = ct.encode()

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
        for name, blob in files.items():
            z.writestr(name, blob)
    return out.getvalue()


def build(fill, running_head: str) -> bytes:
    doc = Document()
    styles(doc)
    page(doc, running_head)
    body = doc.element.body
    for p in list(body.iterchildren(qn("w:p"))):
        body.remove(p)
    fill(doc)
    props = doc.core_properties
    props.author = props.last_modified_by = "Mahendra Tanjung"
    props.title = "AERA report"
    props.comments = ""
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def main() -> None:
    fonts = static_fonts(Path(sys.argv[1]), Path(sys.argv[2]))
    head = "Advanced Ecosystem of Rail Analytics"
    blank_doc = build(blank, head)
    (HERE / "AERA_Report_Template.dotx").write_bytes(finish(blank_doc, fonts, template=True))
    (HERE / "AERA_Report_Blank.docx").write_bytes(finish(blank_doc, fonts, template=False))
    (HERE / "AERA_Report_Sample.docx").write_bytes(finish(build(sample, head), fonts, template=False))
    print("wrote", ", ".join(p.name for p in sorted(HERE.glob("AERA_Report_*"))))


if __name__ == "__main__":
    main()
