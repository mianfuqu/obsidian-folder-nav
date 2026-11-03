import assert from "node:assert/strict";
import test from "node:test";
import { loadPlugin, makeView, TFolder, flushFrames, pendingFrames, resizeObservers } from "./helpers.mjs";

const api = await loadPlugin();

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
