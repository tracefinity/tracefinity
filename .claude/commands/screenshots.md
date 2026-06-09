Take screenshots of the running Tracefinity app using Playwright for docs/README.

Run: `node .claude/commands/screenshots.mjs`

Options: `--light` for light theme, `--base-url=URL` to override (default http://localhost:4001).

Requires: `pnpm add -D playwright` if not already installed, and the app running on localhost:4001.

Output files (always overwritten on re-run):
- `docs/screenshots/dashboard.png`
- `docs/screenshots/tool-editor.png`
- `docs/screenshots/bin-editor.png`

$ARGUMENTS
