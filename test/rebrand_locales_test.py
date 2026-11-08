import pathlib, struct, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from rebrand_locales import rebrand_pak, _parse


def pak(strings, aliases=b''):
    header = struct.pack('<IB3xHH', 5, 1, len(strings), len(aliases) // 4)
    offset = len(header) + 6 * (len(strings) + 1) + len(aliases)
    table = b''
    for identity, text in strings:
        table += struct.pack('<HI', identity, offset)
        offset += len(text)
    table += struct.pack('<HI', 0, offset)
    return header + table + aliases + b''.join(text for _, text in strings)


class RebrandLocales(unittest.TestCase):
    def test_strings_say_wing_and_offsets_follow(self):
        data = pak([(10, b'$1 has been added to Ardia'), (11, b'About Ardia'), (12, b'Settings')],
                   struct.pack('<HH', 20, 1))
        out, changed = rebrand_pak(data)
        self.assertEqual(changed, 2)
        _, ids, blobs, aliases, alias_table = _parse(out)
        self.assertEqual(ids, [10, 11, 12])
        self.assertEqual(blobs, [b'$1 has been added to Wing', b'About Wing', b'Settings'])
        self.assertEqual((aliases, alias_table), (1, struct.pack('<HH', 20, 1)))

    def test_keychain_strings_keep_the_item_name(self):
        text = b'Relaunch Ardia and allow Keychain access.'
        out, changed = rebrand_pak(pak([(1, text)]))
        self.assertEqual((changed, out), (0, pak([(1, text)])))


if __name__ == '__main__':
    unittest.main()
