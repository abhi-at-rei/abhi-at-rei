from __future__ import annotations

import sys
import unittest
import xml.dom.minidom
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "generator"))
import cards
import fetch

FIX = Path(__file__).resolve().parent / "fixtures"


def fixture(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


class ParserTests(unittest.TestCase):
    def test_live_page(self):
        found, highlights = fetch.parse_achievements(fixture("achievements_live.html"))
        self.assertEqual(
            found,
            [
                {"name": "Pull Shark", "slug": "pull-shark", "tier": 2},
                {"name": "Pair Extraordinaire", "slug": "pair-extraordinaire", "tier": 1},
                {"name": "Quickdraw", "slug": "quickdraw", "tier": 1},
                {"name": "YOLO", "slug": "yolo", "tier": 1},
            ],
        )
        self.assertEqual(highlights, ["Developer Program Member"])

    def test_tiers_entities_and_dialog_headings_ignored(self):
        found, highlights = fetch.parse_achievements(fixture("achievements_tiers.html"))
        self.assertEqual([(a["slug"], a["tier"]) for a in found],
                         [("starstruck", 3), ("galaxy-brain", 4), ("pull-shark", 2), ("brand-new-badge", 1)])
        self.assertEqual(found[3]["name"], "Brand & New Badge")
        self.assertEqual(highlights, ["Pro", "Developer Program Member"])

    def test_no_matches(self):
        self.assertEqual(fetch.parse_achievements(fixture("achievements_empty.html")), ([], []))
        self.assertEqual(fetch.parse_achievements(""), ([], []))
        self.assertEqual(fetch.parse_achievements("<html>markup changed</html>"), ([], []))


class ScrapeSafetyTests(unittest.TestCase):
    def test_failure_leaves_keys_absent(self):
        stats = {"achievements": [{"name": "stale"}], "highlights": ["stale"]}
        with mock.patch.object(fetch, "_get_page", side_effect=OSError("offline")):
            fetch.add_achievements(stats)
        self.assertNotIn("achievements", stats)
        self.assertNotIn("highlights", stats)

    def test_zero_matches_leaves_keys_absent(self):
        stats: dict = {}
        with mock.patch.object(fetch, "_get_page", return_value=fixture("achievements_empty.html")):
            fetch.add_achievements(stats)
        self.assertNotIn("achievements", stats)

    def test_success_sets_keys(self):
        stats: dict = {}
        with mock.patch.object(fetch, "_get_page", return_value=fixture("achievements_live.html")):
            fetch.add_achievements(stats)
        self.assertEqual(len(stats["achievements"]), 4)
        self.assertEqual(stats["highlights"], ["Developer Program Member"])


def ach(name, tier=1, slug=None):
    return {"name": name, "slug": slug or cards._slugify(name), "tier": tier}


class RenderTests(unittest.TestCase):
    def render(self, stats, mode="light"):
        svg = cards.render_seals(stats, mode)
        xml.dom.minidom.parseString(svg)
        self.assertLessEqual(len(svg.encode()), 250 * 1024)
        return svg

    def height(self, svg):
        import re
        return int(re.search(r'<svg[^>]*\bheight="(\d+)"', svg).group(1))

    def test_fallback_when_absent(self):
        svg = self.render({})
        for word in ("Pull Shark", "Pair Extraordinaire", "Quickdraw", "YOLO", "Developer Program Member"):
            self.assertIn(word, svg)

    def test_live_overrides_fallback(self):
        svg = self.render({"achievements": [ach("Starstruck", 3)], "highlights": ["Pro"]})
        self.assertIn("Starstruck", svg)
        self.assertIn("STARS", svg)
        self.assertNotIn("Quickdraw", svg)
        self.assertIn("&#215;3", svg)
        self.assertIn("#E1E4E4", svg)  # silver

    def test_tier_colours(self):
        svg = self.render({"achievements": [ach("A", 2), ach("B", 3), ach("C", 4)]})
        for colour in ("#F9BFA7", "#E1E4E4", "#FAE57E"):
            self.assertIn(colour, svg)

    def test_unknown_future_achievement(self):
        svg = self.render({"achievements": [ach("Time Traveller", 1)]})
        self.assertIn("TIME", svg)
        self.assertIn("Unlocked on GitHub", svg)

    def test_layout_adapts_for_1_to_10(self):
        heights = {}
        for n in range(1, 11):
            items = [ach(f"Badge {i}", 1 + i % 4) for i in range(n)]
            svg = self.render({"achievements": items})
            heights[n] = self.height(svg)
            for i in range(n):
                self.assertIn(f"Badge {i}", svg)
        self.assertEqual({heights[n] for n in range(1, 7)}, {230})
        self.assertGreater(heights[7], 230)
        self.assertEqual(heights[7], heights[10])

    def test_more_than_ten_is_capped(self):
        svg = self.render({"achievements": [ach(f"Badge {i}") for i in range(14)]})
        self.assertIn("Badge 9", svg)
        self.assertNotIn("Badge 10", svg)

    def test_both_modes_and_policy(self):
        stats = {"achievements": [ach("Pull Shark", 2), ach("Galaxy Brain", 4)], "highlights": ["Pro"]}
        light, dark = self.render(stats, "light"), self.render(stats, "dark")
        for svg in (light, dark):
            low = svg.lower()
            for banned in ("straw hats", "akatsuki", " vs ", "versus", "<script", "href="):
                self.assertNotIn(banned, low)
        self.assertEqual(self.height(light), self.height(dark))

    def test_names_are_escaped(self):
        svg = self.render({"achievements": [ach("Fish & <Chips>", 2)]})
        self.assertIn("Fish &amp; &lt;Chips&gt;", svg)


if __name__ == "__main__":
    unittest.main()
