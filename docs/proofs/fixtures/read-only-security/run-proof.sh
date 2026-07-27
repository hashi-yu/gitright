#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
proof_root=$(/usr/bin/mktemp -d "${TMPDIR:-/private/tmp}/gitright-read-only-security.XXXXXX")

cleanup() {
  /bin/rm -rf "$proof_root"
}
trap cleanup EXIT HUP INT TERM

GITRIGHT_NETWORK_POLICY=deny /usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/bin/env node \
  "$repository_root/docs/proofs/fixtures/read-only-security/proof-cli.mjs" \
  --fixture-root "$proof_root"
