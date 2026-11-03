import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const prod = process.argv[2] === "production";

/*
 * Where the built plugin gets copied for testing. Point this at the plugin
 * folder inside the vault you develop against, e.g.
 *
 *   OBSIDIAN_PLUGIN_DIR=~/MyVault/.obsidian/plugins/folder-nav-ooeooo npm run build
 *
 * Leave it unset to just build main.js without deploying anywhere.
 */
const PLUGIN_DIR = process.env.OBSIDIAN_PLUGIN_DIR
  ? path.resolve(process.env.OBSIDIAN_PLUGIN_DIR.replace(/^~/, process.env.HOME ?? "~"))
  : null;

const ASSETS = ["manifest.json", "styles.css"];

const banner = `/*
Folder Nav — bundled by esbuild
Source: https://github.com/ooeooo/obsidian-folder-nav
Upstream: https://github.com/mianfuqu/obsidian-folder-nav
*/`;

function deploy() {
  if (!PLUGIN_DIR) {
    console.log("[deploy] skipped — set OBSIDIAN_PLUGIN_DIR to copy into a vault");
    return;
  }
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.copyFileSync("main.js", path.join(PLUGIN_DIR, "main.js"));
  for (const asset of ASSETS) {
    if (fs.existsSync(asset)) fs.copyFileSync(asset, path.join(PLUGIN_DIR, asset));
  }
  console.log(`[deploy] -> ${PLUGIN_DIR}`);
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [{
    name: "deploy-on-rebuild",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) deploy();
      });
    },
  }],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  // styles.css and manifest.json are plain copies, so esbuild won't rebuild on
  // their change — watch them by hand.
  for (const asset of ASSETS) {
    if (fs.existsSync(asset)) {
      fs.watchFile(asset, { interval: 500 }, () => {
        try {
          deploy();
        } catch (err) {
          console.error("[deploy] failed:", err);
        }
      });
    }
  }
  console.log("[watch] waiting for changes...");
}
