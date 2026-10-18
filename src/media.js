// SpaceDash's media library, in place of Decap's: Decap's only lists one folder (media_folder),
// so a site's logo, favicon and gallery folders never showed. This one shows every image in
// the site, folder by folder, and can upload, make folders, insert and delete. Images the
// site's settings use (logo, favicon...) are marked and can't be deleted until they're swapped.
//
// Where the files come from:
//   live      the site's repo on GitHub, through Decap's own api_root (SpaceClub's /api/github)
//   localhost the local preview server's /api/media (server/media.cjs), which uses the disk
//
// Also the "sd-folder" widget: pick a folder of images (for galleries) by its photos.

const IMAGES = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;
const INPUT = "src";

// --- where the files are --------------------------------------------------------

function decapToken() {
  try {
    return JSON.parse(localStorage.getItem("decap-cms-user") || "{}").token || "";
  } catch {
    return "";
  }
}

async function failed(res, what) {
  const data = await res.json().catch(() => ({}));
  return new Error(`${what}: ${data.message || res.status}`);
}

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function localStore(url) {
  return {
    async list() {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw await failed(res, "Couldn't list the images");
      return res.json();
    },
    async readJson(path) {
      const res = await fetch(`${url}?text=${encodeURIComponent(path)}`, { cache: "no-store" });
      return res.ok ? res.json() : null;
    },
    async upload(path, file) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: await toBase64(file) }) });
      if (!res.ok) throw await failed(res, `Couldn't upload ${file.name}`);
    },
    async remove(path) {
      const res = await fetch(`${url}?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (!res.ok) throw await failed(res, "Couldn't delete it");
    },
    fallbackUrl: async (path) => `${url}?file=${encodeURIComponent(path)}`,
  };
}

function githubStore(backend) {
  const api = (backend.api_root || "https://api.github.com").replace(/\/$/, "");
  const repo = `${api}/repos/${backend.repo}`;
  const branch = backend.branch || "main";
  const headers = (extra = {}) => ({ Authorization: `token ${decapToken()}`, ...extra });
  const contents = (path) => `${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  let shas = {};
  return {
    async list() {
      const res = await fetch(`${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: headers(), cache: "no-store" });
      if (!res.ok) throw await failed(res, "Couldn't list the images");
      const { tree = [] } = await res.json();
      shas = {};
      const files = [];
      const folders = [];
      for (const t of tree) {
        if (!t.path.startsWith(INPUT + "/") || /(^|\/)(admin|node_modules)(\/|$)/.test(t.path)) continue;
        if (t.type === "tree") folders.push(t.path);
        else if (IMAGES.test(t.path)) {
          files.push({ path: t.path, size: t.size });
          shas[t.path] = t.sha;
        }
      }
      return { files, folders };
    },
    async readJson(path) {
      const res = await fetch(`${contents(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers({ Accept: "application/vnd.github.raw" }), cache: "no-store" });
      return res.ok ? res.json().catch(() => null) : null;
    },
    async upload(path, file) {
      const body = { message: `Uploads ${path}`, content: await toBase64(file), branch };
      if (shas[path]) body.sha = shas[path];
      const res = await fetch(contents(path), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (!res.ok) throw await failed(res, `Couldn't upload ${file.name}`);
    },
    async remove(path) {
      const res = await fetch(contents(path), {
        method: "DELETE",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: `Deletes ${path}`, sha: shas[path], branch }),
      });
      if (!res.ok) throw await failed(res, "Couldn't delete it");
    },
    // an image that isn't on the live site yet (uploaded since the last deploy)
    async fallbackUrl(path) {
      const res = await fetch(`${contents(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers({ Accept: "application/vnd.github.raw" }) });
      return res.ok ? URL.createObjectURL(await res.blob()) : "";
    },
  };
}

// --- shared state ---------------------------------------------------------------

let store = null;
let defaultFolder = `${INPUT}/assets/images/uploads`;
let index = null; // { files, folders, inUse: { path: label } }
let loading = null;
const listeners = new Set();
const madeFolders = new Set(); // folders made here that have no images yet
let closeOpen = null; // closes the library window that's open

export const publicPath = (path) => path.slice(INPUT.length); // src/assets/x.png -> /assets/x.png
const repoPath = (value) => `${INPUT}/${String(value).replace(/^\/+/, "")}`;
const nameOf = (path) => path.split("/").pop();
const folderOf = (path) => path.split("/").slice(0, -1).join("/");
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// the site's settings files, read for image paths so those images count as in use
const SETTINGS = [`${INPUT}/_data/site.json`];
const LABELS = { logo: "Logo", favicon: "Favicon", preview_image: "Sharing image", image: "Image" };

async function findInUse() {
  const inUse = {};
  for (const file of SETTINGS) {
    const data = await store.readJson(file);
    (function walk(v, key) {
      if (typeof v === "string" && IMAGES.test(v) && !/^[a-z]+:/i.test(v)) inUse[repoPath(v)] = LABELS[key] || key[0].toUpperCase() + key.slice(1);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k);
    })(data, "");
  }
  return inUse;
}

export function loadIndex(force) {
  if (!store) return Promise.reject(new Error("The media library isn't set up."));
  if (index && !force) return Promise.resolve(index);
  if (!loading || force) {
    loading = Promise.all([store.list(), findInUse()])
      .then(([{ files, folders }, inUse]) => {
        index = { files, folders, inUse };
        listeners.forEach((fn) => fn(index));
        return index;
      })
      .finally(() => (loading = null));
  }
  return loading;
}

// folders worth showing: any with images, everything under assets/images, and ones made here
function foldersOf(ix) {
  const set = new Set(madeFolders);
  set.add(defaultFolder);
  for (const f of ix.files) set.add(folderOf(f.path));
  for (const f of ix.folders) if (f.startsWith(`${INPUT}/assets/images`)) set.add(f);
  return [...set].sort((a, b) => a.localeCompare(b));
}
const folderLabel = (f) => (f === `${INPUT}/assets/images` ? "images" : f.startsWith(`${INPUT}/assets/images/`) ? f.slice(`${INPUT}/assets/images/`.length) : f.slice(INPUT.length + 1));

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function uploadName(folder, fileName, taken) {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const base = slug(dot > 0 ? fileName.slice(0, dot) : fileName) || "image";
  let name = `${base}${ext}`;
  for (let i = 2; taken.has(`${folder}/${name}`); i++) name = `${base}-${i}${ext}`;
  return `${folder}/${name}`;
}

// thumbnails come from the site itself; one it doesn't have yet comes from the store
function thumb(img, path) {
  img.loading = "lazy";
  img.alt = nameOf(path);
  img.src = publicPath(path);
  img.onerror = async () => {
    img.onerror = null;
    const url = await store.fallbackUrl(path).catch(() => "");
    if (url) img.src = url;
  };
}

// --- the library window ---------------------------------------------------------

const CSS = `
.sd-media-overlay{position:fixed;inset:0;z-index:99999;background:rgba(8,10,30,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.sd-media{background:var(--sd-panel,#fff);color:var(--sd-text,#1e2235);width:min(1100px,100%);height:min(780px,100%);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:grid;grid-template-columns:230px 1fr;grid-template-rows:auto 1fr auto;overflow:hidden;font:15px/1.4 system-ui,sans-serif}
.sd-media header{grid-column:1/-1;display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--sd-line,#e3e6ee)}
.sd-media header h2{margin:0;font-size:20px;flex:0 0 auto}
.sd-media header input[type=search]{flex:1;min-width:0;padding:8px 12px;border-radius:8px;border:1px solid var(--sd-line,#d5d9e3);background:var(--sd-field,#fff);color:inherit;font:inherit}
.sd-media button{font:inherit;cursor:pointer;border-radius:8px;padding:8px 14px;border:1px solid var(--sd-line,#d5d9e3);background:var(--sd-field,#fff);color:inherit}
.sd-media button.sd-primary{background:var(--sd-accent,#3a69c7);border-color:var(--sd-accent,#3a69c7);color:#fff}
.sd-media button.sd-danger{color:var(--sd-danger,#c0392b);border-color:currentColor;background:none}
.sd-media button:disabled{opacity:.45;cursor:not-allowed}
.sd-media .sd-close{border:0;background:none;font-size:22px;padding:4px 8px}
.sd-media aside{border-right:1px solid var(--sd-line,#e3e6ee);overflow:auto;padding:10px}
.sd-media aside button{display:flex;width:100%;justify-content:space-between;gap:8px;border:0;background:none;text-align:left;padding:8px 10px;margin-bottom:2px}
.sd-media aside button.sd-on{background:var(--sd-hover,#eef2fb);font-weight:600}
.sd-media aside small{color:var(--sd-muted,#798291)}
.sd-media .sd-new{display:flex;gap:6px;margin-top:10px}
.sd-media aside .sd-new button{width:auto;flex:0 0 auto;border:1px solid var(--sd-line,#d5d9e3);padding:6px 10px}
.sd-media .sd-new input{flex:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid var(--sd-line,#d5d9e3);background:var(--sd-field,#fff);color:inherit;font:inherit}
.sd-media main{overflow:auto;padding:16px;position:relative}
.sd-media main.sd-drop{outline:3px dashed var(--sd-accent,#3a69c7);outline-offset:-10px}
.sd-media .sd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.sd-media .sd-card{border:2px solid transparent;border-radius:10px;padding:6px;background:none;text-align:left;display:block;width:100%}
.sd-media .sd-card.sd-on{border-color:var(--sd-accent,#3a69c7);background:var(--sd-hover,#eef2fb)}
.sd-media .sd-card .sd-pic{aspect-ratio:1;border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:repeating-conic-gradient(rgba(127,127,127,.15) 0 25%,transparent 0 50%) 0 0/16px 16px}
.sd-media .sd-card img{max-width:100%;max-height:100%;object-fit:contain}
.sd-media .sd-card .sd-name{display:block;margin-top:6px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-media .sd-card small{color:var(--sd-muted,#798291);font-size:12px}
.sd-media .sd-badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;background:var(--sd-accent,#3a69c7);color:#fff;margin-left:4px}
.sd-media .sd-empty{color:var(--sd-muted,#798291);text-align:center;padding:60px 20px}
.sd-media footer{grid-column:1/-1;display:flex;gap:10px;align-items:center;padding:12px 18px;border-top:1px solid var(--sd-line,#e3e6ee);flex-wrap:wrap}
.sd-media footer .sd-info{flex:1;min-width:200px;font-size:14px}
.sd-media footer .sd-info small{display:block;color:var(--sd-muted,#798291)}
.sd-media .sd-status{font-size:14px;color:var(--sd-muted,#798291)}
.sd-media .sd-status.sd-bad{color:var(--sd-danger,#c0392b)}
@media (max-width:700px){.sd-media{grid-template-columns:1fr;grid-template-rows:auto auto 1fr auto}.sd-media aside{border-right:0;border-bottom:1px solid var(--sd-line,#e3e6ee);display:flex;gap:4px;overflow-x:auto;padding:8px}.sd-media aside button{width:auto;white-space:nowrap}.sd-media .sd-new{margin:0}}
`;

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) node.append(k);
  return node;
}

// Opens the library. pick: { multiple, onPick(paths) } to choose images for a field; without
// it, the library is for looking after the site's images (Decap's Media button).
export function openLibrary({ folder, pick, onClose } = {}) {
  if (!document.getElementById("sd-media-css")) document.head.append(el("style", { id: "sd-media-css" }, CSS));
  let current = folder || null; // null = all images
  let selected = [];
  let query = "";
  let status = "";
  let bad = false;

  const overlay = el("div", { class: "sd-media-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Media" });
  const box = el("div", { class: "sd-media" });
  overlay.append(box);
  const close = () => {
    closeOpen = null;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    listeners.delete(render);
    if (onClose) onClose();
  };
  const onKey = (e) => e.key === "Escape" && close();
  overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
  document.addEventListener("keydown", onKey);

  const fileInput = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => upload([...e.target.files]).then(() => (e.target.value = "")) });
  const search = el("input", { type: "search", placeholder: "Search images", oninput: (e) => { query = e.target.value.toLowerCase(); render(); } });

  function say(text, isBad) {
    status = text;
    bad = !!isBad;
    render();
  }

  async function upload(files) {
    const images = files.filter((f) => IMAGES.test(f.name) || f.type.startsWith("image/"));
    if (!images.length) return say("Only images can go in the media library.", true);
    const target = current || defaultFolder;
    const taken = new Set(index.files.map((f) => f.path));
    const done = [];
    for (const [i, file] of images.entries()) {
      say(`Uploading ${i + 1} of ${images.length}: ${file.name}`);
      const path = uploadName(target, file.name, taken);
      try {
        await store.upload(path, file);
        taken.add(path);
        done.push(path);
      } catch (err) {
        return say(err.message, true);
      }
    }
    madeFolders.delete(target);
    current = target;
    await loadIndex(true);
    selected = pick && !pick.multiple ? done.slice(-1) : done;
    say(`Uploaded ${done.length} image${done.length === 1 ? "" : "s"}.`);
  }

  async function remove(path) {
    if (!window.confirm(`Delete ${nameOf(path)}?\n\nAny page that shows it will show a missing image instead.`)) return;
    say(`Deleting ${nameOf(path)}...`);
    try {
      await store.remove(path);
      selected = selected.filter((p) => p !== path);
      await loadIndex(true);
      say(`Deleted ${nameOf(path)}.`);
    } catch (err) {
      say(err.message, true);
    }
  }

  function makeFolder(name) {
    const clean = name
      .split("/")
      .map(slug)
      .filter(Boolean)
      .join("/");
    if (!clean) return;
    const path = `${INPUT}/assets/images/${clean}`;
    madeFolders.add(path);
    current = path;
    selected = [];
    say(`Made ${clean}. Upload images to keep it (an empty folder isn't saved).`);
  }

  function render() {
    if (!index) return;
    const folders = foldersOf(index);
    const files = index.files
      .filter((f) => (current ? folderOf(f.path) === current : true))
      .filter((f) => !query || f.path.toLowerCase().includes(query))
      .sort((a, b) => a.path.localeCompare(b.path));
    const count = (f) => index.files.filter((x) => folderOf(x.path) === f).length;
    const newName = el("input", { placeholder: "New folder", "aria-label": "New folder name", onkeydown: (e) => e.key === "Enter" && makeFolder(e.target.value) });

    const main = el(
      "main",
      {
        ondragover: (e) => { e.preventDefault(); main.classList.add("sd-drop"); },
        ondragleave: () => main.classList.remove("sd-drop"),
        ondrop: (e) => { e.preventDefault(); main.classList.remove("sd-drop"); upload([...e.dataTransfer.files]); },
      },
      files.length
        ? el(
            "div",
            { class: "sd-grid" },
            files.map((f) => {
              const img = el("img");
              thumb(img, f.path);
              const on = selected.includes(f.path);
              return el(
                "button",
                {
                  type: "button",
                  class: `sd-card${on ? " sd-on" : ""}`,
                  title: publicPath(f.path),
                  onclick: () => {
                    selected = pick && pick.multiple ? (on ? selected.filter((p) => p !== f.path) : [...selected, f.path]) : on ? [] : [f.path];
                    render();
                  },
                  ondblclick: () => pick && finish([f.path]),
                },
                el("span", { class: "sd-pic" }, img),
                el("span", { class: "sd-name" }, nameOf(f.path), index.inUse[f.path] ? el("span", { class: "sd-badge" }, index.inUse[f.path]) : null),
                el("small", {}, `${kb(f.size)}${current ? "" : ` · ${folderLabel(folderOf(f.path))}`}`)
              );
            })
          )
        : el("div", { class: "sd-empty" }, query ? "No images match your search." : "No images here yet. Upload some, or drag them in from your computer.")
    );

    const one = selected.length === 1 ? selected[0] : null;
    const usedAs = one && index.inUse[one];
    const info = one
      ? el("div", { class: "sd-info" }, el("strong", {}, nameOf(one)), el("small", {}, usedAs ? `Your site's ${usedAs.toLowerCase()}. To delete it, choose a different one in Settings first.` : publicPath(one)))
      : el("div", { class: `sd-status${bad ? " sd-bad" : ""}`, style: "flex:1" }, status || (pick ? "Choose an image, or upload one." : "Click an image to see where it's used, copy its address or delete it."));

    box.replaceChildren(
      el(
        "header",
        {},
        el("h2", {}, "Media"),
        search,
        el("button", { type: "button", class: "sd-primary", onclick: () => fileInput.click() }, "Upload"),
        fileInput,
        el("button", { type: "button", class: "sd-close", "aria-label": "Close", onclick: close }, "×")
      ),
      el(
        "aside",
        {},
        el("button", { type: "button", class: current ? "" : "sd-on", onclick: () => { current = null; render(); } }, "All images", el("small", {}, String(index.files.length))),
        folders.map((f) => el("button", { type: "button", class: current === f ? "sd-on" : "", title: f.slice(INPUT.length), onclick: () => { current = f; selected = []; render(); } }, folderLabel(f), el("small", {}, String(count(f))))),
        el("div", { class: "sd-new" }, newName, el("button", { type: "button", onclick: () => makeFolder(newName.value) }, "Add"))
      ),
      main,
      el(
        "footer",
        {},
        info,
        one && status && el("span", { class: `sd-status${bad ? " sd-bad" : ""}` }, status),
        one && el("button", { type: "button", onclick: () => navigator.clipboard?.writeText(publicPath(one)).then(() => say("Address copied.")) }, "Copy address"),
        one && el("button", { type: "button", class: "sd-danger", disabled: !!usedAs, title: usedAs ? `In use as the site's ${usedAs.toLowerCase()}` : "", onclick: () => remove(one) }, "Delete"),
        pick && el("button", { type: "button", onclick: close }, "Cancel"),
        pick && el("button", { type: "button", class: "sd-primary", disabled: !selected.length, onclick: () => finish(selected) }, selected.length > 1 ? `Insert ${selected.length} images` : "Insert")
      )
    );
  }

  function finish(paths) {
    pick.onPick(paths);
    close();
  }

  if (closeOpen) closeOpen();
  closeOpen = close;
  document.body.append(overlay);
  box.append(el("div", { class: "sd-empty", style: "grid-column:1/-1" }, "Loading images..."));
  listeners.add(render);
  loadIndex(true).then(render, (err) => box.replaceChildren(el("div", { class: "sd-empty", style: "grid-column:1/-1" }, err.message, el("p", {}, el("button", { type: "button", onclick: close }, "Close")))));
  search.focus();
}

// --- the folder picker widget ---------------------------------------------------

function registerFolderWidget() {
  const h = window.h;
  const FolderControl = window.createClass({
    getInitialState() {
      return { index, open: false, name: "", error: null };
    },
    componentDidMount() {
      this.listen = (ix) => this.setState({ index: ix });
      listeners.add(this.listen);
      loadIndex().catch((err) => this.setState({ error: err.message }));
    },
    componentWillUnmount() {
      listeners.delete(this.listen);
    },
    // values are paths without src/, with or without a leading slash (the field's leading_slash)
    toValue(folder) {
      const slash = this.props.field.get("leading_slash");
      return `${slash ? "/" : ""}${folder.slice(INPUT.length + 1)}`;
    },
    choose(folder) {
      this.setState({ open: false, name: "" });
      this.props.onChange(this.toValue(folder));
    },
    render() {
      const value = this.props.value || "";
      const folder = value ? repoPath(value) : "";
      const ix = this.state.index;
      const images = ix && folder ? ix.files.filter((f) => folderOf(f.path) === folder) : [];
      const link = { border: 0, background: "none", cursor: "pointer", color: "var(--sd-accent, #3a69c7)", font: "inherit", padding: 0 };
      const pic = (path) =>
        h("img", {
          key: path,
          src: publicPath(path),
          alt: "",
          style: { width: "56px", height: "56px", objectFit: "cover", borderRadius: "6px", background: "rgba(127,127,127,.15)" },
          onError: (e) => {
            const img = e.target;
            img.onerror = null;
            store.fallbackUrl(path).then((u) => u && (img.src = u));
          },
        });
      const add = () => {
        if (folder) madeFolders.add(folder);
        openLibrary({ folder: folder || null });
      };
      return h(
        "div",
        { className: this.props.classNameWrapper, style: { padding: 0, border: 0 } },
        h(
          "div",
          { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" } },
          h("strong", { style: { fontWeight: 600 } }, value ? folderLabel(folder) : "No folder"),
          value ? h("span", { style: { color: "var(--sd-muted, #798291)" } }, ix ? `${images.length} image${images.length === 1 ? "" : "s"}` : "") : null,
          h("button", { type: "button", id: this.props.forID, style: link, onClick: () => this.setState({ open: !this.state.open }) }, value ? "Change folder" : "Choose a folder"),
          value ? h("button", { type: "button", style: link, onClick: add }, "Add photos") : null,
          value ? h("button", { type: "button", style: link, onClick: () => this.props.onChange("") }, "Remove") : null
        ),
        images.length ? h("div", { style: { display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" } }, images.slice(0, 8).map((f) => pic(f.path))) : null,
        this.state.error ? h("p", { style: { color: "var(--sd-danger, #c0392b)" } }, this.state.error) : null,
        this.state.open && ix
          ? h(
              "div",
              { style: { marginTop: "10px", border: "1px solid var(--sd-line, #d5d9e3)", borderRadius: "10px", padding: "6px", maxHeight: "300px", overflow: "auto" } },
              foldersOf(ix).map((f) => {
                const n = ix.files.filter((x) => folderOf(x.path) === f);
                return h(
                  "button",
                  {
                    key: f,
                    type: "button",
                    onClick: () => this.choose(f),
                    style: { display: "flex", alignItems: "center", gap: "10px", width: "100%", border: 0, borderRadius: "8px", padding: "6px 8px", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left", background: f === folder ? "var(--sd-hover, #eef2fb)" : "none" },
                  },
                  h("span", { style: { display: "flex", gap: "3px", width: "96px" } }, n.slice(0, 3).map((x) => h("img", { key: x.path, src: publicPath(x.path), alt: "", style: { width: "30px", height: "30px", objectFit: "cover", borderRadius: "4px" } }))),
                  h("span", { style: { flex: 1 } }, folderLabel(f)),
                  h("small", { style: { color: "var(--sd-muted, #798291)" } }, `${n.length}`)
                );
              }),
              h(
                "div",
                { style: { display: "flex", gap: "6px", padding: "8px" } },
                h("input", {
                  value: this.state.name,
                  placeholder: "Or a new folder, e.g. game-night",
                  onChange: (e) => this.setState({ name: e.target.value }),
                  style: { flex: 1, padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--sd-line, #d5d9e3)", background: "var(--sd-field, #fff)", color: "inherit", font: "inherit" },
                }),
                h(
                  "button",
                  {
                    type: "button",
                    style: { ...link, padding: "6px 10px" },
                    onClick: () => {
                      const clean = this.state.name.split("/").map(slug).filter(Boolean).join("/");
                      if (!clean) return;
                      const f = `${INPUT}/assets/images/${clean}`;
                      madeFolders.add(f);
                      this.choose(f);
                    },
                  },
                  "Make it"
                )
              )
            )
          : null
      );
    },
  });
  const FolderPreview = window.createClass({
    render() {
      return h("span", {}, this.props.value || "");
    },
  });
  window.CMS.registerWidget("sd-folder", FolderControl, FolderPreview);
}

// --- setting it up --------------------------------------------------------------

// Uses SpaceDash's library for Decap's Media button and every image and file field, and
// registers the folder picker. cms: the Decap config SpaceDash built.
export function registerMedia(cms, config) {
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && cms.local_backend;
  store = local ? localStore(config.localMediaUrl) : githubStore(cms.backend || {});
  if (cms.media_folder) defaultFolder = cms.media_folder.replace(/\/+$/, "");
  registerFolderWidget();

  window.CMS.registerMediaLibrary({
    name: "spacedash",
    init: ({ handleInsert }) => ({
      show({ id, allowMultiple }) {
        if (!id) return openLibrary(); // the Media button
        openLibrary({
          pick: {
            multiple: !!allowMultiple,
            onPick: (paths) => {
              const values = paths.map(publicPath);
              handleInsert(allowMultiple ? values : values[0]);
            },
          },
        });
      },
      hide() {
        if (closeOpen) closeOpen();
      },
      enableStandalone: () => true,
    }),
  });
  cms.media_library = { name: "spacedash" };
}
