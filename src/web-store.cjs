"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
function extensionId(value) {
  if (/^[a-p]{32}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      u.hostname === "chromewebstore.google.com" &&
      u.pathname.startsWith("/detail/")
    ) {
      const id = u.pathname.split("/").filter(Boolean).at(-1);
      if (/^[a-p]{32}$/.test(id)) return id;
    }
  } catch {}
  throw Error(
    "Enter a Chrome Web Store extension link or a 32-character extension ID.",
  );
}
function fields(buffer) {
  let offset = 0;
  const result = [];
  function number() {
    let value = 0,
      factor = 1;
    for (let i = 0; i < 8; i++) {
      if (offset >= buffer.length) throw Error("Truncated CRX header");
      const n = buffer[offset++];
      value += (n & 127) * factor;
      if (!(n & 128)) {
        if (!Number.isSafeInteger(value)) throw Error("Invalid CRX integer");
        return value;
      }
      factor *= 128;
    }
    throw Error("Invalid CRX integer");
  }
  while (offset < buffer.length) {
    const tag = number(),
      wire = tag & 7,
      id = Math.floor(tag / 8);
    if (wire === 2) {
      const len = number();
      if (len > buffer.length - offset) throw Error("Invalid CRX field");
      result.push({ id, value: buffer.subarray(offset, offset + len) });
      offset += len;
    } else if (wire === 0) {
      number();
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else throw Error("Unsupported CRX wire type");
    if (offset > buffer.length) throw Error("Invalid CRX header");
  }
  return result;
}
function idFromKey(key) {
  return [...crypto.createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");
}
function verifyCRX(bytes, expectedId) {
  if (
    bytes.length < 12 ||
    bytes.subarray(0, 4).toString() !== "Cr24" ||
    bytes.readUInt32LE(4) !== 3
  )
    throw Error("Only signed CRX3 extensions are supported.");
  const length = bytes.readUInt32LE(8);
  if (length > 1024 * 1024 || 12 + length >= bytes.length)
    throw Error("Invalid CRX header length");
  const header = fields(bytes.subarray(12, 12 + length)),
    signed = header.filter((x) => x.id === 10000);
  if (signed.length !== 1) throw Error("Missing CRX signed data");
  const ids = fields(signed[0].value).filter((x) => x.id === 1);
  if (ids.length !== 1 || ids[0].value.length !== 16)
    throw Error("Invalid CRX identity");
  const id = [...ids[0].value]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");
  if (id !== expectedId)
    throw Error(
      "Downloaded extension identity does not match the requested extension.",
    );
  const zip = bytes.subarray(12 + length),
    size = Buffer.alloc(4);
  size.writeUInt32LE(signed[0].value.length);
  const payload = Buffer.concat([
    Buffer.from("CRX3 SignedData\0"),
    size,
    signed[0].value,
    zip,
  ]);
  for (const proof of header.filter((x) => x.id === 2 || x.id === 3)) {
    const members = fields(proof.value),
      key = members.find((x) => x.id === 1)?.value,
      signature = members.find((x) => x.id === 2)?.value;
    if (!key || !signature || idFromKey(key) !== id) continue;
    try {
      if (
        crypto.verify(
          "sha256",
          payload,
          { key, format: "der", type: "spki" },
          signature,
        )
      )
        return { zip, key: key.toString("base64"), id };
    } catch {}
  }
  throw Error("Extension signature verification failed.");
}
function trustedDownload(url) {
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    ["google.com", "googleusercontent.com", "gvt1.com", "gvt2.com"].some(
      (d) => u.hostname === d || u.hostname.endsWith("." + d),
    )
  );
}
async function download(id, version, fetcher = fetch) {
  let url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${encodeURIComponent(version)}&acceptformat=crx3&x=${encodeURIComponent("id=" + id + "&uc")}`;
  const signal = AbortSignal.timeout(60000);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!trustedDownload(url))
      throw Error("Unexpected extension download destination.");
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      credentials: "omit",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("Invalid download redirect");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok)
      throw Error(
        `Web Store download failed (${response.status}). This extension may not be available.`,
      );
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 64 * 1024 * 1024)
        throw Error("Extension exceeds the 64 MB download limit.");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw Error("Too many extension download redirects.");
}
async function stageExtension(input, root, version) {
  const id = extensionId(input),
    verified = verifyCRX(await download(id, version), id);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(root, ".install-"));
  const archive = path.join(directory, "package.zip"),
    unpacked = path.join(directory, "extension");
  try {
    await fs.writeFile(archive, verified.zip, { mode: 0o600 });
    await require("./zip-extract.cjs").extractExtensionZip(archive, unpacked);
    const manifest = JSON.parse(
      await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"),
    );
    if (manifest.manifest_version !== 3)
      throw Error("Only Manifest V3 store extensions are supported.");
    if (manifest.key && idFromKey(Buffer.from(manifest.key, "base64")) !== id)
      throw Error("Manifest identity does not match signature.");
    manifest.key = verified.key;
    await fs.writeFile(
      path.join(unpacked, "manifest.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    await fs.rm(archive);
    let displayName = manifest.name;
    const message = /^__MSG_([\w@]+)__$/i.exec(displayName || "");
    if (message && /^[A-Za-z0-9_-]+$/.test(manifest.default_locale || "")) {
      try {
        const messages = JSON.parse(
          await fs.readFile(
            path.join(
              unpacked,
              "_locales",
              manifest.default_locale,
              "messages.json",
            ),
            "utf8",
          ),
        );
        const key = Object.keys(messages).find(
          (k) => k.toLowerCase() === message[1].toLowerCase(),
        );
        if (typeof messages[key]?.message === "string")
          displayName = messages[key].message.slice(0, 200);
      } catch {}
    }
    return { id, directory, unpacked, manifest, displayName };
  } catch (e) {
    await fs.rm(directory, { recursive: true, force: true });
    throw e;
  }
}
module.exports = {
  extensionId,
  fields,
  idFromKey,
  verifyCRX,
  trustedDownload,
  download,
  stageExtension,
};
