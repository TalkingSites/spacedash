// SpaceDash: Decap CMS plus SpaceClub's widgets, blocks and screen touches, added to a
// site with one script tag. It loads Decap, registers everything, then starts Decap.
//
// Sites can change the defaults by setting window.SPACEDASH before the script tag:
//   <script>window.SPACEDASH = { blocks: false }</script>
import { registerWidgets } from "./widgets.js";
import { registerBlocks } from "./blocks.js";
import { startTweaks } from "./tweaks.js";
import { registerPreview } from "./preview.js";
import spaceTheme from "./theme.css";

const DECAP = "https://unpkg.com/decap-cms@3.16.3/dist/decap-cms.js";
const ICONS = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/";
const AUTH = "https://auth.talkingsites.org/if/flow/";

const DEFAULTS = {
  // Decap's GitHub "Login with GitHub" button text, and links shown under it (false leaves it alone)
  loginLabel: "Log In",
  loginLinks: [
    { text: "Create account", href: AUTH + "ew-self-enrol/" },
    { text: "Forgot password", href: AUTH + "default-recovery-flow/" },
  ],
  // stylesheets the style and colour pickers draw their buttons with (the site's own)
  siteCss: [
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    ICONS + "bootstrap-icons.css",
    "/assets/css/styles.css",
  ],
  iconsJson: ICONS + "bootstrap-icons.json",
  // the SpaceClub template's partials as editor blocks (Button, Feed, Gallery, Form)
  blocks: true,
  // the site's own scripts (e.g. its own blocks), run in order after Decap loads and before it starts
  scripts: [],
  // "space" for SpaceDash's space theme, or false for Decap's own look
  theme: "space",
  // the real preview: rendered by the site's server with its own Eleventy setup (false for Decap's)
  preview: true,
  previewUrl: "/api/preview",
  // in local development, where Eleventy's dev server has no /api
  localPreviewUrl: "http://localhost:8092/api/preview",
  // how long to wait after typing stops before asking for a new preview (ms)
  previewDelay: 700,
};

const config = { ...DEFAULTS, ...window.SPACEDASH };

function addStylesheet(href) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("SpaceDash couldn't load " + src));
    document.head.appendChild(script);
  });
}

// Decap starts itself as soon as it loads unless told to wait, and widgets and blocks
// have to be registered before it starts
window.CMS_MANUAL_INIT = true;
addStylesheet(ICONS + "bootstrap-icons.css");
if (config.theme === "space") {
  const style = document.createElement("style");
  style.textContent = spaceTheme;
  document.head.appendChild(style);
}
loadScript(DECAP).then(async () => {
  registerWidgets(config);
  if (config.blocks) registerBlocks();
  if (config.preview) await registerPreview(config);
  for (const src of config.scripts) await loadScript(src);
  window.CMS.init();
  startTweaks(config);
});
