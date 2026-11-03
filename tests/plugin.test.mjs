import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadPlugin, makeView, TFile, TFolder, Menu, openedModals,
  metrics, resetMetrics, flushFrames, pendingFrames } from "./helpers.mjs";

const api = await loadPlugin();

test("fork identity is independent of the upstream plugin and its view namespace", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const versions = JSON.parse(await readFile(new URL("../versions.json", import.meta.url), "utf8"));
  assert.notEqual(manifest.id, "folder-nav");
  assert.equal(manifest.id, "folder-nav-ooeooo");
  assert.equal(api.VIEW_TYPE, `${manifest.id}-view`);
  assert.equal(pkg.name, manifest.id);
  assert.equal(pkg.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  const {view} = await makeView(api, 0);
  assert.equal(view.getViewType(), "folder-nav-ooeooo-view");
  await view.onClose();
});

test("malformed settings fall back to independent, validated defaults", () => {
  for (const input of [null, [], 42, {recentColors: 42, hiddenExtensions: null, enabled: "false"}]) {
    const settings = api.normalizeSettings(input);
    assert.equal(settings.enabled, true);
    assert.equal(settings.hiddenExtensions, api.DEFAULT_SETTINGS.hiddenExtensions);
    assert.equal(settings.recentColors.length, 0);
  }
  const settings = api.normalizeSettings({folderColors: {A: "blue", B: "invalid"}, recentColors: ["blue", "blue", 42, "invalid", "red"], colorWash: 90});
  assert.deepEqual(Object.entries(settings.folderColors), [["A", "blue"]]);
  assert.equal(settings.colorWash, 50);
  assert.deepEqual(Array.from(settings.recentColors), ["blue", "red"]);
  settings.folderColors.A = "red";
  assert.equal(api.normalizeSettings(null).folderColors.A, undefined);
});

test("folder paths respect boundaries and rebase descendants only", () => {
  assert.equal(api.isWithin("Notes 2/a", "Notes"), false);
  assert.equal(api.rebasePath("Notes/sub/a.md", "Notes", "Archive"), "Archive/sub/a.md");
  assert.equal(api.rebasePath("Notes 2/a.md", "Notes", "Archive"), "Notes 2/a.md");
});

test("root filtering follows edited extension settings without hiding folders", () => {
  const settings = api.normalizeSettings({hideRootFiles: true, hiddenExtensions: ".PNG, jpg"});
  const children = [new TFile("a.PNG"), new TFile("b.md"), new TFolder("c.png")];
  assert.deepEqual(Array.from(api.applyRootFilter(children, true, settings), f => f.path), ["b.md", "c.png"]);
  settings.hiddenExtensions = "md";
  assert.deepEqual(Array.from(api.applyRootFilter(children, true, settings), f => f.path), ["a.PNG", "c.png"]);
  assert.equal(api.applyRootFilter(children, false, settings), children);
});

test("unchanged refresh reuses 2,000 rows without allocating DOM or listeners", async () => {
  const {view} = await makeView(api, 2000);
  const rows = [...view.listEl.children];
  view.listEl.scrollTop = 120;
  resetMetrics();
  view.refresh(); flushFrames();
  assert.equal(metrics.elements, 0);
  assert.equal(metrics.listeners, 0);
  assert.equal(metrics.icons, 0);
  assert.equal(metrics.mutations, 0);
  assert.equal(view.listEl.scrollTop, 120);
  assert.deepEqual(view.listEl.children, rows);
  await view.onClose();
});

test("a burst of 1,000 vault events produces one render; close cancels pending work", async () => {
  const {view, vault, root} = await makeView(api);
  const render = view.render.bind(view);
  let renders = 0;
  view.render = () => { renders++; render(); };
  for (let i = 0; i < 1000; i++) {
    const file = new TFile(`New ${i}.md`); file.parent = root;
    vault.trigger("create", file);
  }
  assert.equal(pendingFrames(), 1);
  assert.equal(renders, 0);
  flushFrames();
  assert.equal(renders, 1);
  view.refresh();
  await view.onClose(); flushFrames();
  assert.equal(renders, 1);
});

test("selection updates at most the previous and next row", async () => {
  const {view} = await makeView(api, 2000);
  view.select("Note 1.md");
  resetMetrics();
  view.select("Note 2.md");
  assert.equal(metrics.classes, 2);
  assert.equal(view.rows.get("Note 1.md").el.classes.has("is-selected"), false);
  assert.equal(view.rows.get("Note 2.md").el.classes.has("is-selected"), true);
  await view.onClose();
});

