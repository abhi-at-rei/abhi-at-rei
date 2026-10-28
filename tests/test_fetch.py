from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "generator"))
import fetch
from fetch import derive, streaks


class StreakTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(streaks([], "2026-01-05")["current"], 0)

    def test_today_can_be_empty(self):
        result = streaks([
            {"date": "2026-01-02", "count": 2},
            {"date": "2026-01-03", "count": 3},
            {"date": "2026-01-04", "count": 0},
        ], "2026-01-04")
        self.assertEqual((result["current"], result["longest"]), (2, 2))
        self.assertEqual(result["current_start"], "2026-01-02")

    def test_yesterday_empty_breaks_streak(self):
        result = streaks([
            {"date": "2026-01-02", "count": 2},
            {"date": "2026-01-03", "count": 3},
            {"date": "2026-01-04", "count": 0},
        ], "2026-01-05")
        self.assertEqual(result["current"], 0)

    def test_missing_dates_break_streak(self):
        result = streaks([
            {"date": "2026-01-01", "count": 2},
            {"date": "2026-01-03", "count": 3},
            {"date": "2026-01-04", "count": 1},
        ], "2026-01-04")
        self.assertEqual((result["current"], result["longest"]), (2, 2))

    def test_old_and_future_activity_are_not_current(self):
        result = streaks([
            {"date": "2026-01-01", "count": 2},
            {"date": "2026-01-07", "count": 9},
        ], "2026-01-05")
        self.assertEqual((result["current"], result["longest"]), (0, 1))

    def test_incomplete_profile_fails(self):
        with self.assertRaises(ValueError):
            derive({"data": {"user": None}})





class AvatarTests(unittest.TestCase):
    def test_download_creates_missing_data_dir(self):
        import io
        import tempfile
        from unittest import mock

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(fetch, "ROOT", Path(tmp)), \
                mock.patch("urllib.request.urlopen", return_value=Resp(b"png")):
            # data/ is gitignored, so a fresh CI checkout has no such directory
            self.assertTrue(fetch.download_avatar("https://example.invalid/a.png"))
            self.assertEqual((Path(tmp) / "data" / "avatar.png").read_bytes(), b"png")


if __name__ == "__main__":
    unittest.main()