import { EventRef, TAbstractFile, WorkspaceLeaf } from "obsidian";
import type FolderNavPlugin from "./main";
import { VIEW_TYPE } from "./view";

const NATIVE_VIEW = "file-explorer";

/**
 * `WorkspaceLeaf.containerEl` exists at runtime but is newer than the typings
 * version we pin, so reach for it structurally rather than bumping the floor.
 */
function isInLeftSidebar(leaf: WorkspaceLeaf): boolean {
  const el = (leaf as unknown as { containerEl?: HTMLElement }).containerEl;
  return !!el?.closest(".mod-left-split");
}

interface NativeExplorerState {
  sortOrder?: string;
  autoReveal?: boolean;
}

/**
 * Swaps the built-in explorer's view for ours, in the same leaf.
 *
 * We replace the leaf's view state rather than disabling the internal
 * `file-explorer` plugin. Disabling that plugin would also remove the sidebar's
 * ribbon icon and break `revealInFolder`, which both Obsidian's own
 * "Reveal file in navigation" command and other plugins call into.
 */
export class FileExplorerTakeover {
  private plugin: FolderNavPlugin;
  private refs: EventRef[] = [];
  private active = false;
  private busy = false;
  private originalRevealInFolder: ((file: TAbstractFile) => void) | null = null;

  constructor(plugin: FolderNavPlugin) {
    this.plugin = plugin;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.snapshotNativeSettings();
    this.patchRevealInFolder();
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
    this.unpatchRevealInFolder();
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

    const keep = leaves.find((leaf) => isInLeftSidebar(leaf)) ?? leaves[0];
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

  // ------------------------------------------------------------- reveal bridge

  /**
   * `revealInFolder` is an undocumented internal API, so everything here is
   * best-effort: if the shape is not what we expect we simply leave it alone and
   * the native command becomes a no-op while our view is in charge.
   */
  private patchRevealInFolder(): void {
    const instance = this.explorerInstance();
    if (!instance || typeof instance.revealInFolder !== "function") return;
    if (this.originalRevealInFolder) return;

    const original = instance.revealInFolder.bind(instance);
    this.originalRevealInFolder = original;

    instance.revealInFolder = (file: TAbstractFile) => {
      const view = this.plugin.getView();
      if (view) {
        view.revealFile(file);
        return;
      }
      try {
        original(file);
      } catch {
        // The native view is gone; nothing sensible left to delegate to.
      }
    };
  }

  private unpatchRevealInFolder(): void {
    const instance = this.explorerInstance();
    if (instance && this.originalRevealInFolder) {
      instance.revealInFolder = this.originalRevealInFolder;
    }
    this.originalRevealInFolder = null;
  }

  private explorerInstance(): { revealInFolder?: (file: TAbstractFile) => void } | null {
    const internalPlugins = (
      this.plugin.app as unknown as {
        internalPlugins?: {
          getPluginById(id: string): { instance?: unknown } | null;
        };
      }
    ).internalPlugins;
    const instance = internalPlugins?.getPluginById(NATIVE_VIEW)?.instance;
    return (instance as { revealInFolder?: (file: TAbstractFile) => void }) ?? null;
  }
}
