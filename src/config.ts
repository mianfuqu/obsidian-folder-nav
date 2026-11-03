import { paletteColor } from "./palette";

export type SortMode = "folders-first" | "native";

export interface FolderNavSettings {
  enabled: boolean;
  sortMode: SortMode;
  nativeSortOrder: string;
  autoReveal: boolean;
  showExtensions: boolean;
  hideRootFiles: boolean;
  hiddenExtensions: string;
  folderColors: Record<string, string>;
  recentColors: string[];
  colorWash: number;
  /** null follows the theme; numeric values explicitly override it in pixels. */
  pathFontSize: number | null;
  listFontSize: number | null;
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
  pathFontSize: null,
  listFontSize: null,
};

const SORT_ORDERS = new Set([
  "alphabetical", "alphabetical-reverse", "by-modified-time",
  "by-modified-time-reverse", "by-created-time", "by-created-time-reverse",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Treat data.json as input, including older or partially synced settings. */
export function normalizeSettings(value: unknown): FolderNavSettings {
  const stored = isRecord(value) ? value : {};
  const settings: FolderNavSettings = {
    ...DEFAULT_SETTINGS,
    folderColors: Object.create(null) as Record<string, string>,
    recentColors: [],
  };
  for (const key of ["enabled", "autoReveal", "showExtensions", "hideRootFiles"] as const) {
    if (typeof stored[key] === "boolean") settings[key] = stored[key];
  }
  if (stored.sortMode === "native" || stored.sortMode === "folders-first") {
    settings.sortMode = stored.sortMode;
  }
  if (typeof stored.nativeSortOrder === "string" && SORT_ORDERS.has(stored.nativeSortOrder)) {
    settings.nativeSortOrder = stored.nativeSortOrder;
  }
  if (typeof stored.hiddenExtensions === "string") settings.hiddenExtensions = stored.hiddenExtensions;
  if (typeof stored.colorWash === "number" && Number.isFinite(stored.colorWash)) {
    settings.colorWash = Math.max(0, Math.min(50, stored.colorWash));
  }
  for (const key of ["pathFontSize", "listFontSize"] as const) {
    const size = stored[key];
    if (typeof size === "number" && Number.isFinite(size)) {
      settings[key] = Math.max(12, Math.min(22, Math.round(size)));
    }
  }
  if (isRecord(stored.folderColors)) {
    for (const [path, id] of Object.entries(stored.folderColors)) {
      if (typeof id === "string" && paletteColor(id)) settings.folderColors[path] = id;
    }
  }
  if (Array.isArray(stored.recentColors)) {
    settings.recentColors = [...new Set(stored.recentColors.filter(
      (id): id is string => typeof id === "string" && paletteColor(id) !== null
    ))].slice(0, 6);
  }
  return settings;
}
