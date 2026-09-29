import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { assertFinalPrTitle, isPlaceholderPrTitle } from "../pr-title.mjs";
import { buildCnbPullArguments } from "../upsert-cnb-pr.mjs";

const WRAPPER = path.resolve(import.meta.dirname, "../upsert-cnb-pr.mjs");
const SKILL = path.resolve(
  import.meta.dirname,
  "../../../.codebuddy/skills/cmd-publish/SKILL.md",
);

test("route-aware build arguments enforce final conventional commit subjects", () => {
  for (const title of ["", "test", "test #1084", "WIP", "临时 [no-issue]"]) {
    assert.equal(isPlaceholderPrTitle(title), true, title);
    assert.throws(() => assertFinalPrTitle(title), /final and meaningful/iu);
  }

  assert.equal(
    assertFinalPrTitle("fix: repair prototype sharing #1084"),
    "fix: repair prototype sharing #1084",
  );

  const productionArguments = buildCnbPullArguments({
    repo: "x-team/mindx",
    base: "main",
    head: "bugfix/1084-prototype-sharing",
    title: "fix(workflow): repair prototype sharing #1084",
    body: "Refs #1084\nAC-contract: sha256:abc\nTarget-label: 待发布\n",
    route: "production",
    expectedIssueId: "1084",
  });
  assert.deepEqual(
    productionArguments.slice(
      productionArguments.indexOf("--title"),
      productionArguments.indexOf("--title") + 2,
    ),
    ["--title", "fix(workflow): repair prototype sharing #1084"],
  );

  assert.doesNotThrow(() =>
    buildCnbPullArguments({
      repo: "x-team/mindx",
      base: "main",
      head: "chore/pr-title-validation",
      title: "chore: improve PR title validation [no-issue]",
      body: "AC-contract: none\nTarget-label: none\n",
      route: "infrastructure",
    }),
  );
  assert.doesNotThrow(() =>
    buildCnbPullArguments({
      repo: "x-team/mindx",
      base: "main",
      head: "chore/pr-title-validation",
      title: "fix: repair PR title validation #1084",
      body: "Refs #1084\nAC-contract: none\nTarget-label: none\n",
      route: "infrastructure",
      expectedIssueId: "1084",
    }),
  );

  for (const testCase of [
    {
      title: "chore: trigger build [no-issue]",
      route: "infrastructure",
      head: "chore/pr-title-validation",
    },
    {
      title: "ci: trigger release pipeline [no-issue]",
      route: "infrastructure",
      head: "ci/pr-title-validation",
    },
    {
      title: "fixup! fix: repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1084",
    },
    {
      title: "squash! fix: repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1084",
    },
    {
      title: "repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1084",
    },
    {
      title: "fix:   #1084",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1084",
    },
    {
      title: "fix: repair prototype sharing #1085",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1084",
    },
    {
      title: "fix: repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-sharing",
      expectedIssueId: "1085",
    },
    {
      title: "chore: repair PR title validation [no-issue]",
      route: "infrastructure",
      head: "bugfix/1084-prototype-sharing",
    },
    {
      title: "fix: repair PR title validation #1084",
      route: "infrastructure",
      head: "chore/pr-title-validation",
    },
    {
      title: "chore: repair PR title validation [no-issue]",
      route: "infrastructure",
      head: "chore/pr-title-validation",
      expectedIssueId: "1084",
    },
    {
      title: "fix: repair PR title validation #1085",
      route: "infrastructure",
      head: "chore/pr-title-validation",
      expectedIssueId: "1084",
    },
  ]) {
    assert.throws(
      () =>
        buildCnbPullArguments({
          repo: "x-team/mindx",
          base: "main",
          body: "AC-contract: none\nTarget-label: none\n",
          ...testCase,
        }),
      /placeholder|temporary|conventional|meaningful commit subject|expected Issue|source branch|requires/iu,
      testCase.title,
    );
  }
});

test("invalid route-aware PR titles are rejected before CNB is called", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mindx-pr-title-"));
  const cnbPath = path.join(directory, "cnb");
  const logPath = path.join(directory, "calls.log");
  const bodyPath = path.join(directory, "body.md");
  await writeFile(
    cnbPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CNB_TEST_LOG"\n`,
  );
  await chmod(cnbPath, 0o755);
  await writeFile(bodyPath, "AC-contract: none\nTarget-label: none\n");

  for (const { title, route, head, expectedIssueId } of [
    {
      title: "chore: trigger build [no-issue]",
      route: "infrastructure",
      head: "chore/prototype-fix",
    },
    {
      title: "ci: trigger release [no-issue]",
      route: "infrastructure",
      head: "ci/prototype-fix",
    },
    {
      title: "fixup! fix: repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-fix",
      expectedIssueId: "1084",
    },
    {
      title: "squash! fix: repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-fix",
      expectedIssueId: "1084",
    },
    {
      title: "repair prototype sharing #1084",
      route: "production",
      head: "bugfix/1084-prototype-fix",
      expectedIssueId: "1084",
    },
    {
      title: "fix:   #1084",
      route: "production",
      head: "bugfix/1084-prototype-fix",
      expectedIssueId: "1084",
    },
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        WRAPPER,
        "--repo",
        "x-team/mindx",
        "--base",
        "main",
        "--head",
        head,
        "--title",
        title,
        "--body-file",
        bodyPath,
        "--route",
        route,
        ...(expectedIssueId ? ["--expected-issue-id", expectedIssueId] : []),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          CNB_TEST_LOG: logPath,
        },
      },
    );

    assert.notEqual(result.status, 0, title);
  }
  await assert.rejects(readFile(logPath, "utf8"), { code: "ENOENT" });
});

