#!/usr/bin/env bash
# pre-publish-scan.sh - leak check for the open-source Orange the World repo.
#
# Runs a categorized grep over the source tree looking for content that
# should never ship to a public repo: internal codenames, personal names,
# infrastructure hostnames, internal wiki URLs, milestone tags from prior
# internal audits, dead PR refs, personally identifiable email addresses.
#
# Exit code:
#   0  - tree is clean, safe to publish or merge
#   1  - one or more categories reported a leak; review output, clean up,
#        re-run
#
# Run locally before pushing:   bash scripts/pre-publish-scan.sh
# Runs in CI as a required check (see .github/workflows/leak-check.yml).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ----------------------------------------------------------------------
# Path scope
# ----------------------------------------------------------------------

EXCLUDE_DIRS=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=.git
  --exclude-dir=test-results
  --exclude-dir=playwright-report
  --exclude-dir=.husky
  --exclude-dir=target
)

EXCLUDE_FILES=(
  --exclude=bun.lock
  --exclude=bun.lockb
  --exclude=package-lock.json
  --exclude=yarn.lock
  --exclude=Cargo.lock
  --exclude="*.png"
  --exclude="*.jpg"
  --exclude="*.jpeg"
  --exclude="*.webp"
  --exclude="*.gif"
  --exclude="*.ico"
  --exclude="*.svg"
  --exclude="*.woff"
  --exclude="*.woff2"
  --exclude="*.ttf"
  --exclude="*.eot"
)

# ----------------------------------------------------------------------
# Load-bearing exemptions
# ----------------------------------------------------------------------

EXEMPT_GENERIC=(
  "scripts/pre-publish-scan.sh"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/workflows/leak-check.yml"
  "CONTRIBUTING.md"
  "CODE_OF_CONDUCT.md"
  "SECURITY.md"
  "README.md"
  "LICENSE-DATA.md"
)

# Edge-function URL slugs are load-bearing. Consumers (and the portal)
# call them by exact name.
EXEMPT_OW_FUNCTION_URLS=(
  "supabase/functions/world-gateway"
  "supabase/functions/client-signup"
  "supabase/functions/client-verify-email"
  "sites/world/src/pages/Signup.tsx"
  "sites/world/src/pages/VerifyEmail.tsx"
)

# Database column + table names referenced across migrations + the gateway.
EXEMPT_OW_SCHEMA=(
  "supabase/migrations/"
  "supabase/functions/world-gateway"
)

EXIT_CODE=0

# ----------------------------------------------------------------------
# scan: run one categorized grep + exemption filter
# ----------------------------------------------------------------------

scan() {
  local name="$1"
  local pattern="$2"
  local flags="$3"
  local extra_exempt="$4"

  local raw
  if [[ -n "$flags" ]]; then
    raw=$(grep -rnE $flags "$pattern" . \
            "${EXCLUDE_DIRS[@]}" "${EXCLUDE_FILES[@]}" 2>/dev/null || true)
  else
    raw=$(grep -rnE "$pattern" . \
            "${EXCLUDE_DIRS[@]}" "${EXCLUDE_FILES[@]}" 2>/dev/null || true)
  fi

  if [[ -z "$raw" ]]; then
    printf "  \033[32mOK\033[0m  %s\n" "$name"
    return 0
  fi

  local drop_patterns=""
  for e in "${EXEMPT_GENERIC[@]}"; do
    drop_patterns+="${drop_patterns:+|}$(printf '%s' "$e" | sed 's/[.[\]*]/\\&/g')"
  done
  if [[ -n "$extra_exempt" ]]; then
    drop_patterns+="${drop_patterns:+|}$extra_exempt"
  fi

  local filtered
  if [[ -n "$drop_patterns" ]]; then
    filtered=$(printf '%s\n' "$raw" | grep -Ev "$drop_patterns" || true)
  else
    filtered="$raw"
  fi

  if [[ -z "$filtered" ]]; then
    printf "  \033[32mOK\033[0m  %s\n" "$name"
    return 0
  fi

  local count
  count=$(printf '%s\n' "$filtered" | wc -l)
  printf "  \033[31mFAIL\033[0m  %s (%d findings)\n" "$name" "$count"
  printf '%s\n' "$filtered" | sed 's/^/      /' | head -20
  if [[ "$count" -gt 20 ]]; then
    printf "      ... %d more\n" "$((count - 20))"
  fi
  EXIT_CODE=1
}

join_pipe() {
  local IFS="|"
  printf '%s' "$*"
}

EXEMPT_FN_RE="$(join_pipe "${EXEMPT_OW_FUNCTION_URLS[@]}")"
EXEMPT_SCHEMA_RE="$(join_pipe "${EXEMPT_OW_SCHEMA[@]}")"

# ----------------------------------------------------------------------
# Header
# ----------------------------------------------------------------------

printf "\nPre-publish leak scan: Orange the World\n"
printf "  repo: %s\n\n" "$REPO_ROOT"

# ----------------------------------------------------------------------
# Category 1: Sister-product brand references
# ----------------------------------------------------------------------

printf "1. Sister-product brand references\n"

