#!/usr/bin/env node
// pub — publish HTML from projects across your laptop via a symlink registry.
//   node scripts/pub.mjs discover [roots…] [--email a,b]    find HTML you authored → candidates.tsv (roots default: config.json)
//   node scripts/pub.mjs add <file-or-dir> [--slug name]   register (creates symlink in registry/)
//   node scripts/pub.mjs add --from candidates.tsv          register every uncommented line
//   node scripts/pub.mjs remove <slug>                      unregister
//   node scripts/pub.mjs list [--json]                      show entries + derived metadata
//   node scripts/pub.mjs build                              build _site/ locally (follows symlinks)
//   node scripts/pub.mjs deploy [--yes]                     build + force-push _site/ to the gh-pages branch
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = path.join(ROOT, "registry");
const OUT = path.join(ROOT, "_site");
const CONFIG = { siteTitle: "Lane's published HTML", branch: "gh-pages", remote: "origin", ...readJSON(path.join(ROOT, "config.json")) };
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".next", ".cache"]);
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bghp_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAIza[0-9A-Za-z_-]{35}/,
];

// ---------- helpers ----------
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
function git(cwd, ...args) {
  try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch { return ""; }
}
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slugify = (s) => s.toLowerCase().replace(/\.html?$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
const tildify = (p) => (p.startsWith(os.homedir()) ? "~" + p.slice(os.homedir().length) : p);
const die = (msg) => { throw new Error(msg); };
const flag = (args, name) => { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (args, name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true; };

const PROJECT_MARKERS = ["package.json", "pyproject.toml", "README.md", "readme.md", "CLAUDE.md", ".publish.json"];
// Nearest folder that looks like a project (handles monorepos), bounded by the enclosing git repo.
function findProjectRoot(start) {
  let gitRoot = null;
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) { gitRoot = d; break; }
    if (path.dirname(d) === d) break;
  }
  const stop = gitRoot || os.homedir();
  for (let d = start; ; d = path.dirname(d)) {
    if (PROJECT_MARKERS.some((f) => fs.existsSync(path.join(d, f)))) return d;
    if (d === stop || path.dirname(d) === d) return gitRoot || start;
  }
}

function gitRootOf(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return null;
  }
}

