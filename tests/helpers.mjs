import { build } from "esbuild";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const metrics = { elements: 0, listeners: 0, mutations: 0, classes: 0, icons: 0 };
export function resetMetrics() {
  for (const key of Object.keys(metrics)) metrics[key] = 0;
}

const frames = new Map();
let frameId = 0;
export const resizeObservers = new Set();
class ResizeObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.add(this); }
  observe(target) { this.targets.add(target); }
  disconnect() { this.targets.clear(); resizeObservers.delete(this); }
}
export const viewWindow = {
  requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame(id) { frames.delete(id); },
  ResizeObserver,
  innerWidth: 1024, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
};
export function flushFrames() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(0));
}
export function pendingFrames() { return frames.size; }

// A small DOM double records actual allocations and mutations. It deliberately
// does not simulate layout or timing; browser performance needs separate profiling.
export class Element {
  constructor(options = {}, fragment = false) {
    if (!fragment) metrics.elements++;
    this.fragment = fragment;
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = document;
    this.dataset = {};
    this.classes = new Set((options.cls ?? "").split(" ").filter(Boolean));
    this.textContent = options.text ?? "";
    this.events = new Map();
    const styles = new Map();
    this.style = { setProperty(name, value) { styles.set(name, value); },
      removeProperty(name) { styles.delete(name); }, getPropertyValue(name) { return styles.get(name) ?? ""; } };
    this.attributes = new Map();
    this.scrollTop = 0;
  }
  createDiv(options = {}) { return this.appendChild(new Element(options)); }
  createSpan(options = {}) { return this.appendChild(new Element(options)); }
  createEl(_tag, options = {}) { return this.appendChild(new Element(options)); }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, anchor) {
    if (anchor !== null && anchor.parentElement !== this) throw new Error("Invalid insertion anchor");
    metrics.mutations++;
    if (child.fragment) {
      for (const entry of [...child.children]) this.insertBefore(entry, anchor);
      return child;
    }
    child.remove();
    const index = anchor === null ? this.children.length : this.children.indexOf(anchor);
    this.children.splice(index, 0, child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (!this.parentElement) return;
    metrics.mutations++;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  empty() { for (const child of [...this.children]) child.remove(); }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  addClass(value) { metrics.classes++; this.classes.add(value); }
  removeClass(value) { metrics.classes++; this.classes.delete(value); }
  toggleClass(value, enabled) { metrics.classes++; if (enabled) this.classes.add(value); else this.classes.delete(value); }
  setText(text) { this.textContent = text; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get clientWidth() { return this._clientWidth ?? 240; }
  set clientWidth(value) { this._clientWidth = value; }
  getBoundingClientRect() {
    const width = this.classes.has("folder-nav-crumb-sep") ? 16
      : this.classes.has("folder-nav-path-menu") ? 360
      : this.textContent.length * 8 + 8;
    return {x: 0, y: 0, left: 0, top: 0, width, height: this.children.length * 20 + 32,
      right: width, bottom: 32};
  }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  closest(selector) {
    if (!selector.startsWith(".")) return null;
    const name = selector.replace(/^\./, "");
    for (let current = this; current; current = current.parentElement) if (current.classes.has(name)) return current;
    return null;
  }
  addEventListener(name, callback) {
    metrics.listeners++;
    const listeners = this.events.get(name) ?? [];
    listeners.push(callback);
    this.events.set(name, listeners);
  }
  removeEventListener(name, callback) {
    this.events.set(name, (this.events.get(name) ?? []).filter(value => value !== callback));
  }
  dispatch(name, target = this) {
    const event = { target, preventDefault() {}, key: "" };
    for (let current = this; current; current = current.parentElement) {
      for (const callback of current.events.get(name) ?? []) callback(event);
    }
  }
}
const document = {
  defaultView: viewWindow,
  activeElement: null,
  createDocumentFragment() { return new Element({}, true); },
  addEventListener() {}, removeEventListener() {},
};
document.body = new Element();

export class TAbstractFile {
  constructor(path) { this.path = path; this.name = path.split("/").at(-1); this.parent = null; }
}
export class TFolder extends TAbstractFile {
  constructor(path) { super(path); this.children = []; }
  isRoot() { return this.path === "" || this.path === "/"; }
}
export class TFile extends TAbstractFile {
  constructor(path) {
    super(path);
    this.extension = this.name.includes(".") ? this.name.split(".").at(-1) : "";
    this.stat = { mtime: 0, ctime: 0 };
  }
}
class Component {
  registerDomEvent(el, name, callback) { el.addEventListener(name, callback); }
  registerEvent(ref) { return ref; }
}
class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.containerEl = new Element();
    this.contentEl = this.containerEl.createDiv();
  }
}
export const openedModals = [];
class Modal {
  constructor(app) { this.app = app; this.contentEl = new Element(); }
  setPlaceholder() {}
  open() { openedModals.push(this); }
}
export class Menu {
  items = [];
  addItem(callback) {
    const item = {
      setTitle(title) { this.title = title; return this; },
      setIcon() { return this; },
      setSection() { return this; },
      onClick(callback) { this.callback = callback; return this; },
    };
    callback(item);
    this.items.push(item);
  }
  showAtMouseEvent() {}
}
const obsidian = {
  ItemView, TAbstractFile, TFolder, TFile, Menu, Modal, FuzzySuggestModal: Modal,
  Plugin: Component, PluginSettingTab: Component, Notice: class {},
  normalizePath: path => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
  setIcon() { metrics.icons++; },
};

