// Content types, Strapi-style: people make their own collection types (Team, Projects...)
// with their own fields, from the "Content types" screen. The schema lives in the site's
// src/_data/contentTypes.json as { "items": [...types] } (not "types": Decap ignores a list
// field with that name, since it's one of the list widget's own options); the site
// publishes it at /admin/content-types.json, and SpaceDash turns each type into a Decap
// collection when the editor starts.
//
// Every entry gets a title and a body, plus hidden fields that tell Eleventy how to build
// it: its layout, its type (as a tag, so collections.<type> lists them) and its address.

// the field types people can pick, and the Decap widget each one becomes
export const FIELD_TYPES = [
  { label: "Text", value: "text", icon: "fonts", about: "A short line, like a name or role", widget: { widget: "string" } },
  { label: "Long text", value: "longtext", icon: "text-paragraph", about: "A few lines of plain text", widget: { widget: "text" } },
  { label: "Rich text", value: "richtext", icon: "file-richtext", about: "Formatted text with headings and links", widget: { widget: "markdown", modes: ["rich_text", "raw"] } },
  { label: "Number", value: "number", icon: "123", about: "A price, a count, a year", widget: { widget: "number", value_type: "float" } },
  { label: "Date", value: "date", icon: "calendar-event", about: "A day, picked from a calendar", widget: { widget: "datetime", format: "YYYY-MM-DD", date_format: "YYYY-MM-DD", time_format: false } },
  { label: "Yes / no", value: "yesno", icon: "toggle-on", about: "A switch, like Featured", widget: { widget: "boolean", default: false } },
  { label: "Image", value: "image", icon: "image", about: "A photo or picture", widget: { widget: "image" } },
  { label: "Link", value: "link", icon: "link-45deg", about: "An address on this site or another", widget: { widget: "string", hint: "e.g. /about or https://..." } },
  { label: "Icon", value: "icon", icon: "stars", about: "One of the Bootstrap icons", widget: { widget: "bs-icon" } },
  { label: "Choice", value: "choice", icon: "list-check", about: "Pick one from a set of options", widget: { widget: "select" } },
  { label: "List of text", value: "list", icon: "list-ul", about: "Several short items, like skills", widget: { widget: "list" } },
  { label: "Link to another type", value: "relation", icon: "diagram-3", about: "Points at an entry of another type", widget: { widget: "relation" } },
];

const SCHEMA_FILE = "src/_data/contentTypes.json";
const SLUG = /^[a-z][a-z0-9-]*$/;

// The "Content types" screen: a list of types, each with a list of fields
function builderCollection() {
  return {
    name: "content_types",
    label: "Content types",
    label_singular: "Content type",
    editor: { preview: false },
    files: [
      {
        label: "Content types",
        name: "content_types_file",
        file: SCHEMA_FILE,
        fields: [{ label: "Content types", name: "items", widget: "sd-content-types", required: false }],
      },
    ],
  };
}

// One schema field as a Decap field
function decapField(f) {
  const type = FIELD_TYPES.find((t) => t.value === f.type) ?? FIELD_TYPES[0];
  const field = { ...type.widget, label: f.label, name: f.name, required: !!f.required };
  if (f.hint) field.hint = f.hint;
  if (f.type === "choice") field.options = (f.options ?? []).map(String);
  if (f.type === "relation") {
    Object.assign(field, { collection: f.collection, search_fields: ["title"], value_field: "{{slug}}", display_fields: ["title"] });
  }
  return field;
}

// One schema type as a Decap folder collection
function decapCollection(t) {
  return {
    name: t.name,
    label: t.label || t.name,
    label_singular: t.singular || t.label || t.name,
    description: t.description,
    folder: `src/${t.name}`,
    extension: "md",
    format: "frontmatter",
    create: true,
    slug: "{{slug}}",
    summary: "{{title}}",
    fields: [
      { name: "layout", widget: "hidden", default: "item.njk" },
      { name: "tags", widget: "hidden", default: [t.name] },
      { name: "permalink", widget: "hidden", default: `/${t.name}/{{ page.fileSlug }}/` },
      { label: "Title", name: "title", widget: "string" },
      ...(t.fields ?? []).filter((f) => f && f.name && !["title", "body", "layout", "tags", "permalink"].includes(f.name)).map(decapField),
      { label: "Body", name: "body", widget: "markdown", modes: ["rich_text", "raw"], required: false },
    ],
  };
}

// The Nunjucks a type's block writes into a page (see partials/typeList.njk)
export function typeBlockCode(name, opts = {}) {
  const sets = [`{% set listType = "${name}" %}`];
  if (opts.listTitle) sets.push(`{% set listTitle = ${JSON.stringify(String(opts.listTitle))} %}`);
  if (opts.listLimit) sets.push(`{% set listLimit = ${JSON.stringify(String(opts.listLimit))} %}`);
  if (opts.listColumns) sets.push(`{% set listColumns = ${JSON.stringify(String(opts.listColumns))} %}`);
  return [...sets, `{% include "partials/typeList.njk" %}`].join("\n");
}

