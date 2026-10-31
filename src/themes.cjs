"use strict";

// Color data only. No arbitrary CSS, property names, URLs, or executable styles.
const COLOR_FIELDS = Object.freeze(
  [
    { key: "sidebar", label: "Sidebar & frame", cssVar: "--base" },
    { key: "frame", label: "Frame gradient", cssVar: "--base2" },
    { key: "accent", label: "Accent & icons", cssVar: "--accent" },
    { key: "text", label: "Main text", cssVar: "--ink" },
    { key: "muted", label: "Secondary text", cssVar: "--muted" },
    { key: "hover", label: "Hovered controls", cssVar: "--hover" },
    { key: "selected", label: "Selected tabs", cssVar: "--selected" },
    { key: "surface", label: "Home & content background", cssVar: "--surface" },
    {
      key: "elevated",
      label: "Cards & search field",
      cssVar: "--wing-surface",
    },
    { key: "modal", label: "Menus & command bar", cssVar: "--modal" },
    { key: "border", label: "Borders & separators", cssVar: "--border" },
    { key: "focus", label: "Keyboard focus", cssVar: "--wing-focus" },
    { key: "danger", label: "Destructive actions", cssVar: "--wing-danger" },
  ].map(Object.freeze),
);
const LIGHT = Object.freeze({
  text: "#1f1d2b",
  muted: "#5f5c6e",
  hover: "#ffffff4d",
  selected: "#ffffffd9",
  surface: "#ffffff",
  elevated: "#ffffff",
  modal: "#ffffff",
  border: "#1f1d2b14",
  danger: "#c4314b",
});
const DARK = Object.freeze({
  text: "#f2f1f6",
  muted: "#a9a6b8",
  hover: "#ffffff12",
  selected: "#ffffff24",
  surface: "#1c1c1f",
  elevated: "#ffffff0d",
  modal: "#26262b",
  border: "#ffffff17",
  danger: "#ff8fa0",
});
// Arc-style Space gradients: [light start, light end, light accent, dark start, dark end, dark accent].
const PALETTES = {
  lavender: ["#d9d4f5", "#e9d5ef", "#5b4bd6", "#2a2540", "#38234a", "#b3a6ff"],
  sage: ["#cfe3d2", "#e0ecc9", "#2f7d4f", "#1f2f26", "#2b3a20", "#8fd6a8"],
  peach: ["#f6d5c3", "#f7e3b8", "#b4552a", "#3b2a22", "#40301c", "#f2b08c"],
  ocean: ["#c7e0f2", "#cfd9f7", "#1f6fa8", "#1c2c3a", "#202a48", "#8cc8ee"],
  rose: ["#f3cfe0", "#f0d7f0", "#b03a78", "#3a2330", "#38243e", "#f0a0c8"],
  graphite: ["#dcdfe6", "#e7e3ec", "#4a5a78", "#25272e", "#2c2833", "#aebbd6"],
};
const PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PALETTES).map(([key, c]) => [
      key,
      Object.freeze({
        light: Object.freeze({
          ...LIGHT,
          sidebar: c[0],
          frame: c[1],
          accent: c[2],
          focus: c[2],
        }),
        dark: Object.freeze({
          ...DARK,
          sidebar: c[3],
          frame: c[4],
          accent: c[5],
          focus: c[5],
        }),
      }),
    ]),
  ),
);
const knownKeys = new Set(COLOR_FIELDS.map(({ key }) => key));
function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function normalizeCustomColors(input) {
  if (input === undefined) return { light: {}, dark: {} };
  if (
    !plainObject(input) ||
    Object.keys(input).some((key) => !["light", "dark"].includes(key))
  )
    throw Error("Invalid color settings: expected light and dark palettes");
  const output = { light: {}, dark: {} };
  for (const mode of ["light", "dark"]) {
    if (!Object.hasOwn(input, mode)) continue;
    const palette = input[mode];
    if (!plainObject(palette)) throw Error(`Invalid ${mode} color palette`);
    for (const [key, value] of Object.entries(palette)) {
      if (
        !knownKeys.has(key) ||
        typeof value !== "string" ||
        !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)
      )
        throw Error(`Invalid color for ${key}: use #RRGGBB or #RRGGBBAA`);
      output[mode][key] = value.toLowerCase();
    }
  }
  return output;
}
function resolveColors(space, dark = false) {
  const mode = dark ? "dark" : "light";
  const preset = PRESETS[space?.theme] || PRESETS.lavender;
  const colors = {
    ...preset[mode],
    ...normalizeCustomColors(space?.colors)[mode],
  };
  const tokens = Object.fromEntries(
    COLOR_FIELDS.map(({ key, cssVar }) => [cssVar, colors[key]]),
  );
  // Existing layout selectors and shared design-system components use the same source.
  Object.assign(tokens, {
    "--wing-panel": colors.sidebar,
    "--wing-frame": colors.frame,
    "--wing-accent": colors.accent,
    "--wing-text": colors.text,
    "--wing-muted": colors.muted,
    "--wing-hover": colors.hover,
    "--wing-selected": colors.selected,
    "--wing-bg": colors.surface,
    "--wing-modal": colors.modal,
    "--wing-line": colors.border,
    "--danger": colors.danger,
  });
  return tokens;
}
module.exports = {
  COLOR_FIELDS,
  PRESETS,
  normalizeCustomColors,
  resolveColors,
};
