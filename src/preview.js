// The real preview: instead of Decap's plain preview, the pane shows the page as the
// site's own Eleventy setup renders it (see server/preview.cjs). It asks again after a
// short pause in typing, and keeps showing the last good render while it waits.
//
// Decap looks preview templates up by collection name (or file name, for file
// collections), so one template is registered under every one of those names.
export async function registerPreview(config, cms) {
  const h = window.h;
  // The site's server answers /api/preview; in local development (Eleventy's dev server has
  // no API) the local preview server does. A site with neither keeps Decap's own preview.
  // a preview server answers a plain GET with "POST only" (405); a site without one, 404
  const answers = (url) => fetch(url, { cache: "no-store" }).then((r) => r.status !== 404).catch(() => false);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const endpoint = (await answers(config.previewUrl)) ? config.previewUrl
    : local && (await answers(config.localPreviewUrl)) ? config.localPreviewUrl : null;
  if (!endpoint) return;
  const previewUrl = async () => endpoint;

  const names = new Set();
  for (const c of cms.collections || []) {
    if (c.name === "content_types") continue;
    names.add(c.name);
    for (const f of c.files || []) names.add(f.name);
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
