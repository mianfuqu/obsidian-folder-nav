import { Notice, Plugin } from "obsidian";
import { FolderNavView, VIEW_TYPE } from "./view";
import { DEFAULT_SETTINGS, FolderNavSettings, FolderNavSettingTab } from "./settings";
import { FileExplorerTakeover } from "./takeover";

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

    this.app.workspace.onLayoutReady(() => this.applyEnabledState());
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
