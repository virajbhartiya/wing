"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { webURL } = require("./profile-import.cjs");
class PasswordVault {
  constructor(root, storage) {
    this.root = root;
    this.storage = storage;
  }
  file(profile) {
    if (!/^[\w-]{1,100}$/.test(profile)) throw Error("Invalid profile");
    return path.join(this.root, profile + ".vault");
  }
  available() {
    if (!this.storage.isEncryptionAvailable())
      throw Error(
        "macOS Keychain encryption is unavailable. No passwords were saved.",
      );
  }
  async read(profile) {
    this.available();
    let bytes;
    try {
      bytes = await fs.readFile(this.file(profile));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
    try {
      const data = JSON.parse(this.storage.decryptString(bytes));
      if (data.version !== 1 || !Array.isArray(data.entries)) throw Error();
      return data.entries;
    } catch {
      throw Error(
        "Password vault could not be unlocked. Existing data was preserved.",
      );
    }
  }
  async import(profile, credentials) {
    const entries = await this.read(profile);
    for (const c of credentials) {
      const url = webURL(c.url);
      if (!url || typeof c.password !== "string" || !c.password) continue;
      const origin = new URL(url).origin,
        username = String(c.username || "");
      const old = entries.find(
        (e) => e.origin === origin && e.username === username,
      );
      if (old) old.password = c.password;
      else
        entries.push({
          id: crypto.randomUUID(),
          origin,
          username,
          password: c.password,
        });
    }
    this.available();
    const encrypted = this.storage.encryptString(
      JSON.stringify({ version: 1, entries }),
    );
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = this.file(profile),
      tmp = file + "." + crypto.randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, encrypted, { mode: 0o600, flag: "wx" });
      await fs.rename(tmp, file);
    } finally {
      await fs.rm(tmp, { force: true });
      encrypted.fill(0);
    }
    return entries.length;
  }
  async forOrigin(profile, origin) {
    return (await this.read(profile)).filter((e) => e.origin === origin);
  }
  async removeProfile(profile) {
    await fs.rm(this.file(profile), { force: true });
  }
}
// Runs in the main frame's isolated world only after an explicit user selection.
function fillScript(entry) {
  return `(() => { const credential=${JSON.stringify(entry)};
    if(location.origin!==credential.origin || location.protocol!=='https:')return false;
    const visible=e=>!e.disabled&&!e.readOnly&&e.getClientRects().length>0;
    const password=[...document.querySelectorAll('input[type=password]')].find(e=>visible(e)&&e.autocomplete!=='new-password');
    if(!password)return false;
    const form=password.form || document;
    const username=[...form.querySelectorAll('input')].find(e=>visible(e)&&(e.autocomplete==='username'||e.type==='email')) || [...form.querySelectorAll('input[type=text],input:not([type])')].filter(visible).at(-1);
    const set=(field,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));};
    if(username)set(username,credential.username);set(password,credential.password);return true;
  })()`;
}
module.exports = { PasswordVault, fillScript };