export async function loadPlugin() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/config.ts";',
        'export * from "./src/paths.ts";',
        'export * from "./src/sort.ts";',
        'export * from "./src/view.ts";',
        'export * from "./src/fileActions.ts";',
        'export * from "./src/takeover.ts";',
        'export * from "./src/breadcrumb.ts";',
        'export * from "./src/border.ts";',
        'export { default as FolderNavPlugin } from "./src/main.ts";',
      ].join("\n"),
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    },
    bundle: true, write: false, format: "cjs", platform: "node", external: ["obsidian"],
  });
  return loadBundle(result.outputFiles[0].text);
}

export function loadBundle(code) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, document, window: viewWindow,
    createDiv: options => new Element(options),
    createFragment: () => document.createDocumentFragment(),
    require: name => {
      if (name !== "obsidian") throw new Error(`Unexpected runtime dependency: ${name}`);
      return obsidian;
    },
  });
  return module.exports;
}

function emitter() {
  const callbacks = new Map();
  return {
    on(name, callback) {
      const refs = callbacks.get(name) ?? [];
      refs.push(callback); callbacks.set(name, refs); return { name, callback };
    },
    trigger(name, ...args) { for (const callback of callbacks.get(name) ?? []) callback(...args); },
    offref(ref) { callbacks.set(ref.name, (callbacks.get(ref.name) ?? []).filter(value => value !== ref.callback)); },
  };
}

export async function makeView(api, count = 3) {
  const root = new TFolder("");
  const files = new Map([["", root]]);
  const opened = [];
  const vault = Object.assign(emitter(), {
    getRoot: () => root, getName: () => "Test vault",
    getAbstractFileByPath: path => files.get(path) ?? null,
  });
  const workspace = Object.assign(emitter(), { getLeaf: () => ({openFile: file => { opened.push(file); }}), getActiveFile: () => null });
  const plugin = { settings: api.normalizeSettings(null), app: { vault, workspace } };
  function add(file, parent = root) {
    parent.children.push(file); file.parent = parent; file.vault = vault; files.set(file.path, file); return file;
  }
  for (let i = 0; i < count; i++) add(new TFile(`Note ${i}.md`));
  const view = new api.FolderNavView({}, plugin);
  await view.onOpen();
  return { view, plugin, vault, workspace, root, files, opened, add };
}
