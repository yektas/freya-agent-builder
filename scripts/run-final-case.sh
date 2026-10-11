#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: scripts/run-final-case.sh CASE_FOLDER MOCK_URL' >&2
  exit 2
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case_folder="$(cd "$1" && pwd)"
mock_url="$2"
openapi_file="$(mktemp "${TMPDIR:-/tmp}/freya-final-openapi.XXXXXX")"
trap 'rm -f "$openapi_file"' EXIT

cd "$repo_dir"
python3 src/contract_to_openapi.py "$case_folder" \
  --hints final-mock/tool-defaults.json --out "$openapi_file"
node --env-file-if-exists=.env --env-file-if-exists=build-the-builder/env.sh \
  src/cli.ts freya --case-folder "$case_folder" --openapi "$openapi_file" \
  --mock-url "$mock_url" --strategy case-folder --slot final-case \
  --final --timeout-ms 1800000
