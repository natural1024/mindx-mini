import { createRequire } from "node:module";
import fsSync from "node:fs";
import path from "node:path";
import type { RspackOptions, RuleSetRule } from "@rspack/core";

/**
 * smart-doc-editor 本地源码联调 — rspack 配置变换器
 *
 * ## 为什么是「配置变换器」而不是 rspack plugin？
 *
 * rspack `plugin.apply(compiler)` 风格的真插件是给 runtime / asset / emit 等
 * 编译期阶段用的，对 `resolve.alias` / `module.rules` / `conditionNames` 这类
 * **配置形状**改动无能为力。link 联调要做的全是配置 patch，所以本模块以
 * `(config) => config` 函数形态存在，由 createAppConfig 在末尾按需调用。
 *
 * ## 触发条件
 *
 * 仓根目录存在 `.smart-doc-editor-local` 文件且其首行为合法绝对路径，且该
 * 路径下含 `packages/editor/src` 子目录时，本模块在 dev 模式下注入所有
 * link 联调所需的 patch；否则原样返回 config。
 *
 * 不需要任何环境变量、命令行参数。开关由 `.smart-doc-editor-local` 这一个
 * 个人本地文件唯一控制（已加入 `.gitignore`，每人独立）。
 *
 * ## 注入的 patch
 *
 * 1. `resolve.conditionNames` 追加 `'source'` —— 让 rspack 命中 smart-doc-*
 *    包 `package.json.exports` 里的 `"source": "./src/index.ts"` 条件。
 * 2. `resolve.alias` 追加 5 个 `@editor/*` 别名 —— 解析 editor 仓 root
 *    `tsconfig.base.json#paths` 的内部互引（详见 ALIAS_SUBDIRS 注释）。
 * 3. `resolve.alias` 强制 dedupe `react` / `react-dom` —— 防止 editor 仓
 *    worktree 自带的 react@17 与 mindx 的 react@18 共存导致 hooks 失效。
 * 4. `module.rules` 中 swc loader 的 `exclude` 包一层，放行 editor 仓源码
 *    路径（既不在 node_modules 也不在 `@mindx/*` 下，默认会被跳过编译）。
 * 5. `module.rules` 中 svg 规则改造为 `oneOf`：editor 仓 issuer 的 svg 走
 *    `@svgr/webpack` 转 React 组件（命名导出 `ReactComponent`），其余兜底
 *    `asset/resource`（mindx 自家 / docs-design-resources 等老资源包的
 *    URL 默认导出用法不受影响）。
 *
 * ## 设计取向
 *
 * - **零侵入**：未配置 `.smart-doc-editor-local` 时函数早返 config，与无此
 *   模块完全等价。`app.ts` 只多出一行调用。
 * - **dev only**：`createAppConfig` 仅在 `isDev === true` 时调用本模块，
 *   生产构建路径完全不受影响。
 * - **唯一真相源**：editor 仓 root tsconfig.base.json paths / rolldown.config.ts
 *   svgrTransform 配置是这边的对齐目标；editor 仓变了，本文件按列表项更新。
 */

// editor 仓 root tsconfig.base.json#compilerOptions.paths 完整列表
// editor 仓新增 @editor/* paths 项时，本数组同步增加。
const ALIAS_SUBDIRS = ["record", "core", "view", "i18n", "logger"] as const;

// SVGR loader 绝对路径
//
// 必须从 build-config 自身位置 resolve，而不是让 rspack 在入口 app 的
// node_modules 中查找：pnpm 严格模式下 @svgr/webpack 仅装在
// tools/build-config/node_modules，不会 hoist 到 apps 下，rspack 站在 app
// 视角解析裸包名会报 "Unable to resolve loader @svgr/webpack"。
//
// createRequire(import.meta.url) 让我们从 build-config 包根
// （dist/rspack/plugins/smart-doc-editor-local.js）调用
// require.resolve("@svgr/webpack")，沿 tools/build-config/node_modules 链
// 找到实际安装位置。
//
// 解析失败抛错而非静默：只要走到这一步，就强依赖此 loader。
const SVGR_LOADER_PATH = (() => {
  const requireFromHere = createRequire(import.meta.url);
  return requireFromHere.resolve("@svgr/webpack");
})();

