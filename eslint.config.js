// Configuration ESLint (flat config, ESLint 9+).
// On lint le code Node et les modules partagés (src/), qui tournent aussi bien
// dans le navigateur que dans la fonction serverless et les tests. Le JS inline
// restant dans index.html est volontairement dense et n'est pas couvert ici.
"use strict";

module.exports = [
  {
    files: ["api/**/*.js", "src/**/*.js", "test/**/*.js", "eslint.config.js"],
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
        URLSearchParams: "readonly",
        console: "readonly",
        self: "readonly",
        globalThis: "readonly",
        DOMParser: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "error",
      eqeqeq: ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
];
