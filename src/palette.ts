export interface PaletteColor {
  id: string;
  label: string;
  hex: string;
}

/**
 * Mid-tone hues, chosen so a translucent wash of any of them stays legible over
 * both light and dark theme backgrounds. Text colour is never touched — the
 * tint is always layered under the theme's own foreground.
 */
export const PALETTE: PaletteColor[] = [
  { id: "red", label: "红", hex: "#e5484d" },
  { id: "orange", label: "橙", hex: "#f76b15" },
  { id: "amber", label: "琥珀", hex: "#ffb224" },
  { id: "green", label: "绿", hex: "#30a46c" },
  { id: "teal", label: "青", hex: "#12a594" },
  { id: "cyan", label: "天蓝", hex: "#00a2c7" },
  { id: "blue", label: "蓝", hex: "#3e63dd" },
  { id: "indigo", label: "靛", hex: "#5b5bd6" },
  { id: "violet", label: "紫", hex: "#8e4ec6" },
  { id: "pink", label: "粉", hex: "#d6409f" },
  { id: "brown", label: "棕", hex: "#a18072" },
  { id: "gray", label: "灰", hex: "#8b8d98" },
];

/** Folders get a slightly stronger tint than the full-view wash — smaller area. */
export const ROW_TINT_ALPHA = 0.22;

const byId = new Map(PALETTE.map((color) => [color.id, color]));

export function paletteColor(id: string | null | undefined): PaletteColor | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}

/** "#3e63dd" -> "62,99,221" */
function rgbChannels(hex: string): string {
  const value = parseInt(hex.replace("#", ""), 16);
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}

/** A translucent layer of `colorId`, or null if the id isn't in the palette. */
export function tintOf(colorId: string, alpha: number): string | null {
  const color = paletteColor(colorId);
  if (!color) return null;
  return `rgba(${rgbChannels(color.hex)}, ${alpha})`;
}

/**
 * Nearest-ancestor lookup. A folder with no colour of its own inherits the
 * closest coloured ancestor, so drilling from a blue folder into its subfolder
 * keeps the blue — otherwise the "where am I" cue would vanish exactly one
 * level down, which is where a drill-down list needs it most.
 */
export function resolveColorId(
  colors: Record<string, string>,
  path: string
): string | null {
  let current = path;
  for (;;) {
    const found = colors[current];
    if (found) return found;
    if (current === "") return null;
    const slash = current.lastIndexOf("/");
    current = slash === -1 ? "" : current.slice(0, slash);
  }
}
