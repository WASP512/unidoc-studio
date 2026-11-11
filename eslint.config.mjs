// ESLint 10 flat config. The rule sets come straight from the plugins that
// support ESLint 10; eslint-config-next is not used because it pulls in
// plugins (react, import, jsx-a11y) that stop at ESLint 9.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default defineConfig([
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  next.configs["core-web-vitals"],
]);
