import {
  App,
  FuzzySuggestModal,
  Menu,
  Modal,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  normalizePath,
} from "obsidian";

/*
 * The context menu we show is built by hand.
 *
 * Obsidian's own file explorer adds its core items (New note, New folder,
 * Rename, Delete, …) to the Menu itself and only *then* fires the `file-menu`
 * event. So a plugin listening to that event — or firing it — sees third-party
 * contributions and nothing else. Since our view replaces the explorer's view,
 * there is no native menu to borrow, and these have to be reimplemented.
 *
 * Everything below goes through public API. `promptForDeletion` in particular
 * gives back Obsidian's own confirmation dialog rather than a bespoke one.
 */

const UNTITLED = "未命名";
const UNTITLED_FOLDER = "未命名文件夹";

function childPath(folder: TFolder, name: string): string {
  return normalizePath(`${folder.path}/${name}`);
}

/** First free "name", "name 2", "name 3"… inside `folder`. */
function freePath(folder: TFolder, base: string, extension: string): string {
  const vault = folder.vault;
  let candidate = childPath(folder, `${base}${extension}`);
  for (let i = 2; vault.getAbstractFileByPath(candidate) !== null; i += 1) {
    candidate = childPath(folder, `${base} ${i}${extension}`);
  }
  return candidate;
}

async function createNote(app: App, folder: TFolder): Promise<void> {
  const file = await app.vault.create(freePath(folder, UNTITLED, ".md"), "");
  await app.workspace.getLeaf(false).openFile(file);
}

async function createFolder(app: App, folder: TFolder): Promise<void> {
  await app.vault.createFolder(freePath(folder, UNTITLED_FOLDER, ""));
}

async function duplicate(app: App, file: TAbstractFile): Promise<void> {
  const parent = file.parent ?? app.vault.getRoot();
  const extension = file instanceof TFile ? `.${file.extension}` : "";
  const base = extension ? file.name.slice(0, -extension.length) : file.name;
  await app.vault.copy(file, freePath(parent, base, extension));
}

function parentOf(file: TAbstractFile, app: App): TFolder {
  return file.parent ?? app.vault.getRoot();
}

// ------------------------------------------------------------------- modals

class RenameModal extends Modal {
  private file: TAbstractFile;

  constructor(app: App, file: TAbstractFile) {
    super(app);
    this.file = file;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("folder-nav-rename-modal");
    contentEl.createEl("h3", { text: "重命名" });

    const input = contentEl.createEl("input", { type: "text" });
    input.addClass("folder-nav-rename-input");
    input.value = this.file.name;

    // Select the stem only, so typing replaces the name but keeps the extension.
    if (this.file instanceof TFile && this.file.extension) {
      const stem = this.file.name.length - this.file.extension.length - 1;
      input.setSelectionRange(0, stem);
    } else {
      input.select();
    }

    const commit = async () => {
      const next = input.value.trim();
      if (!next || next === this.file.name) {
        this.close();
        return;
      }
      const target = childPath(parentOf(this.file, this.app), next);
      if (this.app.vault.getAbstractFileByPath(target)) {
        new Notice(`已存在:${next}`);
        return;
      }
      try {
        await this.app.fileManager.renameFile(this.file, target);
      } catch (error) {
        new Notice(`重命名失败:${(error as Error).message}`);
      }
      this.close();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });

    const buttons = contentEl.createDiv({ cls: "folder-nav-modal-buttons" });
    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { text: "重命名", cls: "mod-cta" });
    confirm.addEventListener("click", () => void commit());

    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Folder picker for "Move to…", the replacement for drag-and-drop. */
class MoveModal extends FuzzySuggestModal<TFolder> {
  private file: TAbstractFile;

  constructor(app: App, file: TAbstractFile) {
    super(app);
    this.file = file;
    this.setPlaceholder("移动到哪个文件夹…");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [this.app.vault.getRoot()];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;
        // Moving a folder into itself or its own subtree would be a loop.
        if (this.file instanceof TFolder && child.path.startsWith(this.file.path)) continue;
        folders.push(child);
        walk(child);
      }
    };
    walk(this.app.vault.getRoot());
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.isRoot() ? "(库根目录)" : folder.path;
  }

  onChooseItem(folder: TFolder): void {
    const target = childPath(folder, this.file.name);
    if (target === this.file.path) return;
    if (this.app.vault.getAbstractFileByPath(target)) {
      new Notice(`目标位置已存在同名项:${this.file.name}`);
      return;
    }
    void this.app.fileManager.renameFile(this.file, target);
  }
}

// --------------------------------------------------------------- menu items

/**
 * The items Obsidian's own file explorer would have offered, rebuilt on public
 * API. `source` order mirrors the native menu: create, then edit, then open.
 */
export function addCoreFileMenuItems(app: App, menu: Menu, file: TAbstractFile): void {
  // Sections drive the menu's grouping: Obsidian sorts groups by a fixed
  // priority and inserts the separators between them, so we set sections
  // instead of calling addSeparator() ourselves.
  if (file instanceof TFolder) {
    menu.addItem((item) =>
      item
        .setTitle("新建笔记")
        .setIcon("edit")
        .setSection("new")
        .onClick(() => void createNote(app, file))
    );
    menu.addItem((item) =>
      item
        .setTitle("新建文件夹")
        .setIcon("folder-open")
        .setSection("new")
        .onClick(() => void createFolder(app, file))
    );
  } else if (file instanceof TFile) {
    menu.addItem((item) =>
      item
        .setTitle("在新标签页打开")
        .setIcon("file-plus")
        .setSection("open")
        .onClick(() => void app.workspace.getLeaf("tab").openFile(file))
    );
    menu.addItem((item) =>
      item
        .setTitle("在右侧打开")
        .setIcon("separator-vertical")
        .setSection("open")
        .onClick(() => void app.workspace.getLeaf("split", "vertical").openFile(file))
    );
  }

  menu.addItem((item) =>
    item
      .setTitle("重命名")
      .setIcon("edit-3")
      .setSection("action")
      .onClick(() => new RenameModal(app, file).open())
  );

  menu.addItem((item) =>
    item
      .setTitle(file instanceof TFolder ? "移动文件夹到…" : "移动文件到…")
      .setIcon("folder-input")
      .setSection("action")
      .onClick(() => new MoveModal(app, file).open())
  );

  menu.addItem((item) =>
    item
      .setTitle("创建副本")
      .setIcon("files")
      .setSection("action")
      .onClick(() => void duplicate(app, file))
  );

  menu.addItem((item) =>
    item
      .setTitle("删除")
      .setIcon("trash-2")
      .setSection("danger")
      // Delegates to Obsidian's own confirmation dialog.
      .onClick(() => void app.fileManager.promptForDeletion(file))
  );
}
