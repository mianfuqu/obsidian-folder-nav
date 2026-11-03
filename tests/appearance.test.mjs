import assert from "node:assert/strict";
import test from "node:test";
import { loadPlugin, makeView, TFolder, TFile, flushFrames, metrics, resetMetrics } from "./helpers.mjs";

const api = await loadPlugin();

test("font settings migrate to theme defaults and clamp only valid numeric overrides", () => {
  assert.equal(api.normalizeSettings({}).pathFontSize, null);
  assert.equal(api.normalizeSettings({pathFontSize: "18", listFontSize: Infinity}).pathFontSize, null);
  assert.equal(api.normalizeSettings({listFontSize: Infinity}).listFontSize, null);
  const settings = api.normalizeSettings({pathFontSize: 30, listFontSize: 8});
  assert.equal(settings.pathFontSize, 22);
  assert.equal(settings.listFontSize, 12);
  assert.equal(api.normalizeSettings({pathFontSize: 15.6}).pathFontSize, 16);
});

test("font preview and theme reset do not rerender or allocate list rows", async () => {
  const {view, plugin} = await makeView(api, 1000);
  let renders = 0;
  view.renderList = () => { renders++; };
  resetMetrics();
  plugin.settings.pathFontSize = 20; plugin.settings.listFontSize = 18;
  view.refreshAppearance(); flushFrames();
  assert.equal(view.contentEl.style.getPropertyValue("--fn-path-size"), "20px");
  assert.equal(view.contentEl.style.getPropertyValue("--fn-list-size"), "18px");
  plugin.settings.pathFontSize = null; plugin.settings.listFontSize = null;
  view.refreshAppearance(); flushFrames();
  assert.equal(view.contentEl.style.getPropertyValue("--fn-path-size"), "");
  assert.equal(view.contentEl.style.getPropertyValue("--fn-list-size"), "");
  assert.equal(renders, 0);
  assert.equal(metrics.elements, 0);
  assert.equal(metrics.listeners, 0);
  await view.onClose();
});

test("Border colors use the full sibling position and inherit through first children", async () => {
  const {view, plugin, add} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  const b = add(new TFolder("B"));
  const c = add(new TFolder("C"));
  const child = add(new TFolder("B/First"), b);
  const grandchild = add(new TFolder("B/First/Nested"), child);
  const colors = new api.BorderFolderColors();
  assert.equal(colors.colorFor(a, plugin.settings), "currentColor");
  assert.equal(colors.colorFor(b, plugin.settings), "var(--color-red)");
  assert.equal(colors.colorFor(c, plugin.settings), "var(--color-orange)");
  assert.equal(colors.colorFor(grandchild, plugin.settings), "var(--color-red)");
  plugin.settings.sortMode = "folders-first";
  plugin.settings.hideRootFiles = true;
  assert.equal(colors.colorFor(b, plugin.settings), "var(--color-red)");
  view.navigateTo("B"); view.goBack();
  assert.equal(colors.colorFor(b, plugin.settings), "var(--color-red)");
  await view.onClose();
});

test("hidden files retain their Border slot and structure changes invalidate color order", async () => {
  const {view, plugin, add} = await makeView(api, 0);
  add(new TFile("A.png"));
  const b = add(new TFolder("B"));
  const c = add(new TFolder("C"));
  plugin.settings.hideRootFiles = true;
  view.refresh(); flushFrames();
  assert.equal(view.rows.get("B").borderColor, "var(--color-red)");
  assert.equal(view.rows.get("C").borderColor, "var(--color-orange)");
  b.name = "Z"; b.path = "Z";
  view.onRenamed(b, "B"); flushFrames();
  assert.equal(view.rows.get("C").borderColor, "var(--color-red)");
  await view.onClose();
});

test("manual folder icon overrides can be cleared to resume Border colors", async () => {
  const {view, plugin, add} = await makeView(api, 0);
  add(new TFolder("A")); add(new TFolder("B"));
  plugin.settings.folderColors.B = "blue";
  view.refresh(); flushFrames();
  const row = view.rows.get("B");
  assert.equal(row.el.style.getPropertyValue("--fn-manual-icon-color"), "#3e63dd");
  delete plugin.settings.folderColors.B;
  view.refresh(); flushFrames();
  assert.equal(row.el.style.getPropertyValue("--fn-manual-icon-color"), "");
  assert.equal(row.borderColor, "var(--color-red)");
  await view.onClose();
});

test("mtime changes update the native Border palette even in folders-first display mode", async () => {
  const {view, plugin, add, vault} = await makeView(api, 0);
  const first = add(new TFile("A.md")); first.stat.mtime = 1;
  const last = add(new TFile("Z.md")); last.stat.mtime = 4;
  add(new TFolder("B")); add(new TFolder("C"));
  plugin.settings.sortMode = "folders-first";
  plugin.settings.nativeSortOrder = "by-modified-time-reverse";
  view.refresh(); flushFrames();
  const order = Array.from(view.orderedPaths);
  assert.equal(view.rows.get("B").borderColor, "var(--color-orange)");
  last.stat.mtime = 0; vault.trigger("modify", last); flushFrames();
  assert.deepEqual(Array.from(view.orderedPaths), order);
  assert.equal(view.rows.get("B").borderColor, "var(--color-red)");
  await view.onClose();
});

test("slider saves coalesce bursts, serialize disk writes, and keep independent snapshots", async () => {
  const plugin = new api.FolderNavPlugin();
  plugin.settings = api.normalizeSettings(null);
  const writes = [];
  let release;
  plugin.saveData = async snapshot => {
    writes.push(snapshot);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  };
  plugin.saveSettings();
  plugin.settings.pathFontSize = 16;
  plugin.saveSettings();
  await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pathFontSize, 16);
  plugin.settings.pathFontSize = 18; plugin.saveSettings();
  plugin.settings.pathFontSize = 20; const done = plugin.saveSettings();
  release(); await done;
  assert.equal(writes.length, 2);
  assert.equal(writes[0].pathFontSize, 16);
  assert.equal(writes[1].pathFontSize, 20);
});
