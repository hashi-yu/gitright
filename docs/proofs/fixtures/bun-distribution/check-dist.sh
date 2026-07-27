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
LAUNCHER_SOURCE="$REPOSITORY_ROOT/plugins/gitright/launcher/launch"
REFERENCE_DIST="$REPOSITORY_ROOT/plugins/gitright/dist"
NODE_BIN=${NODE_BIN:-$(command -v node)}

if [ "$ACTUAL_BUN_VERSION" != "$EXPECTED_BUN_VERSION" ]; then
  echo "deterministic dist requires Bun $EXPECTED_BUN_VERSION; found $ACTUAL_BUN_VERSION" >&2
  exit 78
fi

if [ ! -f "$REPOSITORY_ROOT/node_modules/esbuild/package.json" ]; then
  echo "deterministic dist requires npm ci before the proof" >&2
  exit 69
fi

for file in launch server.js widget.js widget.css; do
  if [ ! -f "$REFERENCE_DIST/$file" ]; then
    echo "dist reference is missing $file; run npm run build:dist on main or use a release ref with committed dist" >&2
    exit 69
  fi
done

if /usr/bin/git -C "$REPOSITORY_ROOT" \
  ls-files --error-unmatch -- plugins/gitright/dist/server.js >/dev/null 2>&1
then
  REFERENCE_KIND=committed-release-payload
else
  REFERENCE_KIND=local-build-output
fi

mkdir -p "$PROOF_ROOT/first" "$PROOF_ROOT/second"

for directory in "$PROOF_ROOT/first" "$PROOF_ROOT/second"; do
  /bin/cp "$LAUNCHER_SOURCE" "$directory/launch"
  /bin/chmod 755 "$directory/launch"
  "$NODE_BIN" "$WIDGET_BUILD" "$directory/widget.js"
  "$BUN_BIN" build "$SERVER_SOURCE" \
    --target=bun \
    --outfile="$directory/server.js" \
    --minify \
    --silent
done

for file in launch server.js widget.js widget.css; do
  /usr/bin/cmp "$PROOF_ROOT/first/$file" "$PROOF_ROOT/second/$file"
  /usr/bin/cmp "$PROOF_ROOT/first/$file" "$REFERENCE_DIST/$file"
done

if [ "$(/usr/bin/stat -f %Lp "$REFERENCE_DIST/launch")" != 755 ]; then
  echo "dist launcher must have mode 755" >&2
  exit 1
fi

echo "bun_version=$ACTUAL_BUN_VERSION"
echo "reference_kind=$REFERENCE_KIND"
echo "launcher_mode=$(/usr/bin/stat -f %Lp "$REFERENCE_DIST/launch")"
echo "launcher_sha256=$(/usr/bin/shasum -a 256 "$REFERENCE_DIST/launch" | /usr/bin/awk '{print $1}')"
echo "server_bytes=$(/usr/bin/stat -f %z "$REFERENCE_DIST/server.js")"
echo "server_sha256=$(/usr/bin/shasum -a 256 "$REFERENCE_DIST/server.js" | /usr/bin/awk '{print $1}')"
echo "widget_bytes=$(/usr/bin/stat -f %z "$REFERENCE_DIST/widget.js")"
echo "widget_sha256=$(/usr/bin/shasum -a 256 "$REFERENCE_DIST/widget.js" | /usr/bin/awk '{print $1}')"
echo "widget_css_bytes=$(/usr/bin/stat -f %z "$REFERENCE_DIST/widget.css")"
echo "widget_css_sha256=$(/usr/bin/shasum -a 256 "$REFERENCE_DIST/widget.css" | /usr/bin/awk '{print $1}')"
echo "byte_identical=true"
echo "reference_dist_matches=true"
echo "proof_root=$PROOF_ROOT"