/**
 * 解析 .smart-doc-editor-local 中保存的 smart-doc-editor 仓绝对路径。
 *
 * 仓库可叫任何名字（smartcanvas-editor / smart-doc-editor / 任意 worktree 子目录），
 * 因为本模块所有判定都基于该绝对路径前缀比对，不依赖目录命名。
 *
 * 触发条件：仓根目录（沿 rootDir 上行查找）存在该文件。文件不存在或脏配置
 * 都返回 undefined，调用方用此区分"link 模式开 / 关"。
 *
 * 文件格式：单行绝对路径（带或不带尾随 / 都接受），其它内容视为无效。
 *
 * 路径校验：必须是绝对路径 + `<path>/packages/editor/src` 存在。
 */
function readSmartDocEditorLocalPath(rootDir: string): string | undefined {
  // mindx workspace 根 = rootDir 的上若干级，但保险起见沿父链上溯，最多 6 层
  // 兼容 root 之外的入口（比如未来某个 tools/* 也跑 dev）
  let dir = rootDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, ".smart-doc-editor-local");
    if (fsSync.existsSync(candidate)) {
      try {
        const content = fsSync.readFileSync(candidate, "utf-8").trim();
        const firstLine = content.split(/\r?\n/)[0]?.trim();
        if (!firstLine || !path.isAbsolute(firstLine)) return undefined;
        // path.resolve 归一化：消除 .. / 多余分隔符，确保后续 startsWith
        // 前缀比对能正确匹配 rspack 解析出的真实绝对路径
        const resolved = path.resolve(firstLine);
        if (!fsSync.existsSync(path.join(resolved, "packages/editor/src"))) {
          return undefined;
        }
        return resolved.replace(/\/+$/, "");
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * 构造 link 模式下的 alias map：5 个 @editor/* + react / react-dom dedupe。
 */
function buildAliasMap(
  editorRepoRoot: string,
  rootDir: string,
): Record<string, string> {
  const alias: Record<string, string> = {};

  // 与 editor 仓 root tsconfig.base.json#compilerOptions.paths 完全对齐
  for (const sub of ALIAS_SUBDIRS) {
    alias[`@editor/${sub}`] = path.join(
      editorRepoRoot,
      "packages/editor/src",
      sub,
      "index.ts",
    );
  }

  // React / ReactDOM 强制 dedupe 到 mindx 自身的 node_modules
  //
  // 直链 src 时，rspack 从 editor 仓 src 文件解析 `import 'react'` 会沿 Node
  // 模块解析规则向上找最近的 node_modules——命中 editor 仓 worktree 自己的
  // react@17（editor 仓 devDependencies 里固定 17.0.0 用于自身测试）。mindx
  // 这边业务代码用的是 react@18，于是同一个 page 出现两份 React 实例：
  // 各自维护 currentDispatcher，hooks 注册到错的那份 → "Invalid hook call"。
  //
  // alias 用绝对**目录**路径（不带 $），rspack 自动覆盖所有子路径
  // （react/jsx-runtime / react-dom/client / react-dom/server 等）。
  const requireFromMindxRoot = createRequire(
    path.join(rootDir, "package.json"),
  );
  try {
    alias["react"] = path.dirname(
      requireFromMindxRoot.resolve("react/package.json"),
    );
    alias["react-dom"] = path.dirname(
      requireFromMindxRoot.resolve("react-dom/package.json"),
    );
  } catch {
    // 解析失败（理论上不会）就跳过 dedupe，至少 @editor/* 还能用
  }

  return alias;
}

/**
 * 把绝对路径规范化为可作前缀比对的形态：尾部追加分隔符，避免误命中相邻同名目录
 * （如 `/a/b/foo` 与 `/a/b/foo-bar` 都以 `/a/b/foo` 为前缀，但加 sep 后 `/a/b/foo/`
 * 仅匹配前者）。
 */
function withTrailingSep(absPath: string): string {
  return absPath.endsWith(path.sep) ? absPath : absPath + path.sep;
}

/**
 * 从一个匹配多个图片扩展名的合并 RegExp（如 `/\.(svg|png|jpe?g|gif|webp|ico)$/`）
 * 中"剥离 svg"，返回剩余扩展名构成的新 RegExp。
 *
 * 用途：mindx 主配置把 svg 与 png/jpg/... 写在同一条 image rule 里，plugin 接管
 * svg 时不能整条替换（否则其它扩展名失去匹配），需要把这条 rule 拆成两条：
 *   1. 一条仅 .svg → 走 SVGR oneOf
 *   2. 原 rule 但 test 去掉 svg
 *
 * 实现策略（保持简单可靠）：
 *   - 先尝试匹形如 `/\.(svg|png|...|ico)$/i?` 的"合并形态"，从分组中过滤 svg
 *   - 仅匹 svg（如 `/\.svg$/`、`/\.(svg)$/`）→ 返回 null（调用方该整条替换）
 *   - 不识别的复杂形态保守保留 svg → 返回原正则（不破坏未知配置）
 *
 * 不需要做完整正则解析——只覆盖 mindx app.ts 已有的两种典型写法。
 */
function stripSvgFromImageRegex(re: RegExp): RegExp | null {
  const src = re.source;
  // 只处理结尾是 `$` 的合并形态，规避复杂边界
  // 形式 1：/\.svg$/  或  /\.(svg)$/
  if (src === "\\.svg$" || src === "\\.(svg)$") return null;
  // 形式 2：/\.(svg|png|...)$/
  const m = src.match(/^\\\.\(([^)]+)\)\$$/);
  if (!m) return re; // 不识别的形态保守返回原 regex，宁可让其它扩展名也走 SVGR
  const exts = m[1].split("|").filter((e) => e.toLowerCase() !== "svg");
  if (exts.length === 0) return null;
  if (exts.length === 1) {
    return new RegExp(`\\.${exts[0]}$`, re.flags);
  }
  return new RegExp(`\\.(${exts.join("|")})$`, re.flags);
}

/**
 * 构造 svg 规则：editor 仓内 import 走 SVGR，其余兜底 asset/resource。
 *
 * 替代 `app.ts` 中原本的单一 `test: /\.svg$/, type: 'asset/resource'` 规则。
 *
 * 用 `oneOf` + `issuer` 函数判定做分流：
 * - 引入方文件路径以 editorRepoRoot 为前缀 → `@svgr/webpack`（与 editor 仓
 *   rolldown.config.ts svgrTransform 配置完全对齐：exportType 'named' /
 *   namedExport 'ReactComponent' / jsxRuntime 'classic' / svgo 保留 viewBox
 *   + 关闭 cleanupIds）
 * - 其余 svg → asset/resource（mindx 自家 + docs-design-resources 维持
 *   `import url from "x.svg"` 默认导出 = URL 字符串语义不变）
 *
 * 用 issuer 锁定**引入方**而非**被引入文件**，是因为 editor 仓的 svg 文件
 * 路径会同时匹两条规则——issuer 才能精确区分谁在 import。
 *
 * **判定基于 .smart-doc-editor-local 中保存的绝对路径前缀**，不依赖任何目录
 * 命名习惯（仓库可叫任何名字、可在 worktree 子目录、可放在用户家目录任何位置）。
 */
function buildSvgRule(editorRepoRoot: string): RuleSetRule {
  const editorRepoPrefix = withTrailingSep(editorRepoRoot);
  return {
    test: /\.svg$/,
    oneOf: [
      {
        issuer: (resourcePath: string) =>
          resourcePath.startsWith(editorRepoPrefix),
        use: [
          {
            loader: SVGR_LOADER_PATH,
            options: {
              exportType: "named",
              namedExport: "ReactComponent",
              jsxRuntime: "classic",
              svgoConfig: {
                plugins: [
                  {
                    name: "preset-default",
                    params: {
                      overrides: { removeViewBox: false },
                    },
                  },
                  { name: "cleanupIds", active: false },
                ],
              },
            },
          },
        ],
      },
      {
        type: "asset/resource",
      },
    ],
  };
}

/**
 * 把现有 swc loader 的 exclude 函数包一层，放行若干本地仓源码路径前缀。
 *
 * 直链联调时本地仓的源文件物理路径以 `repoRoots` 中任一为前缀。这些路径既不在
 * node_modules 也不在 @mindx/，原始 exclude 会判定为外部依赖跳过 swc，导致
 * TS 源码不被编译。
 *
 * 复用原 exclude 而不是替换，是为了保留它对 node_modules / .d.ts 的判定。
 *
 * 多个 prefix 支持：editor / smart-engine 两个 plugin 各自调一次本函数，
 * 后者 wrap 的对象是已经被前者 wrap 过的版本——天然组合，无需共享状态。
 */
type ExcludeFn = (modulePath: string) => boolean;

function wrapSwcExclude(
  original: ExcludeFn,
  ...repoRoots: string[]
): ExcludeFn {
  const prefixes = repoRoots.map(withTrailingSep);
  return (modulePath: string): boolean => {
    for (const p of prefixes) {
      if (modulePath.startsWith(p)) return false;
    }
    return original(modulePath);
  };
}

/**
 * 查找 workspace 根目录（包含 package.json 且其 pnpm.overrides 字段存在的目录）。
 * 沿 rootDir 上溯，最多 6 层。
 */
function findWorkspaceRoot(rootDir: string): string | undefined {
  let dir = rootDir;
  for (let depth = 0; depth < 6; depth++) {
    const pkgPath = path.join(dir, "package.json");
    if (fsSync.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(pkgPath, "utf-8"));
        if (pkg?.pnpm?.overrides) return dir;
      } catch {
        // 继续上溯
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * 检查 pnpm.overrides 中是否存在以给定前缀开头且值为 link: 协议的条目。
 * 返回 true 表示当前处于 link 联调模式，false 表示已切回 npm。
 */
function isLinkOverrideActive(
  workspaceRoot: string,
  pkgPrefix: string,
): boolean {
  try {
    const pkg = JSON.parse(
      fsSync.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"),
    );
    const overrides: Record<string, string> = pkg?.pnpm?.overrides ?? {};
    for (const [key, value] of Object.entries(overrides)) {
      if (key.startsWith(pkgPrefix) && String(value).startsWith("link:")) {
        return true;
      }
    }
  } catch {
    // 解析失败视为非 link 模式
  }
  return false;
}

/**
 * 联调模式入口守护：统一执行"标记文件 → workspace root → overrides link: 校验"
 * 并通过彩色终端横幅提示联调状态。
 *
 * 返回 `repoRoot` 表示联调模式已激活；返回 `undefined` 表示跳过（原因透明）。
 */
function tryEnterLinkMode(
  repoRoot: string | undefined,
  rootDir: string,
  pkgPrefix: string,
  label: string,
  description: string,
): string | undefined {
  if (!repoRoot) return undefined;

  // 双重校验：标记文件存在 ≠ link 模式激活，还需确认 overrides 是否 link:
  const workspaceRoot = findWorkspaceRoot(rootDir);
  if (!workspaceRoot || !isLinkOverrideActive(workspaceRoot, pkgPrefix)) {
    return undefined;
  }

  const T = "\x1b[33m";
  const G = "\x1b[32m";
  const R = "\x1b[0m";
  const line = "\x1b[36m" + "─".repeat(50) + R;

  console.log(
    `\n${line}\n` +
      `  ${T}🔗 ${label}${R}\n` +
      `  本地仓: ${G}${repoRoot}${R}\n` +
      `  ${description}\n` +
      `${line}\n`,
  );

  return repoRoot;
}

/**
 * dev 模式下的总入口：未启用 link 联调时原样返回 config，启用时注入所有 patch。
 *
 * 启用判定需要同时满足两个条件：
 * 1. `.smart-doc-editor-local` 文件存在且内容合法（记录本地仓路径）
 * 2. `package.json` 的 `pnpm.overrides` 中至少有一个 `@tencent/smart-doc-*`
 *    条目使用 `link:` 协议
 *
 * 条件 2 确保"切回 npm"（overrides 改回 `catalog:`）后，即使标记文件还在，
 * rspack 构建也不会错误进入 link 模式。
 *
 * **本模块仅应在 dev 模式下被调用**。生产构建无需也不应该走这条路径——
 * `createAppConfig` 已用 `if (isDev)` 条件守卫。
 */
export function applySmartDocEditorLocalDevtools(
  config: RspackOptions,
  rootDir: string,
): RspackOptions {
  const editorRepoRoot = tryEnterLinkMode(
    readSmartDocEditorLocalPath(rootDir),
    rootDir,
    "@tencent/smart-doc-",
    "SmartDoc Editor 联调模式已启用",
    "rspack 将使用 source 入口 + 本地 alias 解析",
  );
  if (!editorRepoRoot) return config;

  // 1. resolve.conditionNames：在原列表前部追加 'source'
  //    放在 'development' 之后是因为 mindx 自家 @mindx/* 包用 development 条件，
  //    smart-doc-editor 仓用 source 条件，二者互不冲突；都放前面优先于 import。
  const resolve = config.resolve ?? {};
  const existingConditions = resolve.conditionNames ?? [
    "import",
    "require",
    "module",
    "style",
    "default",
  ];
  const conditionNames = existingConditions.includes("source")
    ? existingConditions
    : ["source", ...existingConditions];

  // 2. resolve.alias：合并 link 模式专用别名
  const linkAlias = buildAliasMap(editorRepoRoot, rootDir);
  const existingAlias = resolve.alias ?? {};
  const mergedAlias = Array.isArray(existingAlias)
    ? existingAlias // 极少见的数组形态保留不动，附加无意义
    : { ...existingAlias, ...linkAlias };

  // 3. module.rules：替换 svg 规则 + 包装 swc loader 的 exclude
  const moduleConfig = config.module ?? {};
  const originalRules = moduleConfig.rules ?? [];

  // rspack 的 rules 元素是含 Falsy 的宽 union；TS 在 flatMap 回调签名上要求
  // 返回值与原元素类型对齐。我们的回调实际只返回 RuleSetRule[] | undefined[]，
  // 所以把 originalRules 先 cast 到一个不含 Falsy 的简化类型签，写起来干净。
  type RawRule = RuleSetRule | undefined | null;
  const rawRules = (originalRules as readonly RawRule[]) ?? [];

  const patchedRules = rawRules.flatMap<RawRule>((rule) => {
    if (!rule || typeof rule !== "object") return [rule];
    const r = rule as RuleSetRule;

    // 识别"含 svg 的图片规则"：test 是 RegExp 且对 .svg 命中
    //
    // mindx app.ts 的合并写法 `test: /\.(svg|png|jpe?g|gif|webp|ico)$/` 也会
    // 命中——必须**只**接管 svg，其它扩展名（png/jpg/...）继续保留原 asset/resource
    // 行为，否则它们会失去 rule 匹配，被 rspack 当 JS 解析后崩。
    //
    // 处置：
    // - 若原 test 仅匹配 .svg（含简单的 /\.svg$/）→ 整条替换为 SVGR oneOf
    // - 若原 test 同时匹配其它扩展名 → 拆成两条：
    //     1) 新 SVGR oneOf 规则（仅 .svg）
    //     2) 原 rule 但 test 改为去掉 svg 后的剩余扩展名集合
    if (r.test instanceof RegExp && r.test.test("foo.svg")) {
      // 已被 link patch 过（含 oneOf 且 test 是 /\.svg$/）就不重复处理
      if (Array.isArray(r.oneOf) && r.test.toString() === "/\\.svg$/") {
        return [r];
      }
      const remaining = stripSvgFromImageRegex(r.test);
      const svgPart = buildSvgRule(editorRepoRoot);
      // remaining 为 null 表示原 rule 仅匹 svg，直接替换
      if (remaining === null) return [svgPart];
      // 否则保留原 rule 但 test 改为去除 svg 后的扩展名集
      return [svgPart, { ...r, test: remaining }];
    }

    // 识别 swc loader 规则：test 匹配 .ts/.tsx 且 use.loader 是 builtin:swc-loader
    const looksLikeSwc =
      r.test instanceof RegExp &&
      r.test.test("foo.ts") &&
      typeof r.use === "object" &&
      r.use !== null &&
      !Array.isArray(r.use) &&
      "loader" in r.use &&
      String((r.use as { loader: string }).loader).includes("swc-loader");
    if (looksLikeSwc && typeof r.exclude === "function") {
      return [
        {
          ...r,
          exclude: wrapSwcExclude(r.exclude as ExcludeFn, editorRepoRoot),
        },
      ];
    }
    return [r];
  });

  return {
    ...config,
    resolve: {
      ...resolve,
      conditionNames,
      alias: mergedAlias,
    },
    module: {
      ...moduleConfig,
      // patchedRules 元素与 originalRules 同源（含可能的 Falsy 兜底），但 flatMap
      // 推断丢失了 union 信息，这里用 cast 还原 rspack 期望的 rules 类型。
      rules: patchedRules as unknown as typeof moduleConfig.rules,
    },
  };
}

// ============================================================================
// smart-engine 本地源码联调
// ============================================================================
//
// 与 smart-doc-editor 类似，但形态更简单：smart-engine 是单包，纯 TS，仓内
// `package.json` 没有 exports 字段（用传统的 main/module/types），所以无法靠
// `conditionNames` 切到 src——改用 `resolve.alias` 把整个包路径直接重定向到
// 本地仓的 src。
//
// 触发条件：仓根目录存在 `.smart-engine-local` 文件。其它行为约定（gitignore /
// dev only / 早返透传）与 smart-doc-editor 完全一致。
//
// 与 editor plugin **完全独立**：可以分别开关，可以同时开。两个 plugin 在
// createAppConfig 末尾被依次调用——后者拿到的是前者已 patch 过的 config，叠加
// 修改而已。

/**
 * 解析 .smart-engine-local 中保存的 smart-engine 仓绝对路径。
 *
 * 形态约定与 .smart-doc-editor-local 完全一致：单行绝对路径，校验
 * `<path>/src/index.ts` 存在。失败返回 undefined（plugin 早返透传）。
 */
function readSmartEngineLocalPath(rootDir: string): string | undefined {
  let dir = rootDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, ".smart-engine-local");
    if (fsSync.existsSync(candidate)) {
      try {
        const content = fsSync.readFileSync(candidate, "utf-8").trim();
        const firstLine = content.split(/\r?\n/)[0]?.trim();
        if (!firstLine || !path.isAbsolute(firstLine)) return undefined;
        const resolved = path.resolve(firstLine);
        if (!fsSync.existsSync(path.join(resolved, "src/index.ts"))) {
          return undefined;
        }
        return resolved.replace(/\/+$/, "");
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * dev 模式下的 smart-engine 联调入口：未启用时原样返回 config。
 *
 * 启用时注入两项 patch：
 * 1. `resolve.alias['@tencent/smart-engine']` → `<repo>/src/index.ts`
 *    rspack/webpack 的 alias 默认是前缀匹配，包名级别的别名同时覆盖任何子路径
 *    （但 smart-engine 这个包对外只暴露根入口，没有子路径 import，单一别名即可）。
 *    选 `src/index.ts` 而非包根目录是因为 rspack alias 指向目录时仍按 package.json
 *    解析入口，等同于回到 dist/lib，达不到吃 src 的目的。
 * 2. swc loader exclude 放行 `<repo>` 前缀，让 src TS 文件能进入 swc 编译。
 *
 * 不需要碰 conditionNames / svg / react dedupe：smart-engine 是纯 TS 工具库，
 * 不带 svg/CSS 资源，运行时也不创建 React 实例（不会触发 dispatcher 冲突）。
 */
export function applySmartEngineLocalDevtools(
  config: RspackOptions,
  rootDir: string,
): RspackOptions {
  const engineRepoRoot = tryEnterLinkMode(
    readSmartEngineLocalPath(rootDir),
    rootDir,
    "@tencent/smart-engine",
    "SmartEngine 联调模式已启用",
    "rspack 将使用本地 src/index.ts 作为包入口",
  );
  if (!engineRepoRoot) return config;

  // 1. resolve.alias：包名 → 本地 src/index.ts
  const resolve = config.resolve ?? {};
  const existingAlias = resolve.alias ?? {};
  const linkAlias: Record<string, string> = {
    "@tencent/smart-engine": path.join(engineRepoRoot, "src/index.ts"),
  };
  const mergedAlias = Array.isArray(existingAlias)
    ? existingAlias
    : { ...existingAlias, ...linkAlias };

  // 2. module.rules：只需包装 swc loader 的 exclude（让外部 src 进入 swc）
  const moduleConfig = config.module ?? {};
  const originalRules = moduleConfig.rules ?? [];
  type RawRule = RuleSetRule | undefined | null;
  const rawRules = (originalRules as readonly RawRule[]) ?? [];

  const patchedRules = rawRules.flatMap<RawRule>((rule) => {
    if (!rule || typeof rule !== "object") return [rule];
    const r = rule as RuleSetRule;

    const looksLikeSwc =
      r.test instanceof RegExp &&
      r.test.test("foo.ts") &&
      typeof r.use === "object" &&
      r.use !== null &&
      !Array.isArray(r.use) &&
      "loader" in r.use &&
      String((r.use as { loader: string }).loader).includes("swc-loader");
    if (looksLikeSwc && typeof r.exclude === "function") {
      return [
        {
          ...r,
          exclude: wrapSwcExclude(r.exclude as ExcludeFn, engineRepoRoot),
        },
      ];
    }
    return [r];
  });

  return {
    ...config,
    resolve: {
      ...resolve,
      alias: mergedAlias,
    },
    module: {
      ...moduleConfig,
      rules: patchedRules as unknown as typeof moduleConfig.rules,
    },
  };
}

// ============================================================================
// docs-ai-page（smart-page 仓）本地 dist 联调
// ============================================================================
//
// 把 @tencent/docs-ai-page-visual-editor 的所有入口 alias 到 smart-page 本地
// 仓编译产物 dist/index.esm.js，用于跨仓联调 visual-editor 的改动（如
// FloatingToolbar / AiEditPanel 等组件）。
//
// 触发条件：仓根目录存在 `.docs-ai-page-local` 文件（单行绝对路径，指向
// smart-page 仓根），且该路径下存在
// `packages/ai-page/visual-editor/dist/index.esm.js`。
//
// 与 smart-doc-editor / smart-engine 两个 plugin 的差异：
//
// - **消费 dist 而非 src**：visual-editor 的 src 含多子入口 + CSS 变量注入 +
//   workspace 依赖，由 smart-page 侧 `nx run
//   @tencent/docs-ai-page-visual-editor:build` 编译成单文件 dist 后直接消费
//   最省事——改 smart-page 源码后重新 build 该包即可，mindx 侧无感。
// - **不走 tryEnterLinkMode 的双重校验**：该校验读取 package.json 的
//   pnpm.overrides（pnpm 9 已忽略该字段，改读 pnpm-workspace.yaml），无法作为
//   开关信号；本模块以 `.docs-ai-page-local` marker 文件为单一开关（删除即关闭）。
//   pnpm-workspace.yaml overrides 里的 `link:` 条目在 pnpm 9.7.1 下会被静默
//   忽略（实测不进 lockfile），所以 node_modules 里仍是 registry 版本——本
//   alias 在 resolve 层面绕过了 pnpm 的目录结构，不依赖 link 安装。
// - **alias 带 `$` 精确匹配**：visual-editor 的 exports 里所有子路径
//   （react/core/adapters/collab/inject）的 import 都指向同一个
//   dist/index.esm.js，因此 6 个精确别名全指同一文件。
// - **react / react-dom dedupe 必须**：dist 物理位于 smart-page 仓内，其
//   node_modules 链上没有 react（peer 未安装），不 alias 会直接
//   "Can't resolve 'react'"。
// - **无需 swc exclude / svg 规则**：dist 是纯 JS（svg 已内联为 dataURL），
//   不匹配 ts/tsx 规则，也不产生 svg 请求。
//
// dist 的其余裸包依赖（css-select / css-tree / htmlparser2 /
// @tencent/docs-ai-page-sandbox）都能从 smart-page 物理路径的 node_modules
// 链正常 resolve，无需处理。

/**
 * 解析 .docs-ai-page-local 中保存的 smart-page 仓绝对路径。
 *
 * 形态约定与 .smart-engine-local 完全一致：单行绝对路径，校验
 * `<path>/packages/ai-page/visual-editor/dist/index.esm.js` 存在。
 * 失败返回 undefined（plugin 早返透传）。
 */
function readDocsAiPageLocalPath(rootDir: string): string | undefined {
  let dir = rootDir;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, ".docs-ai-page-local");
    if (fsSync.existsSync(candidate)) {
      try {
        const content = fsSync.readFileSync(candidate, "utf-8").trim();
        const firstLine = content.split(/\r?\n/)[0]?.trim();
        if (!firstLine || !path.isAbsolute(firstLine)) return undefined;
        const resolved = path.resolve(firstLine);
        if (
          !fsSync.existsSync(
            path.join(
              resolved,
              "packages/ai-page/visual-editor/dist/index.esm.js",
            ),
          )
        ) {
          return undefined;
        }
        return resolved.replace(/\/+$/, "");
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * dev 模式下的 docs-ai-page 联调入口：未启用时原样返回 config。
 *
 * 注入的 patch：
 * 1. `resolve.alias` 6 个精确条目（包根 + 5 个子入口）→ 本地 dist/index.esm.js。
 *    alias 是请求级匹配，不依赖发起文件位置——host 包 dist 里 external 的
 *    `import '@tencent/docs-ai-page-visual-editor/react'` 同样会被重定向。
 * 2. `resolve.alias` react / react-dom dedupe 到 mindx 自身实例（理由见上）。
 */
export function applyDocsAiPageLocalDevtools(
  config: RspackOptions,
  rootDir: string,
): RspackOptions {
  const smartPageRoot = readDocsAiPageLocalPath(rootDir);
  if (!smartPageRoot) return config;

  const T = "\x1b[33m";
  const G = "\x1b[32m";
  const R = "\x1b[0m";
  const line = "\x1b[36m" + "─".repeat(50) + R;

  console.log(
    `\n${line}\n` +
      `  ${T}🔗 docs-ai-page (smart-page) 联调模式已启用${R}\n` +
      `  本地仓: ${G}${smartPageRoot}${R}\n` +
      `  visual-editor 将使用本地 dist/index.esm.js\n` +
      `${line}\n`,
  );

  const distEntry = path.join(
    smartPageRoot,
    "packages/ai-page/visual-editor/dist/index.esm.js",
  );

  // 6 个精确别名（$ 结尾）：包根 + 全部子入口，同指 dist/index.esm.js。
  // 子路径不写 $ 会退化为前缀匹配，把 `pkg/react` 拼成 `dist/react` 导致
  // 解析失败，必须逐个精确列出。
  const linkAlias: Record<string, string> = {
    "@tencent/docs-ai-page-visual-editor$": distEntry,
    "@tencent/docs-ai-page-visual-editor/react$": distEntry,
    "@tencent/docs-ai-page-visual-editor/core$": distEntry,
    "@tencent/docs-ai-page-visual-editor/adapters$": distEntry,
    "@tencent/docs-ai-page-visual-editor/collab$": distEntry,
    "@tencent/docs-ai-page-visual-editor/inject$": distEntry,
  };

  // React / ReactDOM 强制 dedupe 到 mindx 自身的 node_modules（与
  // buildAliasMap 中的做法一致，理由见其注释）。
  const requireFromMindxRoot = createRequire(
    path.join(rootDir, "package.json"),
  );
  try {
    linkAlias["react"] = path.dirname(
      requireFromMindxRoot.resolve("react/package.json"),
    );
    linkAlias["react-dom"] = path.dirname(
      requireFromMindxRoot.resolve("react-dom/package.json"),
    );
  } catch {
    // 解析失败（理论上不会）就跳过 dedupe，至少包级 alias 还能用
  }

  const resolve = config.resolve ?? {};
  const existingAlias = resolve.alias ?? {};
  const mergedAlias = Array.isArray(existingAlias)
    ? existingAlias // 极少见的数组形态保留不动，附加无意义
    : { ...existingAlias, ...linkAlias };

  return {
    ...config,
    resolve: {
      ...resolve,
      alias: mergedAlias,
    },
  };
}
