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
