import { TAbstractFile, TFolder } from "obsidian";
import type { FolderNavSettings } from "./config";
import { sortChildren } from "./sort";

// Border's actual nth-child(8n+2 … 8n+9) palette, rather than a second fixed palette.
export const BORDER_FOLDER_COLORS = [
  "--color-red", "--color-orange", "--color-yellow", "--color-green",
  "--color-cyan", "--color-blue", "--color-purple", "--color-pink",
];

/** Preserve the original sibling position, including files hidden by our filter.
 * The first child inherits its parent's color, as it does in Border's CSS.
 */
export class BorderFolderColors {
  private siblings = new WeakMap<TFolder, Map<TAbstractFile, string | null>>();
  private sortOrder = "";

  invalidate(): void {
    this.siblings = new WeakMap();
  }

  colorFor(folder: TFolder, settings: FolderNavSettings): string {
    if (this.sortOrder !== settings.nativeSortOrder) {
      this.sortOrder = settings.nativeSortOrder;
      this.invalidate();
    }
    let current: TAbstractFile = folder;
    while (current.parent) {
      const parent = current.parent;
      let table = this.siblings.get(parent);
      if (!table) {
        table = new Map();
        const children = sortChildren(parent.children, { ...settings, sortMode: "native" });
        children.forEach((child, index) => table!.set(child,
          index === 0 ? null : `var(${BORDER_FOLDER_COLORS[(index - 1) % 8]})`));
        this.siblings.set(parent, table);
      }
      const color = table.get(current);
      if (color) return color;
      current = parent;
    }
    return "currentColor";
  }
}
