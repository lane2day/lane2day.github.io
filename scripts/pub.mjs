#!/usr/bin/env node
// pub — publish HTML from projects across your laptop via a JSON registry.
//   node scripts/pub.mjs discover [roots…] [--email a,b]               find HTML you authored → candidates.tsv
//   node scripts/pub.mjs add <file-or-dir> [--slug name] [--kind K]     register a new entry
//   node scripts/pub.mjs add <file-or-dir> --version-of <slug>          add a version to an existing entry
//   node scripts/pub.mjs add --from candidates.tsv                      bulk register
//   node scripts/pub.mjs remove <slug> [--version date]                 remove entry or one version
//   node scripts/pub.mjs list [--json] [--status S] [--kind K]          show registry
//   node scripts/pub.mjs build                                          build _site/ locally
//   node scripts/pub.mjs thumbs [slug…] [--force]                       screenshot pages → .thumbs/
//   node scripts/pub.mjs deploy [--yes]                                 build + secret scan + Cloudflare Pages
//   node scripts/pub.mjs migrate [--force]                              one-time: import legacy registry/ symlinks
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_FILE = path.join(ROOT, "registry.json");
const OUT = path.join(ROOT, "_site");
const THUMBS = path.join(ROOT, ".thumbs");
const CONFIG = { siteTitle: "Lane's published HTML", remote: "origin", ...readJSON(path.join(ROOT, "config.json")) };
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
const expandPath = (p) => path.resolve(String(p).replace(/^~(?=$|\/)/, os.homedir()));
const die = (msg) => { throw new Error(msg); };
const flag = (args, name) => { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (args, name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true; };
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => { try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; } };

const PROJECT_MARKERS = ["package.json", "pyproject.toml", "README.md", "readme.md", "CLAUDE.md", ".publish.json"];
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

// ---------- registry ----------
function loadRegistry() {
  const data = readJSON(REGISTRY_FILE);
  return Array.isArray(data.entries) ? data.entries : [];
}

function saveRegistry(entries) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ version: 1, entries }, null, 2) + "\n");
}

// Extract a YYYY-MM-DD date from a path component if it looks date-like.
function parseDateFromPath(p) {
  const base = path.basename(p).replace(/\.html?$/i, "");
  const m = base.match(/(\d{4})-(\d{2})-(\d{2})/) || base.match(/^(\d{4})(\d{2})(\d{2})$/) || base.match(/^(\d{4})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d = "01"] = m;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso + "T12:00:00Z");
  return (dt.getFullYear() > 2000 && dt.getFullYear() < 2050) ? iso : null;
}

// Strip date-like and version suffixes to get a base name for grouping.
function normalizeSlugBase(s) {
  return s
    .replace(/[-_]?(20\d{6}|20\d{2}-\d{2}-\d{2}|20\d{2}-\d{2}|20\d{2})[-_]?/g, "")
    .replace(/[-_]?v\d+$/i, "")
    .replace(/[-]+/g, "-")
    .replace(/^-|-$/g, "")
    || s;
}

// ---------- resolve ----------
const GENERIC = new Set(["ui", "docs", "doc", "report", "reports", "deliverables", "dist", "build", "out", "public", "site", "src",
  "app", "web", "www", "html", "users", "projects", "solutions", "examples", "pages", "slides", "deck", "index", "lane2day"]);

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

function resolveVersionPath(v) {
  const absPath = expandPath(v.path);
  let real;
  try { real = fs.realpathSync(absPath); } catch { return { ...v, broken: true, reason: `path not found: ${v.path}` }; }
  const isDir = fs.statSync(real).isDirectory();
  const htmlFile = isDir ? findEntryHtml(real) : real;
  if (!htmlFile) return { ...v, broken: true, reason: "no .html file in directory" };
  return { ...v, real, isDir, htmlFile };
}