function readmeSummary(root) {
  const f = ["README.md", "readme.md", "README", "README.txt"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
  if (!f) return "";
  const paras = fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/);
  for (const p of paras) {
    const t = p.trim();
    if (!t || /^(#|!\[|\[!\[|<|```|---|\||>)/.test(t) || t.length < 40 || /^\**\w[\w ]{0,20}\**:\s/.test(t)) continue;
    const clean = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ");
    return clean.length > 220 ? clean.slice(0, 217).trimEnd() + "…" : clean;
  }
  return "";
}

function repoUrl(root) {
  let u = git(root, "remote", "get-url", "origin");
  if (!u) return "";
  u = u.replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "");
  return /^https?:\/\//.test(u) ? u : "";
}

const decode = (t) => t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&[a-z]+;|&#\d+;/gi, " ");
// First substantial paragraph of visible body text — most decks/reports open with a subtitle or summary.
function htmlSummary(html) {
  const body = html.replace(/<(script|style|nav|header|footer|svg|noscript)[\s\S]*?<\/\1>/gi, " ");
  for (const m of body.matchAll(/<(p|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length >= 40 && !/^\w[\w ]{0,20}:\s/.test(t)) return t.length > 220 ? t.slice(0, 217).trimEnd() + "…" : t;
  }
  return "";
}

function htmlMeta(html) {
  return {
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim(),
    description: html.match(/<meta\s+name=["']description["']\s+content=(["'])(.*?)\1/i)?.[2]?.trim(),
  };
}

function findEntryHtml(dir) {
  if (fs.existsSync(path.join(dir, "index.html"))) return path.join(dir, "index.html");
  const f = fs.readdirSync(dir).find((n) => n.endsWith(".html"));
  return f ? path.join(dir, f) : null;
}

// ---------- resolve registry entries ----------
function entries() {
  if (!fs.existsSync(REG)) return [];
  return fs.readdirSync(REG).filter((n) => !n.startsWith(".") && n !== "README.md").sort().map(resolveEntry);
}

function resolveEntry(name) {
  const linkPath = path.join(REG, name);
  const slug = slugify(name);
  const isLink = fs.lstatSync(linkPath).isSymbolicLink();
  const linkTarget = isLink ? fs.readlinkSync(linkPath) : linkPath;
  let real;
  try { real = fs.realpathSync(linkPath); } catch { return { slug, name, broken: true, linkTarget }; }
  const isDir = fs.statSync(real).isDirectory();
  const htmlFile = isDir ? findEntryHtml(real) : real;
  if (!htmlFile) return { slug, name, broken: true, linkTarget, reason: "no .html file in directory" };

  const root = findProjectRoot(path.dirname(htmlFile));
  const pkg = readJSON(path.join(root, "package.json"));
  const pyproject = (() => { try { return fs.readFileSync(path.join(root, "pyproject.toml"), "utf8"); } catch { return ""; } })();
  const overridesFile = readJSON(path.join(root, ".publish.json"));
  const relInProject = path.relative(root, isDir ? real : htmlFile).split(path.sep).join("/");
  const override = { ...overridesFile, ...(overridesFile.files?.[relInProject] || {}) };
  delete override.files;
  const html = fs.readFileSync(htmlFile, "utf8");
  const fromHtml = htmlMeta(html);
  // Umbrella folders (users/, solutions/) or a project root far above the page don't describe it well.
  const depth = path.relative(root, path.dirname(htmlFile)).split(path.sep).filter(Boolean).length;
  const rootIsSpecific = !GENERIC.has(path.basename(root).toLowerCase()) && depth <= 2;
  const nearest = (() => { for (let d = isDir ? real : path.dirname(htmlFile); path.dirname(d) !== d; d = path.dirname(d)) if (!GENERIC.has(path.basename(d).toLowerCase())) return path.basename(d); return path.basename(root); })();
  const project = override.project || (rootIsSpecific ? pkg.name || pyproject.match(/^name\s*=\s*["']([^"']+)/m)?.[1] || path.basename(root) : nearest);
  const updatedIso = git(root, "log", "-1", "--format=%cI", "--", relInProject);
  const dirty = git(root, "status", "--porcelain", "--", relInProject) !== "";

  return {
    slug, name, broken: false, isDir, linkTarget, real, htmlFile, root,
    url: `${slug}/` + (isDir ? path.relative(real, htmlFile).split(path.sep).join("/").replace(/^index\.html$/, "") : ""),
    title: override.title || fromHtml.title || project,
    description: override.description || fromHtml.description || htmlSummary(html)
      || (rootIsSpecific ? pkg.description || pyproject.match(/^description\s*=\s*["']([^"']+)/m)?.[1] || readmeSummary(root) : ""),
    project,
    tags: override.tags || [],
    repo: override.repo || repoUrl(root),
    source: tildify(isDir ? real : htmlFile),
    updated: updatedIso && !dirty ? new Date(updatedIso) : fs.statSync(htmlFile).mtime,
    uncommitted: dirty,
  };
}

// ---------- copying ----------
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    if (SKIP_DIRS.has(n) || n.startsWith(".env")) continue;
    const s = path.join(src, n), d = path.join(dest, n);
    const st = fs.statSync(s);
    st.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

// Copies one HTML file to dest/index.html plus any relative assets it (or its CSS) references.
function copyFileWithAssets(htmlFile, dest, warnings) {
  const base = path.dirname(htmlFile);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(htmlFile, path.join(dest, "index.html"));
  const queue = [htmlFile], seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift();
    const text = fs.readFileSync(file, "utf8");
    const refs = [...text.matchAll(/(?:src|href|poster)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1] || m[2]);
    for (let ref of refs) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(ref) || ref.includes("${") || ref.includes("{{")) continue;
      ref = decodeURIComponent(ref.split(/[?#]/)[0]);
      if (!ref) continue;
      const abs = path.resolve(path.dirname(file), ref);
      const rel = path.relative(base, abs);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      if (rel.startsWith("..")) { warnings.push(`skipped asset outside the page's folder: ${ref} (link the folder instead)`); continue; }
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.copyFileSync(abs, path.join(dest, rel));
      if (abs.endsWith(".css")) queue.push(abs);
    }
  }
}

function scanSecrets(dir, hits = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { scanSecrets(p, hits); continue; }
    if (!/\.(html?|js|mjs|css|json|txt|md|svg|map)$/i.test(n) || fs.statSync(p).size > 5e6) continue;
    const t = fs.readFileSync(p, "utf8");
    for (const re of SECRET_PATTERNS) if (re.test(t)) { hits.push(`${path.relative(OUT, p)} (matches ${re.source.slice(0, 24)}…)`); break; }
  }
  return hits;
}

const GENERIC = new Set(["ui", "docs", "doc", "report", "reports", "deliverables", "dist", "build", "out", "public", "site", "src",
  "app", "web", "www", "html", "users", "projects", "solutions", "examples", "pages", "slides", "deck", "index", "lane2day"]);
// Slug = nearest meaningful folder name, plus the file name when it isn't index/generic.
function defaultSlug(real) {
  const isDir = fs.statSync(real).isDirectory();
  const base = isDir ? "" : path.basename(real).replace(/\.html?$/i, "");
  const parts = [];
  for (let d = isDir ? real : path.dirname(real); path.dirname(d) !== d && d !== os.homedir(); d = path.dirname(d)) {
    const n = path.basename(d);
    if (!GENERIC.has(n.toLowerCase())) { parts.push(n); break; }
  }
  if (base && !GENERIC.has(base.toLowerCase()) && !slugify(parts[0] || "").includes(slugify(base))) parts.push(base);
  return parts.join("-") || base || "page";
}

// ---------- commands ----------
function cmdAdd(args) {
  const from = flag(args, "--from");
  if (from) return cmdImport(from);
  const slugArg = flag(args, "--slug");
  const force = bool(args, "--force");
  const target = args[0] && path.resolve(args[0].replace(/^~(?=$|\/)/, os.homedir()));
  if (!target || !fs.existsSync(target)) die("usage: pub add <file.html | folder> [--slug name]");
  const st = fs.statSync(target);
  if (!st.isDirectory() && !/\.html?$/i.test(target)) die("target must be an .html file or a folder containing one");
  if (st.isDirectory() && !findEntryHtml(target)) die("folder has no .html file");
  const real = fs.realpathSync(target);
  const slug = slugify(slugArg || defaultSlug(real));
  const name = st.isDirectory() ? slug : `${slug}.html`;
  fs.mkdirSync(REG, { recursive: true });
  const existing = fs.readdirSync(REG).find((n) => slugify(n) === slug);
  if (existing && !force) {
    let cur; try { cur = fs.realpathSync(path.join(REG, existing)); } catch {}
    if (cur === real) return console.log(`already registered: registry/${existing}`);
    die(`slug "${slug}" already registered (registry/${existing}). Use --slug or --force.`);
  }
  if (existing) fs.rmSync(path.join(REG, existing), { force: true });
  fs.symlinkSync(real, path.join(REG, name));
  const e = resolveEntry(name);
  console.log(`registered registry/${name} -> ${tildify(real)}`);
  printEntry(e);
}

function cmdRemove(args) {
  const slug = args[0] && slugify(args[0]);
  const n = slug && fs.readdirSync(REG).find((x) => slugify(x) === slug);
  if (!n) die(`no entry "${args[0]}"`);
  fs.rmSync(path.join(REG, n));
  console.log(`removed registry/${n} (source untouched)`);
}

function printEntry(e) {
  if (e.broken) return console.log(`  ✗ ${e.slug}  BROKEN → ${e.linkTarget}${e.reason ? " (" + e.reason + ")" : ""}`);
  console.log(`  ✓ ${e.slug}${e.uncommitted ? "  [uncommitted changes in source]" : ""}
      title:       ${e.title}
      description: ${e.description || "(none — add <meta name=\"description\"> or .publish.json)"}
      project:     ${e.project}${e.repo ? "  " + e.repo : ""}
      source:      ${e.source}`);
}

function cmdList(args) {
  const all = entries();
  if (bool(args, "--json")) return console.log(JSON.stringify(all, null, 2));
  if (!all.length) return console.log("registry is empty — run: pub add <path>");
  all.forEach(printEntry);
}

function build() {
  const all = entries();
  const warnings = [];
  const excludes = (CONFIG.excludeTitlePatterns || []).map((x) => new RegExp(x, "i"));
  const ok = all.filter((e) => {
    if (e.broken) return false;
    const hit = excludes.find((re) => re.test(e.title));
    if (hit) warnings.push(`excluded by excludeTitlePatterns (${hit.source}): ${e.slug} — "${e.title}"`);
    return !hit;
  });
  for (const e of all.filter((e) => e.broken)) warnings.push(`broken link, skipped: ${e.name} → ${e.linkTarget}`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  if (CONFIG.public) fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
  for (const e of ok) {
    const w = [];
    e.isDir ? copyDir(e.real, path.join(OUT, e.slug)) : copyFileWithAssets(e.htmlFile, path.join(OUT, e.slug), w);
    w.forEach((m) => warnings.push(`${e.slug}: ${m}`));
  }
  ok.sort((a, b) => b.updated - a.updated);
  const manifest = ok.map(({ slug, url, title, description, project, tags, repo, source, updated }) => ({ slug, url, title, description, project, tags, repo, source, updated }));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT, "index.html"), renderIndex(manifest));
  warnings.forEach((w) => console.warn("warning: " + w));
  console.log(`built ${ok.length} page(s) into _site/`);
  return { ok, warnings };
}

function cmdDeploy(args) {
  const yes = bool(args, "--yes");
  build();
  const hits = scanSecrets(OUT);
  if (hits.length && !yes) die("possible secrets found — inspect, then re-run with --yes if they're safe:\n  " + hits.join("\n  "));
  const remoteUrl = git(ROOT, "remote", "get-url", CONFIG.remote);
  if (!remoteUrl) die(`no git remote "${CONFIG.remote}" in ${ROOT}`);
  const run = (...a) => execFileSync("git", ["-C", OUT, ...a], { stdio: ["ignore", "ignore", "inherit"] });
  run("init", "-q", "-b", CONFIG.branch);
  run("add", "-A");
  run("-c", "user.name=pub", "-c", `user.email=${git(ROOT, "config", "user.email") || "pub@localhost"}`, "commit", "-q", "-m", `Publish ${new Date().toISOString()}`);
  run("push", "-q", "--force", remoteUrl, `HEAD:${CONFIG.branch}`);
  fs.rmSync(path.join(OUT, ".git"), { recursive: true, force: true });
  console.log(`deployed to ${CONFIG.branch}${CONFIG.siteUrl ? " → " + CONFIG.siteUrl : ""}`);
}

function renderIndex(items) {
  const rows = items.map((i) => {
    const q = [i.title, i.description, i.project, i.slug, ...(i.tags || [])].join(" ").toLowerCase();
    const date = new Date(i.updated);
    return `<li data-q="${esc(q)}">
  <div class="main">
    <a class="t" href="${esc(i.url)}">${esc(i.title)}</a>
    ${i.description ? `<p class="d">${esc(i.description)}</p>` : ""}
    <div class="meta"><span class="chip">${esc(i.project)}</span>${(i.tags || []).map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}${i.repo ? `<a href="${esc(i.repo)}">repo</a>` : ""}<code>${esc(i.source)}</code></div>
  </div>
  <time datetime="${date.toISOString()}">${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
</li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(CONFIG.siteTitle)}</title>${CONFIG.public ? '\n<meta name="robots" content="noindex, nofollow">' : ""}
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--line:#e7e5e4;--card:#fff;--acc:#4f46e5;--chip:#f5f5f4}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--mut:#a8a29e;--line:#292524;--card:#1c1917;--acc:#a5b4fc;--chip:#292524}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:820px;margin:0 auto;padding:48px 16px}h1{font-size:28px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 24px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;margin-bottom:16px}
ul{list-style:none;padding:0;margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
li{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:16px;border-top:1px solid var(--line)}li:first-child{border-top:0}
.main{min-width:0}.t{font-weight:600;color:inherit;text-decoration:none}.t:hover{color:var(--acc)}
.d{color:var(--mut);font-size:14px;margin:2px 0 6px}.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:var(--mut)}
.meta a{color:var(--acc)}.chip{background:var(--chip);border-radius:999px;padding:1px 8px}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}
time{color:var(--mut);font-size:13px;white-space:nowrap}.empty{color:var(--mut)}
@media (max-width:560px){li{flex-direction:column;gap:4px}}
</style></head><body><main>
<h1>${esc(CONFIG.siteTitle)}</h1><p class="sub">${items.length} page${items.length === 1 ? "" : "s"} · source of truth lives in each project</p>
<input id="q" type="search" placeholder="Filter by title, project, tag…" aria-label="Filter">
<ul id="list">${rows || '<li class="empty">Nothing published yet.</li>'}</ul>
</main><script>
const q=document.getElementById("q");q.addEventListener("input",()=>{const v=q.value.toLowerCase();document.querySelectorAll("#list li[data-q]").forEach(li=>li.hidden=!li.dataset.q.includes(v))});
</script></body></html>`;
}

// ---------- discover ----------
// Finds HTML you authored across your machine and writes a reviewable candidates file.
const SCAN_SKIP = new Set([...SKIP_DIRS, "Library", "Applications", "Pictures", "Music", "Movies", "Downloads",
  "vendor", "bower_components", "site-packages", "Pods", "DerivedData", "coverage", "htmlcov", "lcov-report",
  "playwright-report", "test-results", "storybook-static", "_build", "target", ".tox", "registry", "_site"]);
const SKIP_PATHS = [/\/go\/pkg\//, /\/\.?gradle\//];
const NOISE = /(^|\/)(_[^/]*|releases|_archive|mcp-test-reports|coverage|htmlcov|lcov-report|jsdoc|apidocs|typedoc|playwright-report|__snapshots__|fixtures?|templates?)(\/|$)/i;

function cmdDiscover(args) {
  const out = flag(args, "--out") || path.join(ROOT, "candidates.tsv");
  const extra = [...(flag(args, "--email") || "").split(","), ...(CONFIG.discoverEmails || [])].filter(Boolean);
  const maxDepth = Number(flag(args, "--depth") || 10);
  const roots = (args.length ? args : CONFIG.discoverRoots?.length ? CONFIG.discoverRoots : [os.homedir()]).map((r) => path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())));
  const emails = new Set([git(ROOT, "config", "--global", "user.email"), git(ROOT, "config", "user.email"), ...extra].filter(Boolean).map((e) => e.toLowerCase()));
  if (!emails.size) die("no git email found — pass --email you@x.com[,other@y.com]");
  console.error(`scanning ${roots.map(tildify).join(", ")} for HTML authored by ${[...emails].join(", ")} …`);

  const registered = new Set(entries().filter((e) => !e.broken).map((e) => e.htmlFile));
  const repoCache = new Map();
  const repoInfo = (root) => {
    if (!repoCache.has(root)) {
      // per-email lookup: avoids buffering the full author log of a large monorepo
      repoCache.set(root, { mine: [...emails].some((e) => git(root, "log", "--all", "-1", "--format=%h", "-i", `--author=${e}`) !== "") });
    }
    return repoCache.get(root);
  };
  const found = [];
  const walk = (dir, depth, repo) => {
    if (depth > maxDepth) return;
    let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (names.some((d) => d.name === ".git")) repo = dir;
    for (const d of names) {
      if (d.name.startsWith(".") || SCAN_SKIP.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (!SKIP_PATHS.some((re) => re.test(p + "/"))) walk(p, depth + 1, repo); }
      else if (d.isFile() && /\.html?$/i.test(d.name)) found.push({ file: p, repo });
    }
  };
  const enclosingRepo = (dir) => { for (let d = dir; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".git"))) return d; if (path.dirname(d) === d) return null; } };
  roots.forEach((r) => walk(r, 0, enclosingRepo(r)));

  // Batch git lookups per repo: one log for authorship, one check-ignore for ignored files.
  const byRepo = new Map();
  for (const f of found) if (f.repo) (byRepo.get(f.repo) || byRepo.set(f.repo, []).get(f.repo)).push(f.file);
  const authorsOf = new Map(), ignoredSet = new Set();
  for (const [repo, files] of byRepo) {
    if (!repoInfo(repo).mine) continue;
    const scopes = [...new Set(roots.map((r) => (r.startsWith(repo + path.sep) ? path.relative(repo, r) : r === repo || repo.startsWith(r) ? "." : null)).filter(Boolean))];
    const log = execFileSync("git", ["-C", repo, "log", "--format=@@%ae", "--name-only", "--", ...scopes.map((x) => `:(glob)${x === "." ? "" : x + "/"}**/*.htm*`)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
    let author = "";
    for (const line of log.split("\n")) {
      if (line.startsWith("@@")) author = line.slice(2).toLowerCase();
      else if (line) { const abs = path.join(repo, line); (authorsOf.get(abs) || authorsOf.set(abs, new Set()).get(abs)).add(author); }
    }
    try {
      const out = execFileSync("git", ["-C", repo, "check-ignore", "--stdin"], { input: files.map((f) => path.relative(repo, f)).join("\n"), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      out.split("\n").filter(Boolean).forEach((rel) => ignoredSet.add(path.join(repo, rel)));
    } catch {} // exit 1 = nothing ignored
  }

  const rows = [];
  for (const { file, repo } of found) {
    let size; try { size = fs.statSync(file).size; } catch { continue; }
    if (size < 300 || registered.has(file)) continue;
    const head = fs.readFileSync(file, "utf8").slice(0, 20000);
    const title = htmlMeta(head).title || "";
    let status, reason;
    if (repo) {
      if (!repoInfo(repo).mine) continue; // someone else's repo (clone, dependency)
      const authors = [...(authorsOf.get(file) || [])];
      if (authors.some((a) => emails.has(a))) { status = "mine"; reason = "you committed it"; }
      else if (authors.length) continue; // tracked, but only others authored it
      else if (ignoredSet.has(file)) { status = "maybe"; reason = "gitignored (build output?) in your repo"; }
      else { status = "mine"; reason = "untracked in your repo"; }
    } else { status = "maybe"; reason = "not in a git repo"; }
    if (NOISE.test(path.relative(repo || os.homedir(), file))) { status = "maybe"; reason += "; looks like a template/snapshot/generated"; }
    if (!title) { status = "maybe"; reason += "; no <title>"; }
    rows.push({ status, slug: slugify(defaultSlug(file)), file, title, reason });
  }
  // Collapse multi-page sites: a selected index.html with selected pages beneath it becomes one folder entry.
  const selected = rows.filter((r) => r.status === "mine").sort((a, b) => a.file.length - b.file.length);
  const drop = new Set();
  for (const r of selected) {
    if (drop.has(r) || path.basename(r.file) !== "index.html") continue;
    const dir = path.dirname(r.file) + path.sep;
    const kids = rows.filter((k) => k !== r && k.file.startsWith(dir));
    if (!kids.some((k) => k.status === "mine")) continue;
    kids.forEach((k) => drop.add(k));
    r.file = path.dirname(r.file);
    r.slug = slugify(defaultSlug(r.file));
    r.reason += `; folder site (${kids.length + 1} pages)`;
  }
  for (let i = rows.length - 1; i >= 0; i--) if (drop.has(rows[i])) rows.splice(i, 1);
  // Same title selected more than once (kit copies, duplicated docs): keep the most recently modified.
  const byTitle = new Map();
  for (const r of rows.filter((r) => r.status === "mine" && r.title)) (byTitle.get(r.title) || byTitle.set(r.title, []).get(r.title)).push(r);
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const mtime = (r) => { try { return fs.statSync(fs.statSync(r.file).isDirectory() ? findEntryHtml(r.file) : r.file).mtimeMs; } catch { return 0; } };
    group.sort((a, b) => mtime(b) - mtime(a));
    for (const r of group.slice(1)) { r.status = "maybe"; r.reason += `; duplicate title of ${tildify(group[0].file)}`; }
  }
  rows.sort((a, b) => (a.status === b.status ? a.file.localeCompare(b.file) : a.status === "mine" ? -1 : 1));
  const seen = new Map();
  for (const r of rows) { const n = (seen.get(r.slug) || 0) + 1; seen.set(r.slug, n); if (n > 1) r.slug += `-${n}`; }
  const clean = (s) => String(s).replace(/[\t\n]/g, " ");
  const lines = [
    "# pub discover — review, then: node scripts/pub.mjs add --from " + path.relative(process.cwd(), out),
    "# Uncommented lines get registered. Edit the slug column freely. '# ' = skipped.",
    "# slug\tpath\ttitle\treason",
    ...rows.map((r) => `${r.status === "mine" ? "" : "# "}${clean(r.slug)}\t${tildify(r.file)}\t${clean(r.title)}\t${r.reason}`),
  ];
  fs.writeFileSync(out, lines.join("\n") + "\n");
  const mine = rows.filter((r) => r.status === "mine").length;
  console.log(`found ${rows.length} candidate(s): ${mine} selected, ${rows.length - mine} commented out for review → ${tildify(out)}`);
}

function cmdImport(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#"));
  let added = 0;
  for (const l of lines) {
    const [slug, p] = l.split("\t");
    try { cmdAdd([p, "--slug", slug]); added++; } catch (e) { console.error(`skip ${p}: ${e.message}`); }
  }
  console.log(`processed ${added} of ${lines.length} line(s)`);
}

// ---------- main ----------
const [cmd, ...args] = process.argv.slice(2);
try {
({ discover: cmdDiscover, add: cmdAdd, remove: cmdRemove, rm: cmdRemove, list: cmdList, ls: cmdList, build: () => build(), deploy: cmdDeploy }[cmd]
  || (() => { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); }))(args);
} catch (e) { console.error("error: " + e.message); process.exit(1); }
