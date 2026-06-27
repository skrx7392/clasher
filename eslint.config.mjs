// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Globally ignored paths (build output, deps, generated files).
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/out/**",
      "**/node_modules/**",
      "**/coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Config / tooling files run in Node and are not part of the typed build.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      sourceType: "module",
    },
  },
  // Keep ESLint out of Prettier's lane (formatting is owned by Prettier).
  prettier,
);
