import { Octokit } from "octokit";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { addMonths, format, startOfMonth, endOfMonth, isBefore, parseISO } from "date-fns";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
interface Args {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  repos: string[];   // ["owner/repo", ...]
  username: string;
  outputDir: string;
  token: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing required argument: ${flag}`);
    }
    return args[idx + 1];
  };

  const now = new Date();
  const lastMonth = addMonths(now, -1);

  return {
    startDate: get("--start-date", format(startOfMonth(lastMonth), "yyyy-MM-dd")),
    endDate: get("--end-date", format(endOfMonth(lastMonth), "yyyy-MM-dd")),
    repos: get("--repos").split(",").map((r) => r.trim()),
    username: get("--username"),
    outputDir: get("--output-dir", "./data"),
    token: get("--token", process.env.GITHUB_TOKEN ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates [startOfMonth, endOfMonth] pairs between two dates. */
function monthRanges(start: string, end: string): Array<{ year: string; month: string; since: string; until: string }> {
  const ranges: Array<{ year: string; month: string; since: string; until: string }> = [];
  let cursor = startOfMonth(parseISO(start));
  const last = parseISO(end);

  while (isBefore(cursor, last) || format(cursor, "yyyy-MM") === format(last, "yyyy-MM")) {
    const monthEnd = endOfMonth(cursor);
    ranges.push({
      year: format(cursor, "yyyy"),
      month: format(cursor, "MM"),
      since: cursor.toISOString(),
      until: monthEnd.toISOString(),
    });
    cursor = startOfMonth(addMonths(cursor, 1));
  }
  return ranges;
}

async function writeJson(dir: string, filename: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✓ ${path} (${Array.isArray(data) ? data.length : 1} items)`);
}

// ---------------------------------------------------------------------------
// Data fetching functions
// ---------------------------------------------------------------------------

async function fetchIssuesCreated(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const items: unknown[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    owner, repo, creator: username, state: "all", since, per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const issue of data) {
      if (issue.pull_request) continue; // skip PRs
      const created = new Date(issue.created_at);
      if (created >= new Date(since) && created <= new Date(until)) {
        items.push(issue);
      }
    }
  }
  return items;
}

async function fetchIssuesAssigned(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const items: unknown[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    owner, repo, assignee: username, state: "all", since, per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const issue of data) {
      if (issue.pull_request) continue;
      const created = new Date(issue.created_at);
      if (created >= new Date(since) && created <= new Date(until)) {
        items.push(issue);
      }
    }
  }
  return items;
}

async function fetchPRsCreated(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const items: unknown[] = [];
  const query = `repo:${owner}/${repo} is:pr author:${username} created:${since.slice(0, 10)}..${until.slice(0, 10)}`;
  let page = 1;
  while (true) {
    const resp = await octokit.rest.search.issuesAndPullRequests({
      q: query, per_page: 100, page, sort: "created", order: "asc",
    });
    items.push(...resp.data.items);
    if (items.length >= resp.data.total_count) break;
    page++;
  }
  return items;
}

async function fetchPRsAssigned(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const items: unknown[] = [];
  const query = `repo:${owner}/${repo} is:pr assignee:${username} created:${since.slice(0, 10)}..${until.slice(0, 10)}`;
  let page = 1;
  while (true) {
    const resp = await octokit.rest.search.issuesAndPullRequests({
      q: query, per_page: 100, page, sort: "created", order: "asc",
    });
    items.push(...resp.data.items);
    if (items.length >= resp.data.total_count) break;
    page++;
  }
  return items;
}

async function fetchPRReviews(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const reviews: unknown[] = [];
  const query = `repo:${owner}/${repo} is:pr reviewed-by:${username} updated:${since.slice(0, 10)}..${until.slice(0, 10)}`;
  let page = 1;
  let prItems: Array<{ number: number }> = [];
  while (true) {
    const resp = await octokit.rest.search.issuesAndPullRequests({
      q: query, per_page: 100, page, sort: "updated", order: "asc",
    });
    prItems.push(...resp.data.items.map((i) => ({ number: i.number })));
    if (prItems.length >= resp.data.total_count) break;
    page++;
  }

  for (const pr of prItems) {
    try {
      const prReviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner, repo, pull_number: pr.number, per_page: 100,
      });
      for (const review of prReviews) {
        const r = review as { user?: { login?: string }; submitted_at?: string };
        if (
          r.user?.login === username &&
          r.submitted_at &&
          new Date(r.submitted_at) >= new Date(since) &&
          new Date(r.submitted_at) <= new Date(until)
        ) {
          reviews.push({ ...review, pull_number: pr.number });
        }
      }
    } catch {
      console.warn(`  ⚠ Could not fetch reviews for PR #${pr.number} in ${owner}/${repo}`);
    }
  }
  return reviews;
}

async function fetchIssueComments(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const comments: unknown[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listCommentsForRepo, {
    owner, repo, since, sort: "created", direction: "asc", per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const comment of data) {
      const c = comment as { user?: { login?: string }; created_at: string };
      const created = new Date(c.created_at);
      if (created > new Date(until)) return comments; // past our window
      if (c.user?.login === username && created >= new Date(since)) {
        comments.push(comment);
      }
    }
  }
  return comments;
}

