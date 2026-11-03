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
import { buildCrumbs, Crumb, firstVisibleCrumb } from "./breadcrumb";
import { addCoreFileMenuItems } from "./fileActions";
import { ROW_TINT_ALPHA, paletteColor, resolveColorId, tintOf } from "./palette";
import { createRow, RenderedRow, updateRow } from "./render";
import { applyRootFilter, sortChildren } from "./sort";
import { isWithin, parentPath, rebasePath } from "./paths";
import { BorderFolderColors } from "./border";
import { PathMenu } from "./pathMenu";

export const VIEW_TYPE = "folder-nav-ooeooo-view";

/** Vault root is represented by the empty string, matching Obsidian's own convention. */
const ROOT = "";

export class FolderNavView extends ItemView {
  plugin: FolderNavPlugin;

  private currentPath = ROOT;
  private history: string[] = [ROOT];
  private historyIndex = 0;
  private selectedPath: string | null = null;

  private backEl!: HTMLButtonElement;
  private forwardEl!: HTMLButtonElement;
  private upEl!: HTMLButtonElement;
  private homeEl!: HTMLButtonElement;
  private crumbEl!: HTMLElement;
  private crumbMeasureEl!: HTMLElement;
  private separatorMeasureEl!: HTMLElement;
  private overflowEl!: HTMLButtonElement;
  private crumbs: Crumb[] = [];
  private crumbParts: { el: HTMLElement; measure: HTMLElement }[] = [];
  private pathMenu: PathMenu | null = null;
  private crumbObserver: ResizeObserver | null = null;
  private crumbFrame: number | null = null;
  private listEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private rows = new Map<string, RenderedRow>();
  private orderedPaths: string[] = [];
  private rowIndexes = new Map<string, number>();
  private frame: number | null = null;
  private viewWindow!: Window & typeof globalThis;
  private opened = false;
  private crumbPath: string | null = null;
  private crumbVaultName: string | null = null;
  private appliedPathSize: number | null | undefined;
  private appliedListSize: number | null | undefined;
  private borderColors = new BorderFolderColors();

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

