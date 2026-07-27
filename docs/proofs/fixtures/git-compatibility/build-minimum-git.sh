#!/bin/sh
set -eu

build_root=${1:?usage: build-minimum-git.sh BUILD_ROOT}
source_sha256=55735021109565721af805af382c45cce73c3cfaa59daad22443d1477d334d19
source_archive="$build_root/git-2.30.0.tar.xz"
source_directory="$build_root/git-2.30.0"
install_directory="$build_root/install"

case "$build_root" in
  /*/gitright-minimum-git-*) ;;
  *)
    echo "BUILD_ROOT must be an absolute gitright-minimum-git directory" >&2
    exit 64
    ;;
esac

if [ -e "$build_root" ]; then
  echo "BUILD_ROOT already exists: $build_root" >&2
  exit 73
fi

mkdir -p "$build_root"
curl --fail --location --show-error \
  --output "$source_archive" \
  https://www.kernel.org/pub/software/scm/git/git-2.30.0.tar.xz
printf '%s  %s\n' "$source_sha256" "$source_archive" |
  shasum -a 256 --check
tar -xJf "$source_archive" -C "$build_root"
make -C "$source_directory" -j4 \
  prefix="$install_directory" \
  NO_GETTEXT=YesPlease \
  NO_TCLTK=YesPlease \
  NO_OPENSSL=YesPlease \
  NO_CURL=YesPlease \
  NO_EXPAT=YesPlease \
  NO_PERL=YesPlease \
  NO_PYTHON=YesPlease \
  install

test -x "$install_directory/bin/git"
