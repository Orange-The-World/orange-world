#!/usr/bin/env node
// Reports whether the approval on a pull request was filed on the commit that
// would actually merge.
//
// WHY THIS EXISTS. This repository does not dismiss approvals when a branch is
// pushed to, and it does not require the last pusher to be approved. That is a
// deliberate trade: a rebase or a comment fix should not cost a second review.
// What it costs is that an approval can stay attached to a pull request while
// the code underneath it moves, and nothing says so. This says so.
//
// It blocks nothing and changes nothing. It states a fact: the approved commit
// and the head commit are the same, or they are not, and how far apart they
// are.
//
// EXIT CODES. Every way of failing to look has its own code, because a check
// that could not look and printed OK anyway is worse than no check at all.
//   0  the latest counting approval is on the head commit, or there is no
//      approval yet, in which case there is nothing to be stale against
//   1  the latest counting approval is on a different commit. Both are named.
//   2  the self-test failed, so nothing else this script says can be trusted
//   3  could not look: the API refused, answered 404, or returned something
//      this cannot read
//
// It prints no token and reads no secret.

const API_ROOT = process.env.GITHUB_API_URL || 'https://api.github.com'

function die(code, message) {
  console.error(`approval-covers-head: ${message}`)
  process.exit(code)
}

// ---------------------------------------------------------------------------
// The comparison. Pure functions, so the self-test drives the real code rather
// than a stand-in written to agree with it.
// ---------------------------------------------------------------------------

// A reviewer's standing is their most recent review that expresses one.
// COMMENTED and PENDING express none, so they neither grant nor withdraw an
// approval. This mirrors how the review state is counted on the platform.
export function latestCountingApproval(reviews, authorLogin) {
  if (!Array.isArray(reviews)) {
    throw new TypeError('the reviews payload was not an array')
  }
  const ordered = reviews
    .filter((r) => r && r.user && r.user.login)
    .slice()
    .sort((a, b) => String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')))

  const standing = new Map()
  for (const review of ordered) {
    const login = review.user.login
    // An author cannot approve their own work, so their review never counts
    // toward one and must not be able to withdraw someone else's either.
    if (authorLogin && login === authorLogin) continue
    const state = String(review.state || '').toUpperCase()
    if (state === 'COMMENTED' || state === 'PENDING') continue
    standing.set(login, review)
  }

  const approvals = [...standing.values()].filter(
    (r) => String(r.state).toUpperCase() === 'APPROVED',
  )
  if (approvals.length === 0) return null
  approvals.sort((a, b) =>
    String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')),
  )
  return approvals[approvals.length - 1]
}

export function verdict(headSha, approval) {
  if (!headSha) throw new TypeError('no head commit was given')
  if (!approval) {
    return {
      ok: true,
      code: 0,
      headline: 'no approval yet, so there is nothing to be stale against',
    }
  }
  const approvedSha = approval.commit_id
  if (!approvedSha) {
    return {
      ok: false,
      code: 3,
      headline: 'the approval carries no commit, so it cannot be compared to the head',
    }
  }
  if (approvedSha === headSha) {
    return {
      ok: true,
      code: 0,
      approvedSha,
      headline: 'the approval was filed on the commit that would merge',
    }
  }
  return {
    ok: false,
    code: 1,
    approvedSha,
    headline: 'the approval was filed on a different commit than the one that would merge',
  }
}

export function render(headSha, result, distance) {
  const lines = []
  if (result.ok && !result.approvedSha) {
    lines.push(`GREEN: ${result.headline}.`)
    lines.push(`  head     ${headSha}`)
    return lines.join('\n')
  }
  if (result.ok) {
    lines.push(`GREEN: ${result.headline}.`)
    lines.push(`  approved ${result.approvedSha}`)
    lines.push(`  head     ${headSha}`)
    return lines.join('\n')
  }
  lines.push(`RED: ${result.headline}.`)
  lines.push(`  approved ${result.approvedSha || '(none recorded)'}`)
  lines.push(`  head     ${headSha}`)
  lines.push(`  ${distance}`)
  lines.push('')
  lines.push('Read the difference between those two commits before merging, and say in')
  lines.push('the merge record what it was. If it touches anything beyond comments and')
  lines.push('lock files, ask for the approval to be refiled at the current head.')
  return lines.join('\n')
}

export function describeDistance(compare) {
  if (!compare) {
    return 'commits between them: unknown, the comparison could not be read'
  }
  const ahead = typeof compare.ahead_by === 'number' ? compare.ahead_by : null
  const behind = typeof compare.behind_by === 'number' ? compare.behind_by : null
  const status = compare.status || 'unknown'
  if (ahead === null) {
    return `commits between them: unknown (relationship reported as ${status})`
  }
  if (status === 'diverged') {
    return `commits between them: ${ahead} on the head that the approved commit does not carry, and ${behind === null ? 'an unknown number' : behind} the other way. The branch was rewritten after the approval, so the approved commit is not an ancestor of the head.`
  }
  return `commits between them: ${ahead}`
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function getJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(url, { headers })
  } catch (err) {
    return { error: `the request did not complete: ${err && err.message ? err.message : String(err)}` }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: `the API refused this token (HTTP ${response.status}). This is NOT a report that the approval covers the head.` }
  }
  if (response.status === 404) {
    return { error: 'the endpoint answered 404. Either the pull request number is wrong or this token cannot see it.' }
  }
  if (response.status < 200 || response.status >= 300) {
    return { error: `HTTP ${response.status}, which this check cannot read as either a value or an absence.` }
  }
  const body = await response.text()
  try {
    return { value: JSON.parse(body) }
  } catch {
    return { error: `the response was not JSON (${body.length} bytes)` }
  }
}

