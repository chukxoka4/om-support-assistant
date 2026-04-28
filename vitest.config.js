import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ["tests/ui/**", "happy-dom"],
      ["tests/**", "node"],
    ],
    setupFiles: ["tests/helpers/chrome-mock.js"],
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "providers/**", "mcp-intercom/**"],
    },
  },
});