function resolveEntry(dbEntry) {
  const { id, slug = id, kind = "page", status = "published", format = null, audience = [], title: dbTitle, description: dbDesc, tags = [], versions = [], addedAt, updatedAt, notes } = dbEntry;
  if (!versions.length) return { ...dbEntry, slug, kind, status, broken: true, reason: "no versions" };

  // Sort newest first
  const sorted = [...versions].sort((a, b) => (b.date || "") > (a.date || "") ? 1 : (b.date || "") < (a.date || "") ? -1 : 0);
  const latestV = resolveVersionPath(sorted[0]);
  if (latestV.broken) return { ...dbEntry, slug, kind, status, broken: true, reason: latestV.reason };

  const { real, isDir, htmlFile } = latestV;
  const root = findProjectRoot(path.dirname(htmlFile));
  const pkg = readJSON(path.join(root, "package.json"));
  const pyproject = (() => { try { return fs.readFileSync(path.join(root, "pyproject.toml"), "utf8"); } catch { return ""; } })();
  const overridesFile = readJSON(path.join(root, ".publish.json"));
  const relInProject = path.relative(root, isDir ? real : htmlFile).split(path.sep).join("/");
  const override = { ...overridesFile, ...(overridesFile.files?.[relInProject] || {}) };
  delete override.files;
  const html = fs.readFileSync(htmlFile, "utf8");
  const fromHtml = htmlMeta(html);
  const depth = path.relative(root, path.dirname(htmlFile)).split(path.sep).filter(Boolean).length;
  const rootIsSpecific = !GENERIC.has(path.basename(root).toLowerCase()) && depth <= 2;
  const nearest = (() => { for (let d = isDir ? real : path.dirname(htmlFile); path.dirname(d) !== d; d = path.dirname(d)) if (!GENERIC.has(path.basename(d).toLowerCase())) return path.basename(d); return path.basename(root); })();
  const project = override.project || (rootIsSpecific ? pkg.name || pyproject.match(/^name\s*=\s*["']([^"']+)/m)?.[1] || path.basename(root) : nearest);
  const updatedIso = git(root, "log", "-1", "--format=%cI", "--", relInProject);
  const dirty = git(root, "status", "--porcelain", "--", relInProject) !== "";

  // Resolve older versions
  const olderVersions = sorted.slice(1).map((v) => {
    const rv = resolveVersionPath(v);
    if (rv.broken) return { ...v, broken: true };
    return { ...rv, url: `${slug}/v/${v.date || "archive"}/`, label: v.label || (v.date ? fmtDate(v.date) : "Archive") };
  });

  const latestDate = sorted[0].date || (updatedIso ? updatedIso.slice(0, 10) : today());
  const versionList = [
    { date: latestDate, url: `${slug}/`, label: sorted[0].label || (sorted.length > 1 ? fmtDate(latestDate) : "Latest"), path: sorted[0].path },
    ...olderVersions.filter((v) => !v.broken).map((v) => ({ date: v.date, url: v.url, label: v.label, path: v.path })),
  ];

  return {
    id, slug, kind, status, format, audience, tags, addedAt, updatedAt, notes,
    broken: false, isDir, real, htmlFile, root,
    url: `${slug}/` + (isDir ? path.relative(real, htmlFile).split(path.sep).join("/").replace(/^index\.html$/, "") : ""),
    title: dbTitle || override.title || fromHtml.title || project,
    description: dbDesc || override.description || fromHtml.description || htmlSummary(html)
      || (rootIsSpecific ? pkg.description || pyproject.match(/^description\s*=\s*["']([^"']+)/m)?.[1] || readmeSummary(root) : ""),
    project,
    repo: override.repo || repoUrl(root),
    source: tildify(isDir ? real : htmlFile),
    updated: updatedIso && !dirty ? new Date(updatedIso) : fs.statSync(htmlFile).mtime,
    uncommitted: dirty,
    versions: versionList,
    olderVersions,
  };
}

function allEntries() {
  return loadRegistry().map(resolveEntry);
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

// ---------- commands ----------
function cmdAdd(args) {
  const from = flag(args, "--from");
  if (from) return cmdImport(from);
  const slugArg = flag(args, "--slug");
  const kindArg = flag(args, "--kind") || "page";
  const formatArg = flag(args, "--format") || null;
  const audienceArg = (flag(args, "--audience") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const versionOf = flag(args, "--version-of");
  const force = bool(args, "--force");
  const target = args[0] && expandPath(args[0]);
  if (!target || !fs.existsSync(target)) die("usage: pub add <file.html | folder> [--slug name] [--kind K] [--version-of slug]");
  const st = fs.statSync(target);
  if (!st.isDirectory() && !/\.html?$/i.test(target)) die("target must be an .html file or a folder containing one");
  if (st.isDirectory() && !findEntryHtml(target)) die("folder has no .html file");
  const real = fs.realpathSync(target);
  const storedPath = tildify(real);
  const inferredDate = parseDateFromPath(real);
  const vDate = inferredDate || today();
  const vEntry = { path: storedPath, type: st.isDirectory() ? "folder" : "file", date: vDate };

  const reg = loadRegistry();

  if (versionOf) {
    const existing = reg.find((e) => e.slug === versionOf || e.id === versionOf);
    if (!existing) die(`no entry with slug "${versionOf}"`);
    if (existing.versions.some((v) => expandPath(v.path) === real) && !force) return console.log(`already a version of ${versionOf}`);
    existing.versions.push(vEntry);
    existing.updatedAt = today();
    saveRegistry(reg);
    console.log(`added version ${vDate} to "${versionOf}"`);
    printEntry(resolveEntry(existing));
    return;
  }

  const slug = slugify(slugArg || defaultSlug(real));

  // Check if this looks like a new version of an existing entry (same project root + normalized slug match)
  const htmlTarget = st.isDirectory() ? findEntryHtml(real) : real;
  const targetRoot = htmlTarget ? findProjectRoot(path.dirname(htmlTarget)) : null;
  const targetBase = normalizeSlugBase(slug);
  const sibling = !force && targetRoot && reg.find((e) => {
    const ep = e.versions?.[0]?.path;
    if (!ep) return false;
    if (normalizeSlugBase(e.slug) !== targetBase) return false;
    try {
      const eReal = expandPath(ep);
      const eHtml = fs.statSync(eReal).isDirectory() ? findEntryHtml(eReal) : eReal;
      return eHtml && findProjectRoot(path.dirname(eHtml)) === targetRoot;
    } catch { return false; }
  });

  if (sibling) {
    if (sibling.versions.some((v) => expandPath(v.path) === real)) return console.log(`already a version of "${sibling.slug}"`);
    sibling.versions.push(vEntry);
    sibling.updatedAt = today();
    saveRegistry(reg);
    console.log(`auto-added as version ${vDate} of "${sibling.slug}" (use --force to create a separate entry)`);
    printEntry(resolveEntry(sibling));
    return;
  }

  if (reg.some((e) => e.slug === slug) && !force) die(`slug "${slug}" already in registry. Use --slug or --force.`);

  const newEntry = { id: slug, slug, kind: kindArg, status: "published", format: formatArg, audience: audienceArg, title: null, description: null, tags: [], versions: [vEntry], addedAt: today(), updatedAt: today(), notes: null };
  reg.push(newEntry);
  saveRegistry(reg);
  console.log(`registered "${slug}" → ${storedPath}`);
  printEntry(resolveEntry(newEntry));
}

function cmdRemove(args) {
  const versionDate = flag(args, "--version");
  const slug = args[0] && slugify(args[0]);
  if (!slug) die("usage: pub remove <slug> [--version date]");
  const reg = loadRegistry();
  const idx = reg.findIndex((e) => e.slug === slug || e.id === slug);
  if (idx === -1) die(`no entry "${args[0]}"`);
  if (versionDate) {
    const entry = reg[idx];
    const vi = entry.versions.findIndex((v) => v.date === versionDate);
    if (vi === -1) die(`no version "${versionDate}" in "${slug}"`);
    entry.versions.splice(vi, 1);
    entry.updatedAt = today();
    if (!entry.versions.length) { reg.splice(idx, 1); console.log(`removed last version — entry "${slug}" deleted`); }
    else console.log(`removed version ${versionDate} from "${slug}"`);
  } else {
    reg.splice(idx, 1);
    console.log(`removed "${slug}" (source files untouched)`);
  }
  saveRegistry(reg);
}

function printEntry(e) {
  if (e.broken) return console.log(`  ✗ ${e.slug}  BROKEN — ${e.reason || "unknown"}`);
  const vInfo = e.versions?.length > 1 ? `  [${e.versions.length} versions]` : "";
  console.log(`  ✓ ${e.slug}${e.uncommitted ? "  [uncommitted]" : ""}${vInfo}  [${e.kind}/${e.status}]
      title:       ${e.title}
      description: ${e.description || "(none — add <meta name=\"description\"> or .publish.json)"}
      project:     ${e.project}${e.repo ? "  " + e.repo : ""}
      source:      ${e.source}`);
}

function cmdList(args) {
  const jsonOut = bool(args, "--json");
  const statusFilter = flag(args, "--status");
  const kindFilter = flag(args, "--kind");
  const reg = loadRegistry()
    .filter((e) => !statusFilter || e.status === statusFilter)
    .filter((e) => !kindFilter || e.kind === kindFilter);
  if (jsonOut) return console.log(JSON.stringify(reg.map(resolveEntry), null, 2));
  if (!reg.length) return console.log("no entries match — run: pub add <path>");
  reg.map(resolveEntry).forEach(printEntry);
}

function build() {
  const reg = loadRegistry();
  const deployable = reg.filter((e) => e.status === "published" || e.status === "hidden");
  const warnings = [];
  const excludes = (CONFIG.excludeTitlePatterns || []).map((x) => new RegExp(x, "i"));

  const resolved = deployable.map(resolveEntry);
  const ok = resolved.filter((e) => {
    if (e.broken) { warnings.push(`broken, skipped: ${e.slug} — ${e.reason}`); return false; }
    const hit = excludes.find((re) => re.test(e.title));
    if (hit) { warnings.push(`excluded by excludeTitlePatterns: ${e.slug} — "${e.title}"`); return false; }
    return true;
  });
  const indexed = ok.filter((e) => e.status === "published");

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  if (CONFIG.public) fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");

  for (const e of ok) {
    const w = [];
    e.isDir ? copyDir(e.real, path.join(OUT, e.slug)) : copyFileWithAssets(e.htmlFile, path.join(OUT, e.slug), w);
    w.forEach((m) => warnings.push(`${e.slug}: ${m}`));
    for (const v of (e.olderVersions || [])) {
      if (v.broken || !v.real) continue;
      const vDest = path.join(OUT, e.slug, "v", v.date || "archive");
      const vw = [];
      v.isDir ? copyDir(v.real, vDest) : copyFileWithAssets(v.htmlFile, vDest, vw);
      vw.forEach((m) => warnings.push(`${e.slug}/v/${v.date}: ${m}`));
    }
  }

  let haveThumbs = 0;
  for (const e of indexed) {
    const src = path.join(THUMBS, e.slug + ".png");
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.join(OUT, "_thumbs"), { recursive: true });
    fs.copyFileSync(src, path.join(OUT, "_thumbs", e.slug + ".png"));
    e.thumb = "_thumbs/" + e.slug + ".png";
    haveThumbs++;
  }
  if (indexed.length > haveThumbs) warnings.push(`${indexed.length - haveThumbs} page(s) have no thumbnail — run: node scripts/pub.mjs thumbs`);

  indexed.sort((a, b) => b.updated - a.updated);
  const manifest = indexed.map(({ slug, url, title, description, project, kind, format, audience, tags, repo, source, updated, thumb, versions }) =>
    ({ slug, url, title, description, project, kind, format, audience, tags, repo, source, updated: updated?.toISOString(), thumb, versions }));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT, "index.html"), renderIndex(manifest));
  warnings.forEach((w) => console.warn("warning: " + w));
  console.log(`built ${ok.length} page(s) into _site/ (${indexed.length} indexed, ${ok.length - indexed.length} hidden)`);
  return { ok, indexed, warnings };
}

function cmdDeploy(args) {
  const yes = bool(args, "--yes");
  build();
  const hits = scanSecrets(OUT);
  if (hits.length && !yes) die("possible secrets found — inspect, then re-run with --yes if they're safe:\n  " + hits.join("\n  "));
  execFileSync("wrangler", ["pages", "deploy", "--branch", "main", "--commit-dirty=true"], { cwd: ROOT, stdio: "inherit" });
  console.log(`deployed${CONFIG.siteUrl ? " → " + CONFIG.siteUrl : ""}`);
}

function cmdMigrate(args) {
  const REG_DIR = path.join(ROOT, "registry");
  if (!fs.existsSync(REG_DIR) || !fs.statSync(REG_DIR).isDirectory()) die("no registry/ directory found — nothing to migrate");
  if (fs.existsSync(REGISTRY_FILE) && !bool(args, "--force")) die("registry.json already exists — use --force to overwrite");
  const names = fs.readdirSync(REG_DIR).filter((n) => !n.startsWith(".") && n !== "README.md");
  if (!names.length) return console.log("registry/ is empty — nothing to migrate");
  const entries = [];
  for (const name of names.sort()) {
    const linkPath = path.join(REG_DIR, name);
    const slug = slugify(name);
    let real;
    try { real = fs.realpathSync(linkPath); } catch { console.warn(`warning: broken symlink ${name}, skipping`); continue; }
    const isDir = fs.statSync(real).isDirectory();
    const storedPath = tildify(real);
    const htmlFile = isDir ? findEntryHtml(real) : real;
    let vDate = today();
    if (htmlFile) {
      const root = findProjectRoot(path.dirname(htmlFile));
      const rel = path.relative(root, isDir ? real : htmlFile).split(path.sep).join("/");
      const gitDate = git(root, "log", "-1", "--format=%cs", "--", rel);
      if (gitDate) vDate = gitDate;
    }
    entries.push({ id: slug, slug, kind: "page", status: "published", title: null, description: null, tags: [], versions: [{ path: storedPath, type: isDir ? "folder" : "file", date: vDate }], addedAt: today(), updatedAt: today(), notes: null });
    console.log(`  migrated: ${slug} → ${storedPath}`);
  }
  saveRegistry(entries);
  console.log(`\nmigrated ${entries.length} entries → registry.json`);
  console.log("registry/ is no longer used — you may delete it: rm -rf registry/");
}

// ---------- render ----------
function hueOf(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) % 360;
  return h;
}

function renderIndex(items) {
  const chip = (text, cls = "") => `<span class="chip ${cls}" style="--h:${hueOf(text)}">${esc(text)}</span>`;

  const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const cards = items.map((i) => {
    const dist = i.audience?.length ? "targeted" : "broad";
    const audList = (i.audience || []).join(",");
    const q = [i.title, i.description, i.project, i.slug, i.kind, i.format, dist, ...(i.audience || []), ...(i.tags || [])].join(" ").toLowerCase();
    const date = new Date(i.updated);
    const letter = (String(i.title || i.slug).trim()[0] || "?").toUpperCase();
    const shot = i.thumb
      ? `<img class="shot" src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">`
      : `<div class="shot ph" style="--h:${hueOf(i.project || i.slug)}"><span>${esc(letter)}</span></div>`;
    const vCount = i.versions?.length > 1 ? chip(`${i.versions.length} versions`, "ver") : "";
    const audChips = (i.audience || []).map((a) => chip(a, "aud")).join("");
    return `<div class="card" data-q="${esc(q)}" data-kind="${esc(i.kind || "")}" data-format="${esc(i.format || "")}" data-dist="${esc(dist)}" data-aud="${esc(audList)}">
  <a class="card-link" href="${esc(i.url)}">
    <div class="thumb">${shot}</div>
    <div class="body">
      <div class="t">${esc(i.title)}</div>
      ${i.description ? `<p class="d">${esc(i.description)}</p>` : ""}
      <div class="chips">${chip(i.project)}${audChips}${(i.tags || []).map((t) => chip(t, "tag")).join("")}${vCount}</div>
      <div class="foot"><time datetime="${date.toISOString()}">${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>${i.format ? `<span class="fmt">${esc(i.format)}</span>` : ""}</div>
    </div>
  </a>
  <button class="eye-btn" data-url="${esc(i.url)}" data-title="${esc(i.title)}" aria-label="Preview ${esc(i.title)}">${EYE_SVG}</button>
</div>`;
  }).join("\n");

  // Build unique filter values from items
  const formats = [...new Set(items.map((i) => i.format).filter(Boolean))].sort();
  const audiences = [...new Set(items.flatMap((i) => i.audience || []))].sort();
  const hasAud = audiences.length > 0;
  const hasFmt = formats.length > 0;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(CONFIG.siteTitle)}</title>${CONFIG.public ? '\n<meta name="robots" content="noindex, nofollow">' : ""}
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--line:#e7e5e4;--card:#fff;--acc:#4f46e5;--chip:#f5f5f4;--shadow:0 8px 24px rgba(28,25,23,.12);--chipbg:92%;--chipfg:30%;--chipsat:60%;--side:220px}
@media(prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--mut:#a8a29e;--line:#292524;--card:#1c1917;--acc:#a5b4fc;--chip:#292524;--shadow:0 8px 28px rgba(0,0,0,.5);--chipbg:22%;--chipfg:78%;--chipsat:45%}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.shell{display:grid;grid-template-columns:var(--side) 1fr;min-height:100vh}
aside{border-right:1px solid var(--line);padding:28px 18px;position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--bg)}
.aside-header{padding:0 0 20px;border-bottom:1px solid var(--line);margin-bottom:20px}
h1{font-size:18px;letter-spacing:-.02em;line-height:1.2;margin-bottom:3px}
.sub{color:var(--mut);font-size:12px}
input[type=search]{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--fg);font:inherit;font-size:13px;margin-bottom:20px}
input[type=search]:focus{outline:2px solid var(--acc);outline-offset:-1px;border-color:transparent}
.filter-group{margin-bottom:20px}
.filter-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-bottom:8px;display:block}
.filter-opt{display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer;font-size:13px;user-select:none}
.filter-opt input{width:14px;height:14px;accent-color:var(--acc);cursor:pointer;margin:0}
.filter-opt span{color:var(--fg)}
.filter-opt .count{color:var(--mut);font-size:11px;margin-left:auto}
.clear-btn{font:inherit;font-size:11px;color:var(--acc);background:none;border:none;cursor:pointer;padding:0;margin-top:6px;display:none}
main{padding:32px 28px 80px;min-width:0}
.top-bar{display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.result-count{color:var(--mut);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;transition:transform .14s,box-shadow .14s,border-color .14s}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--acc)}
.card-link{display:flex;flex-direction:column;text-decoration:none;color:inherit;flex:1}
.thumb{aspect-ratio:16/10;background:var(--chip);border-bottom:1px solid var(--line);overflow:hidden;flex-shrink:0}
.shot{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.ph{display:grid;place-items:center;height:100%;background:linear-gradient(140deg,hsl(var(--h) 42% 42%),hsl(var(--h) 44% 24%))}
.ph span{font-size:36px;font-weight:700;color:#fff;opacity:.9}
.body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:6px;flex:1}
.t{font-weight:600;font-size:13.5px;line-height:1.35;letter-spacing:-.01em}
.d{color:var(--mut);font-size:12px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.chip{font-size:10.5px;font-weight:500;padding:2px 6px;border-radius:4px;background:hsl(var(--h) var(--chipsat) var(--chipbg));color:hsl(var(--h) var(--chipsat) var(--chipfg));white-space:nowrap}
.chip.ver{--h:220;--chipsat:60%;--chipbg:90%;--chipfg:35%}
.chip.aud{--chipsat:50%;--chipbg:88%;--chipfg:32%}
@media(prefers-color-scheme:dark){.chip.ver,.chip.aud{--chipbg:22%;--chipfg:72%}}
.foot{margin-top:auto;padding-top:5px;color:var(--mut);font-size:11px;display:flex;align-items:center;gap:8px}
.fmt{background:var(--chip);border-radius:3px;padding:1px 5px;font-size:10px}
.eye-btn{position:absolute;bottom:10px;right:10px;width:28px;height:28px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--mut);cursor:pointer;display:grid;place-items:center;opacity:0;transition:opacity .14s,color .12s,border-color .12s;z-index:2}
.card:hover .eye-btn{opacity:1}
.eye-btn:hover{color:var(--acc);border-color:var(--acc);background:color-mix(in srgb,var(--acc) 8%,var(--card))}
#none{color:var(--mut);font-size:14px;padding:40px 0;grid-column:1/-1;text-align:center;display:none}
/* preview overlay */
#ov{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:100;display:grid;place-items:center;padding:20px}
#ov[hidden]{display:none}
#pv{background:var(--card);border-radius:14px;width:100%;max-width:1100px;height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.4)}
#pv-hd{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);flex-shrink:0}
#pv-title{font-weight:600;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pv-open{font-size:12px;color:var(--acc);text-decoration:none;padding:4px 10px;border:1px solid var(--acc);border-radius:6px;white-space:nowrap}
#pv-close{background:none;border:none;font-size:18px;cursor:pointer;color:var(--mut);padding:2px 6px;border-radius:5px;line-height:1}
#pv-close:hover{color:var(--fg)}
#pv-frame{flex:1;border:none;width:100%;background:var(--bg)}
@media(max-width:700px){.shell{grid-template-columns:1fr}aside{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}.eye-btn{opacity:1}}
</style></head><body>
<div class="shell">
<aside>
  <div class="aside-header">
    <h1>${esc(CONFIG.siteTitle)}</h1>
    <p class="sub" id="count">${items.length} pages</p>
  </div>
  <input type="search" id="q" placeholder="Search…" aria-label="Search">
  ${hasFmt ? `<div class="filter-group">
    <span class="filter-label">Format</span>
    ${formats.map((f) => `<label class="filter-opt"><input type="checkbox" data-dim="format" value="${esc(f)}"><span>${esc(f)}</span><span class="count"></span></label>`).join("")}
    <button class="clear-btn" data-dim="format">Clear</button>
  </div>` : ""}
  ${hasAud ? `<div class="filter-group">
    <span class="filter-label">Audience</span>
    <label class="filter-opt"><input type="checkbox" data-dim="dist" value="broad"><span>Broad</span><span class="count"></span></label>
    ${audiences.map((a) => `<label class="filter-opt"><input type="checkbox" data-dim="aud" value="${esc(a)}"><span>${esc(a)}</span><span class="count"></span></label>`).join("")}
    <button class="clear-btn" data-dim="aud dist">Clear</button>
  </div>` : ""}
</aside>
<main>
  <div class="top-bar"><span class="result-count" id="rc"></span></div>
  <div class="grid" id="list">${cards || '<p style="color:var(--mut);grid-column:1/-1">Nothing published yet.</p>'}</div>
  <p id="none">No matches.</p>
</main>
</div>

<div id="ov" hidden>
  <div id="pv">
    <div id="pv-hd">
      <span id="pv-title"></span>
      <a id="pv-open" target="_blank" rel="noopener">↗ Open</a>
      <button id="pv-close" aria-label="Close preview">✕</button>
    </div>
    <iframe id="pv-frame" title="Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  </div>
</div>

<script>
const cards=[...document.querySelectorAll("#list .card")];
const qEl=document.getElementById("q"),rcEl=document.getElementById("rc"),noneEl=document.getElementById("none"),countEl=document.getElementById("count");
const ov=document.getElementById("ov"),pvFrame=document.getElementById("pv-frame"),pvTitle=document.getElementById("pv-title"),pvOpen=document.getElementById("pv-open");

// ----- preview -----
document.querySelectorAll(".eye-btn").forEach(btn=>{
  btn.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();
    pvTitle.textContent=btn.dataset.title;
    pvOpen.href=btn.dataset.url;
    pvFrame.src=btn.dataset.url;
    ov.hidden=false;document.body.style.overflow="hidden";
  });
});
document.getElementById("pv-close").onclick=closePreview;
ov.addEventListener("click",e=>{if(e.target===ov)closePreview();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!ov.hidden)closePreview();});
function closePreview(){ov.hidden=true;pvFrame.src="";document.body.style.overflow="";}

