import { App, EventRef, WorkspaceLeaf } from "obsidian";
import type FolderNavPlugin from "./main";
import { VIEW_TYPE } from "./view";

const NATIVE_VIEW = "file-explorer";

/** A leaf is "in the sidebar" when its root split is the left one. */
function isInLeftSidebar(app: App, leaf: WorkspaceLeaf): boolean {
  return leaf.getRoot() === app.workspace.leftSplit;
}

interface NativeExplorerState {
  sortOrder?: string;
  autoReveal?: boolean;
}

/**
 * Swaps the built-in explorer's view for ours, in the same leaf.
 *
 * We replace the leaf's view state rather than disabling the internal
 * `file-explorer` plugin. Disabling it would also remove the sidebar's ribbon
 * icon, and reaching for it would mean touching undocumented APIs — everything
 * here goes through the public workspace API instead.
 */
export class FileExplorerTakeover {
  private plugin: FolderNavPlugin;
  private refs: EventRef[] = [];
  private active = false;
  private busy = false;

  constructor(plugin: FolderNavPlugin) {
    this.plugin = plugin;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.snapshotNativeSettings();
    this.refs.push(this.plugin.app.workspace.on("layout-change", () => void this.takeOver()));
    void this.takeOver();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.release();
    this.restoreNativeLeaves();
  }

  /** Called from Plugin.onunload — the user must never be left with a dead view. */
  restoreOnUnload(): void {
    this.active = false;
    this.release();
    this.restoreNativeLeaves();
  }

  private release(): void {
    for (const ref of this.refs) this.plugin.app.workspace.offref(ref);
    this.refs = [];
  }

  /**
   * The built-in plugin can recreate its own leaf — on layout restore, or when
   * the user runs "Open file explorer". Replacing on every layout change keeps
   * ours in place. The `busy` flag stops the setViewState calls we make here
   * from feeding back into this same handler.
   */
  private async takeOver(): Promise<void> {
    if (this.busy || !this.active) return;
    this.busy = true;
    try {
      const workspace = this.plugin.app.workspace;
      for (const leaf of workspace.getLeavesOfType(NATIVE_VIEW)) {
        const wasActive = workspace.activeLeaf === leaf;
        await leaf.setViewState({ type: VIEW_TYPE, active: wasActive });
      }
      this.consolidate();
    } finally {
      this.busy = false;
    }
  }

  /**
   * A second drill-down pane is never useful, so more than one is always layout
   * debris — Obsidian can persist one from a half-restored workspace, and it
   * shows up as an extra empty tab. Keep the sidebar one and drop the rest.
   */
  private consolidate(): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length <= 1) return;

    const keep =
      leaves.find((leaf) => isInLeftSidebar(this.plugin.app, leaf)) ?? leaves[0];
    for (const leaf of leaves) {
      if (leaf !== keep) leaf.detach();
    }
  }

  private restoreNativeLeaves(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      void leaf.setViewState({ type: NATIVE_VIEW });
    }
  }

  /**
   * Mirrors the native explorer's own settings so the list does not visibly
   * change when we take over. Only readable while a native leaf still exists,
   * which is exactly the moment we take over; afterwards our own settings file
   * carries the values forward.
   */
  private snapshotNativeSettings(): void {
    const leaf = this.plugin.app.workspace.getLeavesOfType(NATIVE_VIEW)[0];
    const state = leaf?.getViewState().state as NativeExplorerState | undefined;
    if (!state) return;

    if (state.sortOrder) this.plugin.settings.nativeSortOrder = state.sortOrder;
    if (typeof state.autoReveal === "boolean") this.plugin.settings.autoReveal = state.autoReveal;
    void this.plugin.saveSettings();
  }

}
