import assert from "node:assert/strict";
import test from "node:test";
import { loadPlugin, makeView, TFile, TFolder, flushFrames, pendingFrames, resizeObservers } from "./helpers.mjs";

const api = await loadPlugin();

test("native takeover during unload and a fresh plugin startup retain the saved directory", async () => {
  const {view: unused, plugin: host, workspace, add} = await makeView(api, 0);
  await unused.onClose();
  add(new TFolder("Projects"));
  let disk;
  const first = new api.FolderNavPlugin();
  first.app = host.app;
  first.settings = api.normalizeSettings(null);
  first.saveData = async snapshot => { disk = JSON.parse(JSON.stringify(snapshot)); };
  let activePlugin = first;
  let operation;
  const leaf = {
    type: api.VIEW_TYPE,
    getViewState() { return {type: this.type, state: {sortOrder: "alphabetical", autoReveal: false}}; },
    setViewState(state) {
      operation = (async () => {
        if (this.view instanceof api.FolderNavView) await this.view.onClose();
        this.type = state.type;
        if (state.type === api.VIEW_TYPE) {
          this.view = new api.FolderNavView(this, activePlugin);
          await this.view.onOpen();
        } else this.view = {};
      })();
      return operation;
    },
  };
  workspace.getLeavesOfType = type => leaf.type === type ? [leaf] : [];
  leaf.view = new api.FolderNavView(leaf, first);
  await leaf.view.onOpen();
  leaf.view.navigateTo("Projects");
  new api.FileExplorerTakeover(first).restoreOnUnload();
  await operation;
  assert.equal(leaf.type, "file-explorer");
  assert.equal(disk.navigation.currentPath, "Projects");

  const reopened = new api.FolderNavPlugin();
  reopened.app = host.app;
  reopened.settings = api.normalizeSettings(disk);
  reopened.saveData = async snapshot => { disk = JSON.parse(JSON.stringify(snapshot)); };
  activePlugin = reopened;
  const takeover = new api.FileExplorerTakeover(reopened);
  takeover.enable();
  await operation;
  assert.equal(leaf.type, api.VIEW_TYPE);
  assert.equal(leaf.view.currentPath, "Projects");
  takeover.restoreOnUnload();
  await operation;
});

test("a fresh view restores the directory, history, selection, and scroll from saved data", async () => {
  const {view, plugin, add} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  const b = add(new TFolder("A/B"), a);
  add(new TFolder("A/B/C"), b);
  add(new TFile("A/B/note.md"), b);
  let disk;
  plugin.saveSettings = async () => { disk = JSON.parse(JSON.stringify(plugin.settings)); };

  view.navigateTo("A"); view.navigateTo("A/B"); view.navigateTo("A/B/C"); view.goBack();
  view.select("A/B/note.md", false);
  view.listEl.scrollTop = 135;
  view.listEl.dispatch("scroll");
  // A hidden sidebar can report zero before the view's close handler runs.
  view.listEl.clientHeight = 0;
  view.listEl.scrollTop = 0;
  await view.onClose(); // Also flushes a pending scroll save.

  const reopenedPlugin = {...plugin, settings: api.normalizeSettings(disk)};
  reopenedPlugin.saveSettings = async () => {};
  const reopened = new api.FolderNavView({}, reopenedPlugin);
  await reopened.onOpen();
  assert.equal(reopened.currentPath, "A/B");
  assert.equal(reopened.selectedPath, "A/B/note.md");
  assert.equal(reopened.rows.get("A/B/note.md").el.classes.has("is-selected"), true);
  assert.equal(reopened.listEl.scrollTop, 135);
  assert.equal(reopened.canGoBack, true);
  assert.equal(reopened.canGoForward, true);
  reopened.goForward(); assert.equal(reopened.currentPath, "A/B/C");
  reopened.goBack(); reopened.goBack(); assert.equal(reopened.currentPath, "A");
  await reopened.onClose();
});

test("a missing saved folder restores its nearest ancestor and discards the old selection and scroll", async () => {
  const {view, plugin, add, files} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  const b = add(new TFolder("A/B"), a);
  add(new TFile("A/B/note.md"), b);
  view.navigateTo("A/B"); view.select("A/B/note.md", false); view.listEl.scrollTop = 90;
  await view.onClose();
  const settings = api.normalizeSettings(JSON.parse(JSON.stringify(plugin.settings)));
  files.delete("A/B"); files.delete("A/B/note.md"); a.children = [];
  const reopened = new api.FolderNavView({}, {...plugin, settings});
  await reopened.onOpen();
  assert.equal(reopened.currentPath, "A");
  assert.equal(reopened.history[reopened.historyIndex], "A");
  assert.equal(reopened.selectedPath, null);
  assert.equal(reopened.listEl.scrollTop, 0);
  assert.equal(settings.navigation.currentPath, "A");
  await reopened.onClose();
});

