#!/usr/bin/env bash
# Install the Node.js version pinned in .node-version into .tools/node (project-local, git-ignored).
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/.node-version")"
DEST="$ROOT/.tools/node"

case "$(uname -m)" in
	x86_64) ARCH=x64 ;;
	aarch64|arm64) ARCH=arm64 ;;
	*) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [[ -x "$DEST/bin/node" && "$("$DEST/bin/node" --version)" == "v$VERSION" ]]; then
	echo "Node v$VERSION is already installed in $DEST"
	exit 0
fi

NAME="node-v$VERSION-linux-$ARCH"
BASE="https://nodejs.org/dist/v$VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$NAME.tar.xz" "$BASE/$NAME.tar.xz"
curl -fsSL -o "$TMP/SHASUMS256.txt" "$BASE/SHASUMS256.txt"
(cd "$TMP" && grep " $NAME.tar.xz\$" SHASUMS256.txt | sha256sum -c -)

mkdir -p "$ROOT/.tools"
rm -rf "$DEST"
tar -xJf "$TMP/$NAME.tar.xz" -C "$ROOT/.tools"
mv "$ROOT/.tools/$NAME" "$DEST"
echo "Installed Node $("$DEST/bin/node" --version) in $DEST"
