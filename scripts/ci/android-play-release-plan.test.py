#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("android-play-release-plan.py")
SPEC = importlib.util.spec_from_file_location("android_play_release_plan", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {SCRIPT_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AndroidPlayReleasePlanTest(unittest.TestCase):
    def test_rc_tracks_are_deduplicated_and_keep_internal_and_beta(self) -> None:
        self.assertEqual(
            MODULE.resolve_tracks(
                " internal, beta,internal ",
                internal_test_release=False,
                stable_production_tag=False,
            ),
            ["internal", "beta"],
        )

    def test_stable_tag_expands_production_to_all_shared_artifact_tracks(self) -> None:
        self.assertEqual(
            MODULE.resolve_tracks(
                "production",
                internal_test_release=False,
                stable_production_tag=True,
            ),
            ["production", "beta", "internal"],
        )

    def test_manual_production_does_not_gain_testing_tracks(self) -> None:
        self.assertEqual(
            MODULE.resolve_tracks(
                "production",
                internal_test_release=False,
                stable_production_tag=False,
            ),
            ["production"],
        )

    def test_compatibility_internal_release_is_internal_only_normal_build(self) -> None:
        self.assertEqual(
            MODULE.resolve_tracks(
                "production,beta",
                internal_test_release=True,
                stable_production_tag=False,
            ),
            ["internal"],
        )

    def test_none_skips_play_and_invalid_mixes_are_rejected(self) -> None:
        self.assertEqual(
            MODULE.resolve_tracks(
                "none",
                internal_test_release=False,
                stable_production_tag=False,
            ),
            [],
        )
        for tracks in ("none,beta", "production,beta"):
            with self.subTest(tracks=tracks):
                with self.assertRaises(ValueError):
                    MODULE.resolve_tracks(
                        tracks,
                        internal_test_release=False,
                        stable_production_tag=False,
                    )

    def test_stable_plan_uses_one_artifact_and_version_for_three_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            notes = root / "notes"
            notes.mkdir()
            (notes / "whatsnew-en-US").write_text("Stable notes\n", encoding="utf-8")
            assets = root / "assets.json"
            listings = root / "listings.json"
            assets.write_text(json.dumps([{"language": "en-US"}]), encoding="utf-8")
            listings.write_text(json.dumps([{"language": "en-US"}]), encoding="utf-8")

            plan = MODULE.build_plan(
                package="tech.dongdongbh.mindwtr",
                artifact_path="mindwtr-1.4.0.aab",
                expected_version_code=200,
                version="1.4.0",
                tracks=["production", "beta", "internal"],
                stable_production=True,
                stable_release_notes_directory=str(notes),
                listing_assets_file=str(assets),
                listings_file=str(listings),
            )

        self.assertEqual(plan["artifactPath"], "mindwtr-1.4.0.aab")
        self.assertEqual(plan["expectedVersionCode"], 200)
        self.assertEqual(
            [release["track"] for release in plan["tracks"]],
            ["production", "beta", "internal"],
        )
        self.assertEqual(plan["tracks"][0]["releaseNotes"][0]["text"], "Stable notes")

    def test_testing_plan_uses_same_release_notes_for_every_track(self) -> None:
        plan = MODULE.build_plan(
            package="tech.dongdongbh.mindwtr",
            artifact_path="mindwtr-1.4.0-rc.1.aab",
            expected_version_code=199,
            version="1.4.0-rc.1",
            tracks=["internal", "beta"],
            stable_production=False,
            testing_release_notes="Test this release",
        )

        self.assertEqual(
            [release["track"] for release in plan["tracks"]],
            ["internal", "beta"],
        )
        for release in plan["tracks"]:
            self.assertEqual(release["releaseNotes"][0]["text"], "Test this release")


if __name__ == "__main__":
    unittest.main()
