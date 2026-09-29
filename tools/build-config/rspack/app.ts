import {
  type RspackOptions,
  type Compiler,
  HtmlRspackPlugin,
  DefinePlugin,
  ProvidePlugin,
  CopyRspackPlugin,
  SwcJsMinimizerRspackPlugin,
} from "@rspack/core";
import ReactRefreshRspackPlugin from "@rspack/plugin-react-refresh";
import NodePolyfillPlugin from "node-polyfill-webpack-plugin";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import browserslist from "browserslist";
import path from "node:path";
import { createRequire } from "node:module";
import { getReleaseVersion } from "./release-version.js";
import { getBuildInfo, serializeBuildInfo } from "./build-info.js";
import {
  applySmartDocEditorLocalDevtools,
  applySmartEngineLocalDevtools,
  applyDocsAiPageLocalDevtools,
} from "./plugins/smart-doc-editor-local.js";

const PUBLIC_DIR_NAME = "public";
const PUBLIC_CDN_DIR = "cdn";
const PUBLIC_SERVER_HTML_DIR = "server-html";

/**
 * iOS 13 兼容基线：core-js 版本（用于 SWC env.coreJs 精确注入 polyfill）。
 * 必须与根 package.json 实际安装的 core-js 大版本一致；升级 core-js 时同步更新。
 */
const CORE_JS_VERSION = "3.39";

/**
 * iOS 13 / Safari 13.1 兼容：生产 web 构建禁用 SWC minifier 的三个高危 compress
 * 子项（`reduce_vars`/`collapse_vars`/`inline`），保留 mangle + 其余 compress。
 *
 * 背景（#1861）：SWC compress 在对「可选链/可选调用降级产物」做二次优化时，生成的
 * 代码触发 Safari 13.1 引擎 bug，运行期报 `undefined is not a function` → 整页白屏。
 * 经 iOS 13.6 真机二分收敛，最小安全集 = 关闭 reduce_vars + collapse_vars + inline
 * （收敛过程见下方 IOS13_UNSAFE_COMPRESS_FLAGS 注释）；sequences 确认无辜、保留启用。
 *
 * 体积实测（apps/mindx/dist/js，388 文件，#1861）：
 *   default     原始 26038 KB / gzip 5669 KB  — 全量压缩（iOS13 白屏）
 *   本方案      原始 26228 KB / gzip 5732 KB  — gzip 仅 +1.11%（+63 KB）← 采用
 *   no-compress 原始 27330 KB / gzip 5925 KB  — 全关 compress（+4.5%，应急回退参考）
 *
 * 仅 web 构建（emitPublicArtifacts=true）生效；federation 走 Chrome 内核、不受影响。
 */

/**
 * safe-compress 模式下禁用的高危 compress 子项（触发 Safari 13.1 miscompile 的元凶集）。
 *
 * 收敛实验（#1861，找最小安全集，每档均 iOS 13.6 真机回归）：
 *   全 4 项 {reduce_vars,collapse_vars,inline,sequences}=false/0 → 【不白】
 *   第1档 {reduce_vars,collapse_vars}（放开 inline+sequences）    → 【白】
 *   第2档 {reduce_vars,collapse_vars,sequences}（放开 inline）    → 【白】⇒ inline 必须关
 *   第3档 {inline} 单独关                                        → 【白】⇒ inline 单独不够
 *   第4档 {inline,sequences}                                     → 【白】⇒ 还需变量合并类
 *   第5档 {reduce_vars,collapse_vars,inline}（放开 sequences）    → 【不白】✅ 最小安全集，采用
 *   ⇒ 结论：reduce_vars + collapse_vars + inline 三项必关且充分；sequences 无辜，保留启用。
 *   ⇒ 勿再删减这三项中的任何一个（第1/3档已证明少了就白）；sequences 若日后需要可保持开启。
 * 注：`inline` 的类型是 0|1|2|3（非 boolean），用 0 表示禁用内联；用 satisfies 校验字面量。
 */
type SwcMinimizerOpts = NonNullable<
  ConstructorParameters<typeof SwcJsMinimizerRspackPlugin>[0]
>;
type SwcCompressOption = NonNullable<
  NonNullable<SwcMinimizerOpts["minimizerOptions"]>["compress"]
>;
const IOS13_UNSAFE_COMPRESS_FLAGS = {
  reduce_vars: false,
  collapse_vars: false,
  inline: 0,
} satisfies SwcCompressOption;

/**
 * 解析 browserslist 目标浏览器列表（单一事实源 = 根 package.json 的 browserslist）。
 *
 * 为什么显式解析而不让 SWC 自动读取：
 *   SWC 的 env 在未显式传 targets 时，会以「被编译文件所在目录」向上查找 browserslist
 *   配置。monorepo 下各 app/package 目录层级不一，且 rspack 调用 cwd 可能是 repo 根或
 *   app 目录，自动解析存在歧义。这里在 config 生成期用 browserslist 包显式解析一次，
 *   把确定的目标列表交给每条 swc rule 的 env.targets，保证降级/polyfill 基线全仓一致。
 *
 * 解析失败（极端情况下配置缺失）时回退到硬编码 iOS>=13 基线，避免构建中断。
 */
function resolveBrowserslistTargets(): string[] {
  try {
    const list = browserslist();
    if (list.length > 0) return list;
  } catch {
    /* 配置缺失时静默回退 */
  }
  return ["ios >= 13", "safari >= 13", "chrome >= 55"];
}

const BROWSERSLIST_TARGETS = resolveBrowserslistTargets();

/**
 * 解析品牌 favicon 的绝对路径。
 *
 * 优先级：
 *   1) app 自身的 `<rootDir>/src/template/favicon.svg`（业务侧覆盖）
 *   2) `@mindx/ui-components` 的 `assets/mindx-logo.svg`（与侧边栏 SidebarBrandPC 同源）
 *
 * 返回 undefined 时 HtmlRspackPlugin 不会注入 favicon。
 */
