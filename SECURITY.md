# Security policy

Orange the World ships a public truth-data portal plus an API gateway. We do not store secrets on behalf of users. We do issue API keys, hash them at rest, and run a rate-limited public API. This document covers what we consider in-scope and how to report vulnerabilities responsibly.

---

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Open a [GitHub Security Advisory](https://github.com/Orange-The-World/orange-world/security/advisories/new) describing the problem with reproduction steps. We target a 72-hour acknowledgment and a 90-day coordinated disclosure window.

If you cannot use Security Advisories for any reason, reach the maintainers through their GitHub profile contact details.

We will credit reporters in the release notes unless they prefer anonymity. We will not pursue legal action against good-faith researchers who follow this policy.

---

## In scope

- The portal at `orangethe.world` and any official Cloudflare Pages preview.
- The `world-gateway` edge function and any other edge function in `supabase/functions/`.
- The `client_platform` schema in `supabase/migrations/` (API-key issuance, organizations, usage tracking).
- Cross-tenant data leaks. An API key issued to one organization must never read another organization's `api_usage` rows.

## Out of scope

- Truth-data accuracy issues. Those are bugs but not security issues. Open a regular issue with a primary-source citation.
- Rate-limit tuning suggestions. Open a regular issue.
- Findings against third-party services we depend on (Supabase, Cloudflare, Resend). Report those upstream.

---

## How API keys are handled

- Keys are minted server-side as `orw_` plus a random suffix.
- Only the **hash** of the key is stored in `client_platform.api_keys.key_hash`. The plaintext is shown to the user exactly once at signup. We cannot recover it.
- Every API call records a row in `client_platform.api_usage` for quota enforcement. Quotas are per-key and per-day.

If you believe a key has been compromised, rotate it via the portal. The old key stops working as soon as the new one is minted.

---

## What the server can see

The truth-data datasets are public. Treat the portal and the API as you would a public newspaper archive: every reader sees the same rows.

We do log API calls (key id, route, status code, timestamp) for rate-limiting and for our own debugging. We do not log request bodies and we do not sell, share, or otherwise repurpose the access logs.

---

## Supply chain

- Dependencies are pinned via `bun.lock`.
- The leak-check workflow runs `scripts/pre-publish-scan.sh` on every PR to keep internal references out of the public repo.
- CI uses pinned action SHAs where the upstream offers them.

If you discover a malicious dependency in the lockfile, open a Security Advisory.
