import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import release_notes as R


class ReleaseNotesTest(unittest.TestCase):
    def test_uses_whats_new_and_drops_download_sections(self):
        news, gaps = R.highlights(
            'Intro line.\n\n## What’s new\n\n- **Downloads fly.** Into the button.\n- Plain fix.\n\n'
            '## Download\n\n- Apple Silicon: https://example.invalid/Wing.dmg\n\n'
            '## Known gaps\n\n- Not notarized yet.\n')
        self.assertEqual(news, ['**Downloads fly.** Into the button.', 'Plain fix.'])
        self.assertEqual(gaps, ['Not notarized yet.'])

    def test_reads_a_bare_list_when_there_is_no_heading(self):
        news, _ = R.highlights('- Faster tabs.\n- Sooner window.\n\nThis build is for Apple Silicon.\n')
        self.assertEqual(news, ['Faster tabs.', 'Sooner window.'])

    def test_bold_headline_versus_bold_inside_a_sentence(self):
        self.assertIn('<span class="title">Downloads fly.</span>', R.item_html('**Downloads fly.** Into it.'))
        inline = R.item_html('**View → Translate** translates text.')
        self.assertNotIn('class="title"', inline)
        self.assertIn('<strong>View → Translate</strong> translates', inline)

    def test_escapes_markup_and_only_links_http(self):
        self.assertNotIn('<script>', R.inline('<script>x</script>'))
        self.assertNotIn('href="javascript', R.inline('[x](javascript:alert(1))'))
        self.assertIn('href="https://wing.example"', R.inline('[site](https://wing.example)'))

    def test_page_lists_earlier_releases_by_headline(self):
        page = R.render('v0.2.0-native.21', '- New thing.\n', '2026-11-25T09:58:54Z',
                        [('v0.2.0-native.19', '- **Downloads fly into place.** Long detail.\n', '2026-11-21T17:50:49Z')])
        self.assertIn('Wing 0.2.0-native.21', page)
        self.assertIn('November 25, 2026', page)
        self.assertIn('Downloads fly into place.', page)
        self.assertNotIn('Long detail.', page)


if __name__ == '__main__':
    unittest.main()
