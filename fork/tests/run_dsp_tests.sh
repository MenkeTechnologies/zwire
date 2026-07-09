#!/usr/bin/env bash
# Drift-proof DSP correctness test for the zwire browser-wide audio engine.
#
# The engine (ZwireEqBand + ZwireEqConfig + ZwireAudioEq) is NOT vendored into
# the test. It is extracted at build time from the authoritative source patch so
# the test always exercises the real, current DSP code:
#
#   fork/patches/0022-audio-eq-output.patch  (added `+` lines)
#     -> dsp_cfg.inc    (config structs)
#     -> dsp_class.inc  (the ZwireAudioEq class)
#
# Then dsp_test.cpp is compiled against dsp_shim.h and run. Any DSP change in the
# patch recompiles here and must still satisfy the invariants, or this fails.
#
# No external deps beyond clang++. Headless. Exits non-zero on any failure.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
patch="$repo/fork/patches/0022-audio-eq-output.patch"

[ -f "$patch" ] || { echo "FATAL: patch not found: $patch" >&2; exit 2; }

build="$here/build"
mkdir -p "$build"
cfg_inc="$build/dsp_cfg.inc"
class_inc="$build/dsp_class.inc"
bin="$build/dsp_test"

# --- extract the config structs (ZwireEqBand through end of ZwireEqConfig) -----
# Start at `+struct ZwireEqBand {`, print through the `+};` that closes
# ZwireEqConfig (the one right after `generation = 0;`), stripping the leading +.
awk '
  /^\+struct ZwireEqBand \{/        { p = 1 }
  p                                 { print }
  /generation = 0;/                 { seen_gen = 1 }
  p && seen_gen && /^\+};/          { exit }
' "$patch" | sed 's/^+//' > "$cfg_inc"

# --- extract the ZwireAudioEq class -------------------------------------------
# Start at `+class ZwireAudioEq {`, print through its closing `+};` at column 0.
# Inner struct closes are indented (`+  };`) so `^\+};` matches only the class.
awk '
  /^\+class ZwireAudioEq \{/  { p = 1 }
  p                           { print }
  p && /^\+};/                { exit }
' "$patch" | sed 's/^+//' > "$class_inc"

# --- sanity: extractions are non-trivial and well-formed ----------------------
grep -q 'struct ZwireEqConfig' "$cfg_inc"   || { echo "FATAL: cfg extraction failed" >&2; exit 2; }
grep -q 'uint64_t generation'  "$cfg_inc"   || { echo "FATAL: cfg extraction truncated" >&2; exit 2; }
grep -q 'class ZwireAudioEq'   "$class_inc" || { echo "FATAL: class extraction failed" >&2; exit 2; }
grep -q 'void Process'         "$class_inc" || { echo "FATAL: class extraction truncated" >&2; exit 2; }
echo "extracted: $(wc -l < "$cfg_inc" | tr -d ' ') cfg lines, $(wc -l < "$class_inc" | tr -d ' ') class lines"

# --- compile ------------------------------------------------------------------
clang++ -std=c++20 -O2 -Wall -I"$here" -I"$build" "$here/dsp_test.cpp" -o "$bin"

# --- run ----------------------------------------------------------------------
echo "running DSP invariant tests..."
"$bin"
