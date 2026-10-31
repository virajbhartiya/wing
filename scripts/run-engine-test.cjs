const { spawnSync } = require("node:child_process");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "wing-engine-test-"));
try {
  const result = spawnSync(require("electron"), ["."], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, WING_ENGINE_TEST: "1", WING_DATA_DIR: data },
    stdio: "inherit",
    timeout: 60000,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(data, { recursive: true, force: true });
}
