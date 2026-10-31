#!/usr/bin/env bash
# regenerates the self-hosted gochi hand subset beside this script.
#
# the output is COMMITTED SOURCE, not a build artifact — same convention as
# packages/crypto's and packages/stocks' src/generated/**. nothing in the task
# graph runs this; it is a maintenance script for a font bump.
#
# the red hat round files beside this script are NOT made here: they are the
# vendor's own static woff2 files, committed whole (see ../fonts.css). a red
# hat round bump is a copy of the new release's files, not a run of this.
#
# gochi hand is cut to the latin range below rather than taken from a font
# package so the one subset we own has one pipeline and one place to look.
#
# output is equivalent but not byte-identical across runs — woff2 compression
# is not deterministic. compare glyph counts, codepoints and feature tags, not
# checksums, when confirming a regeneration did what you expected.
#
# needs python with fontTools + brotli:
#   python3 -m venv .venv && .venv/bin/pip install 'fonttools[woff]' brotli
#   PY=.venv/bin/python3 ./generate.sh
set -euo pipefail
cd "$(dirname "$0")"

PY="${PY:-python3}"
"$PY" -c 'import fontTools, brotli' || {
  echo "needs fontTools + brotli — see the header of this script" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "fetching upstream sources from google/fonts…"
curl -sfL -o "$tmp/GochiHand.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/gochihand/GochiHand-Regular.ttf"

# the unicode-range in ../fonts.css, verbatim. the subset is cut to the UNION
# of its range and the coverage the committed subset beside this script already
# has, so a regeneration can never serve less than what the site served before.
# that union is why the range is expanded in python rather than passed as-is.
"$PY" - "$tmp" <<'PYEOF'
import subprocess, sys, os
from fontTools.ttLib import TTFont

tmp = sys.argv[1]
here = os.getcwd()  # the shell cd'd to this script's dir above

LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
# the layout features the subset keeps: shaping, marks, kerning, ligatures.
GOCHI_FEATURES = "ccmp,locl,mark,mkmk,kern,liga"

def expand(spec):
    out = set()
    for part in spec.split(","):
        p = part.strip()[2:]
        if "-" in p:
            a, b = p.split("-")
            out.update(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(p, 16))
    return out

def floor(out):
    """the coverage the committed subset at `out` already has — the ratchet the
    union above is taken against. it is read from the committed woff2 rather
    than from the font package the subset was first derived from, because
    that package is no longer a dependency: deriving the floor from node_modules
    would quietly return nothing on a clean install and cut a SMALLER font than
    the one it replaced. the shipped bytes are the only copy of this number that
    cannot go missing. absent (a subset generated for the first time) -> the
    declared range alone, said out loud rather than assumed."""
    try:
        return set(TTFont(out).getBestCmap())
    except Exception:
        print(f"  no existing {os.path.basename(out)} — declared range only")
        return set()

def cut(src, out, spec, features):
    keep = floor(out)
    unicodes = expand(spec) | keep
    lst = os.path.join(tmp, "u.txt")
    with open(lst, "w") as fh:
        fh.write(",".join(f"U+{c:04X}" for c in sorted(unicodes)))
    subprocess.run([sys.executable, "-m", "fontTools.subset", src,
                    f"--unicodes-file={lst}", f"--layout-features={features}",
                    "--flavor=woff2", f"--output-file={out}"], check=True)
    f = TTFont(out)
    # the ratchet is only a promise until something checks it — the subsetter
    # can drop a requested codepoint the source face does not actually have.
    lost = keep - set(f.getBestCmap())
    if lost:
        raise SystemExit(f"{os.path.basename(out)} regressed: lost "
                         + " ".join(f"U+{c:04X}" for c in sorted(lost)))
    feats = set()
    for t in ("GSUB", "GPOS"):
        if t in f:
            for fr in f[t].table.FeatureList.FeatureRecord:
                feats.add(fr.FeatureTag)
    print(f"  {os.path.basename(out):44} {os.path.getsize(out):>6}B  "
          f"{len(f.getBestCmap()):>3} cps  {','.join(sorted(feats))}")

cut(f"{tmp}/GochiHand.ttf",
    os.path.join(here, "gochi-hand-latin-400-normal.woff2"),
    LATIN, GOCHI_FEATURES)
PYEOF

echo "done. verify with: pnpm --filter @better-giving/ui build && grep -c woff2 dist/styles.css"
