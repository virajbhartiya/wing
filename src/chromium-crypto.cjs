"use strict";
// Only UUID generation is needed by the shared workspace modules in the shell.
exports.randomUUID = () => globalThis.crypto.randomUUID();