test("incremental insert, removal, reordering and extension changes preserve surviving nodes", async () => {
  const {view, root, add, files, plugin} = await makeView(api, 3);
  const survivor = view.rows.get("Note 1.md").el;
  add(new TFile("A.md"));
  view.refresh(); flushFrames();
  assert.deepEqual(view.listEl.children.map(row => row.dataset.path), ["A.md", "Note 0.md", "Note 1.md", "Note 2.md"]);
  root.children = root.children.filter(file => file.path !== "Note 0.md"); files.delete("Note 0.md");
  plugin.settings.nativeSortOrder = "alphabetical-reverse";
  plugin.settings.showExtensions = false;
  view.refresh(); flushFrames();
  assert.deepEqual(view.listEl.children.map(row => row.dataset.path), ["Note 2.md", "Note 1.md", "A.md"]);
  assert.equal(view.rows.get("Note 1.md").el, survivor);
  assert.equal(view.rows.get("Note 1.md").nameEl.textContent, "Note 1");
  root.children = [];
  view.refresh(); flushFrames();
  assert.equal(view.rows.size, 0);
  assert.equal(view.listEl.children.length, 0);
  assert.equal(view.emptyEl.hidden, false);
  await view.onClose();
});

test("delegated clicks resolve the file from a nested row element", async () => {
  const {view, opened} = await makeView(api);
  const row = view.rows.get("Note 1.md");
  row.nameEl.dispatch("click");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].path, "Note 1.md");
  await view.onClose();
});

test("coalesced delete/create replaces a row when a path changes between file and folder", async () => {
  const {view, root, files, add, vault} = await makeView(api, 2);
  const previous = root.children[0];
  root.children.splice(0, 1); files.delete(previous.path);
  vault.trigger("delete", previous);
  const folder = add(new TFolder(previous.path));
  vault.trigger("create", folder); flushFrames();
  const row = view.rows.get(folder.path);
  assert.equal(row.isFolder, true);
  assert.equal(row.el.classes.has("is-folder"), true);
  assert.equal(row.el.classes.has("is-file"), false);
  assert.equal(row.el.children.length, 3);
  row.nameEl.dispatch("click");
  assert.equal(view.currentPath, folder.path);
  await view.onClose();
});

test("renaming an ancestor rebases current path, selection and all history", async () => {
  const {view, add, files} = await makeView(api, 0);
  const ancestor = add(new TFolder("A"));
  const nested = add(new TFolder("A/sub"), ancestor);
  const note = add(new TFile("A/sub/note.md"), nested);
  view.navigateTo("A"); view.navigateTo("A/sub"); view.select(note.path);
  for (const file of [ancestor, nested, note]) {
    files.delete(file.path); file.path = file.path.replace(/^A/, "B"); files.set(file.path, file);
  }
  view.onRenamed(ancestor, "A"); flushFrames();
  assert.equal(view.currentPath, "B/sub");
  assert.equal(view.selectedPath, "B/sub/note.md");
  assert.deepEqual(Array.from(view.history), ["", "B", "B/sub"]);
  view.goBack(); assert.equal(view.currentPath, "B");
  await view.onClose();
});

test("deleted ancestors and stale history fall back to the nearest surviving folder", async () => {
  const {view, add, files} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  const b = add(new TFolder("A/B"), a);
  add(new TFolder("A/B/C"), b);
  view.navigateTo("A/B/C");
  files.delete("A/B/C"); files.delete("A/B");
  view.onVaultChanged(b);
  assert.equal(view.currentPath, "A");
  view.goBack();
  assert.equal(view.currentPath, "A");
  await view.onClose();
});

test("modifications only trigger repaint when the visible sort depends on mtime", async () => {
  const {view, vault, root, plugin} = await makeView(api, 2);
  const [first, second] = root.children;
  first.stat.mtime = 1; second.stat.mtime = 2;
  vault.trigger("modify", first);
  assert.equal(pendingFrames(), 0);
  plugin.settings.nativeSortOrder = "by-modified-time-reverse";
  first.stat.mtime = 3;
  vault.trigger("modify", first); flushFrames();
  assert.deepEqual(view.listEl.children.map(row => row.dataset.path), [first.path, second.path]);
  await view.onClose();
});

test("root menu offers creation without destructive root operations", () => {
  const menu = new Menu();
  api.addCoreFileMenuItems({}, menu, new TFolder(""));
  assert.deepEqual(menu.items.map(item => item.title), ["新建笔记", "新建文件夹"]);
});

test("move picker excludes a folder subtree without excluding similarly named siblings", async () => {
  const {view, plugin, root, add} = await makeView(api, 0);
  const a = add(new TFolder("A")); add(new TFolder("A/sub"), a);
  add(new TFolder("A2"));
  const menu = new Menu();
  api.addCoreFileMenuItems(plugin.app, menu, a);
  menu.items.find(item => item.title === "移动文件夹到…").callback();
  const picker = openedModals.pop();
  assert.deepEqual(Array.from(picker.getItems(), folder => folder.path), [root.path, "A2"]);
  await view.onClose();
});
