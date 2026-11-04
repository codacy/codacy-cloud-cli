---
"@codacy/codacy-cloud-cli": minor
---

Require a Node.js runtime patched for CVE-2026-111497 (Brotli decoder out-of-bounds write): `^22.23.4 || ^24.22.1 || >=26.12.1`. Node.js 20 is end-of-life, never got the fix, and is no longer supported. The CLI decompresses Brotli-encoded HTTP responses through Node's bundled decoder, so upgrade Node.js if you are on an older release.
