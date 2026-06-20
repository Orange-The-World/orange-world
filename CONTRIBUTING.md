# Contributing to Orange the World

Orange the World is the free, CC-BY 4.0 truth-data portal: inflation, wages, money supply, precious metals, historical money prices going back to 1209, commodity prices, tech productivity curves, and bitcoin network metrics. The mission is to give everyone unfiltered access to the long arc of monetary history so they can see for themselves where purchasing power has gone.

We welcome contributions that make the data more complete, more honest, and more useful.

---

## Before you start

Read these first:

- **[README.md](./README.md)** for what the project is, what ships in this repo, and how the pieces fit together.
- **[LICENSE](./LICENSE)** (Apache 2.0) and **[LICENSE-DATA.md](./LICENSE-DATA.md)** (CC-BY 4.0). Code and data are licensed separately on purpose.
- **[SECURITY.md](./SECURITY.md)** for how to report vulnerabilities privately.

---

## What we welcome

### High-signal contributions

- **New data sources.** Central bank publications, statistical agency time series, public market feeds, primary historical records. Each new source needs the Terms of Service captured and the methodology documented before it lands.
- **Data corrections.** If you can show a row is wrong with a primary-source citation, open an issue. We will fix it and credit you.
- **Methodology audits.** Read the resolution logic and check our math. Public scrutiny is the whole point.
- **Chart and visualization work.** The portal at `orangethe.world` is how most people will encounter this data. Better charts, better tooltips, better mobile rendering all count.
- **Documentation improvements** including translations.
- **Self-hosting instructions** for the Supabase project + edge functions stack on platforms we have not tested.

### Welcome but coordinate first

Open an issue describing the work before submitting a PR for:

- New top-level dataset tables (precious metals, inflation, wages, etc. each follow a `_rates` + `_resolutions` shape; new datasets should match it).
- Schema changes to `client_platform` (the API-key issuance surface).
- Changes to the `world-gateway` edge function's auth or quota logic.
- Changes to the public `/v1/truth/*` API contract.

### Not welcome

- Code paths that silently filter, revise, or omit truth-data based on opinion. Every row has a primary-source citation. If a source is wrong we mark the row, we don't erase it.
- Telemetry or analytics on portal visitors beyond what is strictly necessary for rate-limiting.
- Dependencies from organizations with a track record of supply-chain compromise, or dependencies that cannot be verified by hash.
- Proprietary or source-available licenses. The code is and remains Apache 2.0; the data is and remains CC-BY 4.0.

---

## Development setup

### Prerequisites

- Bun (latest)
- Node 24 for builds (Vite uses `crypto.hash`)
- A Supabase project for local edge-function deploys, or the Supabase CLI for local dev

### Running the portal locally

```bash
cd sites/world
bun install
bun run dev
# Opens at http://localhost:5180
```

Set the following in `sites/world/.env.local`:

```
VITE_OW_SUPABASE_URL=https://<your-supabase-ref>.supabase.co
VITE_OW_SUPABASE_ANON_KEY=<your-anon-key>
```

### Running the edge functions locally

```bash
supabase functions serve world-gateway
supabase functions serve client-signup
supabase functions serve client-verify-email
```

---

## Good first issues

We tag beginner-friendly tickets with `good first issue`. If you're new and want to start somewhere small, open https://github.com/Orange-The-World/orange-world/labels/good%20first%20issue for the current list. If nothing's tagged yet, file an issue saying "I'd like a good first issue" and a maintainer will route you to one.

## Code style

- **TypeScript** for all new code.
- **2-space indentation.** Prettier-enforced.
- **No `any` types** without a comment explaining why.
- **No comments describing what the code does.** Code explains what; comments explain why. Inline comments are for non-obvious design decisions only.

---

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) loosely:

```
feat(world-gateway): add wages dataset route
fix(portal): correct CPI tooltip label
docs(readme): clarify data licensing
data(precious-metals): backfill 1970-1979 from World Gold Council
chore(deps): upgrade @supabase/supabase-js to 2.45.0
```

Use the present tense.

---

## Pull requests

1. Fork the repo.
2. Create a feature branch: `git checkout -b feat/wages-dataset`.
3. Run `bash scripts/pre-publish-scan.sh` and confirm exit 0 before pushing.
4. Open a PR against `dev`.

`dev` is the integration branch; `prod` is the live deployed branch. Promotions from `dev` to `prod` are done by maintainers after a green CI run plus a manual portal smoke test.

**What makes a PR mergeable:**

- CI is green, including the leak-check workflow.
- Linked issue describing the problem (for anything beyond a typo fix).
- Clear before/after description of behavior change.
- For new data sources: a Terms of Service note, a methodology summary, and at least one continuity check.

---

## Developer Certificate of Origin

All commits must be signed off per the [Developer Certificate of Origin](https://developercertificate.org/):

```
git commit -s -m "feat: add wages dataset"
```

By signing off, you certify the DCO. You have the right to submit the contribution under Apache 2.0 (code) and CC-BY 4.0 (data).

---

## Security issues

Do not open public issues for security vulnerabilities. Follow [SECURITY.md](./SECURITY.md) for private disclosure.

---

## Community expectations

Be kind. Be specific. Show your work.

- Disagreements are fine. Personal attacks are not.
- "This number looks wrong" is not useful on its own. Include the source, the row, the expected vs. actual value, and a primary citation.
- Assume good faith.
- Code review is about the code, not the author.

---

## Related projects

Orange the World is part of the `Orange-The-World` GitHub org. Sibling projects include Orange Rails (the paid platform built on the same architecture) and ORBI (the paid Bitcoin index API).
