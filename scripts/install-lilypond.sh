#!/usr/bin/env bash
# Downloads an official LilyPond binary release and unpacks it, so tests can run against a known version.
#
# Usage: scripts/install-lilypond.sh <version> [destination]
#
# Prints the path of the installation root (the directory holding bin/ and share/) on stdout; everything else goes to stderr, so callers can capture the path directly.
#
# The destination defaults to $LILYPOND_TEST_INSTALL_DIR, or ~/lilypond-installs if that is unset. Installing several versions into one destination is the intended way to test against all of them at once: the test helpers search that directory.
#
# Re-running for a version that is already unpacked does nothing, so it is cheap to call from a cached CI step or a local shell.

set -euo pipefail

version=${1:-}
if [ -z "$version" ]; then
	echo "usage: $0 <version> [destination]" >&2
	exit 2
fi

destination=${2:-${LILYPOND_TEST_INSTALL_DIR:-$HOME/lilypond-installs}}
target="$destination/lilypond-$version"

if [ -d "$target/share/lilypond/$version" ]; then
	echo "LilyPond $version is already installed at $target" >&2
	echo "$target"
	exit 0
fi

# The 2.24 series onwards publishes binaries as generic packages attached to the GitLab release. Older series were distributed as self-extracting installers from lilypond.org and will need a separate branch here.
case "$(uname -s)" in
	Linux) asset="lilypond-$version-linux-x86_64.tar.gz" ;;
	Darwin) asset="lilypond-$version-darwin-x86_64.tar.gz" ;;
	MINGW* | MSYS* | CYGWIN*) asset="lilypond-$version-mingw-x86_64.zip" ;;
	*)
		echo "no LilyPond binary release is published for $(uname -s)" >&2
		exit 1
		;;
esac

url="https://gitlab.com/api/v4/projects/lilypond%2Flilypond/packages/generic/lilypond/$version/$asset"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

echo "Downloading $url" >&2
curl --fail --location --show-error --silent --output "$scratch/$asset" "$url"

echo "Unpacking $asset" >&2
mkdir "$scratch/unpacked"
case "$asset" in
	*.zip) unzip -q "$scratch/$asset" -d "$scratch/unpacked" ;;
	*) tar -xzf "$scratch/$asset" -C "$scratch/unpacked" ;;
esac

# The archives wrap everything in a directory whose name has varied between releases, so find the installation root by the layout we actually depend on rather than by name.
share=$(find "$scratch/unpacked" -maxdepth 3 -type d -path '*/share/lilypond' -print -quit)
if [ -z "$share" ]; then
	echo "$asset does not contain a share/lilypond directory" >&2
	exit 1
fi
root=$(dirname "$(dirname "$share")")

mkdir -p "$destination"
rm -rf "$target"
mv "$root" "$target"

echo "Installed LilyPond $version at $target" >&2
echo "$target"
