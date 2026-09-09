import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

// eslint-config-next ships flat configs from v16, so these are spread directly.
// They used to come through FlatCompat, which cannot read them — it walks them
// as eslintrc data and dies on the plugin cycle ("property 'react' closes the
// circle"). @eslint/eslintrc went with it.
const eslintConfig = [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      // New in Next 16's ruleset, and it fires on every fetch-on-mount in the
      // board: seven call sites that load their data from an effect. That is a
      // data-fetching design worth revisiting — it costs a waterfall and gives
      // up server rendering — but it is not a bug, and rewriting it inside a
      // dependency bump would hide a behavioural change in a version PR. Left
      // visible as a warning; see the follow-up issue.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Plain CommonJS consumed by node directly, not by the bundler: the CLI,
    // its compatibility wrapper, the database scripts, and src/lib/sql.js,
    // which the Next app and the scripts share so there is one implementation
    // of the connection and TLS handling rather than two that can drift.
    files: ["src/lib/sql.js", "cli/**/*.js", "bin/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
