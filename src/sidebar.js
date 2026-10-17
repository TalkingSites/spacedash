// SpaceDash's touches on the sidebar: a fitting icon for each collection (content types use
// their own), and Content types set apart as a tool that opens straight into the builder.
// Decap redraws the sidebar often, so these are reapplied whenever the page changes.
const ICONS = { pages: "files", settings: "gear", events: "calendar-event", posts: "stickies", content_types: "boxes" };
const BUILDER = "#/collections/content_types/entries/content_types_file";

export function startSidebar(types) {
  const icons = { ...ICONS };
  for (const t of types || []) icons[t.name] = t.icon || "collection";

  // Content types has one entry, so its list screen is skipped
  function redirect() {
    if (/^#\/collections\/content_types\/?$/.test(location.hash)) location.replace(BUILDER);
  }

  function apply() {
    for (const link of document.querySelectorAll('[class*="-SidebarNavLink"]')) {
      const name = (link.getAttribute("href") || "").split("/collections/")[1]?.split("/")[0];
      if (!name || link.dataset.sdIcon === name) continue;
      link.dataset.sdIcon = name;
      const old = link.querySelector("svg");
      if (old) old.closest("span")?.style.setProperty("display", "none");
      const i = document.createElement("i");
      i.className = `bi bi-${icons[name] || "collection"} sd-nav-icon`;
      i.setAttribute("aria-hidden", "true");
      link.prepend(i);
      if (name === "content_types") {
        link.classList.add("sd-nav-tool");
        link.setAttribute("href", BUILDER);
      }
    }
  }

  // The builder's ← would go back to the Content types list, which only sends people
  // straight back here; it goes to the last screen they were on before instead
  let before = "#/";
  const remember = () => {
    if (!/^#\/collections\/content_types(\/|$)/.test(location.hash)) before = location.hash || "#/";
  };
  document.addEventListener("click", (e) => {
    if (!location.hash.startsWith(BUILDER)) return;
    if (!e.target.closest('[class*="-ToolbarSectionBackLink"], [class*="-BackCollection"], [class*="-BackArrow"]')) return;
    e.preventDefault();
    e.stopPropagation();
    location.hash = before;
  }, true);
  window.addEventListener("hashchange", remember);
  remember();

  window.addEventListener("hashchange", redirect);
  redirect();
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
  apply();
}
