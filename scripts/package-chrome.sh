#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(CDPATH= cd -- "$script_dir/.." && pwd)"

version="$(node -e 'const manifest = require(process.argv[1]); process.stdout.write(manifest.version)' "$project_dir/manifest.json")"
archive_name="page-media-downloader-${version}-chrome.zip"
archive_path="$project_dir/dist/$archive_name"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/page-media-downloader-package.XXXXXX")"
stage_dir="$work_dir/stage"

cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

files=(
  manifest.json
  LICENSE.md
  background.js
  content.js
  popup.html
  popup.js
  popup.css
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

mkdir -p "$stage_dir/icons" "$project_dir/dist"

for relative_path in "${files[@]}"; do
  source_path="$project_dir/$relative_path"
  target_path="$stage_dir/$relative_path"
  if [[ ! -f "$source_path" ]]; then
    echo "Missing required runtime file: $relative_path" >&2
    exit 1
  fi
  cp -- "$source_path" "$target_path"
  chmod 0644 "$target_path"
  touch -t 202001010000.00 "$target_path"
done

node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$stage_dir/manifest.json"

(
  cd "$stage_dir"
  LC_ALL=C zip -X -q "$work_dir/$archive_name" "${files[@]}"
)

mv -f -- "$work_dir/$archive_name" "$archive_path"

echo "$archive_path"
shasum -a 256 "$archive_path"
