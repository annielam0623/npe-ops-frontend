import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // .next-build：本地 `NEXT_DIST_DIR=.next-build next build`（checks/headless/README 的缓存头检查）的产物，不查。
    ignores: [".next/**", ".next-checks/**", ".next-build/**", "out/**", "build/**", "next-env.d.ts", "checks/**"],
  },
];

export default eslintConfig;
