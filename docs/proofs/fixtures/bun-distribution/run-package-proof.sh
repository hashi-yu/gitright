#!/bin/sh
set -eu

FIXTURE_DIR=$(CDPATH= cd -- "${0%/*}" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$FIXTURE_DIR/../../../.." && pwd)
BUN_BIN=${BUN_BIN:-$(command -v bun)}
PROOF_ROOT=${PROOF_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/gitright-bun-distribution.XXXXXX")}
PACKAGE_SOURCE=${PACKAGE_SOURCE:-$REPOSITORY_ROOT/plugins/gitright}
PACKAGE_DIR=${PACKAGE_DIR:-$PROOF_ROOT/package}
SOURCE_CHECKOUT=${SOURCE_CHECKOUT:-$REPOSITORY_ROOT}
REQUIRE_NO_SOURCE_CHECKOUT=${REQUIRE_NO_SOURCE_CHECKOUT:-0}
RUNTIME_BIN="$PROOF_ROOT/runtime/bin"
CLEAN_HOME="$PROOF_ROOT/home"
CLEAN_TMP="$PROOF_ROOT/tmp"
REPOSITORY_DIR="$PROOF_ROOT/repository"
if [ -f "$FIXTURE_DIR/repository-digest.mjs" ]; then
  DIGEST_HELPER="$FIXTURE_DIR/repository-digest.mjs"
else
  DIGEST_HELPER="$FIXTURE_DIR/../repository-digest.mjs"
fi

tree_bytes() {
  /usr/bin/find "$1" -type f -exec /usr/bin/stat -f %z {} \; |
    /usr/bin/awk '{ total += $1 } END { print total + 0 }'
}

tree_sha256() {
  tree=$1
  (
    cd "$tree"
    /usr/bin/find . -type f -print | LC_ALL=C /usr/bin/sort | while IFS= read -r file; do
      /usr/bin/shasum -a 256 "$file"
    done
  ) | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

if [ ! -d "$PACKAGE_DIR" ]; then
  mkdir -p "$PACKAGE_DIR"
  /bin/cp -R \
    "$PACKAGE_SOURCE/.codex-plugin" \
    "$PACKAGE_SOURCE/.mcp.json" \
    "$PACKAGE_SOURCE/dist" \
    "$PACKAGE_SOURCE/skills" \
    "$PACKAGE_DIR/"
fi

if [ -d "$PACKAGE_DIR/server" ] || [ -d "$PACKAGE_DIR/widget" ] ||
  [ -d "$PACKAGE_DIR/node_modules" ]
then
  echo "staged plugin package contains source or node_modules" >&2
  exit 1
fi

if [ -d "$SOURCE_CHECKOUT" ] &&
  [ -n "$(/usr/bin/find "$SOURCE_CHECKOUT" -mindepth 1 -maxdepth 1 -print -quit)" ]
then
  source_checkout_present=true
else
  source_checkout_present=false
fi

if [ "$REQUIRE_NO_SOURCE_CHECKOUT" = 1 ] && [ "$source_checkout_present" = true ]; then
  echo "source checkout is still present during the runtime proof" >&2
  exit 1
fi

mkdir -p "$RUNTIME_BIN" "$CLEAN_HOME" "$CLEAN_TMP"
/bin/ln -s "$BUN_BIN" "$RUNTIME_BIN/bun"

/usr/bin/git init -q "$REPOSITORY_DIR"
/usr/bin/git -C "$REPOSITORY_DIR" \
  -c user.name="GitRight Distribution Proof" \
  -c user.email="gitright-proof@example.invalid" \
  commit --allow-empty -q -m "Offline history fixture"
repository_digest_before=$($BUN_BIN "$DIGEST_HELPER" "$REPOSITORY_DIR")

cat >"$PROOF_ROOT/network-deny.sb" <<'SB'
(version 1)
(allow default)
(deny network*)
SB

{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"gitright-distribution-proof","version":"0.0.0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"open_gitright\",\"arguments\":{},\"_meta\":{\"x-codex-turn-metadata\":{\"workspaces\":{\"$REPOSITORY_DIR\":{}}}}}}"
  printf '%s\n' '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_history","arguments":{}}}'
} >"$PROOF_ROOT/initialize.ndjson"

cat >"$PROOF_ROOT/invalid-input.txt" <<'TEXT'
NOT_JSON_SECRET_SENTINEL_REPOSITORY_CONTENT
TEXT

run_offline() {
  input=$1
  output=$2
  error=$3
  shift 3
  (
    cd "$PACKAGE_DIR"
    /usr/bin/sandbox-exec -f "$PROOF_ROOT/network-deny.sb" \
      /usr/bin/env -i \
        HOME="$CLEAN_HOME" \
        TMPDIR="$CLEAN_TMP" \
        PATH="$RUNTIME_BIN" \
        ./dist/launch "$@" \
        <"$input" >"$output" 2>"$error"
  )
}

if ! /usr/bin/sandbox-exec -f "$PROOF_ROOT/network-deny.sb" \
  /usr/bin/env -i \
    HOME="$CLEAN_HOME" \
    TMPDIR="$CLEAN_TMP" \
    PATH="$RUNTIME_BIN" \
    /usr/bin/git --version \
    >"$PROOF_ROOT/git-preflight.out" 2>"$PROOF_ROOT/git-preflight.err"
then
  /bin/cat "$PROOF_ROOT/git-preflight.err" >&2
  exit 71
fi

if ! /usr/bin/time -p -o "$PROOF_ROOT/startup.time" \
  /usr/bin/sandbox-exec -f "$PROOF_ROOT/network-deny.sb" \
    /usr/bin/env -i \
      HOME="$CLEAN_HOME" \
      TMPDIR="$CLEAN_TMP" \
      PATH="$RUNTIME_BIN" \
      "$PACKAGE_DIR/dist/launch" --diagnostics \
      >"$PROOF_ROOT/diagnostics.out" 2>"$PROOF_ROOT/diagnostics.err"
then
  /bin/cat "$PROOF_ROOT/diagnostics.out" >&2
  /bin/cat "$PROOF_ROOT/diagnostics.err" >&2
  exit 71
fi

run_offline \
  "$PROOF_ROOT/initialize.ndjson" \
  "$PROOF_ROOT/initialize.out" \
  "$PROOF_ROOT/initialize.err"

run_offline \
  "$PROOF_ROOT/invalid-input.txt" \
  "$PROOF_ROOT/invalid-input.out" \
  "$PROOF_ROOT/invalid-input.err"

if ! /usr/bin/grep -q '"name":"gitright"' "$PROOF_ROOT/initialize.out"; then
  echo "MCP initialize response was not produced" >&2
  exit 1
fi

if ! /usr/bin/grep -q '"name":"open_gitright"' "$PROOF_ROOT/initialize.out" ||
  ! /usr/bin/grep -q "Opened GitRight's read-only repository view" "$PROOF_ROOT/initialize.out" ||
  ! /usr/bin/grep -q '"message":"Repository ready"' "$PROOF_ROOT/initialize.out"
then
  echo "representative read-only operation was not produced" >&2
  exit 1
fi

if ! /usr/bin/grep -q '"loadedCount":1' "$PROOF_ROOT/initialize.out" ||
  ! /usr/bin/grep -q 'Offline history fixture' "$PROOF_ROOT/initialize.out"
then
  echo "offline history operation was not produced" >&2
  exit 1
fi

if ! /usr/bin/grep -q '"status":"ok"' "$PROOF_ROOT/diagnostics.out"; then
  echo "diagnostics did not pass" >&2
  exit 1
fi

if /usr/bin/grep -q 'SECRET_SENTINEL' \
  "$PROOF_ROOT/invalid-input.out" "$PROOF_ROOT/invalid-input.err"; then
  echo "invalid request content leaked to output" >&2
  exit 1
fi

package_bytes=$(tree_bytes "$PACKAGE_DIR")
payload_bytes=$(tree_bytes "$PACKAGE_DIR/dist")
package_sha256=$(tree_sha256 "$PACKAGE_DIR")
payload_sha256=$(tree_sha256 "$PACKAGE_DIR/dist")
repository_digest_after=$($BUN_BIN "$DIGEST_HELPER" "$REPOSITORY_DIR")

if [ "$repository_digest_before" != "$repository_digest_after" ]; then
  echo "offline history operation changed the repository" >&2
  exit 1
fi

echo "verdict=PASS"
echo "architecture=$(/usr/bin/uname -m)"
echo "bun_path=$BUN_BIN"
echo "bun_version=$($BUN_BIN --version)"
echo "git_path=/usr/bin/git"
echo "git_version=$(/usr/bin/git --version)"
echo "package_bytes=$package_bytes"
echo "payload_bytes=$payload_bytes"
echo "package_sha256=$package_sha256"
echo "payload_sha256=$payload_sha256"
echo "server_sha256=$(/usr/bin/shasum -a 256 "$PACKAGE_DIR/dist/server.js" | /usr/bin/awk '{print $1}')"
echo "launch_sha256=$(/usr/bin/shasum -a 256 "$PACKAGE_DIR/dist/launch" | /usr/bin/awk '{print $1}')"
echo "package_source_tree_present=false"
echo "source_checkout_present=$source_checkout_present"
echo "node_modules_present=false"
echo "local_build_performed=false"
echo "network_access=denied"
echo "git_preflight=PASS"
echo "mcp_initialize=PASS"
echo "representative_operation=PASS"
echo "history_operation=PASS"
echo "repository_unchanged=true"
echo "repository_digest_before=$repository_digest_before"
echo "repository_digest_after=$repository_digest_after"
echo "diagnostics=PASS"
echo "startup_time:"
/bin/cat "$PROOF_ROOT/startup.time"
echo "diagnostics_output=$(tr -d '\n' <"$PROOF_ROOT/diagnostics.out")"
echo "invalid_input_content_leaked=false"
echo "proof_root=$PROOF_ROOT"
