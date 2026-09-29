import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("release pipeline keeps PR checks secret-free and publishing strictly ordered", async () => {
  const config = await readFile(".ci/mindx-release.yml", "utf8");
  const prStart = config.indexOf(".mindx-release-pr:");
  const publishStart = config.indexOf(".mindx-release-publish:");
  const prBlock = config.slice(prStart, publishStart);
  const publishBlock = config.slice(publishStart);

  assert(!prBlock.includes("genie/secret"));
  assert(!prBlock.includes("docker push"));
  assert(!prBlock.includes("coscmd upload"));
  assert(prBlock.includes(".cnb.yml"));
  assert(prBlock.includes("scripts/deploy/**"));

  const orderedMarkers = [
    "Generate immutable release variables",
    "build once",
    "Verify local release artifacts",
    "Upload immutable static assets",
    "Verify both COS listings and public CDN",
    "smoke-test the verified runtime image",
    "push the immutable runtime image",
    "Output delivery contract",
  ];
  let cursor = -1;
  for (const marker of orderedMarkers) {
    const next = publishBlock.indexOf(marker);
    assert(
      next > cursor,
      `release stage is missing or out of order: ${marker}`,
    );
    cursor = next;
  }
  assert.match(publishBlock, /expires: 10800/);
  assert.match(publishBlock, /timeout: 10800/);
  assert.match(publishBlock, /cancel-in-wait: true/);
  assert.doesNotMatch(publishBlock, /cancel-in-progress/);
  assert.match(
    config,
    /env: &mindx-release-env\n[\s\S]*?NX_SKIP_NX_CACHE: "1"/,
  );
  assert.match(publishBlock, /env: \*mindx-release-env/);
  assert.match(
    publishBlock,
    /genie\/secret\/-\/blob\/main\/mindx-release-cos\.yaml/,
  );
  assert.match(
    publishBlock,
    /genie\/secret\/-\/blob\/main\/mindx-release-tcr\.yaml/,
  );
  assert.doesNotMatch(publishBlock, /genie\/secret\/-\/blob\/main\/cos\.yaml/);
  assert.doesNotMatch(
    publishBlock,
    /genie\/secret\/-\/blob\/main\/tcr-old\.yaml/,
  );
  assert(
    publishBlock.includes("coscmd -b acc-1258344699 list -r -a"),
    "primary COS verification must list every uploaded object",
  );
  assert(
    publishBlock.includes("coscmd -b client-pkg-1258344699 list -r -a"),
    "secondary COS verification must list every uploaded object",
  );
  assert.doesNotMatch(publishBlock, /notify the release group/);
  assert.doesNotMatch(publishBlock, /MINDX_VIBE_WEBHOOK_KEY/);
  assert.doesNotMatch(publishBlock, /qyapi\.weixin\.qq\.com/);
  assert.doesNotMatch(publishBlock, /wecom-release\.json/);
});

