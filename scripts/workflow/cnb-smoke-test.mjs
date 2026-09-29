#!/usr/bin/env node
/**
 * CNB smoke test for the Gongfeng -> CNB migration.
 *
 * This script intentionally performs only reversible or idempotent writes:
 * - patch PR title to its current value
 * - put issue labels back to the exact labels read from the issue
 * - create/update one marker comment on the smoke issue
 */

import { createPlatformClient, platformUtils } from "./platform-client.mjs";

const REQUIRED_ENV = [
  "CNB_API_ENDPOINT",
  "CNB_REPO_SLUG",
  "CNB_BRANCH",
  "CNB_PULL_REQUEST_IID",
  "CNB_PULL_REQUEST_BRANCH",
  "CNB_PULL_REQUEST_SHA",
  "CNB_PULL_REQUEST_TARGET_SHA",
  "CNB_PULL_REQUEST_PROPOSER",
  "MINDX_CI_TOKEN",
  "SMOKE_ISSUE_IID",
];

function fail(message) {
  console.error("");
  console.error("CNB smoke test FAIL");
  console.error(message);
  process.exit(1);
}

function logSection(title) {
  console.log("");
  console.log(`-- ${title} --`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Missing required env: ${name}`);
  return value;
}

async function main() {
  logSection("Env presence");
  for (const key of REQUIRED_ENV) {
    const value = process.env[key];
    if (key === "MINDX_CI_TOKEN") {
      console.log(
        `${key}: ${value ? `present (len=${value.length})` : "missing"}`,
      );
    } else {
      console.log(`${key}: ${value || "(missing)"}`);
    }
  }

  for (const key of REQUIRED_ENV) requiredEnv(key);

  const repo = requiredEnv("CNB_REPO_SLUG");
  const prIid = requiredEnv("CNB_PULL_REQUEST_IID");
  const issueIid = requiredEnv("SMOKE_ISSUE_IID");
  const client = createPlatformClient();

  logSection("Read PR");
  const pr = await client.getPR(prIid);
  const prTitle = pr?.title || process.env.CNB_PULL_REQUEST_TITLE || "";
  console.log(`PR #${prIid}: ${prTitle || "(no title)"}`);
  console.log(`PR proposer: ${process.env.CNB_PULL_REQUEST_PROPOSER}`);

  logSection("Patch PR title to current value");
  await client.patchPRTitle(prIid, prTitle);
  console.log("PR title patch succeeded");

  logSection("Read issue");
  const issue = await client.getIssue(issueIid);
  const originalLabels = platformUtils.normalizeLabels(issue);
  console.log(`Issue #${issueIid}: ${issue?.title || "(no title)"}`);
  console.log(`Issue state: ${issue?.state || "(unknown)"}`);
  console.log(`Issue labels: ${originalLabels.join(", ") || "(none)"}`);
  if (issue?.state === "closed") {
    fail(
      `Smoke issue #${issueIid} is already closed; cannot validate state flow safely.`,
    );
  }

  logSection("Put issue labels back to original labels");
  await client.putIssueLabels(issueIid, originalLabels);
  console.log("Issue label put succeeded");

  logSection("Create or update smoke marker comment");
  const marker = `CNB smoke test: issue #${issueIid} / PR #${prIid}`;
  const body =
    `${marker}\n\n` +
    `- repo: ${repo}\n` +
    `- event: ${process.env.CNB_EVENT || "(unknown)"}\n` +
    `- target branch: ${process.env.CNB_BRANCH}\n` +
    `- source branch: ${process.env.CNB_PULL_REQUEST_BRANCH}\n` +
    `- source sha: ${process.env.CNB_PULL_REQUEST_SHA}\n` +
    `- target sha: ${process.env.CNB_PULL_REQUEST_TARGET_SHA}\n` +
    `- proposer: ${process.env.CNB_PULL_REQUEST_PROPOSER}\n` +
    `- token injected: yes\n`;

  const comments = await client.getIssueNotes(issueIid);
  const existing = comments.find((comment) =>
    String(comment?.body || "").includes(marker),
  );
  if (existing) {
    const id = platformUtils.resolveCommentId(existing);
    if (!id) fail("Found marker comment but cannot resolve comment id");
    await client.updateIssueNote(issueIid, id, body);
    console.log(`Updated marker comment ${id}`);
  } else {
    const created = await client.createIssueNote(issueIid, body);
    const id = platformUtils.resolveCommentId(created);
    if (id) {
      await client.updateIssueNote(
        issueIid,
        id,
        `${body}\n- patch comment: yes\n`,
      );
      console.log(`Created and patched marker comment ${id}`);
    } else {
      console.log(
        "Created marker comment; response did not include a comment id, patch step skipped",
      );
    }
  }

  logSection("Result");
  console.log("CNB smoke test PASS");
}

main().catch((err) => {
  fail(err.stack || err.message || String(err));
});
