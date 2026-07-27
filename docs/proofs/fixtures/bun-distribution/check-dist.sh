#!/bin/sh
set -eu

FIXTURE_DIR=$(CDPATH= cd -- "${0%/*}" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$FIXTURE_DIR/../../../.." && pwd)
BUN_BIN=${BUN_BIN:-$(command -v bun)}
EXPECTED_BUN_VERSION=1.3.14
ACTUAL_BUN_VERSION=$("$BUN_BIN" --version)
PROOF_ROOT=${PROOF_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/gitright-dist-determinism.XXXXXX")}
SERVER_SOURCE="$REPOSITORY_ROOT/plugins/gitright/server/index.ts"
WIDGET_BUILD="$REPOSITORY_ROOT/plugins/gitright/widget/build.mjs"
COMMITTED="$REPOSITORY_ROOT/plugins/gitright/dist"
NODE_BIN=${NODE_BIN:-$(command -v node)}

if [ "$ACTUAL_BUN_VERSION" != "$EXPECTED_BUN_VERSION" ]; then
  echo "deterministic dist requires Bun $EXPECTED_BUN_VERSION; found $ACTUAL_BUN_VERSION" >&2
  exit 78
fi

if [ ! -f "$REPOSITORY_ROOT/node_modules/esbuild/package.json" ]; then
  echo "deterministic dist requires npm ci before the proof" >&2
  exit 69
fi

mkdir -p "$PROOF_ROOT/first" "$PROOF_ROOT/second"

for directory in "$PROOF_ROOT/first" "$PROOF_ROOT/second"; do
  "$NODE_BIN" "$WIDGET_BUILD" "$directory/widget.js"
  "$BUN_BIN" build "$SERVER_SOURCE" \
    --target=bun \
    --outfile="$directory/server.js" \
    --minify \
    --silent
done

for file in server.js widget.js widget.css; do
  /usr/bin/cmp "$PROOF_ROOT/first/$file" "$PROOF_ROOT/second/$file"
  /usr/bin/cmp "$PROOF_ROOT/first/$file" "$COMMITTED/$file"
done

echo "bun_version=$ACTUAL_BUN_VERSION"
echo "server_bytes=$(/usr/bin/stat -f %z "$COMMITTED/server.js")"
echo "server_sha256=$(/usr/bin/shasum -a 256 "$COMMITTED/server.js" | /usr/bin/awk '{print $1}')"
echo "widget_bytes=$(/usr/bin/stat -f %z "$COMMITTED/widget.js")"
echo "widget_sha256=$(/usr/bin/shasum -a 256 "$COMMITTED/widget.js" | /usr/bin/awk '{print $1}')"
echo "widget_css_bytes=$(/usr/bin/stat -f %z "$COMMITTED/widget.css")"
echo "widget_css_sha256=$(/usr/bin/shasum -a 256 "$COMMITTED/widget.css" | /usr/bin/awk '{print $1}')"
echo "byte_identical=true"
echo "committed_dist_matches=true"
echo "proof_root=$PROOF_ROOT"
