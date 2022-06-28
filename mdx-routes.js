const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const fm = require("front-matter");
const babel = require("@babel/core");
const resolve = require("resolve");
const chokidar = require("chokidar");
const fromRoot = (...paths) => path.join(process.cwd(), ...paths);

let watcher;

async function mdxRoutes(
  existingRoutes,
  { mdxFiles = "**/*.mdx", root = fromRoot("app/routes") } = {}
) {
  if (watcher) await watcher.close();

  for (const [key, route] of Object.entries(existingRoutes)) {
    if (!route.file.endsWith(".mdx")) continue;
    const cachePath = await compileMdxRoute(path.join("app", route.file));
    const routeId = cachePath.replace(/\.mdx\.js$/, "");
    // add new compiled mdx route
    existingRoutes[routeId] = {
      ...existingRoutes[key],
      id: routeId,
      file: cachePath,
    };
    // remove the original mdx route
    delete existingRoutes[key];
  }

  const globToMdxFiles = path.join(root, mdxFiles);
  watcher = chokidar.watch(globToMdxFiles).on("change", async (updatedFile) => {
    compileMdxRoute(updatedFile);
  });

  return existingRoutes;
}

async function compileMdxRoute(filePath) {
  const content = await fs.promises.readFile(filePath, "utf8");
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  const cachePath = `${fromRoot(
    ".cache/mdx-routes",
    filePath.replace(process.cwd(), "")
  )}.js`;
  const hashPath = `${fromRoot(
    ".cache/mdx-routes",
    filePath.replace(process.cwd(), "")
  )}-${hash.substring(0, 8)}`;

  // check if hashed file already exists in cache
  if (await fs.existsSync(hashPath)) {
    return cachePath;
  }

  const { code, frontmatter } = await compileMdxFile(content);
  const { code: babelCode } = babel.transform(code, {
    plugins: [
      {
        name: "babel-plugin-fix-imports",
        visitor: {
          ImportDeclaration(astPath) {
            const importPath = astPath.node.source.value;
            if (path.isAbsolute(importPath) || importPath.startsWith("~")) {
              return;
            }
            const basedir = path.dirname(filePath);
            const absolutePath = resolve.sync(importPath, {
              basedir,
              extensions: [".js", ".jsx", ".ts", ".tsx", ".mdx"],
            });
            astPath.node.source.value = absolutePath;
          },
          ExportDefaultDeclaration(path) {
            const hasComponents = path.scope.getBinding("components");
            if (!hasComponents) return;

            if (babel.types.isIdentifier(path.node.declaration)) {
              path.replaceWith(
                babel.template(
                  `export default () => React.createElement(%%EXPORT_NAME%%, {components});`
                )({
                  EXPORT_NAME: path.node.declaration.name,
                })
              );
            }
          },
        },
      },
    ],
  });

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const [stringifyObject] = await Promise.all([
    import("stringify-object").then((mod) => mod.default),
  ]);

  let { meta, headers, ...loaderData } = frontmatter;
  if (!meta) meta = {};
  if (!loaderData) loaderData = {};
  const metaKeys = Array.from(
    new Set(["title", "description", "keywords", ...Object.keys(meta ?? {})])
  );
  const metaObject = metaKeys
    .map((key) =>
      meta[key]
        ? `${key}: \`${meta[key]}\``
        : loaderData[key]
        ? `${key}: data.${key}`
        : undefined
    )
    .filter(Boolean)
    .join(",\n");

  const js = `import { json } from "@remix-run/node";
${babelCode}
export function meta({data}) {
  return {
${metaObject}
  };
}
export function loader() {
  return json(${stringifyObject(loaderData, {
    singleQuotes: false,
  })}${headers ? `, { headers: ${stringifyObject(headers)} }` : ""});
}
`;

  await fs.promises.writeFile(cachePath, js);
  await fs.promises.writeFile(hashPath, new Date().toISOString());

  return cachePath;
}

async function compileMdxFile(content) {
  const [compileMdx, remarkFrontmatter] = await Promise.all([
    import("@mdx-js/mdx").then((mod) => mod.compile),
    import("remark-frontmatter").then((mod) => mod.default),
  ]);

  const frontmatter = fm(content);

  const result = await compileMdx(content, {
    remarkPlugins: [remarkFrontmatter],
  });
  return { code: result.value, frontmatter: frontmatter.attributes };
}

module.exports = { mdxRoutes };
