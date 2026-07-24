#!/usr/bin/env bash
# Generates one folder per exam worker from templates/, filling in
# wrangler.toml's name + database_name. database_id is always left
# as a placeholder — you paste that in per-account after creating
# each D1 database.
#
# Run locally with: bash scripts/scaffold.sh
# (The GitHub Action calls this same script automatically.)

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# One entry per Worker: folder-name:worker-name:db-name
EXAMS=(
  "cgl-worker:mmh-attempts-cgl:mmh-attempts-cgl"
  "chsl-worker:mmh-attempts-chsl:mmh-attempts-chsl"
  "ssc-sub-worker:mmh-attempts-ssc-sub:mmh-attempts-ssc-sub"
  "ntpc-worker:mmh-attempts-ntpc:mmh-attempts-ntpc"
  "mts-worker:mmh-attempts-mts:mmh-attempts-mts"
  "cpo-worker:mmh-attempts-cpo:mmh-attempts-cpo"
  "imps-worker:mmh-attempts-imps:mmh-attempts-imps"
)

for entry in "${EXAMS[@]}"; do
  IFS=":" read -r folder worker_name db_name <<< "$entry"

  echo "Scaffolding $folder ..."
  mkdir -p "$folder/src"

  cp templates/schema.sql "$folder/schema.sql"
  cp templates/package.json "$folder/package.json"
  cp templates/src/index.js "$folder/src/index.js"

  # If this folder's wrangler.toml already has a real database_id
  # filled in, preserve it instead of resetting to the placeholder
  # on re-run.
  existing_id="REPLACE_WITH_DATABASE_ID"
  if [ -f "$folder/wrangler.toml" ]; then
    found=$(grep -oP '(?<=database_id = ")[^"]*' "$folder/wrangler.toml" || true)
    if [ -n "$found" ]; then
      existing_id="$found"
    fi
  fi

  sed -e "s/__WORKER_NAME__/${worker_name}/g" \
      -e "s/__DB_NAME__/${db_name}/g" \
      -e "s/REPLACE_WITH_DATABASE_ID/${existing_id}/g" \
      templates/wrangler.toml.tmpl > "$folder/wrangler.toml"
done

echo "Done. Created/updated ${#EXAMS[@]} worker folders."