function resolveFaviconPath(rootDir: string): string | undefined {
  const localOverride = path.resolve(rootDir, "src/template/favicon.svg");
  if (fsSync.existsSync(localOverride)) {
    return localOverride;
  }

  // 通过 createRequire 从 app 自身的 rootDir 解析 ui-components 包路径
  // （build-config 自己不依赖 ui-components，必须站在 app 的 node_modules 视角
  //   才能解析到 workspace 链接的真实路径）
  //
  // ui-components 的 exports 字段没有声明 "./package.json"，无法直接
  // require.resolve('@mindx/ui-components/package.json')；改为 resolve 入口
  // （命中 development 条件下的 src/index.ts），再向上回溯到包根。
  const requireFromApp = createRequire(path.join(rootDir, "package.json"));
  try {
    // resolve 入口模块路径（如 .../packages/ui-components/src/index.ts）
    const entryPath = requireFromApp.resolve("@mindx/ui-components");
    // 包根：入口在 src/index.ts → 上溯两级到包根
    // 用 includes 兜底，避免发布版（lib/index.cjs）路径层级不同
    const srcMarker = `${path.sep}src${path.sep}`;
    const libMarker = `${path.sep}lib${path.sep}`;
    let pkgRoot: string | undefined;
    if (entryPath.includes(srcMarker)) {
      pkgRoot = entryPath.split(srcMarker)[0];
    } else if (entryPath.includes(libMarker)) {
      pkgRoot = entryPath.split(libMarker)[0];
    }
    if (pkgRoot) {
      const candidate = path.join(pkgRoot, "src/assets/mindx-logo.svg");
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    /* 包未安装时静默跳过，不阻断构建 */
  }
  return undefined;
}

function isDevelopmentMode(): boolean {
  const nodeEnv = process.env["NODE_ENV"];

  if (nodeEnv) {
    return nodeEnv !== "production";
  }

  if (process.argv.includes("build")) {
    return false;
  }

  return true;
}

/**
 * ANALYZE=1 门控的 bundle 体积分析插件（issue #1835 T1 基线建设）。
 *
 * - `ANALYZE=1 pnpm --filter @mindx/app-mindx dist` 时产出体积报告：
 *   dist/bundle-analyzer-report.html（静态报告，浏览器直接打开）。
 *   注：不开启 generateStatsFile（全量 stats JSON 达数百 MB，得不偿失）；
 *   chunk 级统计走 dist/index.html script 清单统计命令（见基线报告）。
 * - 不带 ANALYZE 的常规构建（含 CD 生产）插件零注入，产物与改动前一致。
 *
 * 依赖来源说明（为何不从 @rspack/core 导入）：
 *   当前锁定的 @rspack/core@1.7.11 尚未导出 BundleAnalyzerPlugin（更高版本才内置）；
 *   而 @rspack/cli 把 webpack-bundle-analyzer 声明为自己的依赖（其 `--analyze`
 *   标志内部即动态 import 该包）。这里从 app 侧解析 @rspack/cli 的依赖闭包
 *   复用同一份实例，保证零新增依赖、零 lockfile 变更。
 *   若未来 cli 移除该依赖（解析失败），仅 console.warn 跳过，不阻断构建。
 */
function buildBundleAnalyzerPlugins(rootDir: string) {
  if (process.env["ANALYZE"] !== "1") return [];
  try {
    const appRequire = createRequire(path.join(rootDir, "package.json"));
    const cliManifestPath = appRequire.resolve("@rspack/cli/package.json");
    const cliRequire = createRequire(cliManifestPath);
    const { BundleAnalyzerPlugin } = cliRequire("webpack-bundle-analyzer") as {
      BundleAnalyzerPlugin: new (options: {
        analyzerMode: string;
        reportFilename: string;
        openAnalyzer: boolean;
      }) => { apply: (compiler: Compiler) => void };
    };
    const analyzer = new BundleAnalyzerPlugin({
      // static 模式：产出独立 HTML 报告，不启动本地 server、不自动开浏览器
      analyzerMode: "static",
      reportFilename: "bundle-analyzer-report.html",
      openAnalyzer: false,
    });
    return [
      {
        name: "mindx-bundle-analyzer",
        apply(compiler: Compiler) {
          analyzer.apply(compiler);
        },
      },
    ];
  } catch (err) {
    console.warn(
      "[build-config] ANALYZE=1 已设置，但未能从 @rspack/cli 依赖闭包解析 webpack-bundle-analyzer，本次构建跳过分析报告",
      err,
    );
    return [];
  }
}

class SyncPublicArtifactsPlugin {
  constructor(
    private readonly rootDir: string,
    private readonly distDir: string,
  ) {}

  apply(compiler: any): void {
    compiler.hooks.afterEmit.tapPromise(
      "SyncPublicArtifactsPlugin",
      async () => {
        const publicDir = path.resolve(this.rootDir, PUBLIC_DIR_NAME);
        const publicCdnDir = path.join(publicDir, PUBLIC_CDN_DIR);
        const distDir = path.resolve(this.rootDir, this.distDir);

        await Promise.all([
          fs.mkdir(path.join(publicCdnDir, "css"), { recursive: true }),
          fs.mkdir(path.join(publicCdnDir, "js"), { recursive: true }),
          fs.mkdir(path.join(publicCdnDir, "image"), { recursive: true }),
          fs.mkdir(path.join(publicDir, PUBLIC_SERVER_HTML_DIR), {
            recursive: true,
          }),
        ]);

        await fs.cp(
          path.join(distDir, PUBLIC_SERVER_HTML_DIR),
          path.join(publicDir, PUBLIC_SERVER_HTML_DIR),
          { recursive: true },
        );

        for (const subDir of ["js", "css", "image"]) {
          const src = path.join(distDir, subDir);
          try {
            await fs.access(src);
            await fs.cp(src, path.join(publicCdnDir, subDir), {
              recursive: true,
            });
          } catch {
            // distDir 下该子目录不存在，跳过
          }
        }

        // 同步 dist 根目录散落的静态资产到 cdn 根（如 HtmlRspackPlugin 注入的
        // favicon 文件 `mindx-logo.svg`）。HTML 中的 favicon URL 使用 CDN
        // publicPath，因此该文件也必须出现在 cdn 根目录。
        // 需要 cdn 根上存在该文件，否则线上 favicon 404。
        // 只搬 dist 根目录的「文件」，不动子目录（子目录已在上一步处理）。
        try {
          const rootEntries = await fs.readdir(distDir, {
            withFileTypes: true,
          });
          await Promise.all(
            rootEntries
              .filter((e) => e.isFile())
              .filter((e) => e.name !== "index.html")
              .map((e) =>
                fs.cp(
                  path.join(distDir, e.name),
                  path.join(publicCdnDir, e.name),
                ),
              ),
          );
        } catch {
          // 容错：dist 根目录扫描失败不阻断构建
        }
      },
    );
  }
}

/**
 * 静态站点模式下：把 app 的 `public/` 整体拷贝到 `dist/` 根。
 *
 * 设计动机：
 *   - rspack-dev-server 通过 `devServer.static.directory: <rootDir>/public`
 *     在开发期暴露 public 资源（如 `<rootDir>/public/html-mocks/*.html`），
 *     iframe / fetch 用 `/html-mocks/<id>.html` 这样的绝对路径直接命中。
 *   - 但 `rspack build` 不会自动把 `public/` 搬进 `dist/`，导致生产构建产物
 *     里没有这些文件。部署到 pages.woa.com 后请求 `/html-mocks/tea-shop.html`
 *     落不到任何文件，被全站 SPA fallback（200.html = index.html）兜成 HTML
 *     返回，iframe 加载到的实际是宿主自己 → 嵌套渲染异常。
 *
 * 仅在 staticSite 模式启用：
 *   - server 模式下 `public/` 是 SyncPublicArtifactsPlugin 的【输出归集地】
 *     （存放 cdn/ server-html/ 子目录），含义完全不同，绝不能反向拷回 dist/，
 *     否则会形成"产物归集地 → 产物目录"的污染回环。
 *   - staticSite 模式下 SyncPublicArtifactsPlugin 不启用，public/ 才安全
 *     地承担"静态资源源目录"语义。
 *
 * 边界处理：
 *   - app 没有 public/ 目录时返回空数组，不阻断构建
 *   - 忽略 .DS_Store / Thumbs.db 等系统文件
 *   - HtmlRspackPlugin 在 emit 阶段晚于 CopyPlugin 写入，模板产出的 index.html
 *     不会被 public/index.html 覆盖（rspack/webpack 插件执行顺序保证）
 */
function buildStaticSitePublicCopyPlugins(rootDir: string) {
  const publicDir = path.resolve(rootDir, PUBLIC_DIR_NAME);
  if (!fsSync.existsSync(publicDir)) return [];
  return [
    new CopyRspackPlugin({
      patterns: [
        {
          from: publicDir,
          to: ".",
          noErrorOnMissing: true,
          globOptions: {
            ignore: ["**/.DS_Store", "**/Thumbs.db"],
          },
        },
      ],
    }),
  ];
}

export interface AppConfigOptions {
  /** 项目根目录绝对路径（app 目录），如 __dirname */
  rootDir: string;
  /**
   * 项目名（用于版本号标识，如 'mindx' / 'prototype'）。
   * 不填则从 rootDir 取最后一段目录名。
   * 注入到 window.__globalReleaseVersion 中，供上报/反馈/日志使用。
   */
  projectName?: string;
  /** 入口文件相对于 rootDir 的路径，默认 'src/index.ts'；false 表示无普通入口 */
  entry?: string | false;
  /** HTML 模板路径，默认 'src/index.html'；false 表示不生成任何 HTML */
  htmlTemplate?: string | false;
  /**
   * 额外的 HTML 制品（与主 htmlTemplate 共享同一个 entry chunk）。
   *
   * 使用场景：移动端 / 桌面端需要不同 HTML 模板（注入不同的 meta、title、
   * 首屏骨架等），但 JS/CSS entry 暂未拆分，希望复用同一份静态资源。
   *
   * 每项会新增一个 HtmlRspackPlugin 实例，通过 `chunks: ['main']` 显式
   * 引用主 entry，rspack 不会为额外 HTML 重复产出 JS/CSS，保证一份产物
   * 被多个 HTML 引用。
   *
   * - `template`：模板文件路径（相对 rootDir）
   * - `filename`：产物文件名（相对 outputDir）；dev / staticSite 模式默认
   *   取 basename，生产 server 模式默认放到 `server-html/` 子目录下
   *   （与主 index.html 同策略）
   * - `templateParameters`：额外的 EJS 变量（会与主模板的
   *   `GLOBAL_RELEASE_VERSION` 合并）
   */
  extraHtmlTemplates?: Array<{
    template: string;
    filename?: string;
    templateParameters?: Record<string, string>;
  }>;
  /** 输出目录，默认 'dist' */
  outputDir?: string;
  /** 是否同步 public/CDN 制品，默认 true */
  emitPublicArtifacts?: boolean;
  /** 覆盖 output.publicPath；不填时沿用 app/static-site 默认策略 */
  publicPath?: string;
  /** 开发服务器端口，默认 3000 */
  devPort?: number;
  /** 编译时注入的全局常量，透传给 DefinePlugin */
  define?: Record<string, string>;
  /**
   * 静态站点模式：用于部署到 pages.woa.com 等纯静态托管平台。
   * 开启后：
   *   1. 产物扁平化（关闭 SyncPublicArtifactsPlugin，dist 下直接是 HTML + js/ + css/）
   *   2. publicPath 使用相对路径（默认 './'），可被 STATIC_BASE_PATH 环境变量覆盖
   *   3. HtmlRspackPlugin 直接输出到 dist/index.html（不加 server-html/ 前缀）
   *   4. 通过 DefinePlugin 注入 process.env.ROUTER_BASENAME，供前端路由使用
   * 也可通过 STATIC_SITE=1 环境变量开启。
   */
  staticSite?: boolean;
  /**
   * 跳过 node_modules 第三方产物 / workspace lib 产物的 iOS 13 语法降级
   * （默认 false = 降级到 es2019）。
   *
   * 仅在「宿主内核确定是现代内核」的构建形态下开启：如 federation，宿主为
   * WorkBuddy Desktop（Electron，内核 Chrome 138），原生支持 class fields /
   * 私有方法 / ?. / ?? / 逻辑赋值等全部现代语法。跳过降级后第三方包原样
   * 输出现代语法，可减小产物体积、加快构建。
   *
   * ⚠️ 面向 iOS 13 等老内核的构建（普通 app / iframe / staticSite）不要开启，
   *   否则老浏览器会在「解析阶段」抛 SyntaxError 白屏。
   */
  skipNodeModulesDowngrade?: boolean;
}

/** 创建 app 构建配置（支持 dev server） */
export function createAppConfig(options: AppConfigOptions): RspackOptions {
  const {
    rootDir,
    projectName = path.basename(rootDir),
    entry = "src/index.ts",
    htmlTemplate = "src/index.html",
    extraHtmlTemplates = [],
    outputDir = "dist",
    devPort = 3000,
    define = {},
    emitPublicArtifacts = true,
    publicPath,
    skipNodeModulesDowngrade = false,
  } = options;

  const isDev = isDevelopmentMode();
  const outputPath = path.resolve(rootDir, outputDir);
  const staticSite = options.staticSite ?? process.env["STATIC_SITE"] === "1";
  // 静态站点 publicPath：默认绝对根路径 '/'；MR 预览时 CI 传入绝对子路径（如 '/mr/123/'），
  // 子目录部署也由 CI 显式覆盖。
  //
  // ⚠️ 不要改回 './'：相对 publicPath 在「splitChunks 拆出异步 chunk + SPA 子路由」
  // 组合下会致命失效。webpack 运行时用 publicPath + chunkFilename 拼 URL，相对路径会
  // 以「当前 document URL」为 base 解析，导致用户路由到 /workspace/space-xxx 后再触发
  // 异步加载时，请求路径变成 /workspace/space-xxx/js/vendor-xxx.js（不存在）。
  // 加上 pages.woa.com 主干部署的全站 SPA fallback（200.html = index.html），
  // 这些 404 会被 fallback 成 HTML 返回，浏览器报 "Unexpected token '<'"。
  const staticBasePath = process.env["STATIC_BASE_PATH"] || "/";
  // 前端路由 basename：主干为 '/'，MR 预览时 CI 传入 '/mr/123'
  const routerBasename = process.env["ROUTER_BASENAME"] || "/";
  const configuredPublicPath = process.env["MINDX_PUBLIC_ASSET_BASE_URL"];
  const productionPublicPath = (() => {
    if (isDev || staticSite || publicPath !== undefined) return undefined;
    if (!configuredPublicPath) {
      throw new Error(
        "MINDX_PUBLIC_ASSET_BASE_URL is required for a production application build",
      );
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(configuredPublicPath);
    } catch {
      throw new Error("MINDX_PUBLIC_ASSET_BASE_URL must be an absolute URL");
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("MINDX_PUBLIC_ASSET_BASE_URL must use http or https");
    }
    return `${configuredPublicPath.replace(/\/+$/, "")}/`;
  })();

  // 构建期生成版本号；通过 HtmlRspackPlugin 注入到 HTML 模板的 EJS 变量 GLOBAL_RELEASE_VERSION
  // 浏览器侧最终通过 window.__globalReleaseVersion 暴露
  const releaseVersion = getReleaseVersion({ projectName });
  const buildInfo = serializeBuildInfo(getBuildInfo(rootDir));

  const baseConfig: RspackOptions = {
    context: rootDir,
    entry: entry === false ? {} : { main: path.resolve(rootDir, entry) },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".css"],
      // 条件导出解析顺序：
      // - dev 模式加入 'development'，让 workspace 内的 @mindx/* 包优先命中
      //   package.json 里的 "development": "./src/index.ts"，实现源码热更新 + sourcemap
      // - 生产模式不带 'development'，自动回退到 'import'/'require' 指向的 lib 产物
      // - 不包含 'types'：避免 Rspack 通过 exports.types 解析到 .d.ts 文件
      //   并递归跟踪其中的 re-export 语句（库包的 .d.ts 含有相对路径引用，
      //   但对应目录下只有声明文件，无可执行的 JS 模块）
      conditionNames: isDev
        ? ["development", "import", "require", "module", "style", "default"]
        : ["import", "require", "module", "style", "default"],
    },
    module: {
      rules: [
        {
          // 兜底：部分第三方包（如 @shikijs/vscode-textmate）作为 strict ESM
          // 发布，对裸路径 import 强制要求 .js 扩展。这里在打包侧关闭这个限制，
          // 让 rspack/webpack 仍按裸路径解析，避免 "Module not found" 报错。
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
        {
          // 忽略 .d.ts 文件：库包的 .d.ts 含有相对路径 re-export，
          // 但对应目录下只有声明文件无可执行 JS 模块，Rspack 解析会报错
          test: /\.d\.ts$/,
          type: "asset/resource",
          generator: { emit: false },
        },
        {
          // 关闭 node_modules 内 ESM 模块的 "fullySpecified" 解析强校验。
          //
          // 触发背景：
          //   `@tencent/smart-doc-editor` 间接依赖 `@shikijs/vscode-textmate`（ESM 包，
          //   package.json 里 "type": "module"），其代码里使用 `process.env[...]`。
          //   `node-polyfill-webpack-plugin` 通过 `resolve.fallback.process` 把 process
          //   重定向到 `node-stdlib-browser/cjs/proxy/process`（注意：1.3.1 版本主动
          //   `.replace('.js', '')` 抹掉了扩展名，期望解析器自动补全）。
          //
          //   但 rspack 在 ESM 严格模式（origin 是 .mjs 或 "type": "module" 的 .js）下
          //   要求 import 路径必须 fully-specified（带扩展名），不会自动补 `.js`，
          //   于是抛出 "Module not found ... process" 的错误。
          //
          // 解决方案：
          //   仅对 node_modules 内的 .js / .mjs / .cjs 关闭 fullySpecified，让解析器
          //   重新允许扩展名省略。这只放宽了第三方依赖，业务代码（apps/**, packages/**）
          //   仍按默认严格规则解析。
          //
          // 参考：
          //   - https://webpack.js.org/configuration/module/#resolvefullyspecified
          //   - https://github.com/niksy/node-stdlib-browser/issues/64
          test: /\.[cm]?js$/,
          include: /node_modules/,
          resolve: { fullySpecified: false },
        },
        // node_modules 第三方产物 / workspace lib 产物的 iOS 13 语法降级。
        // skipNodeModulesDowngrade=true 时整条 rule 被跳过，第三方包原样输出
        // 现代语法（仅在宿主内核确定是现代内核时才安全，见 AppConfigOptions）。
        ...(skipNodeModulesDowngrade
          ? []
          : [
              {
                // iOS 13 (Safari 13) 兼容：对 node_modules 内第三方产物做语法降级。
                //
                // 背景：@tencent/smart-doc-editor、@shikijs/*、date-fns、oniguruma-*、
                //   micromark-* 等包以现代语法（class fields、私有方法、?./??、逻辑赋值等）
                //   直接发布 ESM/CJS 产物，未经降级。iOS 13 Safari 在「解析阶段」即抛
                //   SyntaxError（Unexpected token '=' 等），导致整条 vendor chunk 加载
                //   失败 → 白屏。
                //
                // 解决方案：对 node_modules 的 .js/.mjs/.cjs 单独走 swc-loader，降级到
                //   es2019（iOS 13 原生支持 async/await，无需引入 regenerator）。
                //   转掉 class fields / 私有方法 / ?. / ?? / 逻辑赋值 / object spread 等
                //   iOS 13 不支持的语法。
                //
                // ⚠️ test 必须用 /\.[cm]?js$/ 覆盖 .cjs：date-fns@4 / @date-fns/tz 等包
                //   通过 exports 的 "require" 条件被 CJS 形态的 SDK 引入，实际解析到 .cjs
                //   产物（含 ?. / ||= 等现代语法）。若 test 只写 /\.m?js$/ 会漏掉 .cjs，
                //   导致这些 chunk（vendor-date-fns / vendor--date-fns-tz 等）未被降级，
                //   iOS 13 Safari 解析阶段抛 SyntaxError 白屏。
                //
                // 注意：正则 lookbehind (?<=) / (?<!) 属运行时语义，SWC/Babel 均无法转译，
                //   需在依赖侧（pnpm patch 或修改 editor sdk 源码）单独处理。
                test: /\.[cm]?js$/,
                include: [
                  /node_modules/,
                  // #1861 双保险：@mindx/* workspace 包生产构建走 exports "import" →
                  // lib/index.mjs（library.ts 编译产物）。rspack resolve.symlinks 默认
                  // 解析为 realpath packages/<pkg>/lib/*，既不在 node_modules（漏掉上一条
                  // include），也不被下方 ts/tsx rule 的 test(/\.[jt]sx?$/) 匹配（漏掉 .mjs），
                  // 导致产物里的 ?./??/class fields 未降级 → iOS13 解析期 SyntaxError 白屏。
                  // 这里把 workspace lib 产物纳入降级；realpath 与 pnpm symlink 两种形态都覆盖。
                  /[/\\]packages[/\\][^/\\]+[/\\]lib[/\\]/,
                  /[/\\]@mindx[/\\][^/\\]+[/\\]lib[/\\]/,
                ],
                // polyfill / helper 自身无需再降级，排除以免出错、省构建时间
                exclude: [
                  /[/\\]core-js[/\\]/,
                  /[/\\]@swc[/\\]helpers[/\\]/,
                  /[/\\]regenerator-runtime[/\\]/,
                ],
                use: {
                  loader: "builtin:swc-loader",
                  options: {
                    jsc: {
                      parser: { syntax: "ecmascript" },
                      target: "es2019",
                    },
                  },
                },
              },
            ]),
        {
          // 静态图片资源（SVG / PNG / JPG 等）
          // 使用 asset/resource 输出独立文件，避免被当作 JS 解析
          test: /\.(svg|png|jpe?g|gif|webp|ico)$/,
          type: "asset/resource",
        },
        {
          // 字体文件（来自 @tencent/smart-doc-editor 等第三方库）
          test: /\.(woff2?|ttf|eot|otf)$/,
          type: "asset/resource",
        },
        {
          test: /\.[jt]sx?$/,
          exclude: (modulePath: string) => {
            // 放行 @mindx/* workspace 包源码（即使 rspack 解析到 symlink 路径
            // apps/*/node_modules/@mindx/*/src/**，也要让 swc 编译）
            if (/[/\\]@mindx[/\\]/.test(modulePath)) return false;
            return (
              modulePath.includes("node_modules") ||
              modulePath.endsWith(".d.ts")
            );
          },
          use: {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                parser: {
                  syntax: "typescript",
                  tsx: true,
                  decorators: true,
                },
                transform: {
                  react: {
                    runtime: "automatic",
                    development: isDev,
                    refresh: isDev,
                  },
                  legacyDecorator: true,
                  decoratorMetadata: true,
                },
                // dev 模式保留现代 target：跑在开发者现代浏览器上，无需降级/polyfill，
                // 也避免 core-js usage 分析拖慢 HMR。生产用下方 env（与 target 互斥）。
                ...(isDev ? { target: "es2022" } : {}),
              },
              // iOS 13 兼容基线（仅生产 + 仅业务代码）：
              //   - mode: "usage" —— 按代码里实际用到的运行时 API【自动、按需】注入
              //     core-js polyfill（replaceAll / Object.hasOwn / Array.prototype.at …）。
              //     这是「演进无感知」的关键：未来新引入的 ES 运行时 API 自动被覆盖，
              //     无需手动维护 polyfill 黑名单。
              //   - targets —— 读 browserslist（根 package.json），与语法降级基线统一。
              //   - coreJs —— 精确到已安装 core-js 大版本，保证注入的模块路径存在。
              //
              // ⚠️ 为什么仅生产启用：
              //   1) dev 模式跑在开发者现代浏览器上（target es2022），无需降级或
              //      polyfill；跳过 core-js usage 分析也能避免拖慢 HMR。
              //   2) 生产才需要补齐 iOS 13 缺失的 ES 运行时 API。core-js 已提为
              //      根依赖（root package.json），monorepo 内任意包、任意目录都能通过
              //      向上 node_modules 查找解析到注入的 `import "core-js/..."`，
              //      不再依赖 apps/mindx 直接声明。
              //
              // ⚠️ env 只作用于本条业务 rule；node_modules 降级 rule 仍用 jsc.target，
              //   绝不开 usage（否则对整个依赖树做 usage 分析，体积爆炸、构建剧慢）。
              //   core-js 不含 structuredClone 等 HTML/DOM API，那类盲区由
              //   apps/mindx/src/polyfills.ts 手动兜底。
              ...(isDev
                ? {}
                : {
                    env: {
                      targets: BROWSERSLIST_TARGETS,
                      mode: "usage" as const,
                      coreJs: CORE_JS_VERSION,
                    },
                  }),
            },
          },
        },
        {
          // .css 走 postcss-loader → rspack 内置 CSS pipeline
          // 关键 1：rspack 的 `experiments.css: true` 默认把 .css 当原生 CSS 处理，
          //   不会自动启动 PostCSS。Tailwind v4 的 `@import "tailwindcss"` 必须经过
          //   `@tailwindcss/postcss` 插件才能展开为真实 utility class，否则只会被
          //   当成普通 CSS @import 静默失败（产物里没有任何 utility class）。
          // 关键 2：必须用 `type: "css/auto"`（而非 "css"），让 rspack 既应用我们的
          //   loader 链，又把 loader 输出交还给内置 CSS pipeline 处理；用 "css" 时
          //   loader 链可能被静默跳过。
          test: /\.css$/,
          use: [{ loader: "postcss-loader" }],
          type: "css/auto",
        },
        {
          test: /\.less$/,
          // less-loader 先编译 less → css，postcss-loader 再走 autoprefixer
          // 补前缀（如 -webkit-user-select），否则 iOS 下 user-select 不生效。
          use: [{ loader: "postcss-loader" }, { loader: "less-loader" }],
          type: "css",
        },
      ],
    },
    plugins: [
      ...(htmlTemplate === false
        ? []
        : [
            new HtmlRspackPlugin({
              template: path.resolve(rootDir, htmlTemplate),
              // 静态站点模式 / dev 模式：HTML 直接输出到 dist 根目录
              // 生产 server 模式：HTML 放到 server-html/ 子目录（给 Node 服务读取）
              ...(isDev || staticSite
                ? {}
                : {
                    filename: `${PUBLIC_SERVER_HTML_DIR}/${path.basename(htmlTemplate)}`,
                  }),
              // 品牌 favicon：默认从 @mindx/ui-components 复用品牌 logo（与侧边栏顶部
              // SidebarBrandPC 同源），保证浏览器标签页图标与产品内品牌一致。
              // 选择 require.resolve 而非硬编码路径，是为了让 monorepo / 发布场景下都能
              // 解析到实际安装的 ui-components 包的 SVG 资源文件。
              // HtmlRspackPlugin 会自动把该文件拷贝到产物 + 注入 <link rel="icon"> 标签，
              // 业务层不需要在 index.html 里手写 favicon 引用。
              favicon: resolveFaviconPath(rootDir),
              // EJS 模板变量：在 index.html 中通过 <%= GLOBAL_RELEASE_VERSION %> 取用
              templateParameters: {
                GLOBAL_RELEASE_VERSION: releaseVersion,
                BUILD_INFO: buildInfo,
              },
            }),
          ]),
      // 额外 HTML 制品（如 mobile.html）：与主模板共享同一个 entry chunk
      // （chunks: ['main']），rspack 不会为这些 HTML 重复产出 JS/CSS，
      // 保证一份静态资源被多个 HTML 引用。
      ...(htmlTemplate === false ? [] : extraHtmlTemplates).map((item) => {
        const templateAbsPath = path.resolve(rootDir, item.template);
        // 文件名策略与主模板一致：
        //   - dev / staticSite：输出到 dist 根，取 basename
        //   - 生产 server：输出到 server-html/ 子目录，取 basename
        const baseName = path.basename(item.template);
        const filename =
          item.filename ??
          (isDev || staticSite
            ? baseName
            : `${PUBLIC_SERVER_HTML_DIR}/${baseName}`);
        return new HtmlRspackPlugin({
          template: templateAbsPath,
          filename,
          // 显式只引用主 entry chunk，避免 rspack 为额外 HTML 重复产出 JS/CSS
          chunks: ["main"],
          favicon: resolveFaviconPath(rootDir),
          templateParameters: {
            GLOBAL_RELEASE_VERSION: releaseVersion,
            BUILD_INFO: buildInfo,
            ...item.templateParameters,
          },
        });
      }),
      new DefinePlugin({
        // 注入前端路由 basename：主干 '/'，MR 预览 '/mr/123'
        "process.env.ROUTER_BASENAME": JSON.stringify(routerBasename),
        // 编译期常量：业务代码可直接读取 process.env.RELEASE_VERSION 兜底
        "process.env.RELEASE_VERSION": JSON.stringify(releaseVersion),
        // 开关：dev 模式下强制启用业务埋点真上报（`@mindx/tracking` 消费）。
        // 生产构建 NODE_ENV=production 自然启用真上报，本变量不生效；
        // 本地开发者通过 `MINDX_TRACKING_FORCE_ENABLE=1 pnpm dev` 显式启用，
        // tracking service 会跳过 dev noop 分支，把事件真的送到 InLong 联调。
        // 未设置时会被替换为 undefined 字面量，与旧行为完全一致。
        "process.env.MINDX_TRACKING_FORCE_ENABLE": JSON.stringify(
          process.env["MINDX_TRACKING_FORCE_ENABLE"],
        ),
        ...define,
      }),
      // @tencent/smart-doc-editor 等第三方包以 Classic JSX transform 打包，
      // 需要 React 在全局作用域。ProvidePlugin 按需注入，不影响自身代码。
      new ProvidePlugin({
        React: ["react"],
      }),
      // Node 内置模块 polyfill：兜底浏览器构建时第三方依赖
      // 该插件兼容 webpack 5 plugin API，rspack 1.x 完全支持。
      // additionalAliases: ['process'] — v4 默认不 polyfill process，
      // 但 @tencent/clipboard → readable-stream 运行时需要 process.nextTick
      new NodePolyfillPlugin({ additionalAliases: ["process"] }),
      // 静态站点模式不走 CDN + server 架构，产物保持扁平
      ...(isDev ? [new ReactRefreshRspackPlugin()] : []),
      // ANALYZE=1 时注入 bundle 体积分析（仅静态 HTML 报告，不生成 stats JSON）；
      // 常规构建零注入，产物不受影响。见 buildBundleAnalyzerPlugins 注释。
      ...buildBundleAnalyzerPlugins(rootDir),
      ...(emitPublicArtifacts && !isDev
        ? staticSite
          ? buildStaticSitePublicCopyPlugins(rootDir)
          : [new SyncPublicArtifactsPlugin(rootDir, outputDir)]
        : []),
    ],
    output: {
      path: outputPath,
      filename: isDev ? "[name].js" : `js/[name].[contenthash:8].js`,
      chunkFilename: isDev ? "[name].js" : `js/[name].[contenthash:8].js`,
      assetModuleFilename: isDev
        ? "[name][ext][query]"
        : `image/[name].[contenthash:8][ext][query]`,
      publicPath:
        publicPath ??
        (isDev ? "/" : staticSite ? staticBasePath : productionPublicPath),
      clean: true,
      cssFilename: isDev ? "[name].css" : `css/[name].[contenthash:8].css`,
      cssChunkFilename: isDev ? "[name].css" : `css/[name].[contenthash:8].css`,
    },
    experiments: {
      css: true,
    },
    // 生产构建启用 chunk splitting，避免出现单文件超大 chunk。
    // 触发背景：pages.woa.com（静态站点托管）单请求体上限 5MB，曾出现
    // main.js 6.4MB、ui-components barrel chunk 5.58MB 直接被 nginx 413
    // 拦下导致 CD 部署失败。
    // 策略：
    //   - chunks: "all" —— 同步/异步 chunk 都参与拆分
    //   - maxSize / maxAsyncSize / maxInitialSize 三件套 —— 仅设 maxSize 对
    //     entry chunk 与 async chunk 拆分力度不足，三个都设才能真正生效
    //   - cacheGroups —— 单纯靠 maxSize 拆不动"单 module 就 > maxSize"的情况
    //     （如 ui-components 的 barrel re-export 编译产物 5.58MB）。
    //     按 npm 包名 / workspace 包名维度强制分组，让每个包独立成 chunk，
    //     从 module 边界层面拆掉超大块。
    //   - vendor priority 远高于 workspace（20 vs 5），确保 node_modules 内
    //     的 module 不会被裹挟进 workspace chunk。
    //   - minSize: 100KB —— demo 全展示场景，宁可拆碎也不要超大
    // dev 模式不开启：HMR 场景下拆分反而拖慢热更新。
    ...(isDev
      ? {}
      : {
          optimization: {
            // iOS 13 兼容：禁用高危 compress 子项（见文件顶部注释 #1861）。
            // 仅 web 构建生效，federation（emitPublicArtifacts=false）不受影响。
            ...(emitPublicArtifacts
              ? {
                  minimizer: [
                    new SwcJsMinimizerRspackPlugin({
                      minimizerOptions: {
                        compress: IOS13_UNSAFE_COMPRESS_FLAGS,
                      },
                    }),
                  ],
                }
              : {}),
            splitChunks: {
              chunks: "all",
              minSize: 100 * 1024,
              maxSize: 2 * 1024 * 1024,
              maxAsyncSize: 2 * 1024 * 1024,
              maxInitialSize: 2 * 1024 * 1024,
              cacheGroups: {
                // #1835 T3：default 不能简单 false——多异步 chunk 共享的业务模块
                // （如 doc-comment-panel 被 doc-page/web-page 共享）会被"公共祖先
                // 提升"进 entry 的 initial chunk，级联把 smart-doc-editor /
                // docs-ai-page 系列（约 2.5MB）拽回首屏。改为显式 default 组且
                // chunks:"async"：被 ≥2 个 chunk 共享的模块拆成异步共享 chunk，
                // 阻止提升；被 initial 同步引用的模块不受影响。
                default: {
                  chunks: "async",
                  minChunks: 2,
                  priority: -10,
                  reuseExistingChunk: true,
                },
                defaultVendors: false,
                // #1835 T3：品类页懒加载后，被多个异步 chunk 共享的模块/包
                // 会被提升到公共祖先（entry 的 initial chunk），把 smart-doc-editor
                // / docs-ai-page 系列（约 2.5MB）重新拽回首屏。以下两个
                // chunks:"async" 组阻止该提升：只被异步引用的模块强制留在异步图。
                // 被初始 chunk 同步引用的模块不受影响（仍留在 initial）。
                sdkAsync: {
                  // 排除 SDK 的 i18n locales（emoji 语言包 ~342KB）：SDK 内部用动态
                  // import 按需加载（emoji picker 打开时才取对应语言），若被本组
                  // 按包名合并进同步 chunk，会破坏 SDK 的懒加载边界（#1835 实测
                  // smart-doc-editor chunk 47% 是三个 emoji locale）。排除后回到
                  // 默认动态 chunk 行为。
                  // #1875 后续：smart-doc-[a-z-]+ 全系匹配（覆盖 2.134.0 拆出的
                  // convert/record/spec/theme/ui 伴生包——逐名列举漏掉 convert 时，
                  // 它被 SDK 按需 import() 却落 vendor(chunks:"all") 进了首屏）。
                  test: /[\\/]node_modules[\\/]@tencent[\\/](smart-doc-[a-z-]+|docs-ai-page-(visual-editor|database|host|offline|presentation|sandbox))[\\/](?!dist[\\/]i18n[\\/]locales)/,
                  // 必须是 chunks:"async"：实测两种状态下 "all" 均退化
                  // （SDK 包被共享提升回 initial：6.22→6.80MB、5.19→5.54MB）。
                  // async 限制 + priority 30 + reuseExistingChunk:false 的组合
                  // 实测最优。三大品类 SDK（含 database 849KB）已全部移出首屏，
                  // 详见 docs/page-load-optimization-1835.md（#1835）。
                  chunks: "async",
                  name(module: { context?: string | null }) {
                    const ctx = module.context || "";
                    const segments = ctx.split(/[\\/]node_modules[\\/]/);
                    const last = segments[segments.length - 1] || "";
                    const match = last.match(/^(@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
                    if (!match) return "sdk-async";
                    return `sdk-async-${match[1].replace(/[@\\/]/g, "-")}`;
                  },
                  priority: 30,
                  enforce: true,
                  reuseExistingChunk: false,
                },
                sharedComponentsAsync: {
                  test: /[\\/]src[\\/]components[\\/]/,
                  chunks: "async",
                  // 被 ≥2 个 chunk 共享才拆（单引用者跟随原 chunk，不额外拆）
                  minChunks: 2,
                  name: "shared-components",
                  priority: 1,
                },
                // 每个 npm 包独立成 chunk（按顶层包名/scope 分组）
                // priority 20：优先级最高，确保 vendor module 不被 workspace 裹挟
                // #1835 T3：排除三品类 SDK（由 sdkAsync 组接管，强制异步）——
                // vendor 组的 chunks:"all" 会把被共享提升的 SDK 包留进 initial。
                vendor: {
                  test(module: { context?: string | null }) {
                    const ctx = module.context || "";
                    // 排除三品类 SDK：包名后用 (?:[\\/]|$) 兼容 module.context
                    // 为包根目录（无尾部斜杠，如 .../docs-ai-page-database）的情形——
                    // 之前只写 [\\/] 会漏掉包根 context，导致这些模块的初始使用
                    // 落回 vendor(chunks:"all") 生成 initial chunk（database 849KB
                    // 首屏残留的真因）。排除后统一由 sdkAsync(chunks:"async") 接管。
                    // #1875 后续：smart-doc 系用 smart-doc-[a-z-]+ 全系匹配——2.134.0
                    // 拆出 convert/record/spec/theme/ui 伴生包，逐名列举会漏（convert
                    // 80KB 曾因此落 vendor 进首屏）。
                    if (
                      /[\\/]node_modules[\\/]@tencent[\\/](smart-doc-[a-z-]+|docs-ai-page-(visual-editor|database|host|offline|presentation|sandbox))(?:[\\/]|$)/.test(
                        ctx,
                      )
                    ) {
                      return false;
                    }
                    return /[\\/]node_modules[\\/]/.test(ctx);
                  },
                  name(module: { context?: string | null }) {
                    const ctx = module.context || "";
                    // 取路径中"最后一段"node_modules 之后的包名，避免匹配到
                    // pnpm 的 .pnpm 中间层（如 node_modules/.pnpm/pkg@x/node_modules/pkg）
                    const segments = ctx.split(/[\\/]node_modules[\\/]/);
                    const last = segments[segments.length - 1] || "";
                    // last 形如 "@scope/pkg/sub..." 或 "pkg/sub..."
                    const match = last.match(/^(@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
                    if (!match) return "vendor";
                    return `vendor-${match[1].replace(/[@\\/]/g, "-")}`;
                  },
                  priority: 20,
                  reuseExistingChunk: true,
                  enforce: true,
                },
                // @mindx workspace 包按包名拆，避免 ui-components 等大包合并
                workspace: {
                  test: /[\\/]packages[\\/]/,
                  name(module: { context?: string | null }) {
                    const ctx = module.context || "";
                    const match = ctx.match(/[\\/]packages[\\/]([^\\/]+)/);
                    return match ? `pkg-${match[1]}` : "pkg";
                  },
                  priority: 10,
                  reuseExistingChunk: true,
                  enforce: true,
                },
              },
            },
          },
        }),
    mode: isDev ? "development" : "production",
    // 顶层显式关闭 lazyCompilation。@rspack/cli 的 serve 命令在检测到
    // 纯 Web app 且用户未显式设置顶层 lazyCompilation 时，会强制注入
    // `lazyCompilation: { imports: true }`，使所有动态 import() 走懒编译：
    // 首次请求只返回「占位壳」运行时，需经 XHR 通知 dev-server → 二次编译
    // → 客户端重新拉取才能拿到真实模块。该异步链路在页面首次加载周期内
    // 常来不及完成，导致 import() 的 promise 永久 pending（无 resolve/reject），
    // 表现为 mermaid / beautiful-mermaid 等动态加载的渲染库首次渲染为空、
    // 刷新页面后（模块已被标记 active）才恢复。必须在**顶层**显式设 false
    // 才能阻止 cli 的自动注入（experiments.lazyCompilation 是旧式写法，
    // cli 检查的是顶层 userConfig.lazyCompilation，故旧式写法无效）。
    ...(isDev ? { lazyCompilation: false } : {}),
    ...(isDev && {
      devServer: {
        port: devPort,
        hot: true,
        historyApiFallback: true,
        // 确保 WS 握手通过校验，如需在其他代理域名下开发，在此追加对应条目
        // - `.docs.qq.com`：腾讯文档域名 + 子域
        // - `.workbuddy.cn`：WorkBuddy iframe 嵌入版（mindx 作为子页面被 iframe 加载）
        // - `.workbuddy.ai`：WorkBuddy 新域名（www / staging 等 + 子域）
        allowedHosts: [
          "localhost",
          ".docs.qq.com",
          ".workbuddy.cn",
          ".workbuddy.ai",
        ],
        // 使 WS 连接跟随页面端口，确保经过 Whistle 代理转发
        client: {
          webSocketURL: "auto://0.0.0.0:0/ws",
        },
        // 显式把 app 自身的 public/ 暴露成静态资源根目录。
        // 不设的话 rspack-dev-server 默认 cwd/public，而 nx 从 monorepo
        // 根目录调用，cwd 不是 app 目录 → public 下的 html-mocks 等资源全 404。
        static: {
          directory: path.resolve(rootDir, PUBLIC_DIR_NAME),
          watch: true,
          publicPath: "/",
        },
      },
    }),
    devtool: isDev ? "eval-cheap-module-source-map" : false,
  };

  // dev 模式下，按 .smart-doc-editor-local / .smart-engine-local 配置注入本地
  // 源码联调专用的 patch（resolve.alias / svg SVGR / swc exclude / source
  // condition / react dedupe）。两个 plugin 互相独立，可分别开关、可同时开。
  // 未配置对应文件时 plugin 原样返回，对常规开发与 CI 完全透明。
  // 生产构建无需也不应走此路径。详见 plugins/smart-doc-editor-local.ts。
  if (!isDev) return baseConfig;
  let config: RspackOptions = baseConfig;
  config = applySmartDocEditorLocalDevtools(config, rootDir);
  config = applySmartEngineLocalDevtools(config, rootDir);
  config = applyDocsAiPageLocalDevtools(config, rootDir);
  return config;
}
