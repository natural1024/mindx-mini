/**
 * 全局静态资源模块声明（monorepo 根）
 *
 * 作用：
 *  - 让所有子包（apps/*、packages/*）在 tsc 跨包类型检查时，
 *    都能识别 .css / .less / .svg / .png 等非 TS 资源的导入。
 *  - 避免在每个子包各自维护一份 global.d.ts 导致漂移。
 *
 * 接入方式：
 *  - 已通过 `tsconfig.base.json` 的 `include` 全局生效，
 *    子包无需额外配置。
 */

declare module "*.css";
declare module "*.less";
declare module "*.scss";
declare module "*.sass";

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.jpeg" {
  const src: string;
  export default src;
}

declare module "*.gif" {
  const src: string;
  export default src;
}

declare module "*.webp" {
  const src: string;
  export default src;
}

/**
 * 全局 window 扩展声明
 *
 * __globalReleaseVersion: 构建期注入的 web 制品版本号
 *   由 @mindx/build-config/rspack/app 通过 HtmlRspackPlugin 注入到 index.html
 *   格式：YYYYMMDD-HHmm-projectName-branch-commit
 *   例：20260429-1845-mindx-master-21a6f55
 */
declare interface Window {
  __globalReleaseVersion: string;
}

/**
 * 编译期常量（DefinePlugin 注入）：
 *   - 与 window.__globalReleaseVersion 同值
 *   - 业务代码中 SSR / 非 window 环境也可读取
 */
declare namespace NodeJS {
  interface ProcessEnv {
    RELEASE_VERSION?: string;
    ROUTER_BASENAME?: string;
  }
}
