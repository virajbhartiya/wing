"use strict";
// The engine silently drops page messages over 64 KB. Requests are ASCII-only
// so a split can never fall inside a character, and each part stays under the
// limit even if JSON escaping doubles it.
const PART_CHARS = 30000;

function nativeMessages(id, action, data) {
  const json = JSON.stringify({ id, action, data }).replace(
    /[\u0080-￿]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  if (json.length <= PART_CHARS)
    return [{ kind: "wing-request", json }];
  const count = Math.ceil(json.length / PART_CHARS);
  return Array.from({ length: count }, (_, index) => ({
    kind: "wing-request-part",
    json: JSON.stringify({
      id,
      index,
      count,
      text: json.slice(index * PART_CHARS, (index + 1) * PART_CHARS),
    }),
  }));
}
module.exports = { nativeMessages };
