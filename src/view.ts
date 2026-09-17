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
import { ROW_TINT_ALPHA, resolveColorId, tintOf } from "./palette";
import { createRow } from "./render";
import { applyRootFilter, sortChildren } from "./sort";

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
  private rowEls = new Map<string, HTMLElement>();

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
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );

    this.render();
    this.listEl.focus();
  }

  async onClose(): Promise<void> {
    this.rowEls.clear();
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
    this.selectedPath = null;
    this.render();
    this.focusIfEngaged();
  }

  /** Falls back to the nearest surviving ancestor if `path` no longer exists. */
  private normalize(path: string): string {
    const vault = this.plugin.app.vault;
    if (path === ROOT || vault.getAbstractFileByPath(path) instanceof TFolder) return path;

    const slash = path.lastIndexOf("/");
    const parent = slash === -1 ? ROOT : path.slice(0, slash);
    return vault.getAbstractFileByPath(parent) instanceof TFolder ? parent : ROOT;
  }

  goBack(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.currentPath = this.history[this.historyIndex];
    this.selectedPath = null;
    this.render();
    this.focusIfEngaged();
  }

  /**
   * Only reclaim focus if the sidebar already had it. Opening a note triggers a
   * reveal, and stealing focus from the editor mid-typing would be hostile.
   */
  private focusIfEngaged(): void {
    if (this.containerEl.contains(document.activeElement)) this.listEl.focus();
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
    this.render();
  }

  render(): void {
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
    this.crumbEl.empty();
    const crumbs = buildCrumbs(this.plugin.app.vault.getName(), this.currentPath);

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
    const hadFocus = this.containerEl.contains(document.activeElement);

    this.listEl.empty();
    this.rowEls.clear();

    const isRoot = this.currentPath === ROOT;
    const settings = this.plugin.settings;
    const children = applyRootFilter(
      sortChildren(this.currentFolder().children ?? [], settings),
      isRoot,
      settings
    );

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

    const fragment = document.createDocumentFragment();
    for (const child of children) {
      const row = createRow(child, {
        showExtensions: settings.showExtensions,
        tintFor: (file) => this.tintFor(file),
        onOpen: (file) => this.openEntry(file),
        onContextMenu: (event, file) => this.showMenu(event, file),
      });
      if (child.path === this.selectedPath) row.addClass("is-selected");
      this.rowEls.set(child.path, row);
      fragment.appendChild(row);
    }
    this.listEl.appendChild(fragment);

    if (hadFocus) this.listEl.focus();
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

  private select(path: string): void {
    this.selectedPath = path;
    for (const [rowPath, el] of this.rowEls) {
      el.toggleClass("is-selected", rowPath === path);
    }
    this.rowEls.get(path)?.scrollIntoView({ block: "nearest" });
  }

  private onKeyDown(evt: KeyboardEvent): void {
    const ordered = Array.from(this.rowEls.keys());
    if (ordered.length === 0) return;

    const current = this.selectedPath ? ordered.indexOf(this.selectedPath) : -1;

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
        this.select("");
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
    // Fires the native menu, so rename/delete/move/bookmark all keep working.
    this.plugin.app.workspace.trigger("file-menu", menu, file, VIEW_TYPE, this.leaf);
    menu.showAtMouseEvent(event);
  }

  private onContextMenu(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest(".folder-nav-row")) return;
    event.preventDefault();
    // Right-clicking empty space targets the folder you are standing in.
    this.showMenu(event, this.currentFolder());
  }

  // -------------------------------------------------------------- live updates

  private static parentOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? ROOT : path.slice(0, slash);
  }

  private parentPathOf(file: TAbstractFile): string {
    return FolderNavView.parentOf(file.path);
  }

  /** True when `path` is the current folder or lives inside it. */
  private withinCurrent(path: string): boolean {
    return path === this.currentPath || path.startsWith(`${this.currentPath}/`);
  }

  private onVaultChanged(file: TAbstractFile): void {
    // Standing in a folder that just got deleted — retreat to the nearest
    // ancestor that still exists.
    if (file.path === this.currentPath || this.currentPath.startsWith(`${file.path}/`)) {
      this.navigateTo(FolderNavView.parentOf(file.path));
      return;
    }
    if (this.parentPathOf(file) === this.currentPath) this.render();
  }

  private onRenamed(file: TAbstractFile, oldPath: string): void {
    // The folder we are standing in (or below) was renamed — follow it.
    if (this.withinCurrent(oldPath)) {
      this.history = this.history.map((p) =>
        p === oldPath || p.startsWith(`${oldPath}/`) ? file.path + p.slice(oldPath.length) : p
      );
      this.currentPath = this.history[this.historyIndex];
      if (this.selectedPath && this.withinCurrent(this.selectedPath)) {
        this.selectedPath = file.path + this.selectedPath.slice(oldPath.length);
      }
      this.render();
      return;
    }
    // A direct child moved in or out of view.
    if (this.parentPathOf(file) === this.currentPath || FolderNavView.parentOf(oldPath) === this.currentPath) {
      this.render();
    }
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
