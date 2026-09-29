/**
 * 仓库根级 PostCSS 配置。
 *
 * 给 @tailwindcss/postcss 显式指定 `base`：扫描根永远锚定在仓库根目录
 * （= 本 config 文件所在目录），避免在不同 app 的 build cwd 下 Tailwind v4
 * 自动猜错扫描根，导致 @source 路径解析失败、utility class 被全部漏扫。
 *
 * postcss-loader 会沿源 CSS 文件向上查找 postcss.config.mjs，apps/* 自身
 * 没有 config，会一路向上找到这里。
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    "@tailwindcss/postcss": {
      base: repoRoot,
    },
    // 编译期自动补浏览器前缀（如 -webkit-user-select）。
    //
    // 不再设 overrideBrowserslist：autoprefixer 会自动向上查找并读取
    // 根 package.json 的 `browserslist` 字段（iOS 13 兼容基线的单一事实源，
    // 与 SWC env / eslint-plugin-compat 共用同一份），避免两处配置漂移。
    //
    // 历史备注：此前显式列表含 `last 2 versions`，会把 KaiOS 2.5 拉进目标集，
    // 导致 user-select 等属性被误加 -moz- 前缀，故当时需要 `not kaios > 0` 排除。
    // package.json 的 browserslist 用 `> 0.5%`（KaiOS 全球份额 < 0.5%，不入选），
    // 天然不含 KaiOS，无需再排除；且其对 iOS/Safari < 16 的覆盖更完整，
    // -webkit- 前缀目标一个不少。
    autoprefixer: {},
  },
};