scan "BitBooks internal product variants" \
     "V[23] BitBooks|BitBooks V[23]|BitBooks Vault|BitBooks family|BitBooks Personal|BitBooksSupport|Bid ?Balances|Bidvestment" \
     "" \
     ""

scan "Cala ledger (internal V3 evaluation)" \
     "\\bCala\\b" \
     "" \
     ""

scan "Lovable builder platform" \
     "\\bLovable\\b|lovable\\.app|\\.lovable" \
     "" \
     ""

scan "V3 Vault / standalone V[23] product noun" \
     "\\bV3 Vault\\b|\\bV[23] (Test|Issues?|Bug|customer|prod)" \
     "" \
     ""

scan "Hardcoded BitBooks subdomains" \
     "\\b(v[0-9]+dev|v[0-9]+|app|v3dev|vault|admin|support|dashboard)\\.bitbooks\\.com\\b" \
     "" \
     ""

scan "Other personal-project brands" \
     "\\b(TESSA|COLE|ADUB|ADDLY)\\b|Petit Chou|petitchou|Heirloom Book" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 2: Personal names + PII
# ----------------------------------------------------------------------

printf "\n2. Personal names + PII\n"

scan "Personal first names" \
     "\\b(Miguel|Daenon|Roark|Brandon|Ashar|tsaekoo|Abuelo)\\b" \
     "" \
     ""

scan "External contact names" \
     "Charles Taylor|Ruben Izmailyan" \
     "" \
     ""

scan "Personal-domain emails" \
     "@(bitbooks\\.com|abascal\\.ca|tryfaster\\.ca)" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 3: Internal infrastructure leaks
# ----------------------------------------------------------------------

printf "\n3. Internal infrastructure\n"

scan "Internal hostnames" \
     "\\b(jarvis-hosted|bb-support|Jarvis-hosted)\\b|kiwi@jarvis|ubuntu@100\\." \
     "" \
     ""

scan "Internal wiki URLs" \
     "wiki\\.(abascal\\.ca|bitbooks\\.com)" \
     "" \
     ""

scan "Tailscale internal IPs" \
     "\\b100\\.(91|94)\\.[0-9]+\\.[0-9]+\\b" \
     "" \
     ""

scan "Internal bb-support paths" \
     "/opt/bb-support|/mnt/vault/\\.tessa" \
     "" \
     ""

scan "Admin-only orangerails subdomains" \
     "\\b(blocks|stealth)\\.orangerails\\.com\\b" \
     "" \
     ""

scan "Windows-style internal paths" \
     "C:\\\\CLAUDE|C:\\\\Users\\\\micro" \
     "" \
     ""

scan "Home-path leaks" \
     "/home/(kiwi|cactus|claude|ubuntu)/" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 4: Internal milestone tags + dead PR references
# ----------------------------------------------------------------------

printf "\n4. Internal milestone tags + dead PR refs\n"

scan "D-number milestone tags" \
     "\\bD[0-9]{1,3}[:)] |\\(D[0-9]{1,3}\\)|\\bD[0-9]{1,3} -" \
     "" \
     ""

scan "SEC-N audit tags" \
     "\\bSEC-[0-9]+\\b|#SEC-[0-9]+" \
     "" \
     ""

scan "CQ-N code-quality tags" \
     "\\bCQ-[0-9]+\\b|#CQ-[0-9]+" \
     "" \
     ""

scan "DB-N database-audit tags" \
     "\\bDB-[0-9]+\\b|#DB-[0-9]+" \
     "" \
     ""

scan "PERF-N performance-audit tags" \
     "\\bPERF-[0-9]+\\b|#PERF-[0-9]+" \
     "" \
     ""

scan "Dead PR references" \
     "PR #[0-9]+|V[23] PR\\b|OR PR #" \
     "" \
     ""

# ----------------------------------------------------------------------
# Category 5: Operational dates in code comments
# ----------------------------------------------------------------------

printf "\n5. Operational dates in code comments\n"

scan "Audit/observation/verification dates in comments" \
     "(as of |observed |verified |Audit |audited )202[0-9]-[0-1][0-9]-[0-3][0-9]" \
     "" \
     "$EXEMPT_FN_RE|$EXEMPT_SCHEMA_RE"

# ----------------------------------------------------------------------
# Category 6: OWM and other adjacent product names not relevant to OW
# ----------------------------------------------------------------------

printf "\n6. Adjacent product nouns that should not appear in OW\n"

scan "OWM references" \
     "\\bOWM\\b|orangeway\\.app|OrangeWayMe" \
     "" \
     ""

scan "MorningRevolution attribution outside historical context" \
     "MorningRevolution" \
     "" \
     "CHANGELOG\\.md|README\\.md"

# ----------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------

printf "\n"
if [[ "$EXIT_CODE" -eq 0 ]]; then
  printf "Tree is clean. Safe to publish or merge.\n\n"
else
  printf "Leaks found. Clean up the items above before publishing.\n"
  printf "See CONTRIBUTING.md for the rules and exemption process.\n\n"
fi

exit "$EXIT_CODE"
