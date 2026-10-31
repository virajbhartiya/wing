"use strict";
// Pull requests come through the developer's own signed-in gh and glab, so Wing
// never stores a forge token.
const { execFile } = require("node:child_process");
const GITHUB_FIELDS = `nodes { ... on PullRequest {
  number title url isDraft updatedAt additions deletions mergeable reviewDecision
  author { login } repository { nameWithOwner } comments { totalCount }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
} }`;
const GITHUB_QUERY = `{
  mine: search(query: "is:open is:pr author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { ${GITHUB_FIELDS} }
  review: search(query: "is:open is:pr review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { ${GITHUB_FIELDS} }
}`;
const webURL = (value) => (/^https:\/\//.test(String(value)) ? String(value) : "");
const GITHUB_CI = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};
const GITHUB_REVIEW = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  REVIEW_REQUIRED: "waiting",
};
function parseGitHub(data) {
  const row = (section) => (pr) => ({
    provider: "github",
    section,
    repo: pr.repository?.nameWithOwner || "",
    number: pr.number,
    title: String(pr.title || ""),
    url: webURL(pr.url),
    author: pr.author?.login || "",
    draft: !!pr.isDraft,
    ci:
      GITHUB_CI[pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] ||
      "none",
    review: GITHUB_REVIEW[pr.reviewDecision] || "none",
    conflict: pr.mergeable === "CONFLICTING",
    comments: pr.comments?.totalCount || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    updatedAt: pr.updatedAt || "",
  });
  const rows = (nodes = [], section) =>
    nodes.filter((pr) => pr && pr.url).map(row(section));
  return [
    ...rows(data?.review?.nodes, "review"),
    ...rows(data?.mine?.nodes, "mine"),
  ];
}
function parseGitLab(requests, section) {
  return (Array.isArray(requests) ? requests : [])
    .filter((mr) => mr && webURL(mr.web_url))
    .map((mr) => ({
      provider: "gitlab",
      section,
      repo: String(mr.references?.full || "").replace(/!\d+$/, ""),
      number: mr.iid,
      title: String(mr.title || ""),
      url: mr.web_url,
      author: mr.author?.username || "",
      draft: !!mr.draft,
      // GitLab leaves pipeline state out of its list endpoint.
      ci: mr.detailed_merge_status === "ci_still_running" ? "pending"
        : mr.detailed_merge_status === "ci_must_pass" ? "failing"
        : "none",
      review: mr.detailed_merge_status === "not_approved" ? "waiting" : "none",
      conflict: !!mr.has_conflicts,
      comments: mr.user_notes_count || 0,
      additions: 0,
      deletions: 0,
      updatedAt: mr.updated_at || "",
    }));
}
const SEARCH_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
function run(command, args) {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      {
        timeout: 20000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH || ""}:${SEARCH_PATH}` },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        error.missing = error.code === "ENOENT";
        error.signedOut = /auth login|not logged|authenticat|no token/i.test(
          String(stderr),
        );
        reject(error);
      },
    ),
  );
}
function failure(id, name, command, error) {
  const status = error.missing ? "missing" : error.signedOut ? "signedout" : "error";
  const message = {
    missing: `Install the ${command} command line tool to see ${name} here.`,
    signedout: `Run “${command} auth login” in Terminal to see ${name} here.`,
    error: `${name} could not be reached.`,
  }[status];
  return { provider: { id, name, status, message }, items: [] };
}
async function github() {
  try {
    const out = await run("gh", ["api", "graphql", "-f", `query=${GITHUB_QUERY}`]);
    return {
      provider: { id: "github", name: "GitHub", status: "ok" },
      items: parseGitHub(JSON.parse(out).data),
    };
  } catch (error) {
    return failure("github", "GitHub", "gh", error);
  }
}
async function gitlab() {
  try {
    const user = JSON.parse(await run("glab", ["api", "user"]));
    const [mine, review] = await Promise.all([
      run("glab", ["api", "merge_requests?scope=created_by_me&state=opened&per_page=50"]),
      run("glab", [
        "api",
        `merge_requests?scope=all&state=opened&per_page=50&reviewer_username=${encodeURIComponent(user.username)}`,
      ]),
    ]);
    return {
      provider: { id: "gitlab", name: "GitLab", status: "ok" },
      items: [
        ...parseGitLab(JSON.parse(review), "review"),
        ...parseGitLab(JSON.parse(mine), "mine"),
      ],
    };
  } catch (error) {
    return failure("gitlab", "GitLab", "glab", error);
  }
}
async function fetchPullRequests() {
  const results = await Promise.all([github(), gitlab()]);
  return {
    providers: results.map((r) => r.provider),
    items: results.flatMap((r) => r.items),
    fetchedAt: Date.now(),
  };
}
module.exports = { fetchPullRequests, parseGitHub, parseGitLab };