test("a renamed folder in back history is persisted even when it is not the current folder", async () => {
  const {view, plugin, add, files} = await makeView(api, 0);
  const folder = add(new TFolder("A"));
  add(new TFolder("B"));
  view.navigateTo("A"); view.navigateTo("B");
  files.delete("A"); folder.path = "Renamed"; folder.name = "Renamed"; files.set(folder.path, folder);
  view.onRenamed(folder, "A");
  await view.onClose();
  const reopened = new api.FolderNavView({}, {...plugin, settings: api.normalizeSettings(plugin.settings)});
  await reopened.onOpen();
  reopened.goBack(); assert.equal(reopened.currentPath, "Renamed");
  await reopened.onClose();
});

test("layout restoration ignores startup file-open events until the workspace is ready", async () => {
  const {view, plugin, add, workspace} = await makeView(api, 0);
  add(new TFolder("A"));
  const file = add(new TFile("root.md"));
  view.navigateTo("A"); await view.onClose();
  plugin.settings.autoReveal = true;
  workspace.layoutReady = false;
  let ready;
  workspace.onLayoutReady = callback => { ready = callback; };
  const reopened = new api.FolderNavView({}, plugin);
  await reopened.onOpen();
  reopened.onFileOpen(file); assert.equal(reopened.currentPath, "A");
  workspace.layoutReady = true; ready();
  reopened.onFileOpen(file); assert.equal(reopened.currentPath, "");
  await reopened.onClose();
});

test("invalid saved navigation falls back to a safe history and scroll position", () => {
  assert.equal(api.normalizeSettings({navigation: {currentPath: 3}}).navigation, null);
  const restored = api.normalizeSettings({navigation: {
    currentPath: "A", history: ["", 3, "A"], historyIndex: 2,
    selectedPath: {}, scrollTop: -Infinity,
  }}).navigation;
  assert.equal(restored.currentPath, "A");
  assert.deepEqual(Array.from(restored.history), ["A"]);
  assert.equal(restored.historyIndex, 0);
  assert.equal(restored.selectedPath, null);
  assert.equal(restored.scrollTop, 0);
});

test("root breadcrumb uses an accessible home icon while the full-path menu retains the vault name", async () => {
  const {view, add} = await makeView(api, 0);
  const root = view.crumbParts[0].el.children[0];
  assert.equal(root.icon, "house");
  assert.equal(root.textContent, "");
  assert.equal(root.dataset.path, "");
  assert.equal(root.getAttribute("aria-label"), "库根目录：Test vault");
  add(new TFolder("A")); view.navigateTo("A");
  const home = view.crumbParts[0].el.children[0];
  assert.equal(home.icon, "house");
  assert.equal(home.textContent, "");
  assert.equal(view.crumbs[0].label, "Test vault");
  home.dispatch("click"); assert.equal(view.currentPath, "");
  await view.onClose();
});

test("toolbar separates browser history from parent/root navigation", async () => {
  const {view, add} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  add(new TFolder("A/B"), a);
  add(new TFolder("C"));
  assert.equal(view.backEl.disabled, true);
  assert.equal(view.forwardEl.disabled, true);
  assert.equal(view.upEl.disabled, true);
  assert.equal(view.homeEl.disabled, true);
  view.navigateTo("A"); view.navigateTo("A/B");
  view.goBack(); assert.equal(view.currentPath, "A");
  assert.equal(view.forwardEl.disabled, false);
  view.goForward(); assert.equal(view.currentPath, "A/B");
  view.goUp(); assert.equal(view.currentPath, "A");
  view.goBack(); assert.equal(view.currentPath, "A/B");
  view.navigateTo("C");
  assert.equal(view.canGoForward, false);
  view.homeEl.dispatch("click"); assert.equal(view.currentPath, "");
  assert.equal(view.upEl.disabled, true);
  await view.onClose();
});

test("a repeated location creates no history and preserves the forward branch", async () => {
  const {view, add} = await makeView(api, 0);
  add(new TFolder("A"));
  view.navigateTo("A"); view.goBack();
  const history = Array.from(view.history);
  view.navigateTo("");
  assert.deepEqual(Array.from(view.history), history);
  assert.equal(view.canGoForward, true);
  view.goForward(); assert.equal(view.currentPath, "A");
  await view.onClose();
});

