# SpaceDash

An open source site editor built on [Decap CMS](https://decapcms.org), added with one script tag. It's the editor behind [SpaceClub](https://github.com/TalkingSites/spaceclub-template) sites, and it adds:

- an icon picker (Bootstrap Icons) and style and colour pickers drawn in the site's own CSS
- the SpaceClub template's partials as editor blocks (Button, Feed, Gallery, Form), each with a remove button
- a plain "Log In" button with sign-up and password reset links, for sites that sign in through their own provider

## Use it

`/admin/index.html` on your site:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>SpaceDash</title>
</head>
<body>
  <script src="https://cdn.jsdelivr.net/npm/spacedash@1/dist/spacedash.min.js"></script>
</body>
</html>
```

Then add your Decap `config.yml` next to it, as for Decap. `@1` picks up every 1.x release, so fixes reach your site without changing it.

## Options

Set `window.SPACEDASH` before the script tag to change the defaults:

```html
<script>
  window.SPACEDASH = {
    loginLabel: "Log In",          // text for Decap's "Login with GitHub" button, or false to leave it
    loginLinks: [{ text: "Create account", href: "https://..." }],
    siteCss: ["/assets/css/styles.css"],  // stylesheets the style and colour pickers use
    blocks: true,                  // the SpaceClub template blocks
    scripts: ["/admin/blocks.js"], // your own scripts (e.g. your own blocks with CMS.registerEditorComponent),
                                   // run after Decap loads and before it starts
    theme: "space",                // or false for Decap's own look
    preview: true,                 // the real preview (see below), or false for Decap's
  };
</script>
```

## Real preview

The preview pane shows the page as your site's own Eleventy setup renders it, with its layout, CSS and blocks, instead of Decap's plain preview. Your site's server answers `POST /api/preview` with the renderer from this package:

```js
const preview = require("spacedash/preview").createPreview({
  root: __dirname,              // the site's folder (with its Eleventy config and node_modules)
  authorize: (req) => isEditor(req),   // only signed-in editors may render
});
// in the request handler:
if (url.pathname === "/api/preview") return preview(req, res, siteOrigin);
```

Each request renders a scratch copy of the site, so the real files are never touched. Set `preview: false` to keep Decap's own preview. In local development the editor falls back to `localPreviewUrl` (default `http://localhost:8092/api/preview`).

## Develop

```bash
npm install
npm run build    # dist/spacedash.js and dist/spacedash.min.js
```

To try a change, copy `dist/spacedash.js` into a site's `/admin/` folder and point the script tag at it.

## Licence

GPL-3.0. Decap CMS is MIT licensed.
