export default [
  {
    files: ["app.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        window: "readonly", document: "readonly", localStorage: "readonly",
        fetch: "readonly", alert: "readonly", confirm: "readonly",
        URL: "readonly", Blob: "readonly", FileReader: "readonly",
        crypto: "readonly", Dropbox: "readonly", Chart: "readonly",
        btoa: "readonly", history: "readonly", location: "readonly",
        setTimeout: "readonly", clearInterval: "readonly", setInterval: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "warn",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-fallthrough": "error",
      "eqeqeq": ["warn", "always", {"null": "ignore"}]
    }
  }
];
