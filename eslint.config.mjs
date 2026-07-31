import nextConfig from "eslint-config-next";

const eslintConfig = [...nextConfig, { ignores: ["reference/**", ".next/**", "node_modules/**"] }];

export default eslintConfig;
