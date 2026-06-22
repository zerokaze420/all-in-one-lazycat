<!--
SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Vendored `lzc-file-picker`

- Source package: `@lazycatcloud/lzc-file-pickers`
- Version: `2.1.0`
- Bundled file: `lzc-file-pickers.umd.js`
- Purpose: register `<lzc-file-picker>` for `lazycat-injects/open-save-chooser.js`

## Refresh procedure

1. Install or otherwise obtain the target upstream package version.
2. Replace `lzc-file-pickers.umd.js` with the upstream `dist/lzc-file-pickers.umd.js`.
3. Update the version in this file.
4. Verify the inject order in `lzc-manifest.yml` still loads the vendored script before `open-save-chooser.js`.
