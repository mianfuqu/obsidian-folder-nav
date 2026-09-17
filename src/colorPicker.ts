import { App, Modal } from "obsidian";
import type FolderNavPlugin from "./main";
import { PALETTE, PaletteColor } from "./palette";

/** Swatch grid for assigning a folder colour, opened from the file menu. */
export class ColorPickerModal extends Modal {
  private plugin: FolderNavPlugin;
  private folderPath: string;

  constructor(app: App, plugin: FolderNavPlugin, folderPath: string) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("folder-nav-color-modal");

    contentEl.createEl("h3", { text: "文件夹颜色" });
    contentEl.createDiv({
      cls: "folder-nav-color-path",
      text: this.folderPath || "(库根目录)",
    });

    const current = this.plugin.settings.folderColors[this.folderPath] ?? null;

    const grid = contentEl.createDiv({ cls: "folder-nav-swatches" });
    for (const color of PALETTE) {
      this.swatch(grid, color, color.id === current, () => this.apply(color.id));
    }

    const recent = this.plugin.settings.recentColors
      .filter((id) => id !== current)
      .slice(0, 6)
      .map((id) => PALETTE.find((color) => color.id === id))
      .filter((color): color is PaletteColor => color !== undefined);

    if (recent.length > 0) {
      const section = contentEl.createDiv({ cls: "folder-nav-color-recent" });
      section.createDiv({ cls: "folder-nav-color-label", text: "最近用过" });
      const row = section.createDiv({ cls: "folder-nav-swatches is-compact" });
      for (const color of recent) {
        this.swatch(row, color, false, () => this.apply(color.id));
      }
    }

    const footer = contentEl.createDiv({ cls: "folder-nav-color-footer" });
    const clear = footer.createEl("button", { text: "清除颜色" });
    clear.disabled = current === null;
    clear.addEventListener("click", () => void this.apply(null));
  }

  private swatch(
    parent: HTMLElement,
    color: PaletteColor,
    isCurrent: boolean,
    onClick: () => void
  ): void {
    const el = parent.createDiv({ cls: "folder-nav-swatch" });
    el.style.backgroundColor = color.hex;
    el.setAttribute("aria-label", color.label);
    el.toggleClass("is-current", isCurrent);
    el.addEventListener("click", onClick);
  }

  private async apply(colorId: string | null): Promise<void> {
    await this.plugin.setFolderColor(this.folderPath, colorId);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