async function readAllReviews(repo, number) {
  const all = []
  for (let page = 1; page <= 10; page += 1) {
    const got = await getJson(`${API_ROOT}/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`)
    if (got.error) return got
    if (!Array.isArray(got.value)) {
      return { error: 'the reviews response was not a JSON array' }
    }
    all.push(...got.value)
    if (got.value.length < 100) return { value: all }
  }
  return { error: 'more review pages than this check will read; refusing to answer on a partial list' }
}

async function check() {
  const repo = process.env.GITHUB_REPOSITORY
  const number = process.env.PR_NUMBER
  if (!repo) die(3, 'GITHUB_REPOSITORY is not set, so there is no repository to read')
  if (!number) die(3, 'PR_NUMBER is not set, so there is no pull request to read')

  const pr = await getJson(`${API_ROOT}/repos/${repo}/pulls/${number}`)
  if (pr.error) die(3, `could not read pull request ${number}: ${pr.error}`)
  const headSha = pr.value && pr.value.head ? pr.value.head.sha : null
  const authorLogin = pr.value && pr.value.user ? pr.value.user.login : null
  if (!headSha) die(3, 'the pull request response carried no head commit')

  const reviews = await readAllReviews(repo, number)
  if (reviews.error) die(3, `could not read the reviews on pull request ${number}: ${reviews.error}`)

  let approval
  try {
    approval = latestCountingApproval(reviews.value, authorLogin)
  } catch (err) {
    die(3, err && err.message ? err.message : String(err))
  }

  const result = verdict(headSha, approval)

  let distance = ''
  if (!result.ok && result.code === 1) {
    const compare = await getJson(`${API_ROOT}/repos/${repo}/compare/${result.approvedSha}...${headSha}`)
    distance = describeDistance(compare.error ? null : compare.value)
  }

  const text = render(headSha, result, distance)
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    const fs = await import('node:fs')
    const title = result.ok
      ? '## Approval covers head'
      : '## The approval does not cover the commit that would merge'
    fs.appendFileSync(summaryPath, `${title}\n\n\`\`\`\n${text}\n\`\`\`\n`)
  }

  if (result.ok) {
    console.log(text)
    return
  }
  console.error(text)
  process.exit(result.code)
}

// ---------------------------------------------------------------------------
// Self-test. No network. Proves the comparison goes red when the head has
// moved past the approval, green when it has not, and that the cases which
// look like an approval but are not one are treated as no approval.
// ---------------------------------------------------------------------------

function expect(condition, what) {
  if (!condition) die(2, `SELF-TEST FAILED: ${what}`)
}

const review = (login, state, commit, at) => ({
  user: { login },
  state,
  commit_id: commit,
  submitted_at: at,
})

