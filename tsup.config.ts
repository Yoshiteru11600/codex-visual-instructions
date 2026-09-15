import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bridge/index.ts", "src/bridge/cli.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  splitting: false,
});
