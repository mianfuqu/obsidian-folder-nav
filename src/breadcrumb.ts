export interface Crumb {
  label: string;
  /** "" for the vault root. */
  path: string;
}

/**
 * Root-relative trail, e.g. "" -> [MyVault]; "Notes/Physics" ->
 * [MyVault, Notes, Physics].
 */
export function buildCrumbs(vaultName: string, currentPath: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: vaultName, path: "" }];
  if (!currentPath) return crumbs;

  let accumulated = "";
  for (const segment of currentPath.split("/")) {
    if (!segment) continue;
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

/** Decide which leading ancestors to collapse, using natural label widths.
 * The last two levels may truncate; further ancestors are added only in full.
 */
export function firstVisibleCrumb(widths: number[], available: number, overflow: number, separator: number): number {
  if (widths.length < 2) return 0;
  const fullWidth = widths.reduce((sum, width) => sum + width, 0) + separator * (widths.length - 1);
  if (fullWidth <= available) return 0;
  const last = widths.length - 1;
  const pairMinimum = Math.min(widths[last - 1], 72) + Math.min(widths[last], 80) + separator;
  if (last === 1 && pairMinimum <= available) return 0;
  let start = last;
  if (last > 1 && overflow + separator + pairMinimum <= available) start--;
  let needed = overflow + widths.slice(start).reduce((sum, width) => sum + width, 0) + separator * (widths.length - start);
  while (start > 1 && needed + widths[start - 1] + separator <= available) {
    needed += widths[--start] + separator;
  }
  return start;
}