// ----- filters -----
const state={q:"",format:new Set(),dist:new Set(),aud:new Set()};

qEl.addEventListener("input",()=>{state.q=qEl.value.toLowerCase().trim();filter();});

document.querySelectorAll("input[type=checkbox]").forEach(cb=>{
  cb.addEventListener("change",()=>{
    const dim=cb.dataset.dim,val=cb.value;
    state[dim]?.[cb.checked?"add":"delete"]?.(val);
    updateClears();filter();
  });
});

document.querySelectorAll(".clear-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    btn.dataset.dim.split(" ").forEach(d=>{
      state[d]?.clear();
      document.querySelectorAll(\`input[data-dim="\${d}"]\`).forEach(cb=>cb.checked=false);
    });
    updateClears();filter();
  });
});

function updateClears(){
  document.querySelectorAll(".clear-btn").forEach(btn=>{
    const active=btn.dataset.dim.split(" ").some(d=>state[d]?.size>0);
    btn.style.display=active?"block":"none";
  });
}

function matches(c){
  if(state.q&&!c.dataset.q.includes(state.q))return false;
  if(state.format.size&&!state.format.has(c.dataset.format))return false;
  const distMatch=!state.dist.size&&!state.aud.size?true:
    (state.dist.has(c.dataset.dist)||(state.aud.size&&c.dataset.aud.split(",").some(a=>state.aud.has(a))));
  return distMatch;
}

function filter(){
  let n=0;
  cards.forEach(c=>{const m=matches(c);c.hidden=!m;if(m)n++;});
  noneEl.style.display=(n===0&&(state.q||state.format.size||state.dist.size||state.aud.size))?"block":"none";
  rcEl.textContent=n===cards.length?"":n+" shown";
  countEl.textContent=n+" page"+(n===1?"":"s");
  updateCounts();
}

function updateCounts(){
  document.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    const dim=cb.dataset.dim,val=cb.value;
    const prevState=state[dim]?.has(val);
    if(prevState!==undefined){state[dim].delete(val);}
    const cnt=cards.filter(c=>!c.hidden||c.dataset[dim]===val).length;
    const countEl=cb.closest("label")?.querySelector(".count");
    if(countEl)countEl.textContent=cnt;
    if(prevState!==undefined&&prevState){state[dim].add(val);}
  });
}

filter();
</script></body></html>`;
}

// ---------- thumbnails ----------
function cmdThumbs(args) {
  const force = bool(args, "--force");
  const only = args.filter((a) => !a.startsWith("--"));
  const { indexed } = build();
  fs.mkdirSync(THUMBS, { recursive: true });
  const wait = CONFIG.thumbWaitMs ?? 2000;
  const size = CONFIG.thumbViewport || "1280,800";
  let made = 0, kept = 0, failed = 0, blank = 0;
  for (const e of indexed) {
    if (only.length && !only.includes(e.slug)) continue;
    const out = path.join(THUMBS, e.slug + ".png");
    const page = path.join(OUT, e.slug, "index.html");
    if (!fs.existsSync(page)) { console.warn(`warning: no built page for ${e.slug}, skipped`); continue; }
    if (fs.existsSync(out) && !force) { kept++; continue; }
    process.stdout.write(`shooting ${e.slug} … `);
    try {
      execFileSync("npx", ["--yes", "playwright@latest", "screenshot", "--channel=chrome",
        "--viewport-size=" + size, "--wait-for-timeout=" + wait, "file://" + page, out],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 180000 });
      const bytes = fs.statSync(out).size;
      if (bytes < (CONFIG.thumbMinBytes ?? 12000)) {
        fs.rmSync(out, { force: true });
        console.log("blank — app shell? using placeholder"); blank++;
      } else { console.log("ok"); made++; }
    } catch { console.log("FAILED"); failed++; fs.rmSync(out, { force: true }); }
  }
  console.log(`thumbnails: ${made} new, ${kept} cached${blank ? `, ${blank} blank (placeholder)` : ""}${failed ? `, ${failed} failed` : ""} → .thumbs/`);
  if (made || failed) console.log("run: node scripts/pub.mjs deploy");
}

