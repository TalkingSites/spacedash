// SpaceDash's real preview: renders an entry that's being edited with the site's own
// Eleventy setup, so the preview pane shows the actual page (layout, CSS, blocks).
//
// The site's server mounts it at POST /api/preview:
//   const preview = require("spacedash/preview").createPreview({ root: __dirname, authorize });
//   if (url.pathname === "/api/preview") return preview(req, res);
//
// Each request writes the entry into a scratch copy of the site (the real files are never
// touched), renders the site with Eleventy and answers with the entry's page. Data files
// (src/_data/*.json) have no page of their own, so they show on the home page. Renders run
// one at a time; the editor waits for a pause in typing before asking.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");

// Runs in a child process started in the scratch copy (the site's config uses paths
// relative to its own folder): renders the site with its Eleventy and prints each page's
// url, input path and HTML as JSON.
const RENDER = `
(async () => {
  const [entry, input, configPath] = process.argv.slice(1);
  const mod = await import(entry);
  const Eleventy = mod.Eleventy ?? mod.default;
  const elev = new Eleventy(input, "_site", { quietMode: true, configPath: configPath || undefined });
  const pages = (await elev.toJSON()).map((p) => ({ url: p.url, inputPath: p.inputPath, content: String(p.content) }));
  process.stdout.write(JSON.stringify(pages));
})().catch((err) => { process.stderr.write(err.message); process.exit(1); });
`;

const SKIP = new Set(["node_modules", "_site", ".git", ".cache"]);
const LIMIT = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > LIMIT) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function createPreview({ root, authorize, input = "src", corsOrigins = [] }) {
  const siteRequire = createRequire(path.join(root, "package.json"));
  const matter = siteRequire("gray-matter");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "spacedash-preview-"));
  let copied = false;
  let queue = Promise.resolve();

  // a copy of the site's source, made once; node_modules is linked, not copied
  function prepare() {
    if (copied) return;
    for (const name of fs.readdirSync(root)) {
      if (SKIP.has(name)) continue;
      fs.cpSync(path.join(root, name), path.join(scratch, name), { recursive: true });
    }
    fs.symlinkSync(path.join(root, "node_modules"), path.join(scratch, "node_modules"), "dir");
    copied = true;
  }

  // Writes the edited entry over the scratch copy's file, in the same format as the
  // original (front matter + body for Markdown, JSON for data files). Returns a function
  // that puts the original back.
  function overlay(rel, data, body) {
    const file = path.join(scratch, rel);
    if (!file.startsWith(scratch + path.sep)) throw Object.assign(new Error("bad path"), { status: 400 });
    const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = rel.endsWith(".json") ? JSON.stringify(data, null, 2) : matter.stringify(body ?? "", data);
    fs.writeFileSync(file, text);
    return () => (before ? fs.writeFileSync(file, before) : fs.rmSync(file, { force: true }));
  }

  async function render(rel, data, body, origin) {
    prepare();
    const restore = overlay(rel, data, body);
    try {
      const pages = await renderSite();
      const want = path.normalize(rel);
      const page =
        pages.find((p) => p.inputPath && path.normalize(p.inputPath).endsWith(want)) ??
        (rel.endsWith(".json") || rel.includes("_data") ? pages.find((p) => p.url === "/") : null);
      if (!page) return null;
      // asset paths like /assets/... load from the site itself
      return String(page.content).replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
    } finally {
      restore();
    }
  }

  // Eleventy keeps templates it has read in memory, so each render runs in a fresh
  // process that reads the scratch copy as it is now
  function renderSite() {
    const configPath = [".eleventy.js", "eleventy.config.js", "eleventy.config.cjs", "eleventy.config.mjs"]
      .map((f) => path.join(scratch, f)).find((f) => fs.existsSync(f)) ?? "";
    // Eleventy 3 is an ES module; require.resolve finds its CommonJS shim, which sits
    // beside the real entry (src/Eleventy.js)
    const entry = pathToFileURL(path.join(path.dirname(siteRequire.resolve("@11ty/eleventy")), "Eleventy.js")).href;
    return new Promise((resolve, reject) => {
      execFile(process.execPath, ["-e", RENDER, entry, input, configPath], { cwd: scratch, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr).trim().split("\n").pop() || err.message));
        resolve(JSON.parse(stdout));
      });
    });
  }

  return async function handlePreview(req, res, origin) {
    const allowOrigin = corsOrigins.includes(req.headers.origin) ? { "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Headers": "Authorization, Content-Type" } : {};
    if (req.method === "OPTIONS") return send(res, 204, "text/plain", "", { ...allowOrigin, "Access-Control-Allow-Methods": "POST" });
    if (req.method !== "POST") return send(res, 405, "text/plain", "POST only", allowOrigin);
    if (!(await authorize(req))) return send(res, 401, "text/plain", "Please log in again.", allowOrigin);
    let job;
    try {
      job = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, "text/plain", "Couldn't read the entry.", allowOrigin);
    }
    if (typeof job.path !== "string" || !job.path.startsWith(input + "/")) return send(res, 400, "text/plain", "Unknown entry path.", allowOrigin);

    const run = queue.then(() => render(job.path, job.data ?? {}, job.body, origin));
    queue = run.catch(() => {});
    try {
      const html = await run;
      if (html == null) return send(res, 404, "text/plain", "This entry has no page to preview.", allowOrigin);
      send(res, 200, "text/html; charset=utf-8", html, allowOrigin);
    } catch (err) {
      console.error(`[preview] ${job.path}: ${err.message}`);
      send(res, err.status ?? 500, "text/plain", `The preview couldn't be built: ${err.message}`, allowOrigin);
    }
  };
}

module.exports = { createPreview };
