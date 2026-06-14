import { resolve } from "node:path";
import wasm from "vite-plugin-wasm";
import { defineTokimoApp } from "@tokimo/app-builder/vite";

export default defineTokimoApp({
  overrides: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    plugins: [wasm()],
  },
});
