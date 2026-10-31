"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
// Fresh private destination; no links, duplicate entries, or paths outside it.
async function extractExtensionZip(file, destination) {
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  const zip = await new Promise((resolve, reject) =>
    require("yauzl").open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? reject(e) : resolve(z)),
    ),
  );
  return new Promise((resolve, reject) => {
    let bytes = 0,
      count = 0,
      failed = false;
    const seen = new Set();
    const fail = (e) => {
      if (failed) return;
      failed = true;
      zip.close();
      reject(e);
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (!failed) resolve();
    });
    zip.on("entry", (entry) => {
      (async () => {
        if (failed) return;
        const name = entry.fileName,
          parts = name.replace(/\/$/, "").split("/");
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (
          !name ||
          path.isAbsolute(name) ||
          name.includes("\\") ||
          name.includes("\0") ||
          parts.some((p) => !p || p === "." || p === "..") ||
          ![0, 0o100000, 0o040000].includes(mode)
        )
          throw Error("Unsafe path or file type in extension archive.");
        if (seen.has(name)) throw Error("Duplicate archive entry.");
        seen.add(name);
        bytes += entry.uncompressedSize;
        count++;
        if (bytes > 256 * 1024 * 1024 || count > 30000)
          throw Error("Extension exceeds extraction limits.");
        const target = path.join(destination, ...parts);
        if (name.endsWith("/"))
          await fsp.mkdir(target, { recursive: true, mode: 0o700 });
        else {
          await fsp.mkdir(path.dirname(target), {
            recursive: true,
            mode: 0o700,
          });
          const stream = await new Promise((res, rej) =>
            zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))),
          );
          await pipeline(
            stream,
            fs.createWriteStream(target, { flags: "wx", mode: 0o600 }),
          );
        }
        if (!failed) zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
module.exports = { extractExtensionZip };
