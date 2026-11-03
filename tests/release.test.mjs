import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectRelease, releaseInfo } from "../.github/scripts/release-version.mjs";

const manifest = { id: "folder-nav-ooeooo", name: "Folder Nav (ooeooo)", version: "0.2.4", minAppVersion: "1.8.7" };

test("release detection ignores description edits and detects numeric version increases", () => {
  assert.equal(releaseInfo(manifest, {...manifest, description: "previous"}, "push").changed, false);
  assert.equal(releaseInfo(manifest, {...manifest, version: "0.2.3"}, "push").changed, true);
  assert.equal(releaseInfo({...manifest, version: "0.10.0"}, manifest, "push").changed, true);
  assert.throws(() => releaseInfo({...manifest, version: "0.2.3"}, manifest, "push"), /must increase/);
});

test("initial and manual releases work without a previous manifest", () => {
  assert.equal(releaseInfo(manifest, null, "push").changed, true);
  assert.equal(releaseInfo(manifest, manifest, "workflow_dispatch").changed, true);
});

test("invalid versions and unsafe asset names are rejected", () => {
  for (const version of ["v0.2.4", "0.2", "0.2.4-beta", "00.2.4", "0.2.4\nchanged=true"]) {
    assert.throws(() => releaseInfo({...manifest, version}, null, "push"), /X.Y.Z/);
  }
  assert.throws(() => releaseInfo({...manifest, id: "../bad"}, null, "push"), /manifest.id/);
  assert.throws(() => releaseInfo({...manifest, minAppVersion: "bad"}, null, "push"), /X.Y.Z/);
  assert.throws(() => releaseInfo({...manifest, name: "title\nchanged=true"}, null, "push"), /single-line/);
  assert.equal(releaseInfo(manifest, null, "push").name, "Folder Nav (ooeooo)");
});

test("push detection reads the event's previous commit, including multi-commit pushes", t => {
  const scratch = resolve("work");
  mkdirSync(scratch, {recursive: true});
  const root = mkdtempSync(resolve(scratch, "release-test-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
  git("init", "--quiet");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  const commit = value => {
    writeFileSync(resolve(root, "manifest.json"), JSON.stringify(value));
    git("add", "manifest.json"); git("commit", "--quiet", "-m", "test manifest");
    return git("rev-parse", "HEAD");
  };
  const before = commit({...manifest, version: "0.2.3"});
  commit(manifest);
  commit({...manifest, description: "another commit in the same push"});
  assert.equal(detectRelease(root, "push", {before}).changed, true);
  assert.equal(detectRelease(root, "push", {before: git("rev-parse", "HEAD")}).changed, false);
  assert.equal(detectRelease(root, "workflow_dispatch", {}).version, "0.2.4");
  assert.equal(detectRelease(root, "push", {before: "0".repeat(40)}).changed, true);
  assert.throws(() => detectRelease(root, "push", {before: "HEAD; bad"}), /commit SHA/);
  assert.throws(() => detectRelease(root, "pull_request", {}), /Unsupported/);
});
