#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/lzc-manifest-legacy.yml"
content_dir="$repo_root/content"
icon="$repo_root/icon.png"
output="${1:-$repo_root/NextCloud-v0.0.7.lpk}"
tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

tar -C "$content_dir" -cf "$tmpdir/content.tar" .
cp "$icon" "$tmpdir/icon.png"
cp "$manifest" "$tmpdir/manifest.yml"

rm -f "$output"
(
  cd "$tmpdir"
  zip -q -X "$output" content.tar icon.png manifest.yml
)

echo "输出lpk包 $output"