function selfTest() {
  const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  // No reviews at all. Green: nothing to be stale against.
  expect(latestCountingApproval([], 'author') === null, 'an empty review list produced an approval')
  expect(verdict(HEAD, null).code === 0, 'a pull request with no approval was reported red')

  // Approved at the head. Green.
  const onHead = [review('reviewer', 'APPROVED', HEAD, '2020-01-01T00:00:00Z')]
  expect(verdict(HEAD, latestCountingApproval(onHead, 'author')).code === 0, 'an approval on the head was reported red')

  // THE CASE THIS EXISTS FOR: approved, then pushed to. Red, and it names both.
  const stale = [review('reviewer', 'APPROVED', OLD, '2020-01-01T00:00:00Z')]
  const staleVerdict = verdict(HEAD, latestCountingApproval(stale, 'author'))
  expect(staleVerdict.code === 1, 'an approval on a superseded commit was reported green')
  const rendered = render(HEAD, staleVerdict, describeDistance({ status: 'ahead', ahead_by: 3, behind_by: 0 }))
  expect(rendered.includes(OLD) && rendered.includes(HEAD), 'the red report did not name both commits')
  expect(rendered.includes('commits between them: 3'), 'the red report did not say how far apart the commits are')

  // A rewritten branch still reports, and says the approved commit is gone.
  const diverged = describeDistance({ status: 'diverged', ahead_by: 2, behind_by: 5 })
  expect(diverged.includes('rewritten'), 'a diverged comparison did not say the branch was rewritten')

  // An unreadable comparison is never silently dropped.
  expect(describeDistance(null).includes('unknown'), 'an unreadable comparison did not report as unknown')

  // The author's own approval does not count, in either direction.
  const selfApproved = [review('author', 'APPROVED', OLD, '2020-01-01T00:00:00Z')]
  expect(latestCountingApproval(selfApproved, 'author') === null, "the author's own review was counted as an approval")
  const selfDismissing = [
    review('reviewer', 'APPROVED', HEAD, '2020-01-01T00:00:00Z'),
    review('author', 'CHANGES_REQUESTED', HEAD, '2020-01-02T00:00:00Z'),
  ]
  expect(latestCountingApproval(selfDismissing, 'author') !== null, "the author's own review withdrew someone else's approval")

  // A later review by the same reviewer supersedes the approval.
  const withdrawn = [
    review('reviewer', 'APPROVED', OLD, '2020-01-01T00:00:00Z'),
    review('reviewer', 'CHANGES_REQUESTED', HEAD, '2020-01-02T00:00:00Z'),
  ]
  expect(latestCountingApproval(withdrawn, 'author') === null, 'a withdrawn approval was still counted')
  const dismissed = [
    review('reviewer', 'APPROVED', OLD, '2020-01-01T00:00:00Z'),
    review('reviewer', 'DISMISSED', OLD, '2020-01-02T00:00:00Z'),
  ]
  expect(latestCountingApproval(dismissed, 'author') === null, 'a dismissed approval was still counted')

  // A plain comment neither grants nor withdraws one.
  const commented = [
    review('reviewer', 'APPROVED', OLD, '2020-01-01T00:00:00Z'),
    review('reviewer', 'COMMENTED', HEAD, '2020-01-02T00:00:00Z'),
  ]
  expect(verdict(HEAD, latestCountingApproval(commented, 'author')).code === 1, 'a later comment was read as re-approving the head')

  // With two reviewers the most recent counting approval is the one compared.
  const two = [
    review('first', 'APPROVED', OLD, '2020-01-01T00:00:00Z'),
    review('second', 'APPROVED', HEAD, '2020-01-03T00:00:00Z'),
  ]
  expect(verdict(HEAD, latestCountingApproval(two, 'author')).code === 0, 'the latest of two approvals was not the one compared')

  // Order in the payload is not relied on.
  const shuffled = [
    review('reviewer', 'CHANGES_REQUESTED', HEAD, '2020-01-02T00:00:00Z'),
    review('reviewer', 'APPROVED', OLD, '2020-01-01T00:00:00Z'),
  ]
  expect(latestCountingApproval(shuffled, 'author') === null, 'the result depended on the order the reviews arrived in')

  console.log(
    'self-test passed: red when the head has moved past the latest counting approval, naming both commits and the distance; green on an approval at the head and on a pull request with no approval; an author self-review, a withdrawn approval and a dismissed approval all count as no approval, and a later comment neither grants nor withdraws one',
  )
}

// ---------------------------------------------------------------------------

async function main() {
  const mode = process.argv[2]
  if (mode === '--self-test') {
    selfTest()
    return
  }
  if (mode === '--check') {
    await check()
    return
  }
  die(3, 'usage: --self-test | --check   (with GITHUB_REPOSITORY and PR_NUMBER set)')
}

main().catch((err) => {
  die(3, err && err.stack ? err.stack : String(err))
})
