"use strict";
// Parsers for browser files that are not SQLite or JSON. Input is untrusted, so
// every offset is bounds-checked by Buffer and depth and counts are capped.
function parseBplist(buffer) {
  if (buffer.subarray(0, 8).toString() !== "bplist00")
    throw Error("Not a binary property list");
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6],
    refSize = trailer[7],
    count = Number(trailer.readBigUInt64BE(8)),
    top = Number(trailer.readBigUInt64BE(16)),
    table = Number(trailer.readBigUInt64BE(24));
  if (count > 2000000) throw Error("Property list exceeds import limit");
  const offset = (i) => buffer.readUIntBE(table + i * offsetSize, offsetSize);
  function length(position, low) {
    if (low !== 15) return [low, position + 1];
    const size = 1 << (buffer[position + 1] & 15);
    return [
      Number(
        size === 8
          ? buffer.readBigUInt64BE(position + 2)
          : buffer.readUIntBE(position + 2, size),
      ),
      position + 2 + size,
    ];
  }
  function object(index, depth) {
    if (depth > 64 || index >= count) throw Error("Invalid property list");
    const position = offset(index),
      marker = buffer[position],
      high = marker >> 4,
      low = marker & 15;
    if (high === 0) return low === 9 ? true : low === 8 ? false : null;
    if (high === 1) {
      const size = 1 << low;
      return size === 8
        ? Number(buffer.readBigInt64BE(position + 1))
        : buffer.readUIntBE(position + 1, size);
    }
    if (high === 2)
      return low === 3
        ? buffer.readDoubleBE(position + 1)
        : buffer.readFloatBE(position + 1);
    if (high === 3) return buffer.readDoubleBE(position + 1);
    const [size, start] = length(position, low);
    if (size > count && high >= 10) throw Error("Invalid property list");
    if (high === 4) return null; // Binary values are never imported.
    if (high === 5) return buffer.toString("latin1", start, start + size);
    if (high === 6) {
      const text = Buffer.from(buffer.subarray(start, start + size * 2));
      return text.swap16().toString("utf16le");
    }
    const ref = (i) => buffer.readUIntBE(start + i * refSize, refSize);
    if (high === 10)
      return Array.from({ length: size }, (_, i) =>
        object(ref(i), depth + 1),
      );
    if (high === 13) {
      const result = Object.create(null);
      for (let i = 0; i < size; i++)
        result[object(ref(i), depth + 1)] = object(ref(size + i), depth + 1);
      return result;
    }
    return null;
  }
  return object(top, 0);
}

// Cookies.binarycookies: big-endian page table, little-endian pages. Times are
// seconds since 2001, returned here in Chromium's microseconds since 1601.
const MAC_TO_CHROMIUM = 978307200 + 11644473600;
function parseBinaryCookies(buffer) {
  if (buffer.subarray(0, 4).toString() !== "cook")
    throw Error("Not a Safari cookie file");
  const pages = buffer.readUInt32BE(4);
  if (pages > 100000) throw Error("Cookie file exceeds import limit");
  const cookies = [];
  let start = 8 + pages * 4;
  for (let p = 0; p < pages; p++) {
    const size = buffer.readUInt32BE(8 + p * 4),
      page = buffer.subarray(start, start + size);
    start += size;
    const total = page.readUInt32LE(4);
    for (let c = 0; c < total && cookies.length < 30000; c++) {
      const at = page.readUInt32LE(8 + c * 4);
      const text = (field) => {
        const from = at + page.readUInt32LE(at + field),
          end = page.indexOf(0, from);
        return page.toString("utf8", from, end);
      };
      const flags = page.readUInt32LE(at + 8),
        expires = page.readDoubleLE(at + 40);
      cookies.push({
        host_key: text(16),
        name: text(20),
        path: text(24),
        value: text(28),
        is_secure: flags & 1,
        is_httponly: flags & 4 ? 1 : 0,
        samesite: -1,
        has_expires: 1,
        expires_utc: (expires + MAC_TO_CHROMIUM) * 1000000,
      });
    }
  }
  return cookies;
}

// Chromium session files (SNSS): uint16 size, uint8 command, pickled payload.
function pickledString(payload, position) {
  const size = payload.readInt32LE(position);
  if (size < 0 || position + 4 + size > payload.length)
    throw Error("Invalid session string");
  return payload.toString("utf8", position + 4, position + 4 + size);
}
function parseSessionTabs(buffer) {
  if (buffer.subarray(0, 4).toString() !== "SNSS")
    throw Error("Not a Chromium session file");
  const tabs = new Map(),
    selected = new Map(),
    closed = new Set(),
    pinned = new Set(),
    windows = new Map(),
    closedWindows = new Set();
  let position = 8;
  while (position + 3 <= buffer.length) {
    const size = buffer.readUInt16LE(position),
      command = buffer[position + 2],
      payload = buffer.subarray(position + 3, position + 2 + size);
    position += 2 + size;
    if (size < 1) break;
    try {
      if (command === 0)
        windows.set(payload.readInt32LE(4), payload.readInt32LE(0));
      else if (command === 6) {
        // Pickle: uint32 length, int32 tab, int32 navigation index, string URL.
        const tab = payload.readInt32LE(4),
          index = payload.readInt32LE(8),
          url = pickledString(payload, 12);
        if (!tabs.has(tab)) tabs.set(tab, new Map());
        tabs.get(tab).set(index, url);
      } else if (command === 7)
        selected.set(payload.readInt32LE(0), payload.readInt32LE(4));
      else if (command === 12) {
        if (payload[4]) pinned.add(payload.readInt32LE(0));
        else pinned.delete(payload.readInt32LE(0));
      } else if (command === 16) closed.add(payload.readInt32LE(0));
      else if (command === 17) closedWindows.add(payload.readInt32LE(0));
    } catch {}
  }
  const result = [];
  for (const [tab, navigations] of tabs) {
    if (closed.has(tab) || closedWindows.has(windows.get(tab))) continue;
    const url =
      navigations.get(selected.get(tab)) ||
      navigations.get(Math.max(...navigations.keys()));
    if (url) result.push({ url, pinned: pinned.has(tab) });
  }
  return result;
}

// Passwords.app / Safari export. Plaintext: parsed in memory and never stored.
function parseCredentialCsv(text) {
  const records = [];
  let record = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else field += char;
  }
  if (field || record.length) records.push([...record, field]);
  const header = (records.shift() || []).map((h) =>
    h.replace(/^﻿/, "").trim().toLowerCase(),
  );
  const url = header.indexOf("url"),
    username = header.indexOf("username"),
    password = header.indexOf("password");
  if (url < 0 || username < 0 || password < 0)
    throw Error("Expected URL, Username and Password columns");
  return records
    .filter((row) => row[password])
    .map((row) => ({
      url: row[url],
      username: row[username] || "",
      password: row[password],
    }));
}
module.exports = {
  parseBplist,
  parseBinaryCookies,
  parseSessionTabs,
  parseCredentialCsv,
};
