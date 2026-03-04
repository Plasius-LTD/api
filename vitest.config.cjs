module.exports = {
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.tests.ts"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: ["**/node_modules/**", "dist", "coverage", "tests/**", "**/*.config.*"],
      thresholds: {
        lines: 45,
        functions: 50,
        statements: 45,
        branches: 40
      }
    }
  }
};
