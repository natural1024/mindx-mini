import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "apps/**/src/**/*.test.{ts,tsx}",
      "apps/**/test/**/*.test.{ts,tsx}",
      "packages/**/src/**/*.test.{ts,tsx}",
      "packages/**/test/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
