# Third Party Notices

## @breezystack/lamejs

- File: `lamejs.iife.js`
- Version: `1.2.7`
- Source: `https://unpkg.com/@breezystack/lamejs@1.2.7/dist/lamejs.iife.js`
- Purpose: MP3 encoding in the browser
- License: GNU Lesser General Public License v3.0

The library is distributed as a separate, unmodified component. The existing notice file `LICENSE-lamejs.iife.js.txt` is retained.

Note: `lamejs.iife.js` is a compressed third-party JavaScript bundle. Keep the source, version, source URL, and license notice in review records before each release.

- Audited SHA-256: `0be202ec162aa3042d5c5c4e6288ad326cff8cec7312c2894a0a91ad2f9aeda1`
- Verified byte-for-byte against the published 1.2.7 file. Several earlier releases have identical bundle bytes; the documented acquisition version remains 1.2.7.

## lamejs (legacy)

- File: `lame.min.js`, referenced by the retained `AudioRecorder 1.21` page only.
- Version: `1.2.1`, verified byte-for-byte against `https://unpkg.com/lamejs@1.2.1/lame.min.js`.
- Upstream: `https://github.com/zhuker/lamejs`
- License: LGPL-3.0; the existing `LICENSE-lamejs.iife.js.txt` notice is retained.
- Audited SHA-256: `15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4`

## Development dependencies

`backend/package.json` and `backend/package-lock.json` pin Wrangler and the fake-indexeddb test helper, including transitive versions and package integrity hashes. These dependencies are not shipped as browser runtime code. The optional Google Identity Services script is loaded from Google's official endpoint only in the web version; it is a separately maintained remote service, not a vendored npm package.

