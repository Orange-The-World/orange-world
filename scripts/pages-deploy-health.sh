#!/usr/bin/env bash
# Branch-aware Cloudflare Pages deploy-health check.
#
# ROOT CAUSE THIS EXISTS TO FIX (OR-T1347, OR-T1349, 2026-09-02):
# The only deploy-health signal anyone watched was "most recent deployment
# per project", with no branch filter and no coverage of this project at
# all. For orangerails-world specifically: the prod branch deployed daily
# on a schedule through 2026-07-19T04:30 UTC, then silently stopped, and
# nothing alerted on the gap because nothing was watching the DECLARED
# branch's own history, only whatever the most recent deployment happened
# to be (which could be an unrelated preview build).
#
# This script never reads "latest deployment for the project". It always
# resolves the DECLARED branch's own latest deployment first, then checks
# that deployment's outcome, then checks whether GitHub has moved past it.
#
# KNOWN LIMITATION, documented rather than hidden: the Cloudflare deployments
# API (same one the fleet's cf_deployments tool wraps) becomes slow to page
# past a few hundred rows. On a project with heavy preview churn the declared
# branch's true latest deployment could in principle scroll past this
# script's page size. If that happens the branch is not found and this
# script fails loud with "no deployment found for branch", which is reported
# as UNKNOWN, never silently treated as healthy.
set -euo pipefail

PROJECT="$1"                # Cloudflare Pages project name, e.g. orangerails-world
BRANCH="$2"                 # the project's DECLARED branch, e.g. prod (its prod_branch field)
WINDOW_MINUTES="${3:-30}"   # alert if a commit on BRANCH is older than this with no matching deploy

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN not set. This is a repo secret that must be added before this check can run; it is not something a builder creates on its own, route to whoever holds Cloudflare admin.}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID not set (same secret gap as CLOUDFLARE_API_TOKEN above).}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN not set.}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set (Actions provides this automatically).}"

FAIL=0

echo "== ${PROJECT} (declared branch: ${BRANCH}) =="

RESPONSE=$(curl -sS --fail-with-body \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}/deployments?per_page=100" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

LATEST=$(echo "$RESPONSE" | jq -c --arg b "$BRANCH" \
  '[.result[] | select(.deployment_trigger.metadata.branch == $b)] | sort_by(.created_on) | last')

if [ "$LATEST" = "null" ] || [ -z "$LATEST" ]; then
  echo "::error::${PROJECT}: no deployment found for branch '${BRANCH}' in the most recent 100. UNKNOWN, not reported as healthy. Widen the page size or confirm the branch name."
  exit 1
fi

STAGE_NAME=$(echo "$LATEST" | jq -r '.latest_stage.name // "unknown"')
STAGE_STATUS=$(echo "$LATEST" | jq -r '.latest_stage.status // "unknown"')
DEPLOY_SHA=$(echo "$LATEST" | jq -r '.deployment_trigger.metadata.commit_hash // "unknown"')
DEPLOY_CREATED=$(echo "$LATEST" | jq -r '.created_on')

echo "latest ${BRANCH} deployment: stage=${STAGE_NAME}:${STAGE_STATUS} commit=${DEPLOY_SHA:0:8} created=${DEPLOY_CREATED}"

if [ "$STAGE_NAME" != "deploy" ] || [ "$STAGE_STATUS" != "success" ]; then
  echo "::error::${PROJECT}: declared branch '${BRANCH}' latest deployment is ${STAGE_NAME}:${STAGE_STATUS}, not deploy:success."
  FAIL=1
fi

LATEST_COMMIT_JSON=$(curl -sS --fail-with-body \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${BRANCH}")
LATEST_SHA=$(echo "$LATEST_COMMIT_JSON" | jq -r '.sha')
LATEST_COMMIT_DATE=$(echo "$LATEST_COMMIT_JSON" | jq -r '.commit.committer.date')

if [ "${LATEST_SHA:0:8}" != "${DEPLOY_SHA:0:8}" ]; then
  COMMIT_EPOCH=$(date -d "$LATEST_COMMIT_DATE" +%s)
  NOW_EPOCH=$(date +%s)
  AGE_MIN=$(( (NOW_EPOCH - COMMIT_EPOCH) / 60 ))
  if [ "$AGE_MIN" -ge "$WINDOW_MINUTES" ]; then
    echo "::error::${PROJECT}: GitHub ${BRANCH} is at ${LATEST_SHA:0:8} (${AGE_MIN}m old), no matching Cloudflare deployment yet. Latest deploy is still ${DEPLOY_SHA:0:8}. Window is ${WINDOW_MINUTES}m."
    FAIL=1
  else
    echo "GitHub ${BRANCH} moved to ${LATEST_SHA:0:8} ${AGE_MIN}m ago; still inside the ${WINDOW_MINUTES}m build window, not alerting yet."
  fi
fi

exit $FAIL
