import { createAppConfig } from "@mindx/build-config/rspack/app";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createAppConfig({
  rootDir: __dirname,
  projectName: "hello",
  entry: "src/index.tsx",
  htmlTemplate: "src/index.html",
  devPort: 3100,
  // staticSite: dev / dist 都跑扁平化产物，无需 CDN + server-html 结构
  staticSite: true,
  emitPublicArtifacts: false,
});
