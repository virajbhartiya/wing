const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const W = require("../src/web-store.cjs");
function varint(n) {
  const bytes = [];
  do {
    let b = n & 127;
    n = Math.floor(n / 128);
    if (n) b |= 128;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}
function field(id, value) {
  return Buffer.concat([varint((id << 3) | 2), varint(value.length), value]);
}
function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = publicKey.export({ format: "der", type: "spki" }),
    id = W.idFromKey(key);
  const signed = field(
      1,
      crypto.createHash("sha256").update(key).digest().subarray(0, 16),
    ),
    size = Buffer.alloc(4);
  size.writeUInt32LE(signed.length);
  const zip = Buffer.from("PK fixture archive");
  const signature = crypto.sign(
    "sha256",
    Buffer.concat([Buffer.from("CRX3 SignedData\0"), size, signed, zip]),
    privateKey,
  );
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, key), field(2, signature)])),
    field(10000, signed),
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return { id, bytes: Buffer.concat([prefix, header, zip]) };
}
test("CRX3 proof binds archive bytes and requested extension identity", () => {
  const { id, bytes } = fixture();
  assert.equal(W.verifyCRX(bytes, id).id, id);
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => W.verifyCRX(tampered, id));
  assert.throws(() => W.verifyCRX(bytes, "a".repeat(32)));
  assert.throws(() => W.verifyCRX(bytes.subarray(0, 18), id));
});
test("store links and redirects cannot target arbitrary sites or credentials", () => {
  const id = "a".repeat(32);
  assert.equal(
    W.extensionId(`https://chromewebstore.google.com/detail/name/${id}`),
    id,
  );
  assert.throws(() => W.extensionId(`https://evil.test/detail/${id}`));
  assert.equal(W.trustedDownload("https://clients2.google.com/a"), true);
  assert.equal(W.trustedDownload("https://google.com.evil.test/a"), false);
  assert.equal(W.trustedDownload("http://clients2.google.com/a"), false);
  assert.equal(W.trustedDownload("https://user:pass@google.com"), false);
});
