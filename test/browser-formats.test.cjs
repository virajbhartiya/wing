const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("../src/browser-formats.cjs");
const { safariBookmarks, read } = require("../src/profile-reader.cjs");

// Minimal binary plist writer with one-byte offsets and refs.
function bplist(root) {
  const objects = [];
  const add = (value) => {
    const index = objects.length;
    objects.push(null);
    let bytes;
    const head = (high, size) =>
      Buffer.from(
        size < 15 ? [(high << 4) | size] : [(high << 4) | 15, 0x10, size],
      );
    if (typeof value === "string") {
      const wide = /[^\x00-\x7f]/.test(value);
      const body = wide
        ? Buffer.from(value, "utf16le").swap16()
        : Buffer.from(value, "latin1");
      bytes = Buffer.concat([head(wide ? 6 : 5, value.length), body]);
    } else if (Array.isArray(value))
      bytes = Buffer.concat([head(10, value.length), Buffer.from(value.map(add))]);
    else {
      const keys = Object.keys(value);
      const refs = [...keys.map(add), ...keys.map((k) => add(value[k]))];
      bytes = Buffer.concat([head(13, keys.length), Buffer.from(refs)]);
    }
    objects[index] = bytes;
    return index;
  };
  add(root);
  let position = 8;
  const offsets = objects.map((o) => {
    const at = position;
    position += o.length;
    return at;
  });
  assert.ok(position < 256);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([
    Buffer.from("bplist00"),
    ...objects,
    Buffer.from(offsets),
    trailer,
  ]);
}
const SAFARI_TREE = {
  Children: [
    {
      Title: "Work",
      Children: [
        { URLString: "https://a.test/", URIDictionary: { title: "Añ" } },
        { URLString: "javascript:alert(1)" },
      ],
    },
  ],
};
test("Safari bookmark plists keep folders and drop non-web links", () => {
  const rows = safariBookmarks(F.parseBplist(bplist(SAFARI_TREE)));
  assert.deepEqual(rows, [
    { url: "https://a.test/", title: "Añ", folder: "Work", kind: "pinned" },
  ]);
  assert.throws(() => F.parseBplist(Buffer.from("not a plist")));
});
function binaryCookies() {
  const strings = Buffer.from("example.com\0sid\0/\0abc\0");
  const cookie = Buffer.alloc(56 + strings.length);
  cookie.writeUInt32LE(cookie.length, 0);
  cookie.writeUInt32LE(5, 8); // Secure | HttpOnly
  cookie.writeUInt32LE(56, 16);
  cookie.writeUInt32LE(68, 20);
  cookie.writeUInt32LE(72, 24);
  cookie.writeUInt32LE(74, 28);
  cookie.writeDoubleLE(800000000, 40);
  strings.copy(cookie, 56);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(0x100, 0);
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(16, 8);
  const page = Buffer.concat([head, cookie]);
  const file = Buffer.alloc(12);
  file.write("cook");
  file.writeUInt32BE(1, 4);
  file.writeUInt32BE(page.length, 8);
  return Buffer.concat([file, page]);
}
test("Safari cookies convert flags and expiry to Chromium's form", () => {
  const [cookie] = F.parseBinaryCookies(binaryCookies());
  assert.equal(cookie.host_key, "example.com");
  assert.equal(cookie.name, "sid");
  assert.equal(cookie.value, "abc");
  assert.equal(cookie.is_secure, 1);
  assert.equal(cookie.is_httponly, 1);
  assert.equal(
    cookie.expires_utc,
    (800000000 + 978307200 + 11644473600) * 1000000,
  );
});
function sessionCommand(id, payload) {
  const head = Buffer.alloc(3);
  head.writeUInt16LE(payload.length + 1);
  head[2] = id;
  return Buffer.concat([head, payload]);
}
function navigation(tab, index, url) {
  const text = Buffer.from(url);
  const body = Buffer.alloc(16 + text.length);
  body.writeInt32LE(tab, 4);
  body.writeInt32LE(index, 8);
  body.writeInt32LE(text.length, 12);
  text.copy(body, 16);
  return sessionCommand(6, body);
}
const ints = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeInt32LE(v, i * 4));
  return b;
};
test("Chromium sessions yield the current page and omit closed tabs", () => {
  const file = Buffer.concat([
    Buffer.from("SNSS"),
    ints(3),
    navigation(1, 0, "https://old.test/"),
    navigation(1, 1, "https://forward.test/"),
    sessionCommand(7, ints(1, 0)),
    navigation(2, 0, "https://pinned.test/"),
    sessionCommand(12, Buffer.concat([ints(2), Buffer.from([1])])),
    navigation(3, 0, "https://gone.test/"),
    sessionCommand(16, ints(3, 0)),
  ]);
  assert.deepEqual(F.parseSessionTabs(file), [
    { url: "https://old.test/", pinned: false },
    { url: "https://pinned.test/", pinned: true },
  ]);
});
test("Chromium sessions omit tabs of closed windows", () => {
  const file = Buffer.concat([
    Buffer.from("SNSS"),
    ints(3),
    sessionCommand(0, ints(10, 1)),
    navigation(1, 0, "https://open.test/"),
    sessionCommand(0, ints(20, 2)),
    navigation(2, 0, "https://closed-window.test/"),
    // Moved out of the window before it closed, so this tab is still open.
    sessionCommand(0, ints(20, 3)),
    navigation(3, 0, "https://moved.test/"),
    sessionCommand(0, ints(10, 3)),
    sessionCommand(17, ints(20, 0)),
  ]);
  assert.deepEqual(F.parseSessionTabs(file), [
    { url: "https://open.test/", pinned: false },
    { url: "https://moved.test/", pinned: false },
  ]);
});
test("credential CSV handles quoting and rejects unexpected columns", () => {
  const rows = F.parseCredentialCsv(
    'Title,URL,Username,Password,Notes\r\nA,https://a.test/,me,"p,""q",\nB,https://b.test/,me,,\n',
  );
  assert.deepEqual(rows, [
    { url: "https://a.test/", username: "me", password: 'p,"q' },
  ]);
  assert.throws(() => F.parseCredentialCsv("a,b\n1,2\n"));
});
test("Safari import reads its files and asks for a password export", () => {
  const library = fs.mkdtempSync(path.join(os.tmpdir(), "wing-safari-"));
  try {
    const root = path.join(library, "Safari");
    const cookies = path.join(
      library,
      "Containers/com.apple.Safari/Data/Library/Cookies",
    );
    fs.mkdirSync(root);
    fs.mkdirSync(cookies, { recursive: true });
    fs.writeFileSync(path.join(root, "Bookmarks.plist"), bplist(SAFARI_TREE));
    fs.writeFileSync(path.join(cookies, "Cookies.binarycookies"), binaryCookies());
    const result = read(
      { browser: "safari", root },
      { bookmarks: true, cookies: true, passwords: true },
    );
    assert.equal(result.bookmarks.length, 1);
    assert.equal(result.cookies.length, 1);
    assert.match(result.warnings.join(), /iCloud Keychain/);
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
  }
});