async function fetchSchema(config) {
  const res = await fetch(config.contentTypesUrl, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  const schema = await res.json().catch(() => null);
  if (!schema) return null;
  const taken = new Set(config.reservedTypes);
  const types = (schema.items ?? []).filter((t) => t && SLUG.test(t.name ?? "") && !taken.has(t.name) && (taken.add(t.name), true));
  return { types, pages: schema.pages ?? {} };
}

// Builds Decap's whole config: the site's config.yml, plus (when the site publishes a
// content types schema) each type as a collection and the Content types builder. Returns
// { config, types, pages }: types is null when the site hasn't set up content types, and
// pages says which types already have a list page (its file name in Pages).
export async function buildConfig(config, yaml) {
  const link = document.querySelector('link[rel="cms-config-url"]');
  const text = await fetch(link ? link.href : "config.yml", { cache: "no-store" }).then((r) => r.text());
  const cms = yaml.load(text) || {};
  const schema = config.contentTypes ? await fetchSchema(config) : null;
  if (schema) {
    // pages' body field fills in a list page's starting content (see registerListPageBody)
    const pages = (cms.collections || []).find((c) => c.name === config.pagesCollection && c.folder);
    const body = pages?.fields?.find((f) => f.name === "body" && f.widget === "markdown");
    if (body) body.widget = "sd-page-body";
    cms.collections = [...(cms.collections || []), ...schema.types.map(decapCollection), builderCollection()];
  }
  return { config: { ...cms, load_config_file: false }, types: schema?.types ?? null, pages: schema?.pages ?? {} };
}

// Each type as a block in the rich text editor's + menu: it lists the type's entries as
// cards, anywhere in any page, with an optional heading, how many and how many per row
export function registerTypeBlocks(types) {
  const str = `"(?:[^"\\\\]|\\\\.)*"`;
  const setLine = (names) => `\\{%-?\\s*set\\s+(?:${names})\\s*=\\s*${str}\\s*-?%\\}\\s*\\n?`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  for (const t of types) {
    const name = t.name.replace(/[-]/g, "\\-");
    window.CMS.registerEditorComponent({
      id: `type_${t.name}`,
      label: t.label || t.name,
      fields: [
        { name: "listTitle", label: "Heading", widget: "string", required: false },
        { name: "listLimit", label: "How many", widget: "string", default: "all", pattern: ["^(all|[1-9][0-9]*)$", "A number, or all"], hint: "A number, or all" },
        { name: "listColumns", label: "Per row", widget: "select", default: "3", options: ["1", "2", "3", "4", "5", "6"], hint: "On wider screens; phones always show one per row" },
      ],
      pattern: new RegExp(`^\\{%-?\\s*set\\s+listType\\s*=\\s*"${name}"\\s*-?%\\}\\s*\\n?(?:${setLine("listTitle|listLimit|listColumns")})*\\{%-?\\s*include\\s+"partials/typeList\\.njk"\\s*-?%\\}`),
      fromBlock(match) {
        const data = {};
        const re = /\{%-?\s*set\s+(\w+)\s*=\s*("(?:[^"\\]|\\.)*")\s*-?%\}/g;
        let m;
        while ((m = re.exec(match[0]))) if (m[1] !== "listType") data[m[1]] = JSON.parse(m[2]);
        return { listLimit: "all", listColumns: "3", ...data };
      },
      // "all" and 3 per row are the partial's defaults, so they're left out of the code
      toBlock: (data) => typeBlockCode(t.name, { ...data, listLimit: data.listLimit === "all" ? "" : data.listLimit, listColumns: data.listColumns === "3" ? "" : data.listColumns }),
      toPreview: (data) =>
        `<div style="border:1px dashed #6a5acd;border-radius:10px;padding:12px 16px;font-family:system-ui">` +
        `<strong>${esc(t.label || t.name)}</strong><div style="opacity:.75">${esc(data.listTitle || "")} ${esc(data.listLimit || "all")} · ${esc(data.listColumns || "3")} per row</div></div>`,
    });
  }
}

// What a type's list page starts with: a heading, its description, then its block
export function listPageBody(t) {
  return [`# ${t.label || t.name}`, t.description, typeBlockCode(t.name)].filter(Boolean).join("\n\n");
}

// Pages' body field. It's the rich text editor, except that a new page opened from the
// builder's "Make list page" (#/collections/pages/new?...&sdlist=team) starts with that
// type's list page content. (Decap can fill new fields from the address too, but it
// escapes quotes, which the block's code needs.)
export function registerListPageBody(types) {
  const h = window.h;
  const base = window.CMS.getWidget("markdown");
  const start = () => {
    const name = new URLSearchParams(location.hash.split("?")[1] || "").get("sdlist");
    const t = name && types.find((x) => x.name === name);
    return t ? listPageBody(t) : null;
  };
  const Body = window.createClass({
    componentDidMount() {
      const value = !this.props.value && start();
      if (value) this.props.onChange(value);
    },
    render() {
      return h(base.control, { ...this.props, value: this.props.value || start() || this.props.value });
    },
  });
  window.CMS.registerWidget("sd-page-body", Body, base.preview);
}