test("one push publishes both regions with separate locks and Singapore credentials", async () => {
  const config = await readFile(".ci/mindx-release.yml", "utf8");
  const international = config.slice(
    config.indexOf(".mindx-release-publish-international:"),
    config.indexOf("\nmain:"),
  );

  assert.match(
    config,
    /key: mindx-release-\$CNB_BRANCH-\$MINDX_RELEASE_REGION/,
  );
  assert.match(
    config,
    /--pr --sha "\$CNB_PULL_REQUEST_SHA" --region "\$MINDX_RELEASE_REGION"/,
  );
  assert.match(
    config,
    /--release --sha "\$CNB_COMMIT" --region "\$MINDX_RELEASE_REGION"/,
  );
  assert.match(
    config,
    /"\(staging\|release\/\*\)":\n  push:\n    - \*mindx-release-publish\n    - \*mindx-release-publish-international/,
  );
  assert.match(international, /<<: \*mindx-release-publish\n/);
  assert.match(international, /MINDX_RELEASE_REGION: international/);
  assert.match(international, /mindx-release-cos-sg\.yaml/);
  assert.match(international, /mindx-release-tcr-sg\.yaml/);
  assert.match(international, /test "\$COS_BUCKET" = "codebuddy-1328495429"/);
  assert.match(
    international,
    /test "\$COS_ENDPOINT" = "cos\.ap-singapore\.myqcloud\.com"/,
  );
  assert.match(international, /coscmd -b "\$COS_BUCKET" list -r -a/);
  assert.doesNotMatch(
    international,
    /acc-1258344699|client-pkg-1258344699|mindx-release-cos\.yaml|mindx-release-tcr\.yaml/,
  );
  const markers = [
    "- *mindx-release-variables",
    "- *mindx-release-build",
    "- *mindx-release-verify-local",
    "Upload immutable static assets",
    "Verify Singapore COS listing and public CDN",
    "- *mindx-release-smoke",
    "- <<: *mindx-release-push-image",
    "- *mindx-release-delivery",
  ];
  let cursor = -1;
  for (const marker of markers) {
    const next = international.indexOf(marker);
    assert(
      next > cursor,
      `international release stage is missing or out of order: ${marker}`,
    );
    cursor = next;
  }
  const prEvents = config.slice(
    config.indexOf("\nmain:"),
    config.indexOf('\n"(staging|release/*)":'),
  );
  assert.match(prEvents, /<<: \*mindx-release-pr/);
  assert.match(prEvents, /MINDX_RELEASE_REGION: international/);
  assert.doesNotMatch(prEvents, /genie\/secret|docker push|coscmd/);
  assert.doesNotMatch(prEvents, /^  push:/m);
  assert.doesNotMatch(config, /"\(main\|release\/\*\)":/);
});

test("CNB owns the release pipeline after legacy platform retirement", async () => {
  const cnb = await readFile(".cnb.yml", "utf8");
  assert.match(cnb, /\.ci\/mindx-release\.yml/);
  assert.doesNotMatch(cnb, /oci\/scripts|ORANGE_/);
  for (const legacyPath of [
    ".orange-ci.yml",
    ".orange-ci-dep.yml",
    ".orange-ci.token",
    "oci",
    "cache.dockerfile",
    "packages/dws-plugins",
    "tools/script/get-base-commit.ts",
    "tools/script/get-release-project.ts",
    "tools/script/get-time-stamp.ts",
  ]) {
    await assert.rejects(access(legacyPath), { code: "ENOENT" }, legacyPath);
  }

  const entrypoints = [
    cnb,
    await readFile(".husky/pre-commit", "utf8"),
    await readFile(".husky/pre-push", "utf8"),
    await readFile(".husky/commit-msg", "utf8"),
    await readFile("tools/prototype-kit/workbench.mjs", "utf8"),
  ];
  const scriptPaths = new Set(
    entrypoints.flatMap((source) =>
      [...source.matchAll(/scripts\/workflow\/[a-z0-9-]+\.mjs/g)].map(
        ([file]) => file,
      ),
    ),
  );
  assert(
    scriptPaths.size > 10,
    "current entrypoints must retain workflow checks",
  );
  await Promise.all([...scriptPaths].map((file) => access(file)));
});

test("release build image installs coscmd in an isolated Python environment", async () => {
  const dockerfile = await readFile(".ci/mindx-release.dockerfile", "utf8");

  assert.match(dockerfile, /python3 -m venv \/opt\/coscmd/);
  assert.match(
    dockerfile,
    /\/opt\/coscmd\/bin\/pip install --no-cache-dir coscmd/,
  );
  assert.match(dockerfile, /ENV PATH="\/opt\/coscmd\/bin:\$\{PATH\}"/);
  assert.doesNotMatch(dockerfile, /pip3 install --no-cache-dir coscmd/);
  assert.doesNotMatch(dockerfile, /--break-system-packages/);
});
