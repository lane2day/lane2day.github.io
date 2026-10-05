---
name: publish-html
description: Publish an HTML deliverable (presentation, report, dashboard, visualization, prototype) from any project to Lane's GitHub Pages hub by registering a symlink and deploying. Use after creating or significantly updating an HTML deliverable, when Lane says "publish this", "put this on the hub", "share this page", or asks what's published.
---

# Publish HTML to the Pages hub

Lane keeps one GitHub Pages site that indexes HTML from projects across his laptop.
The site repo holds **symlinks only** (`registry/`). Each project stays the source of truth
for its HTML and for the metadata that describes it.

**Hub repo:** read the path from the "Publishing HTML deliverables" block in `~/.claude/CLAUDE.md`.
Fallback: this skill's real path is `<hub>/claude/skills/publish-html`, so go up three levels.
All commands below run as `node <hub>/scripts/pub.mjs …`.

## When you've just made an HTML deliverable

1. **Ask once** at the end of the task: "Want me to publish `<file>` to your Pages hub?" Don't ask again in the same session for the same file. Skip for throwaway scratch files, test fixtures and generated reports (coverage, etc.).
2. If yes, **check it's safe to publish. The hub is a PUBLIC site** (anyone with the URL). Look for secrets, tokens, customer PII, named customer contacts, non-public customer metrics, and anything marked internal. If any are present, say what you found and recommend not publishing, or publishing a sanitized version. Pages titled `[INTERNAL]` are excluded automatically.
3. **Make the project describe it.** Metadata comes from the source project in this order:
   `.publish.json` override → `<title>` / `<meta name="description">` in the HTML → `package.json` / `pyproject.toml` description → the README's first paragraph.
   If the page has no useful `<title>` or description, add a `<meta name="description">` to the HTML (preferred) or create `.publish.json` in the project root:
   ```json
   { "description": "Project-level default", "tags": ["analysis"],
     "files": { "out/deck.html": { "title": "Q3 churn readout", "description": "…" } } }
   ```
4. **Register:** `pub.mjs add <path-to-file-or-folder> [--slug short-name]`.
   - Link a **folder** when the page loads assets from outside its own directory (e.g. `../assets`). A single file brings along only assets in its own folder or below.
   - Slugs become URLs (`<site>/<slug>/`), so keep them short and stable.
5. **Preview:** `pub.mjs list`. Show Lane the title, description and project line for the new entry.
6. **Deploy only after Lane confirms:** `pub.mjs deploy`. It builds, scans for secret-looking strings (it stops if it finds any; re-run with `--yes` only after Lane checks them) and force-pushes the built site to `gh-pages`.
7. Commit the registry change in the hub repo: `git -C <hub> add registry && git -C <hub> commit -m "Publish <slug>" && git -C <hub> push`.
8. Report the URL: `<siteUrl from config.json>/<slug>/`.

## Updating

The source file is the source of truth. After editing it, just `pub.mjs deploy`. No registry change is needed.

## Other commands

- `pub.mjs list`: what's registered (✗ = broken link, e.g. the project moved).
- `pub.mjs remove <slug>`, then `deploy`: unpublish.
- `pub.mjs discover [roots…]`: find unregistered HTML Lane authored, written to `candidates.tsv` for review, then `add --from candidates.tsv`.
