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

export interface RowHandlers {
  showExtensions: boolean;
  /** A translucent background colour for this row, or null for none. */
  tintFor: (file: TAbstractFile) => string | null;
  onOpen: (file: TAbstractFile) => void;
  onContextMenu: (event: MouseEvent, file: TAbstractFile) => void;
}

export function createRow(file: TAbstractFile, handlers: RowHandlers): HTMLElement {
  const isFolder = file instanceof TFolder;

  const row = createDiv({ cls: "folder-nav-row" });
  row.addClass(isFolder ? "is-folder" : "is-file");
  row.dataset.path = file.path;
  row.tabIndex = -1;

  const tint = handlers.tintFor(file);
  if (tint) {
    row.addClass("has-tint");
    row.style.setProperty("--fn-tint", tint);
  }

  const icon = row.createSpan({ cls: "folder-nav-row-icon" });
  setIcon(icon, iconFor(file));

  row.createSpan({
    cls: "folder-nav-row-name",
    text: displayName(file, handlers.showExtensions),
  });

  if (isFolder) {
    const chevron = row.createSpan({ cls: "folder-nav-row-chevron" });
    setIcon(chevron, "chevron-right");
  }

  row.addEventListener("click", () => handlers.onOpen(file));
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.onContextMenu(event, file);
  });

  return row;
}
