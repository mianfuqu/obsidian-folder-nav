import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type FolderNavPlugin from "./main";
import { PALETTE, paletteColor } from "./palette";

/**
 * Sorting is done by us rather than by the built-in explorer, because taking
 * over the explorer's leaf destroys the view we would have borrowed the sort
 * from. `nativeSortOrder` mirrors whatever the native explorer was set to at
 * the moment we took over, so the list looks the same as before.
 */
export type SortMode = "folders-first" | "native";

export interface FolderNavSettings {
  /** Replace the built-in file list with the drill-down view. */
  enabled: boolean;
  sortMode: SortMode;
  /** Mirrors the native explorer's sortOrder, e.g. "alphabetical". */
  nativeSortOrder: string;
  /** Follow the active file into its folder. Seeded from the native setting. */
  autoReveal: boolean;
  showExtensions: boolean;
  /** Hide loose files sitting in the vault root — handy for attachment clutter. */
  hideRootFiles: boolean;
  /** Comma-separated extensions hidden by `hideRootFiles`. */
  hiddenExtensions: string;
  /** Folder path -> palette colour id. The vault root is "". */
  folderColors: Record<string, string>;
  /** Recently used colour ids, newest first, for the picker's shortcut row. */
  recentColors: string[];
  /**
   * Opacity of the wash applied to the whole list inside a coloured folder,
   * as a percentage. 0 colours the folder row only and leaves the list alone.
   */
  colorWash: number;
}

export const DEFAULT_SETTINGS: FolderNavSettings = {
  enabled: true,
  sortMode: "native",
  nativeSortOrder: "alphabetical",
  autoReveal: false,
  showExtensions: true,
  hideRootFiles: false,
  hiddenExtensions: "png,jpg,jpeg,gif,webp,svg,bmp",
  folderColors: {},
  recentColors: [],
  colorWash: 14,
};

export class FolderNavSettingTab extends PluginSettingTab {
  plugin: FolderNavPlugin;

  constructor(app: App, plugin: FolderNavPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("接管文件列表")
      .setDesc(
        "用逐层导航替换 Obsidian 自带的树状文件列表。关闭后立刻恢复原生列表。"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyEnabledState();
        })
      );

    new Setting(containerEl)
      .setName("排序方式")
      .setDesc(
        "「跟随原生」会套用你原先在文件列表里的排序设置(接管时的快照);「文件夹优先」始终把文件夹排在文件前面。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("native", "跟随原生排序")
          .addOption("folders-first", "文件夹优先,再按名称")
          .setValue(this.plugin.settings.sortMode)
          .onChange(async (value) => {
            this.plugin.settings.sortMode = value as SortMode;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("自动定位当前文件")
      .setDesc(
        "切换笔记时,列表自动跳到该笔记所在的文件夹并高亮它。原生的「自动显示当前文件」是关闭状态。"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoReveal).onChange(async (value) => {
          this.plugin.settings.autoReveal = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("显示文件扩展名")
      .setDesc("在文件名后面显示 .md 之类的后缀。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showExtensions).onChange(async (value) => {
          this.plugin.settings.showExtensions = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(containerEl)
      .setName("在库根目录隐藏散落文件")
      .setDesc(
        "只影响库的根目录,不影响任何子文件夹 —— 用来清掉根目录堆积的附件。"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hideRootFiles).onChange(async (value) => {
          this.plugin.settings.hideRootFiles = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(containerEl)
      .setName("隐藏的扩展名")
      .setDesc("逗号分隔,配合上一项使用。例如:png, jpg, pdf")
      .addText((text) =>
        text
          .setPlaceholder("png,jpg,jpeg,gif,webp,svg,bmp")
          .setValue(this.plugin.settings.hiddenExtensions)
          .onChange(async (value) => {
            this.plugin.settings.hiddenExtensions = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    // -------------------------------------------------------------- 文件夹颜色

    new Setting(containerEl).setName("文件夹颜色").setHeading();

    new Setting(containerEl)
      .setName("背景染色强度")
      .setDesc(
        "进入已上色的文件夹时整个列表背景的染色浓度(数值就是透明度百分比)。设为 0 则只染文件夹那一行,不染背景。子文件夹会自动继承最近的上级颜色。"
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 50, 1)
          .setValue(this.plugin.settings.colorWash)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.colorWash = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    this.renderColorList(containerEl);

    let newPath = "";
    new Setting(containerEl)
      .setName("手动指定文件夹")
      .setDesc("填相对库根目录的路径,再点下面的色块。右键文件夹也能设置。")
      .addText((text) =>
        text.setPlaceholder("例如:药理学/第一章").onChange((value) => {
          newPath = value.trim();
        })
      );

    const picker = new Setting(containerEl).setName("选一个颜色");
    for (const color of PALETTE) {
      picker.addButton((button) => {
        button.buttonEl.addClass("folder-nav-swatch-button");
        button.buttonEl.style.backgroundColor = color.hex;
        button.setTooltip(color.label);
        button.onClick(async () => {
          if (!newPath) {
            new Notice("先在左边填文件夹路径");
            return;
          }
          await this.plugin.setFolderColor(newPath, color.id);
          this.display();
        });
      });
    }
  }

  private renderColorList(containerEl: HTMLElement): void {
    const entries = Object.entries(this.plugin.settings.folderColors).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    if (entries.length === 0) {
      new Setting(containerEl)
        .setName("已上色的文件夹")
        .setDesc("还没有。右键任意文件夹即可上色。");
      return;
    }

    new Setting(containerEl)
      .setName(`已上色的文件夹(${entries.length})`)
      .addExtraButton((button) =>
        button
          .setIcon("trash-2")
          .setTooltip("全部清除")
          .onClick(async () => {
            await this.plugin.clearAllFolderColors();
            this.display();
          })
      );

    for (const [path, colorId] of entries) {
      const color = paletteColor(colorId);
      const setting = new Setting(containerEl).setName(path || "(库根目录)");

      const dot = document.createElement("span");
      dot.addClass("folder-nav-swatch-dot");
      if (color) dot.style.backgroundColor = color.hex;
      setting.nameEl.prepend(dot);

      setting.addExtraButton((button) =>
        button
          .setIcon("x")
          .setTooltip("清除颜色")
          .onClick(async () => {
            await this.plugin.setFolderColor(path, null);
            this.display();
          })
      );
    }
  }
}
