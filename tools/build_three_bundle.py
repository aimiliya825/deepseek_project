#!/usr/bin/env python3
"""Bundle the local Three.js ESM build + addons into one classic-script IIFE.

No network access is used. The result exposes window.THREE with the public
namespace and the addons we need (OrbitControls, EffectComposer, ...).

Each ESM module is wrapped in its own function scope so private identifiers
from different modules cannot collide. External names are injected through a
namespace object.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
OUT = VENDOR / "three.bundle.js"

IMPORT_RE = re.compile(r"^[ \t]*import\s*(?:\{([\s\S]*?)\}|([A-Za-z_$][\w$]*))?\s*from\s*'[^']+';", re.MULTILINE)
REEXPORT_RE = re.compile(r"^[ \t]*export\s*\{([\s\S]*?)\}\s*from\s*'[^']+';", re.MULTILINE)
EXPORT_RE = re.compile(r"^[ \t]*export\s*\{([\s\S]*?)\};", re.MULTILINE)
EXPORT_DECL_RE = re.compile(r"^[ \t]*export\s+(class|function|const|let|var)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)


def parse_list(text: str):
    """Parse an import/export name list into (local, exported) pairs."""
    pairs = []
    for raw in text.split(","):
        item = raw.strip()
        if not item:
            continue
        if " as " in item:
            local, exported = [p.strip() for p in item.split(" as ", 1)]
        else:
            local = exported = item
        pairs.append((local, exported))
    return pairs


def strip_module(src: str, label: str):
    """Return (code, import_locals, exported_pairs)."""
    import_locals = []
    exported_pairs = []

    for match in IMPORT_RE.finditer(src):
        if match.group(1):
            for local, _ in parse_list(match.group(1)):
                if local not in import_locals:
                    import_locals.append(local)
        elif match.group(2):
            if match.group(2) not in import_locals:
                import_locals.append(match.group(2))
    src = IMPORT_RE.sub("", src)

    for match in REEXPORT_RE.finditer(src):
        for local, exported in parse_list(match.group(1)):
            exported_pairs.append((local, exported))
            if local not in import_locals:
                import_locals.append(local)
    src = REEXPORT_RE.sub("", src)

    for match in EXPORT_RE.finditer(src):
        for local, exported in parse_list(match.group(1)):
            exported_pairs.append((local, exported))
    src = EXPORT_RE.sub("", src)

    def decl_repl(m):
        exported_pairs.append((m.group(2), m.group(2)))
        return f"{m.group(1)} {m.group(2)}"

    src = EXPORT_DECL_RE.sub(decl_repl, src)

    if re.search(r"^\s*export\b", src, re.MULTILINE):
        raise RuntimeError(f"{label}: unhandled export syntax remains")

    # Keep first occurrence of each exported name
    seen = set()
    exported_pairs = [(l, e) for l, e in exported_pairs if not (e in seen or seen.add(e))]

    # Names referenced by the exported object but not defined in this module
    # have to be injected from the dependency namespace.
    defined = set(
        re.findall(
            r"^[ \t]*(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)",
            src,
            re.MULTILINE,
        )
    )
    external = [n for n, _ in exported_pairs if n not in defined]
    for name in external:
        if name not in import_locals:
            import_locals.append(name)

    return src, import_locals, exported_pairs


def object_literal(pairs):
    if not pairs:
        return "{}"
    items = [k if k == v else f"{v}: {k}" for k, v in pairs]
    return "{\n  " + ",\n  ".join(items) + "\n}"


def wrapper(name: str, code: str, import_locals, exported_pairs) -> str:
    inject = ", ".join(import_locals)
    inject = f"\n  const {{ {inject} }} = __DEP;" if inject else ""
    return (
        f"\n/* ===== {name} ===== */\n"
        f"const __ns_{re.sub(r'[^A-Za-z0-9_]', '_', name)} = (function (__DEP) {{{inject}\n"
        f"{code}\n"
        f"  return {object_literal(exported_pairs)};\n"
        f"}})(__NS);\n"
        f"__NS = Object.assign(__NS, __ns_{re.sub(r'[^A-Za-z0-9_]', '_', name)});\n"
    )


def main():
    core_src = (VENDOR / "three.core.js").read_text(encoding="utf-8")
    module_src = (VENDOR / "three.module.js").read_text(encoding="utf-8")

    core_code, core_imports, core_exports = strip_module(core_src, "three.core.js")
    if core_imports:
        raise RuntimeError(f"three.core.js unexpectedly imports: {core_imports}")

    addon_order = [
        "CopyShader.js",
        "LuminosityHighPassShader.js",
        "OutputShader.js",
        "Pass.js",
        "MaskPass.js",
        "ShaderPass.js",
        "EffectComposer.js",
        "RenderPass.js",
        "UnrealBloomPass.js",
        "OutputPass.js",
        "OrbitControls.js",
    ]

    revision = re.search(r"const REVISION = '([^']+)'", core_src)
    if not revision:
        raise RuntimeError("Could not determine Three.js revision")
    revision = revision.group(1)

    chunks = [
        f"""/*! Three.js r{revision} — bundled locally for offline use.
 *  Core + OrbitControls + EffectComposer + UnrealBloomPass.
 *  Generated by tools/build_three_bundle.py from MIT-licensed Three.js source.
 */
(function (global) {{
'use strict';
const THREE_CORE_VERSION = '{revision}';

/* ===== three.core.js ===== */
{core_code}

/* Initial public namespace. */
let __NS = Object.assign(Object.create(null), {object_literal(core_exports)});
"""
    ]

    module_code, module_imports, module_exports = strip_module(module_src, "three.module.js")
    chunks.append(wrapper("three.module.js", module_code, module_imports, module_exports))

    for name in addon_order:
        src = (VENDOR / name).read_text(encoding="utf-8")
        code, imports, exports = strip_module(src, name)
        chunks.append(wrapper(name, code, imports, exports))

    chunks.append(
        f"""
/* ===== final namespace ===== */
const THREE = Object.assign(Object.create(null), __NS);
THREE.REVISION = THREE_CORE_VERSION;
global.THREE = THREE;
global.__THREE_BUNDLE__ = {{ revision: THREE_CORE_VERSION }};
}})(typeof globalThis !== 'undefined' ? globalThis : this);
"""
    )

    OUT.write_text("".join(chunks), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    print(f"revision: {revision}")
    print("addons: OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
