#!/usr/bin/env bash
# Starts n8n on this machine with the published PaperClerk node and the
# example workflows in examples/, at http://localhost:5678.
#
#   npm run try
#
# n8n keeps its data in ~/.n8n-paperclerk, apart from any other n8n on the
# machine, and listens on this machine only. It installs the node itself at
# startup, at the newest version on npm, and moves to a newer version on a
# later start. The examples are imported on the first start; the "save every
# new document" example writes PDFs to ~/Downloads/PaperClerk. Stop n8n with
# Ctrl+C and run the same command to start it again.
#
# Settings: N8N_PORT (5678), PAPERCLERK_N8N_FOLDER (~/.n8n-paperclerk),
# PAPERCLERK_PDF_FOLDER (~/Downloads/PaperClerk). Delete
# $PAPERCLERK_N8N_FOLDER/.examples-imported to import the examples again;
# that replaces your edits to them.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
package='@paperclerk/n8n-nodes-paperclerk'
data="${PAPERCLERK_N8N_FOLDER:-$HOME/.n8n-paperclerk}"
pdfs="${PAPERCLERK_PDF_FOLDER:-$HOME/Downloads/PaperClerk}"
port="${N8N_PORT:-5678}"
mkdir -p "$data" "$pdfs"

version="$(npm view "$package" version 2>/dev/null || true)"
if [ -n "$version" ]; then
	packages="[{\"name\":\"$package\",\"version\":\"$version\"}]"
else
	packages="[{\"name\":\"$package\"}]"
fi

export N8N_USER_FOLDER="$data"
export N8N_PORT="$port"
export N8N_LISTEN_ADDRESS="${N8N_LISTEN_ADDRESS:-127.0.0.1}"
export N8N_SECURE_COOKIE="${N8N_SECURE_COOKIE:-false}"
export N8N_DIAGNOSTICS_ENABLED="${N8N_DIAGNOSTICS_ENABLED:-false}"
export N8N_PERSONALIZATION_ENABLED="${N8N_PERSONALIZATION_ENABLED:-false}"
export N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
export N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true
export N8N_COMMUNITY_PACKAGES="$packages"
export N8N_UNVERIFIED_PACKAGES_ENABLED=true
export N8N_RESTRICT_FILE_ACCESS_TO="$HOME/.n8n-files;$pdfs"

n8n() {
	(cd "$data" && npx -y --prefer-online n8n@latest "$@")
}

marker="$data/.examples-imported"
if [ ! -f "$marker" ]; then
	examples="$(mktemp -d)"
	for file in "$repo"/examples/*.json; do
		sed "s#/home/node/.n8n-files/#$pdfs/#" "$file" > "$examples/$(basename "$file")"
	done
	n8n import:workflow --separate --input="$examples"
	rm -rf "$examples"
	touch "$marker"
fi

echo
echo "n8n with the PaperClerk node ${version:-(latest)}: http://localhost:$port"
echo "Data: $data"
echo "PDFs from the save example: $pdfs"
echo "Stop with Ctrl+C."
echo
n8n start