// ---------- discover ----------
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

  const reg = loadRegistry();
  const registeredPaths = new Set(
    reg.flatMap((e) => e.versions.map((v) => { try { return fs.realpathSync(expandPath(v.path)); } catch { return null; } })).filter(Boolean)
  );
  const registeredSlugs = new Map(reg.map((e) => [normalizeSlugBase(e.slug), e.slug]));

  const repoCache = new Map();
  const repoInfo = (root) => {
    if (!repoCache.has(root)) {
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
      const ig = execFileSync("git", ["-C", repo, "check-ignore", "--stdin"], { input: files.map((f) => path.relative(repo, f)).join("\n"), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      ig.split("\n").filter(Boolean).forEach((rel) => ignoredSet.add(path.join(repo, rel)));
    } catch {}
  }

  const rows = [];
  for (const { file, repo } of found) {
    let size; try { size = fs.statSync(file).size; } catch { continue; }
    if (size < 300) continue;
    // Check if already registered (any version)
    let realFile; try { realFile = fs.realpathSync(file); } catch { realFile = file; }
    if (registeredPaths.has(realFile)) continue;
    const head = fs.readFileSync(file, "utf8").slice(0, 20000);
    const title = htmlMeta(head).title || "";
    let status, reason;
    if (repo) {
      if (!repoInfo(repo).mine) continue;
      const authors = [...(authorsOf.get(file) || [])];
      if (authors.some((a) => emails.has(a))) { status = "mine"; reason = "you committed it"; }
      else if (authors.length) continue;
      else if (ignoredSet.has(file)) { status = "maybe"; reason = "gitignored (build output?) in your repo"; }
      else { status = "mine"; reason = "untracked in your repo"; }
    } else { status = "maybe"; reason = "not in a git repo"; }
    if (NOISE.test(path.relative(repo || os.homedir(), file))) { status = "maybe"; reason += "; looks like a template/snapshot/generated"; }
    if (!title) { status = "maybe"; reason += "; no <title>"; }
    const rawSlug = slugify(defaultSlug(file));
    const base = normalizeSlugBase(rawSlug);
    const existingSlug = registeredSlugs.get(base);
    if (existingSlug) reason += `; likely version of "${existingSlug}" (use --version-of ${existingSlug})`;
    rows.push({ status, slug: rawSlug, file, title, reason });
  }

  // Collapse multi-page folder sites
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

  // Deduplicate by title
  const byTitle = new Map();
  for (const r of rows.filter((r) => r.status === "mine" && r.title)) (byTitle.get(r.title) || byTitle.set(r.title, []).get(r.title)).push(r);
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const mtime = (r) => { try { return fs.statSync(fs.statSync(r.file).isDirectory() ? findEntryHtml(r.file) || r.file : r.file).mtimeMs; } catch { return 0; } };
    group.sort((a, b) => mtime(b) - mtime(a));
    for (const r of group.slice(1)) { r.status = "maybe"; r.reason += `; duplicate title of ${tildify(group[0].file)}`; }
  }

  rows.sort((a, b) => (a.status === b.status ? a.file.localeCompare(b.file) : a.status === "mine" ? -1 : 1));
  const seen = new Map();
  for (const r of rows) { const n = (seen.get(r.slug) || 0) + 1; seen.set(r.slug, n); if (n > 1) r.slug += `-${n}`; }
  const clean = (s) => String(s).replace(/[\t\n]/g, " ");
  const lines = [
    "# pub discover — review, then: node scripts/pub.mjs add --from " + path.relative(process.cwd(), out),
    "# Uncommented 'mine' lines will be registered. Edit slug freely. '# ' = skipped.",
    "# slug\tpath\ttitle\treason",
    ...rows.map((r) => `${r.status === "mine" ? "" : "# "}${clean(r.slug)}\t${tildify(r.file)}\t${clean(r.title)}\t${r.reason}`),
  ];
  fs.writeFileSync(out, lines.join("\n") + "\n");
  const mine = rows.filter((r) => r.status === "mine").length;
  console.log(`found ${rows.length} candidate(s): ${mine} selected, ${rows.length - mine} commented out → ${tildify(out)}`);
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
  ({ discover: cmdDiscover, add: cmdAdd, remove: cmdRemove, rm: cmdRemove, list: cmdList, ls: cmdList,
     build: () => build(), thumbs: cmdThumbs, deploy: cmdDeploy, migrate: cmdMigrate }[cmd]
    || (() => { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); }))(args);
} catch (e) { console.error("error: " + e.message); process.exit(1); }
