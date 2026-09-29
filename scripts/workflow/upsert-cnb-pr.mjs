#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFinalPrTitle } from "./pr-title.mjs";

const CONVENTIONAL_TITLE_PATTERN =
  /^(?<type>feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([^)]+\))?!?: (?<subject>.+?) (?<binding>#[1-9]\d*|\[no-issue\])$/u;
const TEMPORARY_SUBJECT_PATTERN =
  /^(?:test|tmp|wip|update|fix bug|fix typo|debug|trigger(?:\s+.*)?|临时|测试|调试)$/iu;
const PRODUCTION_BRANCH_PATTERN =
  /^(?:feature|bugfix)\/(?<issueId>[1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const INFRASTRUCTURE_BRANCH_PATTERN =
  /^(?:chore|docs|refactor|style|test|build|ci|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VALID_ROUTES = new Set(["production", "infrastructure"]);

function readOptions(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const token = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!token?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${token || "(empty)"}`);
    }
    options[token.slice(2)] = value;
  }
  return options;
}

export function assertFinalPrTitleForRoute(
  value,
  { route, expectedIssueId, head } = {},
) {
  const title = assertFinalPrTitle(value);
  if (!VALID_ROUTES.has(route)) {
    throw new Error(
      "PR title validation requires route=production|infrastructure",
    );
  }

  const match = CONVENTIONAL_TITLE_PATTERN.exec(title);
  if (!match?.groups) {
    throw new Error(
      "PR title must be a conventional commit subject ending in #<issue-id> or [no-issue]",
    );
  }
  const subject = match.groups.subject.trim();
  if (!subject) {
    throw new Error("PR title must contain a meaningful commit subject");
  }
  if (TEMPORARY_SUBJECT_PATTERN.test(subject)) {
    throw new Error("PR title contains a temporary commit subject");
  }

  if (route === "production") {
    const normalizedIssueId = String(expectedIssueId || "").trim();
    if (!/^[1-9]\d*$/u.test(normalizedIssueId)) {
      throw new Error(
        "production PR title validation requires a positive expectedIssueId",
      );
    }

    const branchIssueId = PRODUCTION_BRANCH_PATTERN.exec(String(head || ""))
      ?.groups?.issueId;
    if (branchIssueId !== normalizedIssueId) {
      throw new Error(
        `production expectedIssueId #${normalizedIssueId} must match the source branch`,
      );
    }
    if (match.groups.binding !== `#${normalizedIssueId}`) {
      throw new Error(
        `production PR title must end with expected Issue #${normalizedIssueId}`,
      );
    }
  } else {
    if (!INFRASTRUCTURE_BRANCH_PATTERN.test(String(head || ""))) {
      throw new Error(
        "infrastructure PR title validation requires an infrastructure source branch",
      );
    }

    const normalizedIssueId = String(expectedIssueId || "").trim();
    if (normalizedIssueId) {
      if (!/^[1-9]\d*$/u.test(normalizedIssueId)) {
        throw new Error(
          "infrastructure expectedIssueId must be a positive integer",
        );
      }
      if (match.groups.binding !== `#${normalizedIssueId}`) {
        throw new Error(
          `infrastructure PR title must end with expected Issue #${normalizedIssueId}`,
        );
      }
    } else if (match.groups.binding !== "[no-issue]") {
      throw new Error(
        "infrastructure PR title requires [no-issue] when no expected Issue is provided",
      );
    }
  }

  return title;
}

export function buildCnbPullArguments({
  repo,
  base,
  head,
  title,
  existingTitle,
  updateTitle = false,
  body,
  number,
  route,
  expectedIssueId,
}) {
  if (!repo || !base || !head || !body?.trim()) {
    throw new Error("repo, base, head and a non-empty body are required");
  }
  if (typeof updateTitle !== "boolean") {
    throw new Error("updateTitle must be a boolean");
  }

  const titleContext = { route, expectedIssueId, head };
  if (number !== undefined) {
    if (!/^[1-9]\d*$/u.test(String(number))) {
      throw new Error("PR number must be a positive integer");
    }
    if (
      typeof existingTitle !== "string" ||
      existingTitle.trim().length === 0
    ) {
      throw new Error(
        "updating an existing PR requires a non-empty existing PR title",
      );
    }

    let existingTitleIsValid = false;
    try {
      assertFinalPrTitleForRoute(existingTitle, titleContext);
      existingTitleIsValid = true;
    } catch {
      existingTitleIsValid = false;
    }

    const argumentsList = [
      "pulls",
      "patch-pull",
      "--repo",
      repo,
      "--number",
      String(number),
    ];
    if (!existingTitleIsValid || updateTitle) {
      argumentsList.push(
        "--title",
        assertFinalPrTitleForRoute(title, titleContext),
      );
    }
    argumentsList.push("--body", body, "--verbose");
    return argumentsList;
  }

  const finalTitle = assertFinalPrTitleForRoute(title, titleContext);
  return [
    "pulls",
    "post-pull",
    "--repo",
    repo,
    "--base",
    base,
    "--head",
    head,
    "--head-repo",
    repo,
    "--title",
    finalTitle,
    "--body",
    body,
    "--verbose",
  ];
}

export function runCnbPull(
  args,
  { cwd = process.cwd(), env = process.env } = {},
) {
  const result = spawnSync("cnb", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `cnb ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const body = await readFile(path.resolve(options["body-file"]), "utf8");
  const updateTitleOption = options["update-title"];
  if (
    updateTitleOption !== undefined &&
    updateTitleOption !== "true" &&
    updateTitleOption !== "false"
  ) {
    throw new Error("--update-title must be true or false");
  }
  const args = buildCnbPullArguments({
    repo: options.repo,
    base: options.base,
    head: options.head,
    title: options.title,
    existingTitle: options["existing-title"],
    updateTitle: updateTitleOption === "true",
    body,
    number: options.number,
    route: options.route,
    expectedIssueId: options["expected-issue-id"],
  });
  process.stdout.write(runCnbPull(args));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
