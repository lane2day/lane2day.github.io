# Pages hub

> **This site is public.** Anyone with a URL can open it. `robots.txt` and a `noindex` tag keep it out of search engines, and
> deploy skips any page whose title matches `excludeTitlePatterns` in `config.json` (default: `[INTERNAL]`).
> Don't publish customer data, named customer contacts, or internal-only analysis.

One GitHub Pages site that indexes HTML from projects all over your laptop. This repo holds
**symlinks only**. Each project stays the source of truth for its HTML and for the metadata
that describes it.

```
registry/q3-churn.html  ->  ~/code/churn-analysis/out/deck.html
registry/pricing-proto  ->  ~/code/pricing/prototype/          (folder: index.html + assets)
```

**Why a local deploy:** git stores a symlink as its target path, not the file, so GitHub can't follow
links to files on your laptop. `pub deploy` follows them on your machine, builds `_site/` and
force-pushes it to the `gh-pages` branch. `main` holds only the registry, so its history shows what was published and when.

## Commands

```sh
node scripts/pub.mjs discover [~/code …]       # find HTML you authored → candidates.tsv (review it)
node scripts/pub.mjs add --from candidates.tsv  # register every uncommented line
node scripts/pub.mjs add <file.html|folder> [--slug name]
node scripts/pub.mjs list                       # entries + the metadata the index will show
node scripts/pub.mjs remove <slug>
node scripts/pub.mjs build                      # local preview: npx serve _site
node scripts/pub.mjs deploy                     # build + secret scan + push to gh-pages
```

After `add`/`remove`, commit `registry/` on `main`. After editing a source file, just `deploy`.

## Where metadata comes from (first match wins)

1. `.publish.json` in the source project root (project defaults, plus per-file overrides under `files`):
   ```json
   { "description": "…", "tags": ["analysis"],
     "files": { "out/deck.html": { "title": "Q3 churn readout" } } }
   ```
2. The page's `<title>` and `<meta name="description">`
3. `package.json` / `pyproject.toml` name and description
4. The first paragraph of the README

Each project's git remote and last commit date for the file are added automatically.

## How discover decides what's yours

It walks `discoverRoots` from `config.json` (or roots you pass; `~` if neither is set), skips `Library`, `Downloads`, `node_modules`, dotfolders and build/test
output, then keeps HTML that sits in a repo you've committed to (by your git email) **and** that you authored or that is
untracked. Repos with none of your commits (clones, dependencies) are ignored. Gitignored files, files
outside any repo and files without a `<title>` are listed but commented out for you to review.
Your git email plus `discoverEmails` in `config.json` count as you; add more with `--email a@x.com`.

## Files vs folders

- Linking a **file** publishes it plus any relative assets in its own folder or below.
- Linking a **folder** publishes the whole folder (minus `.git`, `node_modules`, `.env*`). Use this when
  the page loads `../something`. Everything else in the folder goes public too.

## Claude integration

`scripts/install-claude.sh` links `claude/skills/publish-html` into `~/.claude/skills/` and adds a block
to `~/.claude/CLAUDE.md` telling Claude to ask whether to publish each HTML deliverable it creates.
Re-running it is safe (it replaces its own block and writes a backup).
