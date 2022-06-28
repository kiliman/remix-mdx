const { mdxRoutes } = require("./mdx-routes");
const {
  defineConventionalRoutes,
} = require("@remix-run/dev/config/routesConvention");

/**
 * @type {import('@remix-run/dev').AppConfig}
 */

const ignoredRouteFiles = [".*", "**/*.css", "**/*.test.{js,jsx,ts,tsx}"];
module.exports = {
  devServerPort: 8002,
  cacheDirectory: "./node_modules/.cache/remix",
  ignoredRouteFiles: ["**/*"], // ignore everything in routes folder
  routes: async (defineRoutes) => {
    const conventionalRoutes = defineConventionalRoutes(
      "app",
      ignoredRouteFiles
    );
    return await mdxRoutes(conventionalRoutes);
  },
};
