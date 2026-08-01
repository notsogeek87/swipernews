// Configuration ESLint (flat config, ESLint 9+).
// On lint le code Node (backend serverless + tests). Le JS inline de index.html
// est volontairement dense et sert directement dans le navigateur sans build :
// il n'est pas couvert ici pour éviter un bruit ingérable.
"use strict";

module.exports = [
  {
    files: ["api/**/*.js", "test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
];
