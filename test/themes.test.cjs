const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  COLOR_FIELDS,
  PRESETS,
  normalizeCustomColors,
  resolveColors,
} = require("../src/themes.cjs");
const { initialState, validateState } = require("../src/model.cjs");

test("every semantic color can be customized independently for light and dark", () => {
  const light = {},
    dark = {};
  for (const field of COLOR_FIELDS) {
    light[field.key] = "#123456";
    dark[field.key] = "#abcdef80";
  }
  const space = {
    theme: "sage",
    colors: normalizeCustomColors({ light, dark }),
  };
  for (const field of COLOR_FIELDS) {
    assert.equal(resolveColors(space, false)[field.cssVar], "#123456");
    assert.equal(resolveColors(space, true)[field.cssVar], "#abcdef80");
  }
  assert.equal(resolveColors(space, false)["--wing-panel"], "#123456");
  assert.equal(resolveColors(space, false)["--wing-bg"], "#123456");
  assert.equal(resolveColors(space, false)["--ink"], "#123456");
});
test("custom colors round-trip through workspace validation without changing other Spaces", () => {
  const state = initialState();
  state.spaces[0].colors = {
    light: { accent: "#AABBCC", surface: "#102030" },
    dark: { accent: "#DDEEFF" },
  };
  const saved = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(saved.spaces[0].colors, {
    light: { accent: "#aabbcc", surface: "#102030" },
    dark: { accent: "#ddeeff" },
  });
  assert.equal(saved.spaces[1].colors, undefined);
  assert.equal(resolveColors(saved.spaces[0], true)["--accent"], "#ddeeff");
  assert.notEqual(resolveColors(saved.spaces[1], true)["--accent"], "#ddeeff");
});
test("unknown fields and executable CSS are rejected during edit and import", () => {
  const bad = [
    { light: { accent: "red; background:url(https://example.com)" } },
    { light: { accent: "#123" } },
    { light: { accent: 123 } },
    { light: { unknown: "#123456" } },
    { light: [] },
    { light: null },
    { system: {} },
    null,
    [],
    JSON.parse('{"light":{"__proto__":"#123456"}}'),
  ];
  for (const colors of bad) {
    assert.throws(() => normalizeCustomColors(colors));
    const state = initialState();
    state.spaces[0].colors = colors;
    assert.throws(() => validateState(state));
  }
});
test("resetting overrides resolves preset colors, and legacy workspaces remain valid", () => {
  for (const theme of Object.keys(PRESETS)) {
    const space = { theme, colors: { light: { accent: "#123456" }, dark: {} } };
    space.colors = normalizeCustomColors(undefined);
    assert.equal(
      resolveColors(space, false)["--accent"],
      PRESETS[theme].light.accent,
    );
  }
  const state = initialState();
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});
test("split orientation is persisted and invalid imported values fall back safely", () => {
  const state = initialState();
  assert.equal(state.settings.splitOrientation, "horizontal");
  state.settings.splitOrientation = "vertical";
  assert.equal(validateState(state).settings.splitOrientation, "vertical");
  state.settings.splitOrientation = "diagonal";
  assert.equal(validateState(state).settings.splitOrientation, "horizontal");
});
