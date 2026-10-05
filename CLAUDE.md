# lane2day.github.io — Pages hub

Lane's personal GitHub Pages site. It indexes HTML deliverables that live in projects
scattered across the laptop. **This repo holds symlinks only** — each source project stays
the source of truth for its HTML and metadata.

## The single most important rule

**This site is public.** Anyone with a URL can open it. `robots.txt` plus a `noindex` tag
keep it out of search engines, but that is obscurity, not access control.

Before registering or deploying anything, check it for:

- Customer data, named customer contacts, or account-identifying analysis
- Internal-only Fullstory material (roadmaps, pricing, competitive sales briefs, revenue figures)
- Credentials, API keys, org IDs, or internal hostnames

Mark anything internal with `[INTERNAL]` in the page `<title>` — `pub deploy` skips every page
whose title matches `excludeTitlePatterns` in `config.json`. Deploy also runs a secret scan,
but treat that as a backstop, not the review.

**Never run `pub deploy` without Lane's explicit go-ahead on the current `pub list` output.**

## Layout

| Path | What |
|------|------|
| `registry/` | Symlinks to HTML files/folders in their source projects. Managed only via `pub add`/`pub remove`. |
| `scripts/pub.mjs` | The CLI (below). |
| `scripts/install-claude.sh` | Links the `publish-html` skill into `~/.claude/skills` and adds a block to `~/.claude/CLAUDE.md`. Safe to re-run; writes a `.bak`. |
| `claude/skills/publish-html/` | The skill that offers to publish HTML deliverables. |
| `config.json` | Site title/URL, `gh-pages` branch, discover roots, `[INTERNAL]` exclusion patterns. |
| `client-facing/` | Pre-existing committed content, not part of the registry. |
| `_site/` | Build output. Gitignored. Never commit it. |

## Branches

- **`main`** — the registry and tooling only. Its history is the record of what was published and when.
- **`gh-pages`** — build output, force-pushed by `pub deploy`. **Never hand-edit or commit to it.**

Git stores a symlink as its target path, not the file, so GitHub cannot follow links into the
laptop. That is why deploy is local: `pub deploy` resolves the symlinks on this machine,
builds `_site/`, and force-pushes that.

## Commands

```sh
node scripts/pub.mjs discover [roots…]          # find HTML Lane authored → candidates.tsv (review before using)
node scripts/pub.mjs add --from candidates.tsv  # register every uncommented line
node scripts/pub.mjs add <file.html|folder> [--slug name]
node scripts/pub.mjs list [--json]              # entries + the metadata the index will show
node scripts/pub.mjs remove <slug>
node scripts/pub.mjs build                      # local preview: npx serve _site
node scripts/pub.mjs deploy                     # build + secret scan + force-push to gh-pages
```

After `add`/`remove`, commit `registry/` on `main`. After editing a source file, just `deploy` —
the symlink already points at it, so no registry change is needed.

## Metadata

Resolved per entry, first match wins:

1. `.publish.json` in the source project root (project defaults, plus per-file overrides under `files`)
2. The page's `<title>` and `<meta name="description">`
3. `package.json` / `pyproject.toml` name and description
4. The first paragraph of the README

Git remote and last-commit date for the file are added automatically. To fix a bad title or
description, edit it **in the source project** — not here.

## Files vs folders

- Registering a **file** publishes it plus relative assets in its own folder or below.
- Registering a **folder** publishes the whole folder (minus `.git`, `node_modules`, `.env*`).
  Use this when a page loads `../something`. Everything else in that folder goes public too — check it.
