#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-$HOME/youtube-webos-smart-mirror}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SOURCE="${SCRIPT_DIR}/smart-mirror-bridge.js"
TARGET_BRIDGE="${TARGET_DIR}/src/smart-mirror-bridge.js"
USER_SCRIPT="${TARGET_DIR}/src/userScript.js"

if [[ ! -f "${BRIDGE_SOURCE}" ]]; then
  echo "Bridge source ontbreekt: ${BRIDGE_SOURCE}" >&2
  exit 1
fi

if [[ ! -f "${USER_SCRIPT}" ]]; then
  echo "Geen youtube-webos checkout gevonden in: ${TARGET_DIR}" >&2
  exit 1
fi

cp "${BRIDGE_SOURCE}" "${TARGET_BRIDGE}"

python3 - "${USER_SCRIPT}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

import_line = "import './smart-mirror-bridge.js';"
anchor = "import './sponsorblock.js';"

if import_line in text:
    print("Smart Mirror bridge import bestaat al.")
    raise SystemExit(0)

if anchor not in text:
    raise SystemExit("SponsorBlock import-anchor niet gevonden in src/userScript.js")

text = text.replace(anchor, anchor + "\n" + import_line, 1)
path.write_text(text)
print("Smart Mirror bridge import toegevoegd.")
PY

echo "Bridge klaar in ${TARGET_DIR}"
