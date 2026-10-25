#!/usr/bin/env python3
"""Validate the generated single-file index.html without a browser."""
from pathlib import Path
import hashlib
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
SRC = ROOT / "src"


def main():
    html = INDEX.read_text(encoding="utf-8")
    report = {}

    assert html.lstrip().startswith("<!DOCTYPE html>"), "missing doctype"
    assert html.rstrip().endswith("</html>"), "truncated document"
    assert 'charset="utf-8"' in html, "missing UTF-8 charset"
    assert not re.search(r"<!--INLINE_", html), "unreplaced inline markers"
    assert "Action4Model" in html and "Action4UI" in html, "modules missing"
    assert "window.THREE" in html or "global.THREE" in html, "three missing"

    scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", html, re.DOTALL)
    assert len(scripts) == 5, f"expected 5 inline scripts, found {len(scripts)}"
    styles = re.findall(r"<style(?:\s[^>]*)?>(.*?)</style>", html, re.DOTALL)
    assert len(styles) == 1, f"expected 1 inline style block, found {len(styles)}"
    assert "</script" not in "".join(scripts).lower(), "nested script close in JS"
    assert "</style" not in styles[0].lower(), "nested style close in CSS"

    # Check script syntax through node --check.
    node = None
    for cand in ["node", "node.exe"]:
        try:
            subprocess.run([cand, "--version"], capture_output=True, check=True)
            node = cand
            break
        except Exception:
            continue
    if not node:
        raise RuntimeError("node not available")
    td = ROOT / ".tmp" / "page-validate"
    td.mkdir(parents=True, exist_ok=True)
    for i, script in enumerate(scripts):
        if not script.strip():
            continue
        fp = td / f"inline-{i}.js"
        fp.write_text(script, encoding="utf-8")
        res = subprocess.run([node, "--check", str(fp)], capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"script #{i} syntax error:\n{res.stderr[-2000:]}")
        report[f"inline_script_{i}_bytes"] = len(script.encode("utf-8"))

    # External resources: only allow data:, #, or relative file references in
    # attributes that actually load something. The page must not require a server.
    external = []
    for m in re.finditer(r'\b(?:src|href)\s*=\s*"([^"]*)"', html):
        value = m.group(1).strip()
        if not value or value.startswith("#") or value.startswith("data:"):
            continue
        if value.startswith("http://") or value.startswith("https://") or value.startswith("//"):
            external.append(value)
    assert not external, f"external dependencies: {external}"

    # Ensure the latest source content is embedded (sample markers, not hashes).
    checks = {
        "parts": "window.ACTION4_PARTS",
        "model": "window.Action4Model",
        "ui": "window.Action4UI",
        "app": "__A4_DEBUG__",
        "labels": "leader-lines",
        "boot": "boot-screen",
        "ui_cn": "部件清单",
        "ui_detail": "拆解此部件",
        "guide": "拖拽旋转",
    }
    for name, needle in checks.items():
        assert needle in html, f"missing content marker: {name} ({needle})"

    ui_css = (SRC / "ui.css").read_text(encoding="utf-8")
    app_css = (SRC / "app.css").read_text(encoding="utf-8")
    assert ui_css in html and app_css in html, "CSS sources not embedded verbatim"
    for rel in ["parts-data.js", "model.js", "ui.js", "app.js"]:
        src = (SRC / rel).read_text(encoding="utf-8")
        assert src in html, f"{rel} not embedded verbatim"

    report.update({
        "bytes": INDEX.stat().st_size,
        "sha256": hashlib.sha256(INDEX.read_bytes()).hexdigest(),
        "scripts": len(scripts),
        "style_blocks": len(styles),
        "lines": html.count("\n") + 1,
        "sources_embedded": True,
        "external_dependencies": 0,
    })
    print("PAGE VALIDATION PASSED")
    for k, v in report.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"PAGE VALIDATION FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