test("the final title and long verbose flag are present in the first and only post-pull call", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mindx-pr-create-"));
  const cnbPath = path.join(directory, "cnb");
  const logPath = path.join(directory, "calls.log");
  const titleLogPath = path.join(directory, "title.log");
  const bodyPath = path.join(directory, "body.md");
  await writeFile(
    cnbPath,
    `#!/bin/sh\nprintf 'call\\n' >> "$CNB_TEST_LOG"\nsaw_verbose=0\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--title" ]; then\n    shift\n    printf '%s\\n' "$1" > "$CNB_TEST_TITLE_LOG"\n  elif [ "$1" = "--verbose" ]; then\n    saw_verbose=1\n  elif [ "$1" = "-v" ]; then\n    exit 65\n  fi\n  shift\ndone\n[ "$saw_verbose" -eq 1 ] || exit 64\nprintf '{"number":1084}\\n'\n`,
  );
  await chmod(cnbPath, 0o755);
  await writeFile(bodyPath, "AC-contract: none\nTarget-label: none\n");
  const finalTitle = "fix: make prototype sharing commit-free [no-issue]";

  const result = spawnSync(
    process.execPath,
    [
      WRAPPER,
      "--repo",
      "x-team/mindx",
      "--base",
      "main",
      "--head",
      "chore/prototype-fix",
      "--title",
      finalTitle,
      "--body-file",
      bodyPath,
      "--route",
      "infrastructure",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        CNB_TEST_LOG: logPath,
        CNB_TEST_TITLE_LOG: titleLogPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "call");
  assert.equal((await readFile(titleLogPath, "utf8")).trim(), finalTitle);
});

test("updating an existing PR preserves a valid cumulative title by default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mindx-pr-patch-"));
  const cnbPath = path.join(directory, "cnb");
  const logPath = path.join(directory, "calls.log");
  const titleLogPath = path.join(directory, "title.log");
  const bodyLogPath = path.join(directory, "body.log");
  const bodyPath = path.join(directory, "body.md");
  await writeFile(
    cnbPath,
    `#!/bin/sh\nprintf 'call:%s\\n' "$2" >> "$CNB_TEST_LOG"\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    --title) shift; printf '%s' "$1" > "$CNB_TEST_TITLE_LOG" ;;\n    --body) shift; printf '%s' "$1" > "$CNB_TEST_BODY_LOG" ;;\n  esac\n  shift\ndone\nprintf '{"number":1084}\\n'\n`,
  );
  await chmod(cnbPath, 0o755);
  const existingTitle = "feat: optimize the complete sharing workflow #1084";
  const candidateTitle = "fix: align the handoff contract #1084";
  const finalBody =
    "Refs #1084\n\nAC-contract: sha256:abc\nTarget-label: 待发布\n";
  await writeFile(bodyPath, finalBody);

  const result = spawnSync(
    process.execPath,
    [
      WRAPPER,
      "--repo",
      "x-team/mindx",
      "--base",
      "main",
      "--head",
      "feature/1084-prototype-fix",
      "--number",
      "1084",
      "--existing-title",
      existingTitle,
      "--title",
      candidateTitle,
      "--body-file",
      bodyPath,
      "--route",
      "production",
      "--expected-issue-id",
      "1084",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        CNB_TEST_LOG: logPath,
        CNB_TEST_TITLE_LOG: titleLogPath,
        CNB_TEST_BODY_LOG: bodyLogPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const calls = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "call:patch-pull");
  assert.doesNotMatch(calls[0], /post-pull/u);
  await assert.rejects(readFile(titleLogPath, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(bodyLogPath, "utf8"), finalBody);
});

