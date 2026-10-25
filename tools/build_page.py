#!/usr/bin/env python3
"""Assemble the final single-file page and a linked preview page."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
OUT_INDEX = ROOT / "index.html"
OUT_PREVIEW = ROOT / ".tmp" / "preview.html"

SCRIPTS = [
    ("vendor/three.bundle.js", "INLINE_THREE"),
    ("src/parts-data.js", "INLINE_PARTS"),
    ("src/model.js", "INLINE_MODEL"),
    ("src/ui.js", "INLINE_UI"),
    ("src/app.js", "INLINE_APP"),
]


def script_tag(path: Path, code: str) -> str:
    if "</script" in code.lower():
        raise RuntimeError(f"{path} contains a literal </script> sequence")
    return f"<script>\n{code}\n</script>"


def main():
    template = (SRC / "template.html").read_text(encoding="utf-8")

    ui_css = (SRC / "ui.css").read_text(encoding="utf-8")
    app_css = (SRC / "app.css").read_text(encoding="utf-8")
    styles = f"<style>\n/* ===== HUD ===== */\n{ui_css}\n/* ===== SCENE / LABELS ===== */\n{app_css}\n</style>"
    inline = template.replace("<!--INLINE_STYLES-->", styles)

    missing = []
    for rel, marker in SCRIPTS:
        path = ROOT / rel
        if not path.exists():
            missing.append(rel)
            continue
        inline = inline.replace(
            f"<!--{marker}-->",
            script_tag(path, path.read_text(encoding="utf-8")),
        )
    if missing:
        raise RuntimeError("Missing source files: " + ", ".join(missing))

    # Preview page with normal external references for easier debugging.
    preview = template
    preview = preview.replace(
        "<!--INLINE_STYLES-->",
        '<link rel="stylesheet" href="../src/ui.css" />\n<link rel="stylesheet" href="../src/app.css" />',
    )
    for rel, marker in SCRIPTS:
        preview = preview.replace(f"<!--{marker}-->", f'<script src="../{rel}"></script>')

    OUT_INDEX.write_text(inline, encoding="utf-8")
    OUT_PREVIEW.parent.mkdir(exist_ok=True)
    OUT_PREVIEW.write_text(preview, encoding="utf-8")

    # Sanity checks: no leftover markers or broken inline script closes.
    if re.search(r"<!--INLINE_", inline):
        raise RuntimeError("Unreplaced inline markers remain")
    if not re.search(r"window\.THREE|globalThis\.THREE", inline):
        raise RuntimeError("Three bundle not embedded")
    print(f"Wrote {OUT_INDEX} ({OUT_INDEX.stat().st_size:,} bytes)")
    print(f"Wrote {OUT_PREVIEW} ({OUT_PREVIEW.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
