const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

function manifestIdentity(manifest) {
  if (typeof manifest.key !== "string") return null;
  // Chromium extension IDs encode the first 128 bits of the public-key SHA-256.
  return createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (n) => String.fromCharCode(97 + parseInt(n, 16)));
}

// Each profile owns a Chromium session and an extension API adapter. The shell
// never shares these with its privileged renderer session.
class ExtensionManager {
  constructor(options) {
    this.options = options;
    this.adapters = new Map();
    this.errors = new Map();
    this.restorations = new Map();
    this.activeTabs = new Map();
    this.queue = Promise.resolve();
    this.Adapter =
      options.Adapter ||
      require("electron-chrome-extensions").ElectronChromeExtensions;
  }

  configure(profileId) {
    if (this.adapters.has(profileId)) return this.adapters.get(profileId);
    const hooks = {
      license: "GPL-3.0",
      session: this.options.getSession(profileId),
    };
    for (const name of [
      "createTab",
      "selectTab",
      "removeTab",
      "createWindow",
      "removeWindow",
      "requestPermissions",
      "assignTabDetails",
    ]) {
      if (this.options[name])
        hooks[name] = (...args) => this.options[name](profileId, ...args);
    }
    const adapter = new this.Adapter(hooks);
    // Register after the adapter so browser.* can share the implemented APIs.
    const namespacePreload = path.join(
      __dirname,
      "extension-namespace-preload.cjs",
    );
    hooks.session.registerPreloadScript({
      id: "wing-extension-namespace-frame",
      type: "frame",
      filePath: namespacePreload,
    });
    hooks.session.registerPreloadScript({
      id: "wing-extension-namespace-worker",
      type: "service-worker",
      filePath: namespacePreload,
    });
    this.adapters.set(profileId, adapter);
    return adapter;
  }

  setupActionProtocol(shellSession) {
    this.Adapter.handleCRXProtocol(shellSession);
  }

  addTab(profileId, contents, window) {
    this.configure(profileId).addTab(contents, window);
  }
  selectTab(profileId, contents) {
    if (this.activeTabs.get(profileId) === contents.id) return;
    this.activeTabs.set(profileId, contents.id);
    this.configure(profileId).selectTab(contents);
  }
  removeTab(profileId, contents) {
    if (this.activeTabs.get(profileId) === contents.id)
      this.activeTabs.delete(profileId);
    this.adapters.get(profileId)?.removeTab(contents);
  }
  getContextMenuItems(profileId, contents, params) {
    return this.configure(profileId).getContextMenuItems(contents, params);
  }

  async readRegistry() {
    let value;
    try {
      value = JSON.parse(await fs.readFile(this.options.registryPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, profiles: {} };
      throw error;
    }
    if (
      value?.version !== 1 ||
      !value.profiles ||
      typeof value.profiles !== "object" ||
      Array.isArray(value.profiles)
    )
      throw Error(
        "Invalid extension registry; original file has been preserved",
      );
    for (const entries of Object.values(value.profiles)) {
      if (
        !Array.isArray(entries) ||
        entries.some(
          (e) =>
            !e ||
            !/^[a-p]{32}$/.test(e.id) ||
            typeof e.path !== "string" ||
            !path.isAbsolute(e.path),
        )
      )
        throw Error(
          "Invalid extension registry entries; original file has been preserved",
        );
    }
    return value;
  }

  async writeRegistry(value) {
    const target = this.options.registryPath;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  mutate(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  restore(profileId) {
    this.configure(profileId);
    if (this.restorations.has(profileId))
      return this.restorations.get(profileId);
    const restored = this.mutate(async () => {
      const registry = await this.readRegistry();
      const errors = [];
      for (const entry of registry.profiles[profileId] || []) {
        try {
          const extension = await this.options
            .getSession(profileId)
            .extensions.loadExtension(entry.path);
          if (extension.id !== entry.id) {
            this.options
              .getSession(profileId)
              .extensions.removeExtension(extension.id);
            throw Error("Extension identity changed; remove and reinstall it");
          }
        } catch (error) {
          errors.push({ id: entry.id, path: entry.path, error: error.message });
        }
      }
      this.errors.set(profileId, errors);
      return this.list(profileId);
    });
    this.restorations.set(profileId, restored);
    return restored;
  }

  install(profileId, unpackedPath) {
    this.configure(profileId);
    return this.mutate(async () => {
      const directory = await fs.realpath(unpackedPath);
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
      );
      if (
        ![2, 3].includes(manifest.manifest_version) ||
        typeof manifest.name !== "string"
      )
        throw Error(
          "Choose an unpacked Chrome extension folder containing manifest.json",
        );
      const registry = await this.readRegistry();
      const entries = registry.profiles[profileId] || [];
      if (entries.some((entry) => entry.path === directory))
        throw Error("This extension is already installed in this profile");
      const api = this.options.getSession(profileId).extensions;
      const identity = manifestIdentity(manifest);
      if (
        identity &&
        (entries.some((entry) => entry.id === identity) ||
          api.getAllExtensions().some((entry) => entry.id === identity))
      )
        throw Error("An extension with this identity is already installed");
      const extension = await api.loadExtension(directory);
      if (entries.some((entry) => entry.id === extension.id))
        throw Error("An extension with this identity is already installed");
      registry.profiles[profileId] = [
        ...entries,
        { id: extension.id, path: directory },
      ];
      try {
        await this.writeRegistry(registry);
      } catch (error) {
        api.removeExtension(extension.id);
        throw error;
      }
      return this.list(profileId);
    });
  }

  uninstall(profileId, id) {
    return this.mutate(async () => {
      const registry = await this.readRegistry();
      const entries = registry.profiles[profileId] || [];
      if (!entries.some((entry) => entry.id === id))
        throw Error("Extension is not installed in this profile");
      registry.profiles[profileId] = entries.filter((entry) => entry.id !== id);
      await this.writeRegistry(registry);
      this.options.getSession(profileId).extensions.removeExtension(id);
      this.errors.set(
        profileId,
        (this.errors.get(profileId) || []).filter((entry) => entry.id !== id),
      );
      return this.list(profileId);
    });
  }

  list(profileId) {
    return {
      extensions: this.options
        .getSession(profileId)
        .extensions.getAllExtensions()
        .map((extension) => ({
          id: extension.id,
          name: extension.name,
          version: extension.version,
          manifestVersion: extension.manifest.manifest_version,
          permissions: extension.manifest.permissions || [],
          hostPermissions: extension.manifest.host_permissions || [],
        })),
      errors: this.errors.get(profileId) || [],
    };
  }
}
module.exports = { ExtensionManager };
