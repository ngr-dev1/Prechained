# Prechained

**The internet's cryptographic memory for the software supply chain.**

[![CBOM Verified](https://cbomcompliance.com/.netlify/functions/badge?receipt_id=NGR-CBOM-8ED22D90DD7D)](https://cbomcompliance.com/verify.html)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-orange.svg)](LICENSE)

**[prechained.com](https://prechained.com)** — Free. Open source. No account. No cost. Ever.

---

## What is Prechained?

When a supply chain attack happens, every organization asks the same question:

> *Can you prove what your software looked like before it happened?*

Prechained answers that question for the public supply chain. Every public package across npm, PyPI, Cargo, NuGet, Maven, RubyGems, Packagist, and GitHub is automatically captured, SHA-384 fingerprinted, and permanently archived — before any attack occurs.

Every manifest is stored in a public GitHub archive. Anyone can download it, hash it, and verify it independently.

---

## How it works

1. The crawler runs daily across 8 ecosystems
2. Each package version is SHA-384 fingerprinted
3. The manifest is stored permanently in [prechained-archive](https://github.com/ngr-dev1/prechained-archive)
4. The fingerprint and manifest path are recorded in the database
5. Each record is queued for OpenTimestamps anchoring; Bitcoin confirmation follows once the timestamp is included in a block

Anyone can verify: download the manifest → hash it → compare to the SHA-384 on [prechained.com](https://prechained.com). If they match, the record is authentic.

---

## Ecosystems

| Ecosystem | Registry |
|-----------|----------|
| npm | npmjs.com |
| PyPI | pypi.org |
| Cargo (Rust) | crates.io |
| NuGet (.NET) | nuget.org |
| Maven (Java) | search.maven.org |
| RubyGems | rubygems.org |
| Packagist (PHP) | packagist.org |
| GitHub Repos | github.com |

---

## License

AGPL-3.0. Free to use for any non-commercial purpose. If you use this code to run a network service, you must open source your version under AGPL.

Need a commercial license? Contact [NextGenRails™](https://nextgenrails.net).

---

## Compliance

Prechained's own software bill of materials has been verified by [cbomcompliance.com](https://cbomcompliance.com).

**Receipt:** `NGR-CBOM-8ED22D90DD7D` · Status: CLEAN · 0 issues · OpenTimestamps anchored

See [SECURITY.md](SECURITY.md) for the full compliance receipt.

---

## Need compliance receipts for your own software?

Prechained covers the public supply chain — free, automatic, forever.

**[cbomcompliance.com](https://cbomcompliance.com)** covers your private packages, internal dependencies, and proprietary software with formally signed cryptographic receipts suitable for submission to C3PAOs and auditors under frameworks such as CMMC, EU CRA, and ISO 27001. Zero retention.

---

Built by [NextGenRails™](https://nextgenrails.net) · *Trust is not declared. It is computed.*
