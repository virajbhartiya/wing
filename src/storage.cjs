const fs = require("node:fs");
const path = require("node:path");
/** Serial atomic writes: a slower older write must never replace newer state. */
class WorkspaceStore {
  constructor(filename) {
    this.filename = filename;
    this.pending = null;
    this.running = null;
    this.stopped = false;
  }
  write(value) {
    if (this.stopped) return Promise.resolve();
    this.pending = JSON.stringify(value, null, 2);
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    return this.running;
  }
  async drain() {
    await fs.promises.mkdir(path.dirname(this.filename), { recursive: true });
    while (this.pending !== null && !this.stopped) {
      const text = this.pending;
      this.pending = null;
      await fs.promises.writeFile(this.filename + ".async.tmp", text, {
        mode: 0o600,
      });
      if (!this.stopped)
        await fs.promises.rename(this.filename + ".async.tmp", this.filename);
    }
  }
  /** Called only at shutdown: prevent an asynchronous write overwriting final state. */
  flushSync(value) {
    this.stopped = true;
    this.pending = null;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(
      this.filename + ".final.tmp",
      JSON.stringify(value, null, 2),
      { mode: 0o600 },
    );
    fs.renameSync(this.filename + ".final.tmp", this.filename);
  }
}
module.exports = { WorkspaceStore };
