import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repo = fileURLToPath(new URL("..", import.meta.url));
const execute = promisify(execFile);

async function fixture(t) {
  const scratch = join(repo, "work");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "build-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const name of ["src", "esbuild.config.mjs", "manifest.json", "styles.css", "tsconfig.json"]) {
    await cp(join(repo, name), join(root, name), { recursive: true });
  }
  await symlink(join(repo, "node_modules"), join(root, "node_modules"), "junction");
  const target = join(root, "test-vault-plugin");
  return {root, target, env: {...process.env, OBSIDIAN_PLUGIN_DIR: target}};
}

test("production builds are reproducible and copy the exact assets", async t => {
  const {root, target, env} = await fixture(t);
  const run = () => execute(process.execPath, ["esbuild.config.mjs", "production"], {cwd: root, env});
  await run();
  const before = await readFile(join(root, "main.js"), "utf8");
  await run();
  assert.equal(await readFile(join(root, "main.js"), "utf8"), before);
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    assert.deepEqual(await readFile(join(root, name)), await readFile(join(target, name)));
  }
});

test("watch mode deploys both the first build and a subsequent source change", {timeout: 15000}, async t => {
  const {root, target, env} = await fixture(t);
  const child = spawn(process.execPath, ["esbuild.config.mjs"], {cwd: root, env, stdio: "pipe"});
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  async function waitFor(predicate) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      try {
        const content = await readFile(join(target, "main.js"), "utf8");
        if (predicate(content)) return content;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(40);
    }
    throw new Error(`Watch build timed out: ${output}`);
  }
  const initial = await waitFor(content => content.length > 0);
  const sourcePath = join(root, "src", "view.ts");
  const source = await readFile(sourcePath, "utf8");
  await writeFile(sourcePath, source.replace('return "文件列表";', 'return "WATCH_REBUILD_OK";'));
  const rebuilt = await waitFor(content => content.includes("WATCH_REBUILD_OK"));
  assert.notEqual(rebuilt, initial);
  assert.equal(rebuilt, await readFile(join(root, "main.js"), "utf8"));
});
