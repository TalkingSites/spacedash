// The real preview: instead of Decap's plain preview, the pane shows the page as the
// site's own Eleventy setup renders it (see server/preview.cjs). It asks again after a
// short pause in typing, and keeps showing the last good render while it waits.
//
// Decap looks preview templates up by collection name (or file name, for file
// collections), so one template is registered under every name in config.yml.
export async function registerPreview(config) {
  const h = window.h;
  const names = await collectionNames();

  // the site's server answers /api/preview; in local development (Eleventy's dev server
  // has no API) it falls back to the local preview server
  let endpoint = null;
  async function previewUrl() {
    if (endpoint) return endpoint;
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const probe = await fetch(config.previewUrl, { method: "OPTIONS" }).catch(() => null);
    endpoint = probe && probe.status !== 404 ? config.previewUrl : local ? config.localPreviewUrl : config.previewUrl;
    return endpoint;
  }

  function token() {
    try {
      return JSON.parse(localStorage.getItem("decap-cms-user") || "{}").token || "";
    } catch {
      return "";
    }
  }

  // where the entry lives: its own path, or (for a new one) a made-up file in its folder
  function entryPath(entry, collection) {
    const own = entry.get("path");
    if (own) return own;
    const folder = collection.get("folder");
    return folder ? `${folder}/spacedash-new-entry.${collection.get("extension") || "md"}` : null;
  }

  const Preview = window.createClass({
    getInitialState() {
      return { html: null, error: null, busy: false };
    },
    componentDidMount() {
      this.request();
    },
    componentDidUpdate(prev) {
      if (prev.entry !== this.props.entry) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.request(), config.previewDelay);
      }
    },
    componentWillUnmount() {
      clearTimeout(this.timer);
      this.gone = true;
    },
    async request() {
      const path = entryPath(this.props.entry, this.props.collection);
      if (!path) return this.setState({ error: "This entry can't be previewed yet." });
      const data = this.props.entry.get("data").toJS();
      const { body, ...fields } = data;
      const id = (this.seq = (this.seq || 0) + 1);
      this.setState({ busy: true });
      try {
        const res = await fetch(await previewUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `token ${token()}` },
          body: JSON.stringify({ path, data: fields, body }),
        });
        const text = await res.text();
        // a slower, older request finishing late mustn't replace a newer one
        if (this.gone || id !== this.seq) return;
        if (res.ok) this.setState({ html: text, error: null, busy: false });
        else this.setState({ error: text || `Preview failed (${res.status})`, busy: false });
      } catch {
        if (!this.gone && id === this.seq) this.setState({ error: "Couldn't reach the preview server.", busy: false });
      }
    },
    render() {
      const { html, error, busy } = this.state;
      const bar = { position: "absolute", top: 8, right: 8, zIndex: 2, padding: "4px 12px", borderRadius: 999, font: "600 12px system-ui, sans-serif" };
      return h("div", { style: { position: "fixed", inset: 0, background: "#fff" } },
        html && h("iframe", { srcDoc: html, title: "Preview", style: { width: "100%", height: "100%", border: 0, display: "block" } }),
        !html && !error && h("div", { style: { padding: 24, font: "15px system-ui, sans-serif", color: "#555" } }, "Building the preview..."),
        busy && html && h("div", { style: { ...bar, background: "rgba(10,20,60,.8)", color: "#fff" } }, "Updating..."),
        error && h("div", { style: html ? { ...bar, background: "#fde2e0", color: "#8a1c14", maxWidth: "70%" } : { padding: 24, font: "15px system-ui, sans-serif", color: "#8a1c14" } }, error),
      );
    },
  });

  for (const name of names) window.CMS.registerPreviewTemplate(name, Preview);
}

// Every `name:` in config.yml (collections, their files, and fields too, which is harmless)
async function collectionNames() {
  const link = document.querySelector('link[rel="cms-config-url"]');
  const text = await fetch(link ? link.href : "config.yml").then((r) => r.text()).catch(() => "");
  const names = new Set();
  for (const m of text.matchAll(/(?:^|[\s{,])name:\s*["']?([\w-]+)/g)) names.add(m[1]);
  return names;
}
