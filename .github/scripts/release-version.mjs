import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Expected an Obsidian version in X.Y.Z format: ${value}`);
  }
  return value.split(".").map(BigInt);
}

export function releaseInfo(manifest, previous, eventName) {
  const current = parseVersion(manifest.version);
  parseVersion(manifest.minAppVersion);
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) {
    throw new Error("manifest.id must contain lowercase letters, digits, and hyphens");
  }
  let changed = true;
  if (eventName !== "workflow_dispatch" && previous) {
    const before = parseVersion(previous.version);
    const index = current.findIndex((part, i) => part !== before[i]);
    if (index !== -1 && current[index] < before[index]) {
      throw new Error(`Plugin version must increase: ${previous.version} -> ${manifest.version}`);
    }
    changed = index !== -1;
  }
  return { changed, version: manifest.version, id: manifest.id };
}

function previousManifest(before, root) {
  if (!before || /^0+$/.test(before)) return null;
  if (!/^[a-f0-9]{40}$/i.test(before)) throw new Error("Invalid previous commit SHA");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  // An unavailable commit is an error, rather than evidence of a new version.
  git("cat-file", "-e", `${before}^{commit}`);
  if (!git("ls-tree", "--name-only", before, "--", "manifest.json").trim()) return null;
  return JSON.parse(git("show", `${before}:manifest.json`));
}

export function detectRelease(root, eventName, event) {
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(`Unsupported release event: ${eventName}`);
  }
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  const previous = eventName === "push" ? previousManifest(event.before, root) : null;
  return releaseInfo(manifest, previous, eventName);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const info = detectRelease(process.cwd(), process.env.GITHUB_EVENT_NAME, event);
  appendFileSync(process.env.GITHUB_OUTPUT,
    `changed=${info.changed}\nversion=${info.version}\nid=${info.id}\n`);
  console.log(info.changed ? `Prepare plugin release ${info.version}` : "Plugin version unchanged; skipping release");
}
