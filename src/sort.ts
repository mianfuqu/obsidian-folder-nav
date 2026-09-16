import { TAbstractFile, TFile, TFolder } from "obsidian";
import type { FolderNavSettings } from "./settings";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function byName(a: TAbstractFile, b: TAbstractFile): number {
  return collator.compare(a.name, b.name);
}

function folderRank(file: TAbstractFile): number {
  return file instanceof TFolder ? 0 : 1;
}

// TFolder carries no stat, so time-based modes park folders at one end rather
// than pretending they have a timestamp.
function timeOf(file: TAbstractFile, kind: "mtime" | "ctime"): number {
  if (file instanceof TFile) return file.stat[kind];
  return 0;
}

/**
 * Reproduces the built-in explorer's ordering from its `sortOrder` setting,
 * which we snapshot when taking over. Unknown values fall back to alphabetical.
 */
export function sortChildren(
  children: TAbstractFile[],
  settings: FolderNavSettings
): TAbstractFile[] {
  const list = children.slice();

  if (settings.sortMode === "folders-first") {
    list.sort((a, b) => folderRank(a) - folderRank(b) || byName(a, b));
    return list;
  }

  switch (settings.nativeSortOrder) {
    case "alphabetical-reverse":
      list.sort((a, b) => byName(b, a));
      break;
    case "by-modified-time":
      list.sort((a, b) => timeOf(a, "mtime") - timeOf(b, "mtime") || byName(a, b));
      break;
    case "by-modified-time-reverse":
      list.sort((a, b) => timeOf(b, "mtime") - timeOf(a, "mtime") || byName(a, b));
      break;
    case "by-created-time":
      list.sort((a, b) => timeOf(a, "ctime") - timeOf(b, "ctime") || byName(a, b));
      break;
    case "by-created-time-reverse":
      list.sort((a, b) => timeOf(b, "ctime") - timeOf(a, "ctime") || byName(a, b));
      break;
    case "alphabetical":
    default:
      list.sort(byName);
      break;
  }

  return list;
}

/** Drops loose files in the vault root that match `hiddenExtensions`. */
export function applyRootFilter(
  children: TAbstractFile[],
  isRoot: boolean,
  settings: FolderNavSettings
): TAbstractFile[] {
  if (!isRoot || !settings.hideRootFiles) return children;

  const hidden = new Set(
    settings.hiddenExtensions
      .split(",")
      .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean)
  );
  if (hidden.size === 0) return children;

  return children.filter((file) => {
    if (!(file instanceof TFile)) return true;
    return !hidden.has(file.extension.toLowerCase());
  });
}
