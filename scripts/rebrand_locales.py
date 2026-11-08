"""Chromium's built-in strings name the engine's brand ("MetaMask has been added
to Ardia", "About Ardia"). Rewrite the locale packs so they say Wing.

Strings about the macOS Keychain keep the old name: the Safe Storage item in
Keychain Access is still called "Ardia Safe Storage", and they point there.
"""
import pathlib, struct

KEEP = (b'Keychain', b'encryption key')


def _parse(data):
    version, = struct.unpack_from('<I', data, 0)
    if version != 5:
        raise ValueError(f'Unsupported pak version {version}')
    encoding = data[4]
    count, aliases = struct.unpack_from('<HH', data, 8)
    entries = [struct.unpack_from('<HI', data, 12 + 6 * i) for i in range(count + 1)]
    alias_table = data[12 + 6 * (count + 1):12 + 6 * (count + 1) + 4 * aliases]
    blobs = [data[entries[i][1]:entries[i + 1][1]] for i in range(count)]
    return encoding, [e[0] for e in entries[:count]], blobs, aliases, alias_table


def _write(encoding, ids, blobs, aliases, alias_table):
    header = struct.pack('<IB3xHH', 5, encoding, len(ids), aliases)
    offset = len(header) + 6 * (len(ids) + 1) + len(alias_table)
    table = b''
    for identity, blob in zip(ids, blobs):
        table += struct.pack('<HI', identity, offset)
        offset += len(blob)
    table += struct.pack('<HI', 0, offset)
    return header + table + alias_table + b''.join(blobs)


def rebrand_pak(data, old=b'Ardia', new=b'Wing'):
    encoding, ids, blobs, aliases, alias_table = _parse(data)
    if encoding != 1:  # only UTF-8 packs hold plain strings
        return data, 0
    changed = 0
    for i, blob in enumerate(blobs):
        # Compressed resources (gzip, brotli) are never strings.
        if old in blob and not blob.startswith((b'\x1f\x8b', b'\x1e\x9b')) and not any(k in blob for k in KEEP):
            blobs[i] = blob.replace(old, new)
            changed += 1
    return (_write(encoding, ids, blobs, aliases, alias_table) if changed else data), changed


def rebrand_locales(resources):
    total = 0
    for pak in sorted(pathlib.Path(resources).glob('*.lproj/locale.pak')):
        data, changed = rebrand_pak(pak.read_bytes())
        if changed:
            pak.write_bytes(data)
            total += changed
    return total
