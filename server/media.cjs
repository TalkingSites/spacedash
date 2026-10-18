// SpaceDash's media library in local development: lists, adds and deletes the site's images
// on disk, so the library works without GitHub (a live site's library talks to GitHub through
// the site's own /api/github instead). Only images, only inside the site's src folder.
//
//   GET    /api/media                    { files: [{ path, size }], folders: [path] }
//   GET    /api/media?file=<path>        the image itself (for thumbnails Eleventy hasn't copied yet)
//   GET    /api/media?text=<path>        a settings file (.json) as text, to see which images are in use
//   POST   /api/media  { path, content }  adds or replaces an image (content is base64)
//   DELETE /api/media?path=<path>        deletes an image
const fs = require("node:fs");
const path = require("node:path");

const IMAGES = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon" };
const SKIP = new Set(["node_modules", "_site", ".git", ".cache", "admin"]);
const LIMIT = 25 * 1024 * 1024;

function createMedia({ root, input = "src", corsOrigins = [] }) {
  const base = path.join(root, input);

  // a repo path (src/...) that stays inside src, or null
  function inside(rel) {
    if (typeof rel !== "string" || !rel.startsWith(input + "/")) return null;
    const full = path.resolve(root, rel);
    return full.startsWith(base + path.sep) ? full : null;
  }

  function list() {
    const files = [];
    const folders = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (entry.isDirectory()) {
          folders.push(rel);
          walk(full);
        } else if (IMAGES.test(entry.name)) {
          files.push({ path: rel, size: fs.statSync(full).size });
        }
      }
    })(base);
    return { files, folders };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > LIMIT * 1.4) reject(Object.assign(new Error("That file is too big (25 MB at most)."), { status: 413 }));
        else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  return async function handleMedia(req, res, url) {
    const cors = corsOrigins.includes(req.headers.origin)
      ? { "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE" }
      : {};
    const send = (status, type, body) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...cors });
      res.end(body);
    };
    const json = (status, data) => send(status, "application/json", JSON.stringify(data));
    try {
      if (req.method === "OPTIONS") return send(204, "text/plain", "");
      if (req.method === "GET") {
        const file = url.searchParams.get("file");
        const text = url.searchParams.get("text");
        if (file) {
          const full = inside(file);
          if (!full || !IMAGES.test(full) || !fs.existsSync(full)) return json(404, { message: "No such image." });
          return send(200, TYPES[path.extname(full).slice(1).toLowerCase()] || "application/octet-stream", fs.readFileSync(full));
        }
        if (text) {
          const full = inside(text);
          if (!full || !full.endsWith(".json") || !fs.existsSync(full)) return json(404, { message: "No such file." });
          return send(200, "application/json", fs.readFileSync(full));
        }
        return json(200, list());
      }
      if (req.method === "POST") {
        const { path: rel, content } = JSON.parse(await readBody(req));
        const full = inside(rel);
        if (!full || !IMAGES.test(full) || typeof content !== "string") return json(400, { message: "Only images, inside the site's folder." });
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.from(content, "base64"));
        return json(200, { path: rel });
      }
      if (req.method === "DELETE") {
        const full = inside(url.searchParams.get("path"));
        if (!full || !IMAGES.test(full)) return json(400, { message: "Only images, inside the site's folder." });
        fs.rmSync(full, { force: true });
        return json(200, {});
      }
      return json(405, { message: "GET, POST or DELETE" });
    } catch (err) {
      return json(err.status || 500, { message: err.message });
    }
  };
}

module.exports = { createMedia };
