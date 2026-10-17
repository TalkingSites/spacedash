// Light and dark mode for the space theme. The choice (System, Light or Dark) is kept in
// this browser; System follows the computer's setting and changes with it. A small switch
// sits in the top bar on every screen (Decap redraws its bars, so it's put back as needed).
const KEY = "spacedash-mode";
const MODES = [
  { value: "system", icon: "circle-half", label: "Match my computer" },
  { value: "light", icon: "sun", label: "Light" },
  { value: "dark", icon: "moon-stars", label: "Dark" },
];

function saved(fallback) {
  try {
    return localStorage.getItem(KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function startModes(config) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let mode = saved(config.mode);

  function apply() {
    const dark = mode === "dark" || (mode === "system" && media.matches);
    document.documentElement.dataset.sdTheme = dark ? "dark" : "light";
    document.querySelectorAll(".sd-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  }

  function choose(next) {
    mode = next;
    try {
      if (next === config.mode) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    apply();
  }

  function makeSwitch() {
    const box = document.createElement("div");
    box.className = "sd-mode";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Colour mode");
    for (const m of MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = m.value;
      b.title = m.label;
      b.setAttribute("aria-label", m.label);
      b.innerHTML = `<i class="bi bi-${m.icon}" aria-hidden="true"></i>`;
      b.addEventListener("click", () => choose(m.value));
      box.appendChild(b);
    }
    return box;
  }

  // the collection screens' top bar, or the editor's toolbar
  function place() {
    const spot = document.querySelector('[class*="-AppHeaderActions"]') || document.querySelector('[class*="-ToolbarSectionMeta"]');
    if (!spot || spot.querySelector(".sd-mode")) return;
    spot.prepend(makeSwitch());
    apply();
  }

  media.addEventListener("change", apply);
  apply();
  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
}
