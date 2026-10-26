#!/usr/bin/env bash
# Regenerate every CAD output of the Universal ATM Stand (FreeCAD >= 1.0 required).
set -euo pipefail
cd "$(dirname "$0")"
FC=$(command -v freecadcmd || command -v freecad.cmd || command -v FreeCADCmd)
"$FC" src/build_all.py 2>&1 | tr "\r\t" "\n\n" | grep -v -e "update.go" -e "snap-specific" -e "%)" -e "saving" -e "^\s*$"
