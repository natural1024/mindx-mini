import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { rspack } from "@rspack/core";
import { afterEach, test } from "node:test";
import { createAppConfig } from "../dist/rspack/app.js";
import { getBuildInfo, serializeBuildInfo } from "../dist/rspack/build-info.js";
import { getReleaseVersion } from "../dist/rspack/release-version.js";

const ROOT_DIR = path.resolve("/tmp/mindx-build-config-test");
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PUBLIC_ASSET_BASE_URL = process.env.MINDX_PUBLIC_ASSET_BASE_URL;

function pluginNames(config) {
  return (config.plugins ?? [])
    .filter(Boolean)
    .map((plugin) => plugin.constructor.name);
}

function htmlPluginFilenames(config) {
  return (config.plugins ?? [])
    .filter((plugin) => plugin?.constructor.name === "HtmlRspackPlugin")
    .map((plugin) => plugin._args[0].filename ?? "index.html");
}

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_PUBLIC_ASSET_BASE_URL === undefined) {
    delete process.env.MINDX_PUBLIC_ASSET_BASE_URL;
  } else {
    process.env.MINDX_PUBLIC_ASSET_BASE_URL = ORIGINAL_PUBLIC_ASSET_BASE_URL;
  }
});

test("keeps the existing application entry and HTML defaults", () => {
  process.env.NODE_ENV = "production";
  process.env.MINDX_PUBLIC_ASSET_BASE_URL =
    "https://download.codebuddy.cn/web/library";

  const config = createAppConfig({ rootDir: ROOT_DIR });

  assert.deepEqual(config.entry, {
    main: path.join(ROOT_DIR, "src/index.ts"),
  });
  assert.ok(pluginNames(config).includes("HtmlRspackPlugin"));
  assert.ok(pluginNames(config).includes("SyncPublicArtifactsPlugin"));
});

test("emits MindX production templates under server-html", () => {
  process.env.NODE_ENV = "production";
  process.env.MINDX_PUBLIC_ASSET_BASE_URL =
    "https://download.codebuddy.cn/web/library";

  const config = createAppConfig({
    rootDir: ROOT_DIR,
    projectName: "mindx",
    htmlTemplate: "src/template/pc.html",
    extraHtmlTemplates: [{ template: "src/template/mobile.html" }],
  });

  assert.deepEqual(htmlPluginFilenames(config), [
    "server-html/pc.html",
    "server-html/mobile.html",
  ]);
  assert.equal(
    config.output.publicPath,
    "https://download.codebuddy.cn/web/library/",
  );
});

test("fails a MindX production build without an explicit asset base URL", () => {
  process.env.NODE_ENV = "production";
  delete process.env.MINDX_PUBLIC_ASSET_BASE_URL;

  assert.throws(
    () =>
      createAppConfig({
        rootDir: ROOT_DIR,
        projectName: "mindx",
        htmlTemplate: "src/template/pc.html",
      }),
    /MINDX_PUBLIC_ASSET_BASE_URL/,
  );
});

test("rejects a non-URL MindX production asset base", () => {
  process.env.NODE_ENV = "production";
  process.env.MINDX_PUBLIC_ASSET_BASE_URL = "relative/path";

  assert.throws(
    () => createAppConfig({ rootDir: ROOT_DIR }),
    /MINDX_PUBLIC_ASSET_BASE_URL must be an absolute URL/,
  );
});

test("keeps static-site HTML at the dist root without the MindX CDN input", () => {
  process.env.NODE_ENV = "production";
  delete process.env.MINDX_PUBLIC_ASSET_BASE_URL;

  for (const projectName of ["sandbox", "workshop"]) {
    const config = createAppConfig({
      rootDir: ROOT_DIR,
      projectName,
      htmlTemplate: "src/template/index.html",
      staticSite: true,
    });

    assert.deepEqual(htmlPluginFilenames(config), ["index.html"]);
    assert.equal(config.output.publicPath, "/");
  }
});

test("supports a no-entry no-HTML build while retaining splitChunks", () => {
  process.env.NODE_ENV = "production";

  const config = createAppConfig({
    rootDir: ROOT_DIR,
    entry: false,
    htmlTemplate: false,
    emitPublicArtifacts: false,
    publicPath: "auto",
  });

  assert.deepEqual(config.entry, {});
  assert.ok(!pluginNames(config).includes("HtmlRspackPlugin"));
  assert.ok(!pluginNames(config).includes("SyncPublicArtifactsPlugin"));
  assert.ok(!pluginNames(config).includes("CopyRspackPlugin"));
  assert.equal(config.output.publicPath, "auto");
  assert.equal(config.optimization.splitChunks.chunks, "all");
  assert.equal(config.optimization.splitChunks.minSize, 100 * 1024);
  assert.equal(config.optimization.splitChunks.maxSize, 2 * 1024 * 1024);
  assert.equal(config.optimization.splitChunks.maxAsyncSize, 2 * 1024 * 1024);
  assert.equal(config.optimization.splitChunks.maxInitialSize, 2 * 1024 * 1024);
});

test("keeps React refresh in development when public artifact sync is off", () => {
  process.env.NODE_ENV = "development";

  const config = createAppConfig({
    rootDir: ROOT_DIR,
    emitPublicArtifacts: false,
  });

  assert.ok(pluginNames(config).includes("ReactRefreshRspackPlugin"));
  assert.ok(!pluginNames(config).includes("SyncPublicArtifactsPlugin"));
  assert.ok(!pluginNames(config).includes("CopyRspackPlugin"));
});

