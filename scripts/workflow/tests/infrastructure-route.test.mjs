import assert from "node:assert/strict";
import test from "node:test";

import {
  assertInfrastructureChangedPaths,
  isInfrastructurePathAllowed,
  resolveChangedPathsBetweenRefs,
} from "../infrastructure-route.mjs";

test("infrastructure none route accepts established infrastructure prefixes", () => {
  for (const filePath of [
    "docs/prototype-workflow.md",
    ".cnb/ISSUE_TEMPLATE/0-feature-request.yml",
    ".cnb/settings.yml",
    ".cnb/web_trigger.yml",
    ".cnb/other.yml",
    ".cnb/workflows/nested.yml",
    ".codebuddy/skills/prototype-handoff/SKILL.md",
    "scripts/workflow/check-pr-issue-contract.mjs",
    "tools/prototype-kit/cli.mjs",
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ]) {
    assert.equal(isInfrastructurePathAllowed(filePath), true, filePath);
  }

  for (const filePath of [
    "apps/mindx/src/pages/space/pc.tsx",
    "apps/sandbox/src/pages/concept.tsx",
    "apps/workshop/src/pages/catalog.tsx",
    "packages/core-data/src/services/record-service/index.ts",
    "packages/ui-components/src/button.tsx",
    "src/index.tsx",
    "runtime.ts",
    ".release-policy.json",
    ".cnbx/workflows/nested.yml",
    "/.cnb/settings.yml",
    ".cnb/../apps/mindx/src/escape.ts",
    "../apps/mindx/src/escape.ts",
  ]) {
    assert.equal(isInfrastructurePathAllowed(filePath), false, filePath);
  }
});

test("retired platform assets are no longer infrastructure allowlist entries", () => {
  for (const filePath of [
    ".orange-ci.yml",
    ".orange-ci-dep.yml",
    ".orange-ci.token",
    "cache.dockerfile",
    "oci/oci-config.yml",
  ]) {
    assert.equal(isInfrastructurePathAllowed(filePath), false, filePath);
  }
});

test("infrastructure none route classifies package assets by nature", () => {
  const allowedPackageAssets = [
    "packages/ui-components/README.md",
    "packages/ui-elements/README.md",
    "packages/ui-components/.business-frozen.json",
    "packages/core-data/architecture.md",
    "packages/core-data/src/services/record-service/index.test.ts",
    "packages/ui-components/src/button.spec.tsx",
    "packages/ui-components/src/button.test.js",
    "packages/ui-components/src/button.spec.jsx",
    "packages/ui-components/src/button.test.mts",
    "packages/ui-components/src/button.spec.cts",
    "packages/ui-components/src/button.test.cjs",
    "apps/mindx/src/pages/drive-page/hooks/use-audio-parse.test.ts",
    "src/bootstrap.spec.mjs",
  ];

  for (const filePath of allowedPackageAssets) {
    assert.equal(isInfrastructurePathAllowed(filePath), true, filePath);
  }

  assert.deepEqual(
    assertInfrastructureChangedPaths([
      "packages/ui-components/README.md",
      "packages/ui-elements/README.md",
      "packages/ui-components/.business-frozen.json",
    ]),
    [
      "packages/ui-components/.business-frozen.json",
      "packages/ui-components/README.md",
      "packages/ui-elements/README.md",
    ],
  );
});

test("infrastructure none route rejects package runtime and lookalike assets", () => {
  for (const filePath of [
    "packages/core-data/src/services/record-service/index.ts",
    "packages/ui-components/src/button.tsx",
    "packages/ui-components/src/dom.js",
    "packages/ui-components/src/dom.jsx",
    "packages/ui-components/src/button.css",
    "packages/ui-components/src/button.less",
    "packages/ui-components/src/icons/add.svg",
    "packages/ui-components/src/button.test-helper.ts",
    "packages/ui-components/src/button.spec-data.ts",
    "packages/ui-components/src/button.test.css",
    "packages/ui-components/src/button.spec.svg",
    "packages/ui-components/src/button.test.json",
    "packages/ui-components/tests/button.fixture.ts",
    "packages/ui-components/package.json",
    "packages/ui-components/.release-policy.json",
    "packages/ui-components/business-frozen.json",
    "packages/ui-components/.business-frozen.json.js",
  ]) {
    assert.equal(isInfrastructurePathAllowed(filePath), false, filePath);
  }
});

test("infrastructure none route fails closed for empty or mixed diffs", () => {
  assert.throws(
    () => assertInfrastructureChangedPaths([]),
    /INFRASTRUCTURE_DIFF_EMPTY/u,
  );
  assert.throws(
    () =>
      assertInfrastructureChangedPaths([
        "docs/a.md",
        "../apps/mindx/src/escape.ts",
      ]),
    /INFRASTRUCTURE_DIFF_FORBIDDEN/u,
  );
  assert.throws(
    () =>
      assertInfrastructureChangedPaths([
        "docs/workflow.md",
        "apps/mindx/src/pages/feature.tsx",
      ]),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*apps\/mindx/u,
  );
  assert.throws(
    () =>
      assertInfrastructureChangedPaths([
        "packages/ui-components/README.md",
        "packages/ui-components/src/button.tsx",
      ]),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*packages\/ui-components\/src\/button\.tsx/u,
  );
  assert.throws(
    () =>
      assertInfrastructureChangedPaths([
        "apps/mindx/src/pages/drive-page/hooks/use-audio-parse.test.ts",
        "apps/mindx/src/pages/drive-page/hooks/use-audio-parse.ts",
      ]),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*use-audio-parse\.ts/u,
  );

  assert.deepEqual(
    assertInfrastructureChangedPaths([
      "docs/workflow.md",
      "scripts/workflow/check.mjs",
    ]),
    ["docs/workflow.md", "scripts/workflow/check.mjs"],
  );
  assert.deepEqual(
    assertInfrastructureChangedPaths([
      ".cnb/settings.yml",
      ".cnb/web_trigger.yml",
      ".cnb/workflows/nested.yml",
    ]),
    [".cnb/settings.yml", ".cnb/web_trigger.yml", ".cnb/workflows/nested.yml"],
  );
});

test("local infrastructure gate includes deletions in the cumulative diff", () => {
  const base = "1".repeat(40);
  const calls = [];
  const changedPaths = resolveChangedPathsBetweenRefs({
    baseRef: "origin/main",
    headRef: "HEAD",
    git(args) {
      calls.push(args);
      if (args[0] === "merge-base") return base;
      if (args[0] === "diff") {
        return "docs/a.md\napps/mindx/src/deleted-feature.ts\n";
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  });

  assert.deepEqual(changedPaths, [
    "docs/a.md",
    "apps/mindx/src/deleted-feature.ts",
  ]);
  assert.deepEqual(calls, [
    ["merge-base", "origin/main", "HEAD"],
    [
      "diff",
      "--no-renames",
      "--name-only",
      "--diff-filter=ACDMRT",
      `${base}..HEAD`,
    ],
  ]);
  assert.throws(
    () => assertInfrastructureChangedPaths(changedPaths),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*deleted-feature/u,
  );
});
