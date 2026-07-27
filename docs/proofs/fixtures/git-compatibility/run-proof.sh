#!/bin/sh
set -eu

git_bin=${1:-/usr/bin/git}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
proof_root=$(/usr/bin/mktemp -d "${TMPDIR:-/private/tmp}/gitright-git-compatibility.XXXXXX")

cleanup() {
  /bin/rm -rf "$proof_root"
}
trap cleanup EXIT HUP INT TERM

GITRIGHT_NETWORK_POLICY=deny /usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*)' \
  /usr/bin/env node \
  "$repository_root/docs/proofs/fixtures/git-compatibility/proof-cli.mjs" \
  --git "$git_bin" \
  --fixture-root "$proof_root"
