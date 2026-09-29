import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALLOWED_PREFIXES = Object.freeze([
  ".agents/",
  ".cnb/",
  ".codebuddy/",
  ".github/",
  ".husky/",
  ".vibe/",
  "docs/",
  "scripts/",
  "tools/",
]);

const ALLOWED_ROOT_FILES = new Set([
  ".cnb.yml",
  ".gitignore",
  ".npmrc",
  ".stylelintrc.js",
  ".whistle.rules.conf",
  "commitlint.config.cjs",
  "eslint.config.mjs",
  "lint-staged.config.mjs",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "skills-lock.json",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
]);

const MARKDOWN_PATH_PATTERN = /\.md$/u;
const PACKAGE_GOVERNANCE_PATH_PATTERN =
  /^packages\/[^/]+\/\.business-frozen\.json$/u;
const TEST_SOURCE_PATH_PATTERN =
  /(?:^|\/)[^/]+\.(?:test|spec)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/u;

export class InfrastructureRouteError extends Error {
  constructor(message) {
    super(message);
    this.name = "InfrastructureRouteError";
  }
}

function normalizeChangedPath(filePath) {
  const normalized = String(filePath || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
}

/**
 * `Target-label: none` is intentionally narrow and asset-based: known root
 * tooling/config files, workflow/tooling directories, Markdown documentation,
 * explicit governance metadata, and strictly named test/spec sources.
 * Anything that does not match a reviewed category requires a real Issue.
 */
export function isInfrastructurePathAllowed(filePath) {
  const normalized = normalizeChangedPath(filePath);
  if (!normalized) return false;
  return (
    ALLOWED_ROOT_FILES.has(normalized) ||
    ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    MARKDOWN_PATH_PATTERN.test(normalized) ||
    PACKAGE_GOVERNANCE_PATH_PATTERN.test(normalized) ||
    TEST_SOURCE_PATH_PATTERN.test(normalized)
  );
}

export function assertInfrastructureChangedPaths(changedPaths) {
  const rawPaths = Array.isArray(changedPaths) ? changedPaths : [];
  if (rawPaths.length === 0) {
    throw new InfrastructureRouteError(
      "INFRASTRUCTURE_DIFF_EMPTY: Target-label none requires a non-empty trusted diff",
    );
  }

  const normalizedEntries = rawPaths.map(normalizeChangedPath);
  const invalidPathIndex = normalizedEntries.findIndex(
    (filePath) => filePath === null,
  );
  if (invalidPathIndex !== -1) {
    throw new InfrastructureRouteError(
      `INFRASTRUCTURE_DIFF_FORBIDDEN: invalid changed path at index ${invalidPathIndex}`,
    );
  }

  const normalizedPaths = Array.from(new Set(normalizedEntries)).sort((a, b) =>
    a.localeCompare(b),
  );
  const forbidden = normalizedPaths.filter(
    (filePath) => !isInfrastructurePathAllowed(filePath),
  );
  if (forbidden.length > 0) {
    throw new InfrastructureRouteError(
      `INFRASTRUCTURE_DIFF_FORBIDDEN: Target-label none cannot modify production paths:\n${forbidden.join("\n")}`,
    );
  }
  return normalizedPaths;
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new InfrastructureRouteError(
      `INFRASTRUCTURE_DIFF_UNAVAILABLE: git ${args.join(" ")} failed\n${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
  return String(result.stdout || "").trim();
}

function isFullSha(value) {
  return /^[0-9a-f]{40}$/u.test(String(value || ""));
}

function parseChangedPaths(output) {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveChangedPathsBetweenRefs({
  baseRef = "origin/main",
  headRef = "HEAD",
  git = runGit,
} = {}) {
  const mergeBase = git(["merge-base", baseRef, headRef]);
  if (!isFullSha(mergeBase)) {
    throw new InfrastructureRouteError(
      `INFRASTRUCTURE_DIFF_UNAVAILABLE: invalid merge base ${mergeBase || "(empty)"}`,
    );
  }
  return parseChangedPaths(
    git([
      "diff",
      "--no-renames",
      "--name-only",
      "--diff-filter=ACDMRT",
      `${mergeBase}..${headRef}`,
    ]),
  );
}

function hasCommit(sha, git) {
  if (!isFullSha(sha)) return false;
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveCommit({ sha, branch, git }) {
  if (hasCommit(sha, git)) return sha;

  if (isFullSha(sha)) {
    try {
      git(["fetch", "origin", sha, "--depth=1000"]);
    } catch {
      // Some servers disallow fetching an object ID directly. Try the branch.
    }
    if (hasCommit(sha, git)) return sha;
  }

  if (!branch) {
    throw new InfrastructureRouteError(
      "INFRASTRUCTURE_DIFF_UNAVAILABLE: missing branch/SHA for trusted diff",
    );
  }
  git(["fetch", "origin", branch, "--depth=1000"]);
  const fetchedSha = git(["rev-parse", "FETCH_HEAD"]);
  if (isFullSha(sha) && hasCommit(sha, git)) return sha;
  if (!isFullSha(fetchedSha)) {
    throw new InfrastructureRouteError(
      `INFRASTRUCTURE_DIFF_UNAVAILABLE: invalid fetched SHA for ${branch}`,
    );
  }
  return fetchedSha;
}

export function resolvePullRequestChangedPaths({
  env = process.env,
  sourceBranch,
  targetBranch,
  headSha,
  targetSha,
  git = runGit,
} = {}) {
  const resolvedHead = resolveCommit({
    sha: headSha || env.CNB_PULL_REQUEST_SHA || env.CNB_COMMIT || "",
    branch: sourceBranch || env.CNB_PULL_REQUEST_BRANCH || "",
    git,
  });
  const resolvedTarget = resolveCommit({
    sha:
      targetSha || env.CNB_PULL_REQUEST_TARGET_SHA || env.CNB_BEFORE_SHA || "",
    branch: targetBranch || env.CNB_BRANCH || "main",
    git,
  });
  return resolveChangedPathsBetweenRefs({
    baseRef: resolvedTarget,
    headRef: resolvedHead,
    git,
  });
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  try {
    const changedPaths = resolveChangedPathsBetweenRefs({
      baseRef: process.env.BASE_REF || "origin/main",
      headRef: process.env.HEAD_REF || "HEAD",
    });
    const validatedPaths = assertInfrastructureChangedPaths(changedPaths);
    console.log(
      `Infrastructure diff allowed: ${validatedPaths.length} changed path(s)`,
    );
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
