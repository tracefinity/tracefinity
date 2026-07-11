import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      "@next/next/no-img-element": "off",
      // react 19 strictness -- these fire on well-established patterns
      // (callback refs, initialising state from external sources in effects)
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    ignores: [".next/", "node_modules/"],
  },
];

export default eslintConfig;
