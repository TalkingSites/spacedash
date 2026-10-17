// A page's Address: its permalink shown as / about /, so people can see and change where a
// page lives. A page without its own permalink lives at /<file name>/, which is shown until
// it's changed. Special addresses (Home at /, the 404 page at /404.html) are shown but
// can't be changed here.
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-");

export function registerPageWidgets() {
  const h = window.h;

  const Address = window.createClass({
    render() {
      const { value, entry, onChange, forID, classNameWrapper } = this.props;
      const own = typeof value === "string" ? value : "";
      // a new page's address follows its title until someone types one
      const fromFile = entry.get("slug") || slugify(entry.getIn(["data", "title"]));
      const simple = own === "" || /^\/[a-z0-9][a-z0-9-]*\/$/.test(own);
      const shown = own ? own.replace(/^\/|\/$/g, "") : fromFile;
      const box = { display: "flex", alignItems: "center", gap: "2px", fontSize: "15px" };
      const affix = { color: "var(--sd-muted, #798291)" };
      if (!simple) {
        return h("div", { className: classNameWrapper, style: box },
          h("code", null, own),
          h("span", { style: { ...affix, marginLeft: "10px", fontSize: "13px" } }, own === "/" ? "This is the home page" : "A special page; its address is fixed"));
      }
      return h("div", { className: classNameWrapper, style: box },
        h("span", { style: affix }, "/"),
        h("input", {
          id: forID,
          value: shown || "",
          placeholder: "about",
          style: { flex: 1, border: 0, background: "transparent", color: "inherit", font: "inherit", outline: "none", padding: "0 2px" },
          onChange: (e) => {
            const next = slugify(e.target.value).replace(/^-+/, "");
            onChange(next ? `/${next}/` : "");
          },
        }),
        h("span", { style: affix }, "/"),
        shown && !SLUG.test(shown) ? h("span", { style: { color: "var(--sd-danger, #c8322a)", fontSize: "13px" } }, "Use lowercase letters, numbers and dashes") : null);
    },
  });

  window.CMS.registerWidget("sd-address", Address, (props) => h("code", null, props.value || ""));
}

// Shows the Pages collection's permalink field as the Address (it's hidden in config.yml so
// the site still works without SpaceDash)
export function useAddressField(cms, pagesCollection) {
  const pages = (cms.collections || []).find((c) => c.name === pagesCollection && c.folder);
  const field = pages?.fields?.find((f) => f.name === "permalink");
  if (!field) return;
  Object.assign(field, { widget: "sd-address", label: field.label || "Address", hint: "Where the page lives on the site. Changing it breaks old links to the page." });
  // the address sits just under the title
  const fields = pages.fields.filter((f) => f !== field);
  const at = fields.findIndex((f) => f.name === "title");
  fields.splice(at + 1, 0, field);
  pages.fields = fields;
}
