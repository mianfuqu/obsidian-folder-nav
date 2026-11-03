import {
  ItemView,
  Menu,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type FolderNavPlugin from "./main";
import { buildCrumbs } from "./breadcrumb";
import { addCoreFileMenuItems } from "./fileActions";
import { ROW_TINT_ALPHA, resolveColorId, tintOf } from "./palette";
import { createRow, RenderedRow, updateRow } from "./render";
import { applyRootFilter, sortChildren } from "./sort";
import { isWithin, parentPath, rebasePath } from "./paths";

export const VIEW_TYPE = "folder-nav-view";

/** Vault root is represented by the empty string, matching Obsidian's own convention. */
const ROOT = "";

export class FolderNavView extends ItemView {
  plugin: FolderNavPlugin;

  private currentPath = ROOT;
  private history: string[] = [ROOT];
  private historyIndex = 0;
  private selectedPath: string | null = null;

  private backEl!: HTMLElement;
  private crumbEl!: HTMLElement;
  private listEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private rows = new Map<string, RenderedRow>();
  private orderedPaths: string[] = [];
  private rowIndexes = new Map<string, number>();
  private frame: number | null = null;
  private viewWindow!: Window;
  private opened = false;
  private crumbPath: string | null = null;
  private crumbVaultName: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: FolderNavPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    // Matches the native view so the sidebar tab is indistinguishable.
    return "文件列表";
  }

  getIcon(): string {
    return "folder-closed";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    this.viewWindow = root.ownerDocument.defaultView ?? window;
    this.opened = true;
    root.empty();
    root.addClass("folder-nav");

    const header = root.createDiv({ cls: "folder-nav-header" });

    this.backEl = header.createDiv({ cls: "folder-nav-back" });
    setIcon(this.backEl, "arrow-left");
    this.backEl.setAttribute("aria-label", "返回上一级");

    this.crumbEl = header.createDiv({ cls: "folder-nav-breadcrumb" });

    this.listEl = root.createDiv({ cls: "folder-nav-list" });
    this.listEl.tabIndex = 0;

    this.emptyEl = root.createDiv({ cls: "folder-nav-empty" });
    this.emptyEl.hide();

    this.registerDomEvent(this.backEl, "click", () => this.goBack());
    this.registerDomEvent(this.listEl, "click", (evt) => {
      const file = this.fileAtEvent(evt);
      if (file) this.openEntry(file);
    });
    // One handler on the container: row keydowns bubble up to it.
    this.registerDomEvent(this.containerEl, "keydown", (evt) => this.onKeyDown(evt));
    this.registerDomEvent(this.containerEl, "contextmenu", (evt) =>
      this.onContextMenu(evt)
    );
    // Clicking blank space in the list should arm the keyboard shortcuts.
    this.registerDomEvent(this.listEl, "mousedown", (evt) => {
      if (!(evt.target as HTMLElement).closest(".folder-nav-row")) this.listEl.focus();
    });

    this.registerEvent(this.plugin.app.vault.on("create", (file) => this.onVaultChanged(file)));
    this.registerEvent(this.plugin.app.vault.on("delete", (file) => this.onVaultChanged(file)));
    this.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) => this.onRenamed(file, oldPath))
    );
    this.registerEvent(this.plugin.app.vault.on("modify", (file) => {
      if (this.plugin.settings.sortMode === "native" &&
          this.plugin.settings.nativeSortOrder.startsWith("by-modified-time") &&
          this.parentPathOf(file) === this.currentPath) this.refresh();
    }));
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );

    this.render();
    this.listEl.focus();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.cancelRefresh();
    this.rows.clear();
    this.rowIndexes.clear();
    this.orderedPaths = [];
    this.crumbPath = null;
    this.crumbVaultName = null;
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------- navigation

  navigateTo(path: string, pushHistory = true): void {
    const target = this.normalize(path);
    if (target !== this.currentPath) {
      if (pushHistory) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(target);
        this.historyIndex = this.history.length - 1;
      }
    }
    this.currentPath = target;
    this.select(null, false);
    this.render();
    this.focusIfEngaged();
  }

  /** Falls back to the nearest surviving ancestor if `path` no longer exists. */
  private normalize(path: string): string {
    const vault = this.plugin.app.vault;
    while (path !== ROOT && !(vault.getAbstractFileByPath(path) instanceof TFolder)) {
      path = parentPath(path);
    }
    return path;
  }

  goBack(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.currentPath = this.normalize(this.history[this.historyIndex]);
    this.history[this.historyIndex] = this.currentPath;
    this.select(null, false);
    this.render();
    this.focusIfEngaged();
  }

  /**
   * Only reclaim focus if the sidebar already had it. Opening a note triggers a
   * reveal, and stealing focus from the editor mid-typing would be hostile.
   */
  private focusIfEngaged(): void {
    if (this.containerEl.contains(this.contentEl.ownerDocument.activeElement)) this.listEl.focus();
  }

  goUp(): void {
    if (this.currentPath === ROOT) return;
    const slash = this.currentPath.lastIndexOf("/");
    this.navigateTo(slash === -1 ? ROOT : this.currentPath.slice(0, slash));
  }

  /** Jumps to `file`'s folder and highlights it. */
  revealFile(file: TAbstractFile): void {
    const parent = this.parentPathOf(file);
    if (parent !== this.currentPath) this.navigateTo(parent);
    this.select(file.path);
  }

  revealActiveFile(): void {
    const file = this.plugin.app.workspace.getActiveFile();
    if (file) this.revealFile(file);
  }

  // ------------------------------------------------------------------ rendering

  /** Public hook so the plugin can re-render every open view after a setting change. */
  refresh(): void {
    if (!this.opened || this.frame !== null) return;
    // Vault imports and setting changes can emit many events in one frame.
    this.frame = this.viewWindow.requestAnimationFrame(() => {
      this.frame = null;
      if (this.opened) this.render();
    });
  }

  private cancelRefresh(): void {
    if (this.frame === null) return;
    this.viewWindow.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  render(): void {
    this.cancelRefresh();
    this.renderBreadcrumb();
    this.renderList();
    this.applyWash();
    this.backEl.toggleClass("is-disabled", this.historyIndex <= 0);
  }

  /**
   * Tints the whole view while standing inside a coloured folder — including
   * an inherited colour from a parent, so the cue survives drilling down.
   */
  private applyWash(): void {
    const { folderColors, colorWash } = this.plugin.settings;
    const colorId = resolveColorId(folderColors, this.currentPath);
    const wash = colorId && colorWash > 0 ? tintOf(colorId, colorWash / 100) : null;

    this.contentEl.toggleClass("has-wash", wash !== null);
    if (wash) this.contentEl.style.setProperty("--fn-wash", wash);
    else this.contentEl.style.removeProperty("--fn-wash");
  }

  /**
   * Only folders carry a colour, and only one assigned to them directly —
   * an inherited colour belongs to the wash, not to the row.
   */
  private tintFor(file: TAbstractFile): string | null {
    if (!(file instanceof TFolder)) return null;
    const colorId = this.plugin.settings.folderColors[file.path];
    return colorId ? tintOf(colorId, ROW_TINT_ALPHA) : null;
  }

  private currentFolder(): TFolder {
    const folder = this.plugin.app.vault.getAbstractFileByPath(this.currentPath);
    return folder instanceof TFolder ? folder : this.plugin.app.vault.getRoot();
  }

  private renderBreadcrumb(): void {
    const vaultName = this.plugin.app.vault.getName();
    if (this.crumbPath === this.currentPath && this.crumbVaultName === vaultName) return;
    this.crumbPath = this.currentPath;
    this.crumbVaultName = vaultName;
    this.crumbEl.empty();
    const crumbs = buildCrumbs(vaultName, this.currentPath);

    crumbs.forEach((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      const el = this.crumbEl.createDiv({ cls: "folder-nav-crumb", text: crumb.label });
      if (isLast) {
        el.addClass("is-current");
      } else {
        el.addEventListener("click", () => this.navigateTo(crumb.path));
        this.crumbEl.createSpan({ cls: "folder-nav-crumb-sep", text: "›" });
      }
    });

    // A long trail should show the deepest crumb, not the vault name.
    this.crumbEl.scrollLeft = this.crumbEl.scrollWidth;
  }

  private renderList(): void {
    const isRoot = this.currentPath === ROOT;
    const settings = this.plugin.settings;
    const children = sortChildren(
      applyRootFilter(this.currentFolder().children, isRoot, settings), settings
    );
    const visible = new Set(children.map((file) => file.path));
    for (const [path, row] of this.rows) {
      if (!visible.has(path)) row.el.remove();
    }
    const nextRows = new Map<string, RenderedRow>();
    this.orderedPaths = [];
    this.rowIndexes.clear();
    let cursor = this.listEl.firstElementChild;
    let additions: DocumentFragment | null = null;
    for (const file of children) {
      const options = { showExtensions: settings.showExtensions, tint: this.tintFor(file) };
      let row = this.rows.get(file.path);
      // Delete/create can replace a file with a folder at the same path before
      // the scheduled frame runs. Its structure must then be recreated.
      if (row && row.isFolder !== (file instanceof TFolder)) {
        if (row.el === cursor) cursor = cursor.nextElementSibling;
        row.el.remove();
        row = undefined;
      }
      if (row) {
        updateRow(row, file, options);
        if (additions) {
          this.listEl.insertBefore(additions, cursor);
          additions = null;
        }
        if (row.el === cursor) cursor = cursor.nextElementSibling;
        else this.listEl.insertBefore(row.el, cursor);
      } else {
        row = createRow(file, options);
        if (file.path === this.selectedPath) row.el.addClass("is-selected");
        additions ??= this.contentEl.ownerDocument.createDocumentFragment();
        additions.appendChild(row.el);
      }
      // Only changed positions touch the live DOM. Unchanged rows retain focus,
      // scroll position, and their SVG elements.
      nextRows.set(file.path, row);
      this.rowIndexes.set(file.path, this.orderedPaths.length);
      this.orderedPaths.push(file.path);
    }
    if (additions) this.listEl.insertBefore(additions, cursor);
    this.rows = nextRows;

    if (children.length === 0) {
      this.emptyEl.show();
      this.emptyEl.setText(
        isRoot && settings.hideRootFiles
          ? "根目录的散落文件已按设置隐藏"
          : "这个文件夹是空的"
      );
      return;
    }
    this.emptyEl.hide();
  }

  // --------------------------------------------------------------- interaction

  /**
   * Named `openEntry`, not `open`: View already defines `open()`, and that is
   * the method the workspace calls to mount the view. Shadowing it silently
   * prevents the view from ever attaching.
   */
  private openEntry(file: TAbstractFile): void {
    if (file instanceof TFolder) {
      this.navigateTo(file.path);
      return;
    }
    if (file instanceof TFile) {
      // getLeaf(false) skips pinned leaves, so this can never open the note
      // inside our own sidebar.
      void this.plugin.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private select(path: string | null, scroll = true): void {
    if (this.selectedPath !== path) {
      if (this.selectedPath) this.rows.get(this.selectedPath)?.el.removeClass("is-selected");
      if (path) this.rows.get(path)?.el.addClass("is-selected");
    }
    this.selectedPath = path;
    if (scroll && path) this.rows.get(path)?.el.scrollIntoView({ block: "nearest" });
  }

  private onKeyDown(evt: KeyboardEvent): void {
    const ordered = this.orderedPaths;
    if (ordered.length === 0) return;

    const current = this.selectedPath ? this.rowIndexes.get(this.selectedPath) ?? -1 : -1;

    switch (evt.key) {
      case "ArrowDown": {
        evt.preventDefault();
        this.select(ordered[Math.min(current + 1, ordered.length - 1)]);
        return;
      }
      case "ArrowUp": {
        evt.preventDefault();
        this.select(ordered[Math.max(current - 1, 0)]);
        return;
      }
      case "Enter": {
        evt.preventDefault();
        const path = this.selectedPath;
        if (!path) return;
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file) this.openEntry(file);
        return;
      }
      case "Backspace":
      case "ArrowLeft": {
        // Backspace would otherwise navigate the whole app backwards.
        if (evt.key === "Backspace" || evt.altKey || evt.metaKey) {
          evt.preventDefault();
          this.goBack();
        }
        return;
      }
      case "Escape": {
        this.select(null);
        return;
      }
    }

    if (evt.key === "[" && (evt.metaKey || evt.ctrlKey)) {
      evt.preventDefault();
      this.goBack();
    }
  }

  private showMenu(event: MouseEvent, file: TAbstractFile): void {
    const menu = new Menu();
    // Obsidian's own explorer adds its core items to the menu *before* firing
    // `file-menu`, so the event on its own only carries third-party
    // contributions — no New note, Rename or Delete. Rebuild those, then let
    // other plugins (and our colour picker) add theirs on top.
    addCoreFileMenuItems(this.plugin.app, menu, file);
    this.plugin.app.workspace.trigger("file-menu", menu, file, VIEW_TYPE, this.leaf);
    menu.showAtMouseEvent(event);
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // Right-clicking empty space targets the folder you are standing in.
    this.showMenu(event, this.fileAtEvent(event) ?? this.currentFolder());
  }

  private fileAtEvent(event: MouseEvent): TAbstractFile | null {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".folder-nav-row");
    if (!row || !this.listEl.contains(row) || !row.dataset.path) return null;
    return this.plugin.app.vault.getAbstractFileByPath(row.dataset.path);
  }

  // -------------------------------------------------------------- live updates

  private parentPathOf(file: TAbstractFile): string {
    return parentPath(file.path);
  }

  private onVaultChanged(file: TAbstractFile): void {
    // Standing in a folder that just got deleted — retreat to the nearest
    // ancestor that still exists.
    if (isWithin(this.currentPath, file.path)) {
      this.navigateTo(parentPath(file.path));
      return;
    }
    if (this.selectedPath && isWithin(this.selectedPath, file.path)) this.select(null, false);
    if (this.parentPathOf(file) === this.currentPath) this.refresh();
  }

  private onRenamed(file: TAbstractFile, oldPath: string): void {
    const oldCurrent = this.currentPath;
    // Rebase all history, even when the renamed folder is not currently open.
    this.history = this.history.map((path) => rebasePath(path, oldPath, file.path));
    this.currentPath = rebasePath(this.currentPath, oldPath, file.path);
    if (this.selectedPath) {
      this.select(rebasePath(this.selectedPath, oldPath, file.path), false);
    }
    if (oldCurrent !== this.currentPath || this.parentPathOf(file) === this.currentPath ||
        parentPath(oldPath) === this.currentPath) this.refresh();
  }

  private onFileOpen(file: TFile | null): void {
    if (!file) return;
    if (this.plugin.settings.autoReveal) {
      this.revealFile(file);
      return;
    }
    // Otherwise only move the highlight, and only if the note is already visible.
    if (this.parentPathOf(file) === this.currentPath) this.select(file.path);
  }
}
