// Owns only short-lived, in-memory page images. A generation prevents stale
// capture/decode replies from hiding a page after the user closes the dialog.
class OverlayBackdrop {
  constructor({ capture, commit, release }) {
    this.capture = capture;
    this.onCommit = commit;
    this.onRelease = release;
    this.generation = 0;
    this.frames = null;
    this.pending = null;
  }
  async prepare() {
    const token = ++this.generation;
    if (!this.frames && !this.pending) {
      this.pending = this.capture();
    }
    const pending = this.pending;
    let frames;
    try {
      frames = this.frames || (await pending);
    } catch (error) {
      if (this.pending === pending) this.pending = null;
      throw error;
    }
    if (token !== this.generation) return { cancelled: true };
    this.pending = null;
    this.frames = frames;
    return { token, frames };
  }
  commit(token) {
    if (token !== this.generation || !this.frames) return false;
    this.onCommit();
    return true;
  }
  close() {
    ++this.generation;
    this.pending = null;
    this.frames = null;
    this.onRelease();
  }
}
module.exports = { OverlayBackdrop };

// A stalled compositor must not stall browser commands or accumulate new
// screenshot requests each time the user reopens a dialog.
const capturesInFlight = new WeakMap();
async function capturePageBounded(contents, timeoutMs = 300) {
  let capture = capturesInFlight.get(contents);
  if (!capture) {
    capture = Promise.resolve()
      .then(() => contents.capturePage())
      .finally(() => capturesInFlight.delete(contents));
    capturesInFlight.set(contents, capture);
  }
  let timer;
  try {
    return await Promise.race([
      capture,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Page capture timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
module.exports.capturePageBounded = capturePageBounded;