test("an existing PR title changes only when it is invalid or explicitly replaced", () => {
  const sharedOptions = {
    repo: "x-team/mindx",
    base: "main",
    head: "feature/1155-prototype-library-share-draft",
    body: "Refs #1155\nAC-contract: sha256:abc\nTarget-label: 待发布\n",
    number: "1190",
    route: "production",
    expectedIssueId: "1155",
    title: "feat: optimize prototype library sharing and draft flow #1155",
  };

  const invalidExistingTitleArguments = buildCnbPullArguments({
    ...sharedOptions,
    existingTitle: "WIP #1155",
  });
  assert.deepEqual(
    invalidExistingTitleArguments.slice(
      invalidExistingTitleArguments.indexOf("--title"),
      invalidExistingTitleArguments.indexOf("--title") + 2,
    ),
    ["--title", sharedOptions.title],
  );

  const explicitReplacementArguments = buildCnbPullArguments({
    ...sharedOptions,
    existingTitle: "feat: previous complete scope #1155",
    updateTitle: true,
  });
  assert.deepEqual(
    explicitReplacementArguments.slice(
      explicitReplacementArguments.indexOf("--title"),
      explicitReplacementArguments.indexOf("--title") + 2,
    ),
    ["--title", sharedOptions.title],
  );

  const infrastructureIssueOptions = {
    ...sharedOptions,
    head: "chore/pr-title-validation",
    route: "infrastructure",
    expectedIssueId: "1155",
  };
  const validInfrastructureTitleArguments = buildCnbPullArguments({
    ...infrastructureIssueOptions,
    existingTitle: "fix: preserve the complete infrastructure scope #1155",
  });
  assert.equal(validInfrastructureTitleArguments.includes("--title"), false);

  const mismatchedInfrastructureTitleArguments = buildCnbPullArguments({
    ...infrastructureIssueOptions,
    existingTitle: "fix: preserve the complete infrastructure scope #1154",
  });
  assert.deepEqual(
    mismatchedInfrastructureTitleArguments.slice(
      mismatchedInfrastructureTitleArguments.indexOf("--title"),
      mismatchedInfrastructureTitleArguments.indexOf("--title") + 2,
    ),
    ["--title", sharedOptions.title],
  );
});

test("updating an existing PR requires the remote title for a fail-closed decision", () => {
  for (const existingTitle of [undefined, "", "   "]) {
    assert.throws(
      () =>
        buildCnbPullArguments({
          repo: "x-team/mindx",
          base: "main",
          head: "feature/1155-prototype-library-share-draft",
          body: "Refs #1155\nAC-contract: sha256:abc\nTarget-label: 待发布\n",
          number: "1190",
          route: "production",
          expectedIssueId: "1155",
          existingTitle,
          title:
            "feat: optimize prototype library sharing and draft flow #1155",
        }),
      /non-empty existing PR title/iu,
    );
  }
});

test("blank existing PR titles are rejected before CNB is called", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mindx-pr-blank-existing-title-"),
  );
  const cnbPath = path.join(directory, "cnb");
  const logPath = path.join(directory, "calls.log");
  const bodyPath = path.join(directory, "body.md");
  await writeFile(
    cnbPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CNB_TEST_LOG"\n`,
  );
  await chmod(cnbPath, 0o755);
  await writeFile(
    bodyPath,
    "Refs #1155\nAC-contract: sha256:abc\nTarget-label: 待发布\n",
  );

  for (const existingTitle of ["", "   "]) {
    const result = spawnSync(
      process.execPath,
      [
        WRAPPER,
        "--repo",
        "x-team/mindx",
        "--base",
        "main",
        "--head",
        "feature/1155-prototype-library-share-draft",
        "--number",
        "1190",
        "--existing-title",
        existingTitle,
        "--title",
        "feat: optimize prototype library sharing and draft flow #1155",
        "--body-file",
        bodyPath,
        "--route",
        "production",
        "--expected-issue-id",
        "1155",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          CNB_TEST_LOG: logPath,
        },
      },
    );

    assert.notEqual(result.status, 0, JSON.stringify(existingTitle));
    assert.match(result.stderr, /non-empty existing PR title/iu);
  }
  await assert.rejects(readFile(logPath, "utf8"), { code: "ENOENT" });
});

test("cmd-publish revalidates HEAD at every Step 2 entry and passes route context", async () => {
  const skill = await readFile(SKILL, "utf8");
  const step2 = skill.slice(
    skill.indexOf("### Step 2: 推送分支"),
    skill.indexOf("## Step 3: CNB PR 创建/更新"),
  );

  assert.match(step2, /每次进入或重新进入 Step 2/u);
  assert.match(step2, /git log -1 --pretty=%s/u);
  assert.match(step2, /assertFinalPrTitle/u);
  assert.match(skill, /--route production --expected-issue-id <issue_id>/u);
  assert.match(skill, /--route infrastructure/u);
});

test("cmd-publish treats PR titles as cumulative summaries and preserves valid existing titles", async () => {
  const skill = await readFile(SKILL, "utf8");

  assert.match(skill, /Issue.*累计 diff.*整体标题/u);
  assert.match(skill, /已有.*合法.*非临时.*默认保留/u);
  assert.match(skill, /placeholder.*格式不合法.*Issue 不匹配.*用户显式/u);
  assert.match(
    skill,
    /infrastructure.*真实 Issue.*--expected-issue-id.*无 Issue.*\[no-issue\]/su,
  );
  assert.doesNotMatch(skill, /PR 标题的唯一来源是最新有效 commit subject/u);
  assert.doesNotMatch(
    skill,
    /把标题更新为当前 `<latest valid commit subject>`/u,
  );
});
