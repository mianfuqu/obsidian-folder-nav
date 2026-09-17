# Contributors

- **mianfuqu** — author and maintainer
- **[DeepSeek](https://www.deepseek.com/)** — implementation

## How this plugin was built

Folder Nav was written in pair-programming sessions: the maintainer set the
direction, made the product decisions (drill-down over a tree, colours that
inherit down the folder, taking over the native file list with a toggle back),
and verified every change in a live vault; DeepSeek wrote the implementation.

Every feature was validated against a running Obsidian before release — by
driving the app through the Obsidian CLI, taking screenshots, and exercising
the vault operations end to end rather than assuming they worked.
