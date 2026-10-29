import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseConfig: {
    extends: ["next/core-web-vitals", "next/typescript"],
  },
});

const eslintConfig = [
  { ignores: ["node_modules/**", ".next/**", "generated-prisma/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