test("reads build metadata from the app checkout and supports detached HEAD", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mindx-build-info-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-b", "feature/build-info");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const info = getBuildInfo(cwd);
  assert.equal(info.gitBranch, "feature/build-info");
  assert.equal(info.gitCommit, git("rev-parse", "--short", "HEAD"));
  assert.match(info.buildTime, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(info.gitCommitTime, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  git("checkout", "--detach", "--quiet");
  const previousBranch = process.env.CNB_BRANCH;
  process.env.CNB_BRANCH = "feature/build-info";
  t.after(() => {
    if (previousBranch === undefined) delete process.env.CNB_BRANCH;
    else process.env.CNB_BRANCH = previousBranch;
  });
  assert.equal(getBuildInfo(cwd).gitBranch, "feature/build-info");
});

test("build metadata prefers CNB and retains generic CI and local fallbacks", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mindx-build-ci-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    CNB_BRANCH: "feature/cnb",
    CI_COMMIT_REF_NAME: "feature/generic",
    CNB_COMMIT: "cnb-commit",
    CI_COMMIT_SHA: "generic-commit",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  assert.equal(getBuildInfo(cwd).gitBranch, "feature/cnb");
  assert.equal(getBuildInfo(cwd).gitCommit, "cnb-commit");
  assert.match(
    getReleaseVersion({ projectName: "mindx", cwd }),
    /-mindx-feature-cnb-empty-hash$/,
  );

  delete process.env.CNB_BRANCH;
  delete process.env.CNB_COMMIT;
  assert.equal(getBuildInfo(cwd).gitBranch, "feature/generic");
  assert.equal(getBuildInfo(cwd).gitCommit, "generic-commit");
  assert.match(
    getReleaseVersion({ projectName: "mindx", cwd }),
    /-mindx-feature-generic-empty-hash$/,
  );

  delete process.env.CI_COMMIT_REF_NAME;
  assert.match(
    getReleaseVersion({ projectName: "mindx", cwd }),
    /-mindx-empty-branch-empty-hash$/,
  );
});

test("falls back without Git and safely serializes inline scripts", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mindx-build-info-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const key of [
    "CNB_BRANCH",
    "CI_COMMIT_REF_NAME",
    "CNB_COMMIT",
    "CI_COMMIT_SHA",
  ]) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const info = getBuildInfo(cwd);
  assert.equal(info.gitBranch, "unknown");
  assert.equal(info.gitCommit, "unknown");
  assert.equal(info.gitCommitTime, "unknown");
  info.gitBranch = 'feature/</script><script>alert("x")</script>';
  const json = serializeBuildInfo(info);
  assert.ok(!json.includes("<"));
  assert.deepEqual(JSON.parse(json), info);
});

test("emits executable build info in both production HTML shells before app JS", async (t) => {
  process.env.NODE_ENV = "production";
  process.env.MINDX_PUBLIC_ASSET_BASE_URL =
    "https://static.workbuddy.cn/web/library";
  const outputPath = mkdtempSync(path.join(tmpdir(), "mindx-build-html-"));
  t.after(() => rmSync(outputPath, { recursive: true, force: true }));
  const rootDir = fileURLToPath(
    new URL("../../../apps/mindx/", import.meta.url),
  );
  const config = createAppConfig({
    rootDir,
    htmlTemplate: "src/template/pc.html",
    extraHtmlTemplates: [{ template: "src/template/mobile.html" }],
  });
  // Compile the actual production templates without the unrelated application bundle.
  const plugins = config.plugins.filter(
    (plugin) => plugin?.constructor.name === "HtmlRspackPlugin",
  );
  const compiler = rspack({
    mode: "production",
    entry: {},
    plugins,
    output: { path: outputPath, publicPath: config.output.publicPath },
  });
  await new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) reject(error || closeError);
        else if (stats.hasErrors()) reject(new Error(stats.toString()));
        else resolve();
      });
    });
  });
  const infos = [];
  for (const name of ["pc", "mobile"]) {
    const html = readFileSync(
      path.join(outputPath, `server-html/${name}.html`),
      "utf8",
    );
    assert.ok(!html.includes("<%="));
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const context = { window: {} };
    runInNewContext(script, context);
    const info = JSON.parse(JSON.stringify(context.window.__BUILD_INFO__));
    assert.deepEqual(Object.keys(info), [
      "buildTime",
      "gitBranch",
      "gitCommit",
      "gitCommitTime",
    ]);
    assert.notEqual(info.gitCommit, "unknown");
    assert.ok(context.window.__globalReleaseVersion);
    infos.push(info);
  }
  assert.deepEqual(infos[0], infos[1]);
});

test("skips the node_modules downgrade rule when requested", () => {
  process.env.NODE_ENV = "production";
  process.env.MINDX_PUBLIC_ASSET_BASE_URL =
    "https://download.codebuddy.cn/web/library";

  const downgradeRules = (config) =>
    (config.module.rules ?? []).filter(
      (rule) => rule.use?.options?.jsc?.target === "es2019",
    );

  const withDowngrade = createAppConfig({ rootDir: ROOT_DIR });
  assert.ok(downgradeRules(withDowngrade).length > 0);

  const withoutDowngrade = createAppConfig({
    rootDir: ROOT_DIR,
    skipNodeModulesDowngrade: true,
  });
  assert.equal(downgradeRules(withoutDowngrade).length, 0);
});
