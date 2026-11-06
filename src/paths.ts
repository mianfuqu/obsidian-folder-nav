/** Path boundaries matter: "Notes 2" is not inside "Notes". */
export function isWithin(path: string, ancestor: string): boolean {
  return ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`);
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function rebasePath(path: string, oldPath: string, newPath: string): string {
  return isWithin(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
}
