import {
  type RspackOptions,
  type ExternalItemFunctionData,
} from "@rspack/core";
import path from "node:path";

export interface LibraryConfigOptions {
  /**
   * 入口。两种形态：
   *   - 单入口（绝大多数包）：传入口文件绝对路径字符串，产出 `lib/index.mjs`；
   *   - 多入口：传 `{ [chunkName]: 绝对路径 }`，按 name 产出 `lib/<name>.mjs`。
   *     用于把重依赖能力（如 Calendar→react-day-picker→date-fns）拆成独立子路径
   *     产物，避免被主 barrel 单文件 bundle 连带进消费方首屏（#1875）。
   */
  entry: string | Record<string, string>;
  /** 子包的 package.json 内容，用于自动提取 peerDependencies 作为 externals */
  pkgJson: {
    peerDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  /** 输出目录，默认 'lib' */
  outputDir?: string;
}

function buildExternals(
  pkgJson: LibraryConfigOptions["pkgJson"],
): (data: ExternalItemFunctionData) => Promise<string | undefined> {
  // 库构建 externalize 策略：
  //   - peerDependencies：业界标准必须 externalize（避免 react 重复打包）
  //   - dependencies：也 externalize，让消费方负责 bundle 这些依赖
  //     原因：避免把 @tencent/smart-doc-editor 等巨型依赖（单包数 MB）inline 到
  //     lib/index.mjs，导致产物 > 10MB，且阻断消费方的 chunk splitting。
  //     消费方在自己的 rspack 配置里能更精细地控制这些依赖的拆分策略。
  //   - workspace 包（@mindx/*）也作为 dependencies 出现，同样 externalize；
  //     消费方通过 workspace link 直接从源码/lib 解析，不需要 inline。
  // 这是业界标准做法（antd / material-ui / radix-ui 都不会 inline 自己的 deps）。
  const externalPkgs = new Set([
    ...Object.keys(pkgJson.peerDependencies ?? {}),
    ...Object.keys(pkgJson.dependencies ?? {}),
  ]);
  return async ({ request }) => {
    if (!request) return undefined;
    // 排除相对路径 / 绝对路径（自己的源码模块，必须 bundle）
    if (request.startsWith(".") || request.startsWith("/")) return undefined;
    // 精确匹配包名 或 任何子路径（如 react/jsx-runtime、@phosphor-icons/react/dist/ssr）
    for (const pkg of externalPkgs) {
      if (request === pkg || request.startsWith(`${pkg}/`)) {
        return request;
      }
    }
    return undefined;
  };
}

/** 创建 library 双格式（ESM + CJS）构建配置数组 */
export function createLibraryConfig(
  options: LibraryConfigOptions,
): RspackOptions[] {
  const { entry, pkgJson, outputDir = "lib" } = options;
  const externals = buildExternals(pkgJson);
  // 归一为 entry object；单入口沿用 { index } 命名，保证 filename "[name].mjs"
  // 产出 index.mjs（与历史产物完全一致，不影响既有消费方，#1875）。
  const entryObj: Record<string, string> =
    typeof entry === "string" ? { index: entry } : entry;
  // outputPath 基准目录：取任一入口文件所在目录的上级（约定 src/ 同级的 lib/）。
  const anyEntry = Object.values(entryObj)[0] ?? "";
  const outputPath = path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(path.dirname(anyEntry), "..", outputDir);

  const shared: Omit<RspackOptions, "output"> = {
    entry: entryObj,
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    module: {
      rules: [
        {
          test: /\.map$/,
          type: "asset/resource",
          generator: { emit: false },
        },
        {
          // 静态图片资源（SVG / PNG / JPG / WEBP / GIF）
          // Library 模式使用 asset/inline（data URL），避免产出独立文件后消费方无法 resolve
          test: /\.(svg|png|jpe?g|gif|webp|ico)$/,
          type: "asset/inline",
        },
        {
          test: /\.[jt]sx?$/,
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
                  },
                  legacyDecorator: true,
                  decoratorMetadata: true,
                },
                // iOS 13 (Safari 13) 兼容：库产物 target 必须与 app 侧降级基线
                // （es2019）保持一致。此前为 es2020，会在 lib/index.mjs 中原样保留
                // optional chaining `?.` / nullish `??` / object rest 等 ES2020 语法；
                // 生产构建下 @mindx/* 走 exports 的 "import" 命中 lib/index.mjs，
                // 而 app 侧两条降级 rule 都覆盖不到该 .mjs 产物（node_modules rule 的
                // include 不含 workspace realpath、ts/tsx rule 的 test 不匹配 .mjs），
                // 导致 iOS 13.0–13.3 在解析阶段直接 SyntaxError → 白屏。降到 es2019
                // 让产物源头即不含这些语法（async/await 属 es2017，iOS 13 原生支持，保留）。
                target: "es2019",
              },
            },
          },
        },
        {
          // .css 走 postcss-loader → rspack 内置 CSS pipeline
          // 让库构建时 Tailwind v4 (`@import "tailwindcss"`) 能被展开为真实 utility class
          test: /\.css$/,
          use: [{ loader: "postcss-loader" }],
          type: "css",
        },
        {
          test: /\.less$/,
          // less-loader 先编译 less → css，postcss-loader 再走 autoprefixer 补前缀。
          use: [{ loader: "postcss-loader" }, { loader: "less-loader" }],
          type: "css",
        },
      ],
    },
    experiments: {
      css: true,
    },
    externals,
    externalsType: "commonjs",
    optimization: {
      minimize: false,
    },
    devtool: false,
    mode: "production",
  };

  const esmConfig: RspackOptions = {
    ...shared,
    experiments: { ...shared.experiments, outputModule: true },
    externalsType: "module",
    output: {
      path: outputPath,
      filename: "[name].mjs",
      library: { type: "module" },
      chunkFormat: "module",
    },
  };

  const cjsConfig: RspackOptions = {
    ...shared,
    externalsType: "commonjs",
    output: {
      path: outputPath,
      filename: "[name].cjs",
      library: { type: "commonjs2" },
    },
  };

  return [esmConfig, cjsConfig];
}
