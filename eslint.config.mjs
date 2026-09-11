import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Next's own rules, nothing added. `.agents`, `.claude` and `.github/skills` hold vendored
 * tool scripts — someone else's bundled code, so linting it only ever produces noise.
 */
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".agents/**", ".claude/**", ".github/skills/**", ".impeccable/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
