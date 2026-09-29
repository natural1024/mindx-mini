// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import compatPlugin from "eslint-plugin-compat";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * @typedef {import('eslint').Linter.Config} EslintConfig
 */

/**
 * @typedef {Object} ConfigOptions
 * @property {string[]} [tsConfigPaths] - tsconfig 文件路径数组，用于类型感知 lint 规则
 * @property {boolean} [react] - 是否启用 React 规则（默认 false）
 * @property {string} [app] - 应用名（预留标识，当前仅透传语义）
 * @property {boolean} [compat] - 是否启用 iOS 13 兼容门禁（eslint-plugin-compat）。
 *   默认 false（opt-in）。仅【承诺支持 iOS 13 的生产 app】（如 mindx）应开启；
 *   内部 demo / 工具 app（sandbox、workshop）不承诺 iOS 13，保持关闭，避免其大量
 *   使用的 ResizeObserver 等 API 误报阻塞。
 * @property {string[]} [compatPolyfills] - eslint-plugin-compat 的额外豁免清单
 *   （settings.polyfills）。用于声明"已在应用侧 polyfill 或已有运行时守卫、
 *   无需门禁阻塞"的 API。格式见 eslint-plugin-compat 文档：
 *   如 "ResizeObserver"、"navigator.clipboard"、"Promise.allSettled"。仅 compat=true 时生效。
 */

/**
 * eslint-plugin-compat 默认豁免清单（全仓通用）。
 *
 * 仅收录满足以下条件之一的 API：
 *   - 已在 apps/mindx/src/polyfills.ts 全局注入（如 structuredClone）；
 *   - 由 SWC env(core-js usage) 在构建时按 browserslist targets 自动注入
 *     的 ES 运行时 API（core-js 覆盖范围内，如 Object.fromEntries）；
 *   - 代码中普遍带 `typeof X === "undefined"` 运行时守卫、缺失时安全降级；
 *   - iOS 13.4+ 已支持且业务可接受 13.0–13.3 降级（渐进增强）。
 *
 * 新增豁免必须谨慎：豁免意味着门禁不再拦该 API，一旦某处无守卫直接使用即有
 * iOS 13 崩溃风险。优先考虑加守卫或 polyfill，而非放进豁免。
 * @type {string[]}
 */
const DEFAULT_COMPAT_POLYFILLS = [
  // apps/mindx/src/polyfills.ts 已全局注入
  "structuredClone",
  "AbortController",
  // SWC env(core-js usage) 构建时按 browserslist targets 自动注入（覆盖 Chrome 55 缺口）
  "Object.fromEntries",
  "String.padStart",
  "Promise.allSettled",
  "queueMicrotask",
  // Chrome 55 原生支持基础能力，仅 rootMargin 等选项降级为渐进增强（无需 polyfill）
  "IntersectionObserver",
];

/**
 * 创建 ESLint flat config 数组
 * @param {ConfigOptions} [options]
 * @returns {EslintConfig[]}
 */
export function createConfig(options = {}) {
  const {
    tsConfigPaths,
    react = false,
    compat = false,
    compatPolyfills = [],
  } = options;

  /** @type {EslintConfig[]} */
  const configs = [
    // Ignore build outputs and common non-source dirs
    {
      ignores: ["**/dist/**", "**/node_modules/**", "**/.nx/**"],
    },
    // TypeScript files
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          ecmaVersion: 2020,
          sourceType: "module",
          ...(tsConfigPaths
            ? { project: tsConfigPaths, tsconfigRootDir: process.cwd() }
            : {}),
        },
      },
      plugins: {
        "@typescript-eslint": tseslint,
      },
      rules: {
        // Base recommended rules (no type info needed)
        ...tseslint.configs["recommended"].rules,
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
    // iOS 13 兼容门禁（eslint-plugin-compat）—— opt-in，仅 compat=true 时加入：
    //   读取 browserslist（根 package.json 单一事实源），在 lint 阶段【静态扫出】
    //   代码里使用了目标浏览器不支持的 Web API（含 DOM/HTML API，如 structuredClone /
    //   ResizeObserver / Array.prototype.at 等）。这是「演进无感知」的感知层：
    //   未来有人引入 iOS 13 不支持的 API，CI 直接红，无需等真机白屏才发现。
    //
    //   与 SWC env(core-js usage) 的分工：
    //     - core-js usage 自动「补」ES 运行时缺口（能 polyfill 的）；
    //     - compat 自动「报」所有 Web API 缺口（含 core-js 盲区，如 HTML/DOM API）。
    //   已在应用侧手动 polyfill 的 API（如 structuredClone）通过 settings.polyfills 豁免。
    //
    //   仅对浏览器运行时源码生效；Node 脚本（*.mjs 工具、测试）不属于本门禁范围，
    //   由各自 eslint 忽略规则或文件匹配自然排除。
    ...(compat
      ? [
          /** @type {EslintConfig} */ ({
            files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
            plugins: {
              compat: compatPlugin,
            },
            settings: {
              // 豁免清单：默认（全仓）+ 各 app 追加。已 polyfill / 已有守卫 / 可接受降级的 API。
              polyfills: [...DEFAULT_COMPAT_POLYFILLS, ...compatPolyfills],
            },
            rules: {
              "compat/compat": "error",
            },
          }),
        ]
      : []),
  ];

  if (react) {
    configs.push({
      files: ["**/*.tsx", "**/*.jsx"],
      plugins: {
        react: reactPlugin,
        "react-hooks": reactHooksPlugin,
      },
      settings: {
        react: { version: "detect" },
      },
      rules: {
        ...reactPlugin.configs.recommended.rules,
        ...reactHooksPlugin.configs.recommended.rules,
        // Not needed with React 17+ new JSX transform
        "react/react-in-jsx-scope": "off",
      },
    });
  }

  return [...configs, eslintConfigPrettier];
}