test("forward history follows renamed folders and handles subsequently deleted folders", async () => {
  const {view, add, files} = await makeView(api, 0);
  const a = add(new TFolder("A"));
  const b = add(new TFolder("A/B"), a);
  view.navigateTo("A/B"); view.goBack();
  files.delete("A/B"); b.path = "A/C"; b.name = "C"; files.set(b.path, b);
  view.onRenamed(b, "A/B"); flushFrames();
  view.goForward(); assert.equal(view.currentPath, "A/C");
  view.goBack(); files.delete(b.path);
  view.goForward(); assert.equal(view.currentPath, "A");
  await view.onClose();
});

test("history shortcuts work in an empty directory without stealing button Enter", async () => {
  const {view, add, opened} = await makeView(api, 2);
  add(new TFolder("A"));
  view.navigateTo("A");
  const press = (key, extra = {}) => view.onKeyDown({key, target: view.listEl, preventDefault() {}, ...extra});
  press("ArrowLeft", {altKey: true}); assert.equal(view.currentPath, "");
  press("ArrowRight", {altKey: true}); assert.equal(view.currentPath, "A");
  press("ArrowUp", {altKey: true}); assert.equal(view.currentPath, "");
  view.select("Note 0.md");
  view.onKeyDown({key: "Enter", target: view.backEl, preventDefault() {}});
  assert.equal(opened.length, 0);
  press("]", {ctrlKey: true});
  await view.onClose();
});

test("path fitting retains nearby ancestors, expands with room, and handles extreme widths", () => {
  assert.equal(api.firstVisibleCrumb([60, 60, 60, 60], 500, 32, 16), 0);
  assert.equal(api.firstVisibleCrumb([60, 60, 60, 60], 270, 32, 16), 1);
  assert.equal(api.firstVisibleCrumb([60, 60, 60, 60], 240, 32, 16), 2);
  assert.equal(api.firstVisibleCrumb([60, 60, 60, 60], 150, 32, 16), 3);
  assert.equal(api.firstVisibleCrumb([500, 500], 200, 32, 16), 0);
  assert.equal(api.firstVisibleCrumb([500, 500], 100, 32, 16), 1);
  assert.equal(api.firstVisibleCrumb([800], 20, 32, 16), 0);
});

test("complete path menu supports ancestor jumps, current marker and Escape focus return", async () => {
  const {view, add} = await makeView(api, 0);
  let path = "", parent;
  for (let i = 0; i < 6; i++) {
    path += (path ? "/" : "") + `Long folder ${i}`;
    parent = add(new TFolder(path), parent);
  }
  view.navigateTo(path);
  assert.equal(view.overflowEl.hidden, false);
  view.overflowEl.dispatch("click");
  const menu = view.pathMenu;
  assert.equal(menu.buttons.length, 7);
  assert.equal(menu.buttons[6].getAttribute("aria-current"), "location");
  menu.onKeyDown({key: "Escape", preventDefault() {}, stopPropagation() {}});
  assert.equal(view.pathMenu, null);
  assert.equal(view.contentEl.ownerDocument.activeElement, view.overflowEl);
  view.overflowEl.dispatch("click");
  view.pathMenu.onKeyDown({key: "Home", preventDefault() {}, stopPropagation() {}});
  view.pathMenu.buttons[0].dispatch("click");
  assert.equal(view.currentPath, "");
  assert.equal(view.canGoBack, true);
  assert.equal(view.pathMenu, null);
  await view.onClose();
});

test("resize refits only the path and view close releases observers and queued layout", async () => {
  const before = resizeObservers.size;
  const {view, add} = await makeView(api, 0);
  const a = add(new TFolder("A very long parent folder"));
  add(new TFolder("A very long parent folder/A very long child folder"), a);
  view.navigateTo("A very long parent folder/A very long child folder");
  let renders = 0;
  view.renderList = () => { renders++; };
  view.crumbEl.clientWidth = 90;
  view.crumbObserver.callback(); flushFrames();
  assert.equal(view.crumbParts.filter(part => !part.el.hidden).length, 1);
  view.crumbEl.clientWidth = 2000;
  view.crumbObserver.callback(); flushFrames();
  assert.equal(view.overflowEl.hidden, true);
  assert.equal(renders, 0);
  view.crumbObserver.callback();
  await view.onClose();
  assert.equal(pendingFrames(), 0);
  assert.equal(resizeObservers.size, before);
});
