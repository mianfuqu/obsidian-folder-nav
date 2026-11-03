import { setIcon } from "obsidian";
import type { Crumb } from "./breadcrumb";

/** An accessible path menu with public DOM APIs, scoped to its owning window. */
export class PathMenu {
  private el: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private index: number;
  private closed = false;
  private doc: Document;
  private win: Window;

  constructor(
    private anchor: HTMLElement,
    crumbs: Crumb[],
    fontSize: number | null,
    private onNavigate: (path: string) => void,
    private onClose: () => void,
  ) {
    this.doc = anchor.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.el = this.doc.body.createDiv({ cls: "folder-nav-path-menu" });
    this.el.setAttribute("role", "menu");
    this.el.setAttribute("aria-label", "完整文件夹路径");
    if (fontSize !== null) this.el.style.setProperty("--fn-path-size", `${fontSize}px`);
    this.index = crumbs.length - 1;
    crumbs.forEach((crumb, index) => {
      const button = this.el.createEl("button", { cls: "folder-nav-path-menu-item", type: "button" });
      button.setAttribute("role", "menuitem");
      button.title = crumb.path || crumb.label;
      const icon = button.createSpan({ cls: "folder-nav-path-menu-icon" });
      setIcon(icon, index === 0 ? "vault" : "folder-closed");
      const label = button.createSpan({ cls: "folder-nav-path-menu-label" });
      label.createSpan({ text: crumb.label });
      label.createSpan({ cls: "folder-nav-path-menu-level", text: index === 0 ? "库根目录" : `第 ${index} 级` });
      if (index === this.index) {
        button.setAttribute("aria-current", "location");
        setIcon(button.createSpan({ cls: "folder-nav-path-menu-check" }), "check");
      }
      button.tabIndex = index === this.index ? 0 : -1;
      button.addEventListener("click", () => {
        this.close(false);
        this.onNavigate(crumb.path);
      });
      this.buttons.push(button);
    });
    this.el.addEventListener("keydown", this.onKeyDown);
    this.doc.addEventListener("pointerdown", this.onOutside, true);
    this.doc.addEventListener("scroll", this.onScroll, true);
    this.win.addEventListener("resize", this.onResize);
    this.position();
    this.buttons[this.index]?.focus();
    this.buttons[this.index]?.scrollIntoView({ block: "nearest" });
  }

  private position(): void {
    const anchor = this.anchor.getBoundingClientRect();
    const menu = this.el.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left, this.win.innerWidth - menu.width - 12));
    const below = anchor.bottom + 6;
    const top = below + menu.height <= this.win.innerHeight - 12
      ? below : Math.max(12, anchor.top - menu.height - 6);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      return;
    }
    if (event.key === "Tab") {
      this.close(true);
      return;
    }
    let next = this.index;
    if (event.key === "ArrowDown") next = (next + 1) % this.buttons.length;
    else if (event.key === "ArrowUp") next = (next - 1 + this.buttons.length) % this.buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.buttons.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    this.buttons[this.index].tabIndex = -1;
    this.index = next;
    this.buttons[next].tabIndex = 0;
    this.buttons[next].focus();
    this.buttons[next].scrollIntoView({ block: "nearest" });
  };

  private onOutside = (event: Event): void => {
    const target = event.target as Node | null;
    if (!this.el.contains(target) && !this.anchor.contains(target)) this.close(false);
  };

  private onScroll = (event: Event): void => {
    if (!this.el.contains(event.target as Node | null)) this.close(false);
  };

  private onResize = (): void => this.close(false);

  close(restoreFocus = false): void {
    if (this.closed) return;
    this.closed = true;
    this.doc.removeEventListener("pointerdown", this.onOutside, true);
    this.doc.removeEventListener("scroll", this.onScroll, true);
    this.win.removeEventListener("resize", this.onResize);
    this.el.remove();
    if (restoreFocus) this.anchor.focus();
    this.onClose();
  }
}
