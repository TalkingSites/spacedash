# SpaceDash

An open source site editor built on [Decap CMS](https://decapcms.org), added with one script tag. It's the editor behind [SpaceClub](https://github.com/TalkingSites/spaceclub) sites, and it adds:

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
    mode: "system",                // the space theme's starting mode: "system", "light" or "dark"
    preview: true,                 // the real preview (see below), or false for Decap's
    contentTypes: true,            // content types made in SpaceDash (see below)
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

## Content types

Like Strapi's content-type builder, but editing files: people make their own types (Team, Projects...) with their own fields on the **Content types** screen. Each type gets its own section in the sidebar and a block for the rich text **+** menu that lists its entries in any page.

The site keeps the schema in `src/_data/contentTypes.json` (`{ "items": [] }`) and publishes it, with each type's list page, at `/admin/content-types.json`. Its Eleventy setup builds each entry's page and each type's list page. The SpaceClub template does all of this; a site without `/admin/content-types.json` simply doesn't get content types.

## Develop

```bash
npm install
npm run build    # dist/spacedash.js and dist/spacedash.min.js
```

`pm2 start ecosystem.config.cjs` runs a dev build that rebuilds on every save, at `http://localhost:8093/spacedash.js`. A SpaceClub site's `/admin/` on localhost uses it while it's running, and the CDN otherwise.

## Licence

GPL-3.0. Decap CMS is MIT licensed.
