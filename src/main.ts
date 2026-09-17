import { Notice, Plugin, TFolder } from "obsidian";
import { FolderNavView, VIEW_TYPE } from "./view";
import { DEFAULT_SETTINGS, FolderNavSettings, FolderNavSettingTab } from "./settings";
import { FileExplorerTakeover } from "./takeover";
import { ColorPickerModal } from "./colorPicker";

export default class FolderNavPlugin extends Plugin {
  settings!: FolderNavSettings;
  private takeover!: FileExplorerTakeover;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new FolderNavView(leaf, this));
    this.takeover = new FileExplorerTakeover(this);
    this.addSettingTab(new FolderNavSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-drilldown",
      name: "切换逐层导航 / 原生文件列表",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.applyEnabledState();
        new Notice(this.settings.enabled ? "已切换为逐层导航" : "已恢复原生文件列表");
      },
    });

    this.addCommand({
      id: "go-to-root",
      name: "回到库根目录",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) view.navigateTo("");
        return true;
      },
    });

    this.addCommand({
      id: "go-up",
      name: "返回上一级文件夹",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) view.goUp();
        return true;
      },
    });

    this.addCommand({
      id: "reveal-active-file",
      name: "定位到当前文件",
      checkCallback: (checking) => {
        const view = this.getView();
        if (!view) return false;
        if (!checking) view.revealActiveFile();
        return true;
      },
    });

    this.registerFileMenu();
    this.registerColorMaintenance();

    this.app.workspace.onLayoutReady(() => this.applyEnabledState());
  }

  /**
   * Adds the colour picker to the file context menu.
   *
   * `source` must be checked: FolderNavView's own context menu goes through the
   * native `file-menu` event, so without this the item would also appear in the
   * built-in explorer's menu after the takeover is switched off — where it would
   * do nothing visible.
   */
  private registerFileMenu(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source !== VIEW_TYPE) return;
        if (!(file instanceof TFolder)) return;
        menu.addItem((item) =>
          item
            .setTitle("文件夹颜色")
            .setIcon("palette")
            .setSection("action")
            .onClick(() => new ColorPickerModal(this.app, this, file.path).open())
        );
      })
    );
  }

  /**
   * Colours are keyed by path, so renames and deletions have to follow them.
   * This lives on the plugin rather than the view: the colour map is plugin
   * state and must stay correct even when no view is open.
   */
  private registerColorMaintenance(): void {
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const colors = this.settings.folderColors;
        let changed = false;
        for (const key of Object.keys(colors)) {
          if (key === oldPath || key.startsWith(`${oldPath}/`)) {
            colors[file.path + key.slice(oldPath.length)] = colors[key];
            delete colors[key];
            changed = true;
          }
        }
        if (changed) void this.persistColorChange();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const colors = this.settings.folderColors;
        let changed = false;
        for (const key of Object.keys(colors)) {
          if (key === file.path || key.startsWith(`${file.path}/`)) {
            delete colors[key];
            changed = true;
          }
        }
        if (changed) void this.persistColorChange();
      })
    );
  }

  private async persistColorChange(): Promise<void> {
    await this.saveSettings();
    this.refreshViews();
  }

  /**
   * Assigns or clears a folder colour. Passing null removes it.
   * The picker modal and the settings tab both go through here, and it doubles
   * as the entry point for verifying colours without driving the native menu,
   * which cannot be exercised programmatically.
   */
  async setFolderColor(path: string, colorId: string | null): Promise<void> {
    if (colorId) {
      this.settings.folderColors[path] = colorId;
      this.settings.recentColors = [
        colorId,
        ...this.settings.recentColors.filter((id) => id !== colorId),
      ].slice(0, 6);
    } else {
      delete this.settings.folderColors[path];
    }
    await this.persistColorChange();
  }

  async clearAllFolderColors(): Promise<void> {
    this.settings.folderColors = {};
    await this.persistColorChange();
  }

  onunload(): void {
    // Hand the leaf back to the built-in explorer rather than leaving behind a
    // view whose plugin no longer exists.
    this.takeover?.restoreOnUnload();
  }

  applyEnabledState(): void {
    if (this.settings.enabled) this.takeover.enable();
    else this.takeover.disable();
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      (leaf.view as FolderNavView).refresh();
    }
  }

  getView(): FolderNavView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf ? (leaf.view as FolderNavView) : null;
  }

  async loadSettings(): Promise<void> {
    const stored = ((await this.loadData()) ?? {}) as Partial<FolderNavSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    // Object.assign is shallow: without these two lines the settings object
    // would share its containers with DEFAULT_SETTINGS, and assigning a colour
    // would mutate the defaults themselves for the rest of the session.
    this.settings.folderColors = { ...(stored.folderColors ?? {}) };
    this.settings.recentColors = [...(stored.recentColors ?? [])];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
