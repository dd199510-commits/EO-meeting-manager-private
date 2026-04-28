from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, StyleSheet1, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "使用说明书.md"
OUTPUT = ROOT / "使用说明书.pdf"

FONT_SERIF = "ManualSongti"
FONT_SANS = "ManualArialUnicode"

ACCENT = colors.HexColor("#1F5AA6")
ACCENT_SOFT = colors.HexColor("#EAF2FF")
SUBTLE = colors.HexColor("#5C667A")
RULE = colors.HexColor("#D7E2F2")
TEXT = colors.HexColor("#1C2430")
PAGE_BG = colors.white


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_SERIF, "/System/Library/Fonts/Supplemental/Songti.ttc"))
    pdfmetrics.registerFont(TTFont(FONT_SANS, "/Library/Fonts/Arial Unicode.ttf"))


def build_styles() -> StyleSheet1:
    styles = getSampleStyleSheet()

    base = ParagraphStyle(
        "BaseCN",
        parent=styles["BodyText"],
        fontName=FONT_SERIF,
        fontSize=11,
        leading=18,
        textColor=TEXT,
        wordWrap="CJK",
        allowWidows=1,
        allowOrphans=1,
    )
    styles.add(base)
    styles.add(
        ParagraphStyle(
            "TitleCN",
            parent=base,
            fontSize=22,
            leading=30,
            alignment=TA_CENTER,
            textColor=ACCENT,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            "IntroCN",
            parent=base,
            fontSize=10.5,
            leading=17,
            alignment=TA_CENTER,
            textColor=SUBTLE,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            "H1CN",
            parent=base,
            fontSize=15.5,
            leading=24,
            textColor=ACCENT,
            spaceBefore=12,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            "H2CN",
            parent=base,
            fontSize=12.5,
            leading=20,
            textColor=colors.HexColor("#244C7D"),
            spaceBefore=8,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "BodyCN",
            parent=base,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "BulletCN",
            parent=base,
            leftIndent=16,
            firstLineIndent=-11,
            bulletIndent=0,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            "NumberCN",
            parent=base,
            leftIndent=16,
            firstLineIndent=-11,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            "LeadCN",
            parent=base,
            textColor=SUBTLE,
            backColor=ACCENT_SOFT,
            borderPadding=(7, 9, 7),
            borderRadius=4,
            spaceBefore=3,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            "SmallCN",
            parent=base,
            fontSize=9.5,
            leading=14,
            textColor=SUBTLE,
        )
    )
    return styles


def inline_markup(text: str) -> str:
    escaped = escape(text.strip())
    return re.sub(
        r"`([^`]+)`",
        rf'<font name="{FONT_SANS}" color="#163A69">\1</font>',
        escaped,
    )


def build_title_block(styles: StyleSheet1):
    title = Paragraph("CEO Office 会议管理系统使用说明书", styles["TitleCN"])
    subtitle = Paragraph("会议库维护、AI 排程、审核确认与预留通知操作指南", styles["IntroCN"])
    note = Paragraph("版本：V1.0", styles["IntroCN"])
    box = Table(
        [[title], [subtitle], [note]],
        colWidths=[170 * mm],
        style=TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ACCENT_SOFT),
                ("BOX", (0, 0), (-1, -1), 0.8, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ]
        ),
    )
    return [box, Spacer(1, 8), HRFlowable(width="100%", thickness=1, color=RULE), Spacer(1, 8)]


def build_story(styles: StyleSheet1):
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    story = []
    story.extend(build_title_block(styles))

    first_heading_seen = False
    for raw in lines:
        stripped = raw.strip()

        if not stripped:
            story.append(Spacer(1, 4))
            continue

        if stripped == "---":
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.7, color=RULE))
            story.append(Spacer(1, 6))
            continue

        if stripped.startswith("# "):
            if first_heading_seen:
                story.append(Paragraph(inline_markup(stripped[2:]), styles["H1CN"]))
            else:
                first_heading_seen = True
            continue

        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), styles["H1CN"]))
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), styles["H2CN"]))
            continue

        numbered = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if numbered:
            story.append(Paragraph(inline_markup(f"{numbered.group(1)}. {numbered.group(2)}"), styles["NumberCN"]))
            continue

        bullet = re.match(r"^-\s+(.*)$", stripped)
        if bullet:
            story.append(Paragraph(inline_markup(f"• {bullet.group(1)}"), styles["BulletCN"]))
            continue

        if stripped.endswith("：") or stripped.endswith(":"):
            story.append(Paragraph(f"<b>{inline_markup(stripped)}</b>", styles["LeadCN"]))
            continue

        story.append(Paragraph(inline_markup(stripped), styles["BodyCN"]))

    return story


def draw_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)

    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, height - 13 * mm, width - 18 * mm, height - 13 * mm)
    canvas.line(18 * mm, 12 * mm, width - 18 * mm, 12 * mm)

    canvas.setFillColor(ACCENT)
    canvas.setFont(FONT_SANS, 9)
    canvas.drawString(20 * mm, height - 10 * mm, "CEO Office 会议管理系统")

    canvas.setFillColor(SUBTLE)
    canvas.drawRightString(width - 20 * mm, height - 10 * mm, "使用说明书")
    canvas.drawRightString(width - 20 * mm, 8 * mm, f"第 {doc.page} 页")
    canvas.restoreState()


def main() -> None:
    register_fonts()
    styles = build_styles()
    story = build_story(styles)

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title="CEO Office 会议管理系统使用说明书",
        author="OpenAI Codex",
    )
    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    print(OUTPUT)


if __name__ == "__main__":
    main()
