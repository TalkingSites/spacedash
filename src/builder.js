// The content types builder (Strapi's content-type builder, for SpaceDash): types down the
// left, the chosen type on the right with its settings and fields. It edits the schema's
// "items" list as plain data; Decap saves it to src/_data/contentTypes.json.
import { FIELD_TYPES } from "./contentTypes.js";

const SLUG = /^[a-z][a-z0-9-]*$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const RESERVED_KEYS = ["title", "body", "layout", "tags", "permalink"];

const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^[^a-z]+/, "");
const keyify = (s) => String(s || "").normalize("NFKD").replace(/[^\w\s]/g, "").trim().split(/\s+/).filter(Boolean)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("").replace(/^[^a-zA-Z]+/, "");
const typeOf = (value) => FIELD_TYPES.find((t) => t.value === value) ?? FIELD_TYPES[0];
const plain = (v) => (v && typeof v.toJS === "function" ? v.toJS() : v) || [];

export function registerBuilder(config, pages = {}) {
  const h = window.h;
  const icon = (name, extra = "") => h("i", { className: `bi bi-${name} ${extra}`, "aria-hidden": true });

  const Builder = window.createClass({
    getInitialState() {
      return { selected: 0, open: null, picking: false };
    },
    types() {
      return plain(this.props.value);
    },
    save(types) {
      this.props.onChange(types);
    },
    // changes the chosen type; the address and field keys follow the name while they still match it
    updateType(patch) {
      const types = this.types().slice();
      const t = { ...types[this.state.selected] };
      if ("label" in patch && (!t.name || t.name === slugify(t.label))) t.name = slugify(patch.label);
      Object.assign(t, patch);
      types[this.state.selected] = t;
      this.save(types);
    },
    updateField(i, patch) {
      const types = this.types().slice();
      const t = { ...types[this.state.selected] };
      const fields = (t.fields || []).slice();
      const f = { ...fields[i] };
      if ("label" in patch && (!f.name || f.name === keyify(f.label))) f.name = keyify(patch.label);
      Object.assign(f, patch);
      fields[i] = f;
      t.fields = fields;
      types[this.state.selected] = t;
      this.save(types);
    },
    moveField(i, by) {
      const types = this.types().slice();
      const t = { ...types[this.state.selected] };
      const fields = (t.fields || []).slice();
      const j = i + by;
      if (j < 0 || j >= fields.length) return;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      t.fields = fields;
      types[this.state.selected] = t;
      this.save(types);
      if (this.state.open === i) this.setState({ open: j });
    },
    removeField(i) {
      const t = this.types()[this.state.selected];
      if (!window.confirm(`Remove the ${t.fields[i].label || "field"} field? Entries keep their saved values, but they won't show.`)) return;
      const types = this.types().slice();
      types[this.state.selected] = { ...t, fields: t.fields.filter((_, k) => k !== i) };
      this.save(types);
      this.setState({ open: null });
    },
    addField(type) {
      const types = this.types().slice();
      const t = { ...types[this.state.selected] };
      const fields = (t.fields || []).slice();
      const label = typeOf(type).label;
      let key = keyify(label);
      for (let n = 2; fields.some((f) => f.name === key) || RESERVED_KEYS.includes(key); n++) key = keyify(label) + n;
      fields.push({ label, name: key, type });
      t.fields = fields;
      types[this.state.selected] = t;
      this.save(types);
      this.setState({ picking: false, open: fields.length - 1 });
    },
    addType() {
      const types = this.types().concat([{ label: "", singular: "", name: "", description: "", icon: "collection", fields: [] }]);
      this.save(types);
      this.setState({ selected: types.length - 1, open: null, picking: false });
    },
    removeType() {
      const t = this.types()[this.state.selected];
      if (!window.confirm(`Remove the ${t.label || "new"} type? Its entries stay in the site's files, but they won't be editable or shown.`)) return;
      this.save(this.types().filter((_, k) => k !== this.state.selected));
      this.setState({ selected: 0, open: null });
    },

    // a type's list page is an ordinary page at /<type>/: open it, or start one already
    // holding a heading, the description and the type's block (Decap fills the title and
    // address from the link; the body fills itself in from sdlist, see registerListPageBody)
    listPageLink(t) {
      const slug = pages[t.name];
      if (slug) return `#/collections/${config.pagesCollection}/entries/${slug}`;
      const params = new URLSearchParams({ title: t.label || t.name, description: t.description || "", permalink: `/${t.name}/`, sdlist: t.name });
      return `#/collections/${config.pagesCollection}/new?${params}`;
    },

    problems(t, types) {
      const out = [];
      if (!t.label) out.push("Give it a name.");
      if (!SLUG.test(t.name || "")) out.push("The address needs lowercase letters, numbers and dashes, starting with a letter.");
      else if ((config.reservedTypes || []).includes(t.name)) out.push(`/${t.name}/ is already used by the site.`);
      else if (types.filter((x) => x.name === t.name).length > 1) out.push(`Another type already uses /${t.name}/.`);
      const keys = (t.fields || []).map((f) => f.name);
      (t.fields || []).forEach((f) => {
        if (!KEY.test(f.name || "")) out.push(`${f.label || "A field"} needs a key made of letters, numbers and _.`);
        else if (RESERVED_KEYS.includes(f.name)) out.push(`${f.label}: "${f.name}" is taken by every entry.`);
        else if (keys.filter((k) => k === f.name).length > 1) out.push(`Two fields use the key "${f.name}".`);
        if (f.type === "relation" && !types.some((x) => x.name === f.collection)) out.push(`${f.label || "A link field"}: choose which type it links to.`);
      });
      return out;
    },

    input(label, value, onChange, opts = {}) {
      return h("label", { className: "sd-ct-input" + (opts.wide ? " wide" : "") },
        h("span", null, label),
        opts.multiline
          ? h("textarea", { value: value || "", rows: 2, placeholder: opts.placeholder, onChange: (e) => onChange(e.target.value) })
          : h("div", { className: "sd-ct-affix" },
              opts.before && h("em", null, opts.before),
              h("input", { value: value || "", placeholder: opts.placeholder, onChange: (e) => onChange(e.target.value) }),
              opts.after && h("em", null, opts.after)),
        opts.hint && h("small", null, opts.hint));
    },

    fieldRow(f, i, count, types) {
      const t = typeOf(f.type);
      const open = this.state.open === i;
      const others = types.filter((x, k) => k !== this.state.selected && x.name);
      return h("li", { key: i, className: "sd-ct-field" + (open ? " open" : "") },
        h("div", { className: "sd-ct-row", onClick: () => this.setState({ open: open ? null : i }) },
          h("span", { className: "sd-ct-ficon" }, icon(t.icon)),
          h("span", { className: "sd-ct-fname" }, f.label || "Untitled field", f.required && h("b", { title: "Required" }, " *")),
          h("code", null, f.name),
          h("span", { className: "sd-ct-badge" }, t.label),
          h("span", { className: "sd-ct-actions", onClick: (e) => e.stopPropagation() },
            h("button", { type: "button", title: "Move up", disabled: i === 0, onClick: () => this.moveField(i, -1) }, icon("arrow-up")),
            h("button", { type: "button", title: "Move down", disabled: i === count - 1, onClick: () => this.moveField(i, 1) }, icon("arrow-down")),
            h("button", { type: "button", title: "Remove", className: "danger", onClick: () => this.removeField(i) }, icon("x-lg")))),
        open && h("div", { className: "sd-ct-fdetails" },
          this.input("Label", f.label, (v) => this.updateField(i, { label: v }), { placeholder: "e.g. Role" }),
          this.input("Key", f.name, (v) => this.updateField(i, { name: v }), { placeholder: "e.g. role", hint: "How it's stored. Don't change it once entries use it." }),
          h("label", { className: "sd-ct-input" }, h("span", null, "Type"),
            h("select", { value: f.type, onChange: (e) => this.updateField(i, { type: e.target.value }) },
              FIELD_TYPES.map((x) => h("option", { key: x.value, value: x.value }, x.label)))),
          h("label", { className: "sd-ct-check" },
            h("input", { type: "checkbox", checked: !!f.required, onChange: (e) => this.updateField(i, { required: e.target.checked }) }),
            h("span", null, "Required")),
          this.input("Help text", f.hint, (v) => this.updateField(i, { hint: v }), { wide: true, placeholder: "Shown under the field" }),
          f.type === "choice" && this.input("Choices", (f.options || []).join(", "), (v) => this.updateField(i, { options: v.split(",").map((s) => s.trim()).filter(Boolean) }), { wide: true, placeholder: "e.g. Small, Medium, Large", hint: "Separate them with commas" }),
          f.type === "relation" && h("label", { className: "sd-ct-input wide" }, h("span", null, "Links to"),
            h("select", { value: f.collection || "", onChange: (e) => this.updateField(i, { collection: e.target.value }) },
              h("option", { value: "" }, "Choose a type"),
              others.map((x) => h("option", { key: x.name, value: x.name }, x.label || x.name))))));
    },

    render() {
      const types = this.types();
      const selected = Math.min(this.state.selected, types.length - 1);
      const t = types[selected];
      const IconWidget = window.CMS.getWidget("bs-icon")?.control;

      return h("div", { className: "sd-ct" },
        h("aside", { className: "sd-ct-types" },
          h("div", { className: "sd-ct-head" }, "Your types"),
          types.map((x, i) => h("button", { key: i, type: "button", className: "sd-ct-type" + (i === selected ? " on" : ""), onClick: () => this.setState({ selected: i, open: null, picking: false }) },
            h("span", { className: "sd-ct-tico" }, icon(x.icon || "collection")),
            h("span", { className: "sd-ct-tname" }, x.label || "New type", h("small", null, x.name ? `/${x.name}/` : "no address yet")),
            h("span", { className: "sd-ct-count" }, `${(x.fields || []).length + 2}`))),
          h("button", { type: "button", className: "sd-ct-new", onClick: this.addType }, icon("plus-lg"), " New type"),
          h("p", { className: "sd-ct-note" }, "New types appear in the sidebar once this change is published.")),

        !t
          ? h("section", { className: "sd-ct-empty" },
              h("div", null, icon("stars", "sd-ct-big")),
              h("h2", null, "Make your own content types"),
              h("p", null, "A type is a kind of thing your site lists, like Team members, Projects or Resources. Each gets its own section here, a list page and a page for every entry."),
              h("button", { type: "button", className: "sd-ct-primary", onClick: this.addType }, icon("plus-lg"), " Create your first type"))
          : h("section", { className: "sd-ct-main" },
              h("div", { className: "sd-ct-title" },
                h("span", { className: "sd-ct-tico big" }, icon(t.icon || "collection")),
                h("div", null, h("h2", null, t.label || "New type"), h("small", null, t.name ? `Lives at /${t.name}/` : "Give it a name to get its address")),
                SLUG.test(t.name || "") && h("a", { className: "sd-ct-listpage", href: this.listPageLink(t), title: pages[t.name] ? "Change what's on this type's list page" : "Make this type's list page, to add your own text and blocks around the list" },
                  icon(pages[t.name] ? "pencil-square" : "file-earmark-plus"), pages[t.name] ? " Edit list page" : " Make list page"),
                h("button", { type: "button", className: "sd-ct-remove", onClick: this.removeType }, icon("trash3"), " Remove type")),
              this.problems(t, types).length > 0 && h("ul", { className: "sd-ct-problems" }, this.problems(t, types).map((p, i) => h("li", { key: i }, p))),
              h("div", { className: "sd-ct-grid" },
                this.input("Name", t.label, (v) => this.updateType({ label: v }), { placeholder: "e.g. Team or Projects" }),
                this.input("One item is called", t.singular, (v) => this.updateType({ singular: v }), { placeholder: "e.g. Team member" }),
                this.input("Address", t.name, (v) => this.updateType({ name: v.toLowerCase() }), { before: "/", after: "/", placeholder: "team", hint: "Don't change it once there are entries." }),
                h("div", { className: "sd-ct-input" }, h("span", null, "Icon"),
                  IconWidget ? h(IconWidget, { value: t.icon, onChange: (v) => this.updateType({ icon: v }), forID: "sd-ct-icon", classNameWrapper: "", field: this.props.field }) : null),
                this.input("Description", t.description, (v) => this.updateType({ description: v }), { wide: true, multiline: true, placeholder: "Shown at the top of the list page" })),

              h("div", { className: "sd-ct-head" }, "Fields"),
              h("ul", { className: "sd-ct-fields" },
                h("li", { className: "sd-ct-field locked" }, h("div", { className: "sd-ct-row" },
                  h("span", { className: "sd-ct-ficon" }, icon("fonts")), h("span", { className: "sd-ct-fname" }, "Title"), h("code", null, "title"),
                  h("span", { className: "sd-ct-badge" }, "Text"), h("span", { className: "sd-ct-actions" }, icon("lock-fill", "sd-ct-lock")))),
                (t.fields || []).map((f, i) => this.fieldRow(f, i, t.fields.length, types)),
                h("li", { className: "sd-ct-field locked" }, h("div", { className: "sd-ct-row" },
                  h("span", { className: "sd-ct-ficon" }, icon("file-richtext")), h("span", { className: "sd-ct-fname" }, "Body"), h("code", null, "body"),
                  h("span", { className: "sd-ct-badge" }, "Rich text"), h("span", { className: "sd-ct-actions" }, icon("lock-fill", "sd-ct-lock"))))),
              this.state.picking
                ? h("div", { className: "sd-ct-picker" },
                    h("div", { className: "sd-ct-head" }, "Choose a field type", h("button", { type: "button", className: "sd-ct-close", onClick: () => this.setState({ picking: false }) }, icon("x-lg"))),
                    h("div", { className: "sd-ct-pick-grid" }, FIELD_TYPES.map((x) => h("button", { key: x.value, type: "button", onClick: () => this.addField(x.value) },
                      h("span", { className: "sd-ct-ficon" }, icon(x.icon)), h("b", null, x.label), h("small", null, x.about)))))
                : h("button", { type: "button", className: "sd-ct-add", onClick: () => this.setState({ picking: true, open: null }) }, icon("plus-lg"), " Add field")));
    },
  });

  window.CMS.registerWidget("sd-content-types", Builder);
}
