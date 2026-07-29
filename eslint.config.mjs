import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
      "lib/opportunity-engine/**",
      "app/api/internal/combined-opportunity-engine/**",
      "scripts/combined-opportunity-engine-smoke.ts",
    ],
  },
  {
    files: ["lib/equity-signal/us-watch-out-engine.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^ImpactCandidate$" }],
    },
  },
];

export default eslintConfig;