async function fetchPRComments(
  octokit: Octokit, owner: string, repo: string, username: string, since: string, until: string
): Promise<unknown[]> {
  const comments: unknown[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listReviewCommentsForRepo, {
    owner, repo, since, sort: "created", direction: "asc", per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const comment of data) {
      const c = comment as { user?: { login?: string }; created_at: string };
      const created = new Date(c.created_at);
      if (created > new Date(until)) return comments;
      if (c.user?.login === username && created >= new Date(since)) {
        comments.push(comment);
      }
    }
  }
  return comments;
}

// ---------------------------------------------------------------------------
// Rate-limit aware wrapper
// ---------------------------------------------------------------------------

async function withRateLimit<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const e = err as { status?: number; response?: { headers?: Record<string, string> } };
    if (e.status === 403 || e.status === 429) {
      const resetHeader = e.response?.headers?.["x-ratelimit-reset"];
      const resetTime = resetHeader ? parseInt(resetHeader, 10) * 1000 : Date.now() + 60_000;
      const waitMs = Math.max(resetTime - Date.now(), 1000);
      console.warn(`  ⏳ Rate limited on ${label}. Waiting ${Math.round(waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return fn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.token) {
    throw new Error("No GitHub token provided. Use --token or set GITHUB_TOKEN env var.");
  }

  const octokit = new Octokit({ auth: args.token });

  // Verify authentication
  const { data: user } = await octokit.rest.users.getAuthenticated();
  console.log(`✓ Authenticated as ${user.login}`);

  const ranges = monthRanges(args.startDate, args.endDate);
  console.log(`\nFetching data for ${ranges.length} month(s): ${ranges.map((r) => `${r.year}-${r.month}`).join(", ")}`);
  console.log(`Repos: ${args.repos.join(", ")}`);
  console.log(`Username: ${args.username}\n`);

  for (const range of ranges) {
    const monthLabel = `${range.year}-${range.month}`;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📅 ${monthLabel}`);
    console.log(`${"=".repeat(60)}`);

    const monthDir = join(args.outputDir, monthLabel);

    // Collect data from all repos for this month
    const allIssuesCreated: unknown[] = [];
    const allIssuesAssigned: unknown[] = [];
    const allPRsCreated: unknown[] = [];
    const allPRsAssigned: unknown[] = [];
    const allPRReviews: unknown[] = [];
    const allIssueComments: unknown[] = [];
    const allPRComments: unknown[] = [];

    for (const repoFull of args.repos) {
      const [owner, repo] = repoFull.split("/");
      console.log(`\n  📦 ${owner}/${repo}`);

      const issuesCreated = await withRateLimit(
        () => fetchIssuesCreated(octokit, owner, repo, args.username, range.since, range.until),
        `issues-created:${repoFull}`
      );
      allIssuesCreated.push(...issuesCreated.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const issuesAssigned = await withRateLimit(
        () => fetchIssuesAssigned(octokit, owner, repo, args.username, range.since, range.until),
        `issues-assigned:${repoFull}`
      );
      allIssuesAssigned.push(...issuesAssigned.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const prsCreated = await withRateLimit(
        () => fetchPRsCreated(octokit, owner, repo, args.username, range.since, range.until),
        `prs-created:${repoFull}`
      );
      allPRsCreated.push(...prsCreated.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const prsAssigned = await withRateLimit(
        () => fetchPRsAssigned(octokit, owner, repo, args.username, range.since, range.until),
        `prs-assigned:${repoFull}`
      );
      allPRsAssigned.push(...prsAssigned.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const prReviews = await withRateLimit(
        () => fetchPRReviews(octokit, owner, repo, args.username, range.since, range.until),
        `pr-reviews:${repoFull}`
      );
      allPRReviews.push(...prReviews.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const issueComments = await withRateLimit(
        () => fetchIssueComments(octokit, owner, repo, args.username, range.since, range.until),
        `issue-comments:${repoFull}`
      );
      allIssueComments.push(...issueComments.map((i) => ({ ...i as object, _source_repo: repoFull })));

      const prComments = await withRateLimit(
        () => fetchPRComments(octokit, owner, repo, args.username, range.since, range.until),
        `pr-comments:${repoFull}`
      );
      allPRComments.push(...prComments.map((i) => ({ ...i as object, _source_repo: repoFull })));
    }

    // Write all data files for this month
    await writeJson(monthDir, "issues-created.json", allIssuesCreated);
    await writeJson(monthDir, "issues-assigned.json", allIssuesAssigned);
    await writeJson(monthDir, "prs-created.json", allPRsCreated);
    await writeJson(monthDir, "prs-assigned.json", allPRsAssigned);
    await writeJson(monthDir, "pr-reviews.json", allPRReviews);
    await writeJson(monthDir, "issue-comments.json", allIssueComments);
    await writeJson(monthDir, "pr-comments.json", allPRComments);

    console.log(`\n  📊 ${monthLabel} totals:`);
    console.log(`     Issues created:  ${allIssuesCreated.length}`);
    console.log(`     Issues assigned: ${allIssuesAssigned.length}`);
    console.log(`     PRs created:     ${allPRsCreated.length}`);
    console.log(`     PRs assigned:    ${allPRsAssigned.length}`);
    console.log(`     PR reviews:      ${allPRReviews.length}`);
    console.log(`     Issue comments:  ${allIssueComments.length}`);
    console.log(`     PR comments:     ${allPRComments.length}`);
  }

  console.log(`\n✅ Done! Data written to ${args.outputDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
