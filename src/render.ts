import { TAbstractFile, TFile, TFolder, setIcon } from "obsidian";

const EXTENSION_ICONS: Record<string, string> = {
  md: "file-text",
  canvas: "layout-dashboard",
  base: "file-box",
  pdf: "file-text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  mp3: "file-audio",
  wav: "file-audio",
  m4a: "file-audio",
  ogg: "file-audio",
  mp4: "file-video",
  mov: "file-video",
  webm: "file-video",
  js: "file-code",
  ts: "file-code",
  json: "file-code",
  css: "file-code",
  html: "file-code",
};

function iconFor(file: TAbstractFile): string {
  if (file instanceof TFolder) return "folder-closed";
  if (file instanceof TFile) return EXTENSION_ICONS[file.extension.toLowerCase()] ?? "file";
  return "file";
}

/** `basename` lives on TFile only, so derive it the same way for both kinds. */
function displayName(file: TAbstractFile, showExtensions: boolean): string {
  if (showExtensions) return file.name;
  const extension = file instanceof TFile ? file.extension : "";
  return extension ? file.name.slice(0, -(extension.length + 1)) : file.name;
}

export interface RowOptions {
  showExtensions: boolean;
  tint: string | null;
}

export interface RenderedRow {
  el: HTMLElement;
  isFolder: boolean;
  nameEl: HTMLElement;
  iconEl: HTMLElement;
  name: string;
  icon: string;
  tint: string | null;
}

export function createRow(file: TAbstractFile, options: RowOptions): RenderedRow {
  const isFolder = file instanceof TFolder;

  const row = createDiv({ cls: "folder-nav-row" });
  row.addClass(isFolder ? "is-folder" : "is-file");
  row.dataset.path = file.path;
  row.tabIndex = -1;

  const iconEl = row.createSpan({ cls: "folder-nav-row-icon" });
  const nameEl = row.createSpan({ cls: "folder-nav-row-name" });

  if (isFolder) {
    const chevron = row.createSpan({ cls: "folder-nav-row-chevron" });
    setIcon(chevron, "chevron-right");
  }

  const result: RenderedRow = { el: row, isFolder, nameEl, iconEl, name: "", icon: "", tint: null };
  updateRow(result, file, options);
  return result;
}

/** Retain DOM nodes and SVGs when a vault event leaves their content unchanged. */
export function updateRow(row: RenderedRow, file: TAbstractFile, options: RowOptions): void {
  const name = displayName(file, options.showExtensions);
  if (row.name !== name) {
    row.name = name;
    row.nameEl.setText(name);
  }
  const icon = iconFor(file);
  if (row.icon !== icon) {
    row.icon = icon;
    setIcon(row.iconEl, icon);
  }
  if (row.tint !== options.tint) {
    row.tint = options.tint;
    row.el.toggleClass("has-tint", options.tint !== null);
    if (options.tint) row.el.style.setProperty("--fn-tint", options.tint);
    else row.el.style.removeProperty("--fn-tint");
  }
}