    this.crumbEl = header.createDiv({ cls: "folder-nav-breadcrumb" });
    this.crumbEl.setAttribute("role", "navigation");
    this.crumbEl.setAttribute("aria-label", "文件夹路径");
    const toolbar = header.createDiv({ cls: "folder-nav-toolbar" });
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "目录导航");
    this.backEl = this.navigationButton(toolbar, "arrow-left", "后退", () => this.goBack());
    this.forwardEl = this.navigationButton(toolbar, "arrow-right", "前进", () => this.goForward());
    toolbar.createSpan({ cls: "folder-nav-toolbar-divider" }).setAttribute("aria-hidden", "true");
    this.upEl = this.navigationButton(toolbar, "arrow-up", "上一级", () => this.goUp());
    this.homeEl = this.navigationButton(toolbar, "house", "库根目录", () => this.navigateTo(ROOT));
    this.crumbMeasureEl = header.createDiv({ cls: "folder-nav-breadcrumb-measure" });
    this.crumbMeasureEl.setAttribute("aria-hidden", "true");
    this.crumbMeasureEl.setAttribute("inert", "");

    this.listEl = root.createDiv({ cls: "folder-nav-list" });
    this.listEl.tabIndex = 0;

    this.emptyEl = root.createDiv({ cls: "folder-nav-empty" });
    this.emptyEl.hide();

    this.registerDomEvent(this.crumbEl, "click", (event) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>(".folder-nav-crumb");
      if (!button || !this.crumbEl.contains(button)) return;
      if (button.dataset.action === "path-menu") this.openPathMenu(button);
      else if (button.dataset.path !== undefined) {
        this.navigateTo(button.dataset.path);
        this.listEl.focus();
      }
    });
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
      if (this.plugin.settings.nativeSortOrder.startsWith("by-modified-time")) {
        this.borderColors.invalidate();
        if (isWithin(this.currentPath, this.parentPathOf(file))) this.refresh();
      }
    }));
    this.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );
    this.registerEvent(this.plugin.app.workspace.on("css-change", () => this.requestBreadcrumbLayout()));
    if (this.viewWindow.ResizeObserver) {
      this.crumbObserver = new this.viewWindow.ResizeObserver(() => this.requestBreadcrumbLayout());
      this.crumbObserver.observe(this.crumbEl);
      // Natural text width also changes with theme fonts, font size and font loading.
      this.crumbObserver.observe(this.crumbMeasureEl);
    } else {
      this.registerDomEvent(this.viewWindow, "resize", () => this.requestBreadcrumbLayout());
    }

    this.render();
    this.listEl.focus();
  }

  private navigationButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "folder-nav-nav-button", type: "button" });
    button.setAttribute("aria-label", label);
    button.title = label;
    setIcon(button, icon);
    this.registerDomEvent(button, "click", action);
    return button;
  }

  async onClose(): Promise<void> {
    this.opened = false;
    this.cancelRefresh();
    if (this.crumbFrame !== null) this.viewWindow.cancelAnimationFrame(this.crumbFrame);
    this.crumbFrame = null;
    this.crumbObserver?.disconnect();
    this.crumbObserver = null;
    this.pathMenu?.close();
    this.crumbParts = [];
    this.crumbs = [];
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
    if (target === this.currentPath) return;
    if (pushHistory) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(target);
      this.historyIndex = this.history.length - 1;
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
    if (this.canGoBack) this.visitHistory(this.historyIndex - 1);
  }

  goForward(): void {
    if (this.canGoForward) this.visitHistory(this.historyIndex + 1);
  }

  get canGoBack(): boolean { return this.historyIndex > 0; }
  get canGoForward(): boolean { return this.historyIndex < this.history.length - 1; }

  private visitHistory(index: number): void {
    this.historyIndex = index;
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
    if (this.listEl.contains(this.contentEl.ownerDocument.activeElement)) this.listEl.focus();
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
    const appearanceChanged = this.applyAppearance();
    this.renderBreadcrumb(appearanceChanged);
    this.renderList();
    this.applyWash();
    this.backEl.disabled = !this.canGoBack;
    this.forwardEl.disabled = !this.canGoForward;
    this.upEl.disabled = this.currentPath === ROOT;
    this.homeEl.disabled = this.currentPath === ROOT;
  }

  refreshAppearance(): void {
    if (!this.opened) return;
    this.applyAppearance();
    this.requestBreadcrumbLayout();
  }

  private applyAppearance(): boolean {
    let changed = false;
    const {pathFontSize, listFontSize} = this.plugin.settings;
    if (pathFontSize !== this.appliedPathSize) {
      this.appliedPathSize = pathFontSize;
      if (pathFontSize === null) this.contentEl.style.removeProperty("--fn-path-size");
      else this.contentEl.style.setProperty("--fn-path-size", `${pathFontSize}px`);
      changed = true;
    }
    if (listFontSize !== this.appliedListSize) {
      this.appliedListSize = listFontSize;
      if (listFontSize === null) this.contentEl.style.removeProperty("--fn-list-size");
      else this.contentEl.style.setProperty("--fn-list-size", `${listFontSize}px`);
      changed = true;
    }
    return changed;
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

  private renderBreadcrumb(appearanceChanged = false): void {
    const vaultName = this.plugin.app.vault.getName();
    if (this.crumbPath === this.currentPath && this.crumbVaultName === vaultName) {
      if (appearanceChanged) this.layoutBreadcrumb();
      return;
    }
    this.pathMenu?.close();
    this.crumbPath = this.currentPath;
    this.crumbVaultName = vaultName;
    this.crumbEl.empty();
    this.crumbMeasureEl.empty();
    this.crumbs = buildCrumbs(vaultName, this.currentPath);
    this.crumbEl.title = this.crumbs.map((crumb) => crumb.label).join(" / ");
    this.overflowEl = this.crumbEl.createEl("button", {
      cls: "folder-nav-crumb folder-nav-path-overflow", type: "button",
    });
    this.overflowEl.dataset.action = "path-menu";
    this.overflowEl.setAttribute("aria-label", "展开完整路径");
    this.overflowEl.setAttribute("aria-haspopup", "menu");
    this.overflowEl.setAttribute("aria-expanded", "false");
    this.overflowEl.title = "完整路径";
    setIcon(this.overflowEl, "ellipsis");
    this.separatorMeasureEl = this.crumbMeasureEl.createSpan({ cls: "folder-nav-crumb-sep", text: "›" });
    this.crumbParts = this.crumbs.map((crumb, index) => {
      const isLast = index === this.crumbs.length - 1;
      const part = this.crumbEl.createSpan({ cls: "folder-nav-crumb-part" });
      if (isLast) part.addClass("is-current");
      if (index > 0) part.createSpan({ cls: "folder-nav-crumb-sep", text: "›" }).setAttribute("aria-hidden", "true");
      const button = part.createEl("button", { cls: "folder-nav-crumb", text: crumb.label, type: "button" });
      button.dataset.path = crumb.path;
      button.title = crumb.path || crumb.label;
      const measure = this.crumbMeasureEl.createEl("button", { cls: "folder-nav-crumb", text: crumb.label, type: "button" });
      measure.tabIndex = -1;
      if (isLast) {
        button.addClass("is-current");
        measure.addClass("is-current");
        button.setAttribute("aria-current", "location");
      }
      return {el: part, measure};
    });
    this.layoutBreadcrumb();
  }

  private requestBreadcrumbLayout(): void {
    if (!this.opened || this.crumbFrame !== null) return;
    this.crumbFrame = this.viewWindow.requestAnimationFrame(() => {
      this.crumbFrame = null;
      if (this.opened) this.layoutBreadcrumb();
    });
  }

  private layoutBreadcrumb(): void {
    if (!this.crumbParts.length) return;
    const widths = this.crumbParts.map((part) => part.measure.getBoundingClientRect().width);
    const separator = this.separatorMeasureEl.getBoundingClientRect().width;
    const start = firstVisibleCrumb(widths, this.crumbEl.clientWidth, 32, separator);
    this.crumbEl.toggleClass("is-compact", start > 0 && this.crumbParts.length - start === 2);
    this.overflowEl.hidden = start === 0;
    this.crumbParts.forEach((part, index) => { part.el.hidden = index < start; });
    if (start === 0) this.pathMenu?.close();
  }

  private openPathMenu(anchor: HTMLElement): void {
    if (this.pathMenu) { this.pathMenu.close(true); return; }
    anchor.setAttribute("aria-expanded", "true");
    this.pathMenu = new PathMenu(anchor, this.crumbs, this.plugin.settings.pathFontSize,
      (path) => { this.navigateTo(path); this.listEl.focus(); },
      () => { this.pathMenu = null; anchor.setAttribute("aria-expanded", "false"); });
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
      const manual = file instanceof TFolder ? paletteColor(resolveColorId(settings.folderColors, file.path)) : null;
      const options = {
        showExtensions: settings.showExtensions, tint: this.tintFor(file),
        borderColor: file instanceof TFolder ? this.borderColors.colorFor(file, settings) : "currentColor",
        manualColor: manual?.hex ?? null,
      };
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
    const target = evt.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable=true]")) return;
    if ((evt.altKey || evt.metaKey) && evt.key === "ArrowLeft" ||
        (evt.metaKey || evt.ctrlKey) && evt.key === "[" || evt.key === "Backspace" && !evt.shiftKey) {
      evt.preventDefault(); this.goBack(); return;
    }
    if ((evt.altKey || evt.metaKey) && evt.key === "ArrowRight" ||
        (evt.metaKey || evt.ctrlKey) && evt.key === "]" || evt.key === "Backspace" && evt.shiftKey) {
      evt.preventDefault(); this.goForward(); return;
    }
    if (evt.altKey && evt.key === "ArrowUp") {
      evt.preventDefault(); this.goUp(); return;
    }
    // Native button Enter/Space activation must not also open a selected file.
    if (!this.listEl.contains(target)) return;
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
      case "Escape": {
        this.select(null);
        return;
      }
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
    this.borderColors.invalidate();
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
    this.borderColors.invalidate();
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
