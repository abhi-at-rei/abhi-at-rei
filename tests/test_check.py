from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import check
import preview

PNG_DATA = "data:image/png;base64,iVBORw0KGgo="
JPEG_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="


def svg(body: str = "", style: str = "@media (prefers-reduced-motion: reduce){*{animation:none}}", title: str = "Harbor",
        root_attrs: str = "") -> bytes:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" viewBox="0 0 10 10"{root_attrs}>'
        f"<title>{title}</title><desc>A small test scene.</desc><style>{style}</style>{body}</svg>"
    ).encode("utf-8")


class SvgPolicyTests(unittest.TestCase):
    def errors(self, payload: bytes) -> list[str]:
        return check.check_svg_bytes(payload)

    def test_baseline_is_clean(self) -> None:
        self.assertEqual(self.errors(svg('<rect width="10" height="10" fill="#fff"/>')), [])

    def test_allowed_references(self) -> None:
        body = (
            '<defs><linearGradient id="g"/><clipPath id="c"/></defs>'
            '<use href="#g"/><use xlink:href="#g"/>'
            f'<image href="{PNG_DATA}"/><image xlink:href="{JPEG_DATA}"/>'
            '<rect fill="url(#g)" clip-path="url(&quot;#c&quot;)" style="filter:url(#g)"/>'
        )
        style = f"@media (prefers-reduced-motion: reduce){{*{{animation:none}}}} .a{{fill:url(#g)}} .b{{background:url({PNG_DATA})}}"
        self.assertEqual(self.errors(svg(body, style)), [])

    def test_reference_policy_rejects(self) -> None:
        cases = {
            "http href": '<image href="http://example.com/a.png"/>',
            "https xlink:href": '<image xlink:href="https://example.com/a.png"/>',
            "protocol-relative href": '<image href="//example.com/a.png"/>',
            "relative file href": '<image href="a.png"/>',
            "svg data href": '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
            "html data href": '<a href="data:text/html;base64,PGI+"><rect/></a>',
            "gif data href": '<image href="data:image/gif;base64,R0lGOD=="/>',
            "plain data href": '<image href="data:image/png,abc"/>',
            "external url attribute": '<rect fill="url(https://example.com/p.svg#x)"/>',
            "relative url attribute": '<rect filter="url(other.svg#f)"/>',
            "external url in style attribute": '<rect style="fill:url(http://example.com/x)"/>',
            "import in style attribute": '<rect style="@import url(#a)"/>',
            "external url on unlisted attribute": '<rect data-x="url(http://example.com/x)"/>',
            "src attribute": '<image src="http://example.com/a.png"/>',
        }
        for name, body in cases.items():
            with self.subTest(name):
                self.assertTrue(self.errors(svg(body)), name)

    def test_css_policy_rejects(self) -> None:
        reduced = "@media (prefers-reduced-motion: reduce){*{animation:none}}"
        cases = {
            "import url": f"@import url(https://example.com/a.css); {reduced}",
            "import string": f'@import "a.css"; {reduced}',
            "escaped import": f"@\\69mport 'a.css'; {reduced}",
            "http url": f".a{{background:url(https://example.com/a.png)}} {reduced}",
            "quoted http url": f'.a{{background:url("http://example.com/a.png")}} {reduced}',
            "escaped url": f".a{{background:\\75rl(http://example.com/a.png)}} {reduced}",
            "svg data url": f".a{{background:url(data:image/svg+xml;base64,PHN2Zy8+)}} {reduced}",
            "data url comment obfuscation": f".a{{background:url(ht/**/tp://example.com/a.png)}} {reduced}",
        }
        for name, style in cases.items():
            with self.subTest(name):
                self.assertTrue(self.errors(svg(style=style)), name)

    def test_script_and_handlers_rejected(self) -> None:
        cases = {
            "script element": "<script>alert(1)</script>",
            "script in cdata": "<script><![CDATA[alert(1)]]></script>",
            "namespaced script": '<svg:script xmlns:svg="http://www.w3.org/2000/svg">1</svg:script>',
            "onload on child": '<rect onload="x()"/>',
            "onclick": '<rect onclick="x()"/>',
            "uppercase handler": '<rect ONMOUSEOVER="x()"/>',
            "smil handler": '<animate onbegin="x()"/>',
            "foreignObject": '<foreignObject><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject>',
            "javascript href": '<a href="javascript:alert(1)"><rect/></a>',
            "javascript xlink": '<a xlink:href="javascript:alert(1)"><rect/></a>',
            "entity obfuscated javascript": '<a href="java&#115;cript:alert(1)"><rect/></a>',
            "javascript in comment": "<!-- javascript:alert(1) -->",
            "script in comment": "<!-- <script>x</script> -->",
        }
        for name, body in cases.items():
            with self.subTest(name):
                self.assertTrue(self.errors(svg(body)), name)

    def test_root_event_handler_rejected(self) -> None:
        self.assertTrue(self.errors(svg(root_attrs=' onload="x()"')))

    def test_entity_declarations_rejected(self) -> None:
        payload = b'<!DOCTYPE svg [<!ENTITY x "y">]>' + svg()
        self.assertTrue(self.errors(payload))

    def test_structure_requirements(self) -> None:
        self.assertTrue(self.errors(svg().replace(b' role="img"', b"")))
        self.assertTrue(self.errors(svg().replace(b"<title>Harbor</title>", b"")))
        self.assertTrue(self.errors(svg(title="")))
        self.assertTrue(self.errors(svg().replace(b"<desc>A small test scene.</desc>", b"")))
        self.assertTrue(self.errors(svg(style=".a{fill:red}")))
        self.assertTrue(self.errors(svg('<rect id="a"/><rect id="a"/>')))
        self.assertTrue(self.errors(b"<html></html>"))

    def test_desc_before_title_rejected(self) -> None:
        payload = svg().replace(b"<title>Harbor</title><desc>A small test scene.</desc>", b"<desc>D</desc><title>T</title>")
        self.assertTrue(self.errors(payload))

    def test_size_limit(self) -> None:
        filler = "<!-- " + "x" * check.MAX_SVG_BYTES + " -->"
        self.assertTrue(any("size" in error for error in self.errors(svg(filler))))
        self.assertEqual(self.errors(svg("<!-- " + "x" * 200000 + " -->")), [])

    def test_xml_validity_and_ampersand_escaping(self) -> None:
        self.assertEqual(self.errors(b"<svg"), ["invalid SVG XML"])
        self.assertEqual(self.errors(svg(title="Banks & Blocks")), ["invalid SVG XML"])
        self.assertEqual(self.errors(svg(title="Banks &amp; Blocks")), [])

    def test_reduced_motion_rule(self) -> None:
        self.assertEqual(self.errors(svg(style="@media (prefers-reduced-motion:reduce){a{opacity:1}}")), [])
        self.assertTrue(self.errors(svg(style="@media (prefers-reduced-motion: no-preference){a{opacity:1}}")))


class BannedWordTests(unittest.TestCase):
    def flagged(self, text: str) -> bool:
        return bool(check.check_svg_bytes(svg(f'<text x="1" y="1">{text}</text>')))

    def test_banned_phrases(self) -> None:
        for text in ("Straw Hat crew", "Straw Hats", "the AKATSUKI", "us versus them", "a vs b", "Team A vs. Team B",
                     "WANTED", "WANTED poster", "a threat", "threats", "Dead or Alive", "dead  or  alive", "Agentic"):
            with self.subTest(text):
                self.assertTrue(self.flagged(text), text)

    def test_banned_phrase_in_title_and_desc(self) -> None:
        self.assertTrue(check.check_svg_bytes(svg(title="Straw Hats harbor")))
        self.assertFalse(check.check_svg_bytes(svg(title="A straw hat on a barrel")))
        self.assertTrue(check.check_svg_bytes(svg().replace(b"A small test scene.", b"Wanted: dead or alive")))

    def test_clean_phrases_pass(self) -> None:
        for text in ("Harbor at dusk", "Most Valued Engineer", "wanted a better build", "a harbor vsync pass", "Threadbare",
                     "&#8594; 2025&#8211;now", "2016 &#183; 2025", "a &#x2192; b", "assets/wanted-light.svg"):
            with self.subTest(text):
                self.assertFalse(self.flagged(text), text)

    def test_numeric_entities_are_not_false_positives(self) -> None:
        self.assertEqual(check.visible_errors("→ – ·"), [])
        self.assertEqual(check.check_svg_bytes(svg('<text>&#8594; &#38; &#169;</text>')), [])

    def test_cjk_rejected_anywhere(self) -> None:
        for text in ("あ", "ア", "漢字", "한", "&#12354;", "&#x6F22;"):
            with self.subTest(text):
                self.assertTrue(self.flagged(text), text)
        hidden = svg('<g><!-- あ --><rect/></g>')
        self.assertTrue(check.check_svg_bytes(hidden))
        self.assertTrue(check.check_svg_bytes(svg('<rect id="漢"/>')))

    def test_urls_and_filenames_are_not_scanned(self) -> None:
        self.assertEqual(check.visible_errors("see https://example.com/versus/wanted and wanted-light.svg"), [])


def parse(markup: str) -> check.VisibleHTML:
    return check.html_content(markup)


def picture(dark: str = "assets/a-dark.svg", light: str = "assets/a-light.svg", alt: str = "A scene") -> str:
    return (
        f'<picture><source media="(prefers-color-scheme: dark)" srcset="{dark}">'
        f'<img alt="{alt}" src="{light}" width="100%"></picture>'
    )


class PictureTests(unittest.TestCase):
    def test_complete_picture_passes(self) -> None:
        self.assertEqual(check.picture_errors(parse(picture()).pictures), [])

    def test_missing_pieces_fail(self) -> None:
        cases = {
            "no source": '<picture><img alt="a" src="assets/a-light.svg"></picture>',
            "no img": '<picture><source media="(prefers-color-scheme: dark)" srcset="assets/a-dark.svg"></picture>',
            "light-only source": '<picture><source media="(prefers-color-scheme: light)" srcset="assets/a-dark.svg"><img alt="a" src="assets/a-light.svg"></picture>',
            "no media": '<picture><source srcset="assets/a-dark.svg"><img alt="a" src="assets/a-light.svg"></picture>',
            "empty srcset": '<picture><source media="(prefers-color-scheme: dark)" srcset=""><img alt="a" src="assets/a-light.svg"></picture>',
            "missing alt": picture(alt=""),
            "same file twice": picture(dark="assets/a.svg", light="assets/a.svg"),
            "dark img": picture(light="assets/a-dark.svg"),
            "light source": picture(dark="assets/a-light.svg"),
        }
        for name, markup in cases.items():
            with self.subTest(name):
                self.assertTrue(check.picture_errors(parse(markup).pictures), name)

    def test_each_of_several_pictures_is_checked(self) -> None:
        markup = picture() + '<picture><img alt="a" src="assets/b-light.svg"></picture>'
        self.assertEqual(len(check.picture_errors(parse(markup).pictures)), 1)

    def test_picture_state_does_not_leak(self) -> None:
        markup = picture() + '<img alt="loose" src="assets/loose.svg">'
        self.assertEqual(len(parse(markup).pictures), 1)


class ReferenceTests(unittest.TestCase):
    def test_readme_asset_files_must_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "assets" / "ok.svg").write_text("<svg/>")
            self.assertEqual(check.readme_reference_errors(["assets/ok.svg", "https://example.com/x"], root), [])
            errors = check.readme_reference_errors(["assets/ok.svg", "assets/gone.svg", "../outside.svg"], root)
            self.assertEqual(len(errors), 2)
            self.assertTrue(any("gone.svg" in error for error in errors))
            self.assertTrue(any("escapes" in error for error in errors))

    def test_remote_output_references_must_name_build_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "generator").mkdir()
            (root / "generator" / "build.py").write_text("RENDERERS = {'battlefield': 1}\n")
            (root / "dist").mkdir()
            (root / "dist" / "battlefield-light.svg").write_text("<svg/>")
            good = preview.RAW_OUTPUT + "battlefield-light.svg"
            self.assertEqual(check.readme_reference_errors([good], root), [])
            self.assertEqual(len(check.readme_reference_errors([preview.RAW_OUTPUT + "battlefield-dark.svg"], root)), 1)
            self.assertEqual(len(check.readme_reference_errors([preview.RAW_OUTPUT + "mystery-light.svg"], root)), 1)

    def test_fragments_must_resolve(self) -> None:
        self.assertEqual(check.fragment_errors(["#what-i-build", "https://x.test/#y"], {"what-i-build"}), [])
        self.assertEqual(len(check.fragment_errors(["#nowhere"], {"what-i-build"})), 1)

    def test_site_must_not_reference_outside_itself(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "site").mkdir()
            (root / "dist").mkdir()
            (root / "dist" / "battlefield-light.svg").write_text("<svg/>")
            page = root / "site" / "index.html"
            self.assertTrue(check.site_reference_errors(page, root, ["../dist/battlefield-light.svg"], '<img src="../dist/battlefield-light.svg">'))
            self.assertTrue(check.site_reference_errors(page, root, [], "fetch('../dist/x.svg')"))
            self.assertTrue(check.site_reference_errors(page, root, ["missing.js"], ""))
            self.assertEqual(check.site_reference_errors(page, root, ["https://x.test/a.js", "#top", "./battlefield-light.svg", "stats.json"], ""), [])
            (root / "site" / "app.js").write_text("")
            self.assertEqual(check.site_reference_errors(page, root, ["app.js"], ""), [])


class PreviewTests(unittest.TestCase):
    def test_heading_ids_follow_github_slugs(self) -> None:
        rendered = preview.offline_markdown("# What I build\n\n## Cloud & tooling\n\n## Cloud & tooling\n\n### `Code` *italic*, 2025-now!\n")
        ids = [match for match in re.findall(r'<h[1-6] id="([^"]*)"', rendered)]
        self.assertEqual(ids, ["what-i-build", "cloud--tooling", "cloud--tooling-1", "code-italic-2025-now"])

    def test_every_readme_fragment_resolves_offline(self) -> None:
        rendered = preview.offline_markdown((ROOT / "README.md").read_text(encoding="utf-8"))
        content = check.html_content(rendered)
        self.assertEqual(check.fragment_errors(content.references, content.ids), [])
        self.assertTrue(any(reference.startswith("#") for reference in content.references))

    def test_api_heading_prefix_is_normalised(self) -> None:
        api = '<h2><a id="user-content-what-i-build" class="anchor" href="#what-i-build"></a>What I build</h2>'
        self.assertIn('id="what-i-build"', preview.rewrite_urls(api))
        self.assertNotIn("user-content-what", preview.rewrite_urls(api))

    def test_theme_switch_is_present_and_wired(self) -> None:
        document = preview.preview_document(preview.rewrite_urls(preview.offline_markdown("# A\n\n" + picture(
            "https://raw.githubusercontent.com/abhi-at-rei/abhi-at-rei/output/x-dark.svg",
            "https://raw.githubusercontent.com/abhi-at-rei/abhi-at-rei/output/x-light.svg"))))
        self.assertIn('data-t="light"', document)
        self.assertIn('data-t="dark"', document)
        self.assertIn("../dist/x-dark.svg", document)
        self.assertIn("../dist/x-light.svg", document)
        self.assertIn("document.documentElement.dataset.theme = t", document)
        self.assertIn('id="a"', document)

    def test_cli_offline_writes_preview(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested" / "index.html"
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "preview.py"), "--offline", "--output", str(output)],
                capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("offline subset", result.stdout)
            text = output.read_text(encoding="utf-8")
            self.assertIn('<h2 id="what-i-build">', text)
            self.assertIn('class="theme-switch"', text)


class WorkflowTests(unittest.TestCase):
    """The workflow is never run by these tests; its text is checked structurally, without a YAML module."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.text = (ROOT / ".github" / "workflows" / "profile.yml").read_text(encoding="utf-8")

    def position(self, needle: str) -> int:
        index = self.text.find(needle)
        self.assertGreaterEqual(index, 0, f"workflow lacks {needle!r}")
        return index

    def test_indentation_is_spaces_and_consistent(self) -> None:
        self.assertNotIn("\t", self.text)
        for number, line in enumerate(self.text.splitlines(), 1):
            if line.strip():
                self.assertEqual((len(line) - len(line.lstrip(" "))) % 2, 0, f"odd indent on line {number}")

    def test_keys_and_jobs(self) -> None:
        for key in ("\nname: profile", "\non:", "\npermissions:", "\njobs:", "\n  build:", "\n  pages:", "needs: build"):
            self.assertIn(key, self.text)

    def test_checks_run_before_publication_and_upload(self) -> None:
        tests = self.position("python -m unittest discover -s tests -p 'test_*.py'")
        checks = self.position("python scripts/check.py")
        render = self.position("python generator/build.py")
        publish = self.position("crazy-max/ghaction-github-pages")
        upload = self.position("actions/upload-pages-artifact")
        deploy = self.position("actions/deploy-pages")
        self.assertLess(render, tests)
        self.assertLess(tests, checks)
        self.assertLess(checks, publish)
        self.assertLess(publish, upload)
        self.assertLess(upload, deploy)

    def test_fallback_images_are_staged_inside_site(self) -> None:
        stage = self.position("cp data/stats.json site/stats.json")
        for name in ("battlefield-light.svg", "battlefield-dark.svg"):
            copy = self.position(f"dist/{name}")
            self.assertLess(self.position("python generator/build.py"), copy)
        self.assertRegex(self.text, r"cp dist/battlefield-light\.svg dist/battlefield-dark\.svg site/")
        self.assertLess(stage, self.position("python scripts/check.py"), "check.py should see the staged site")
        self.assertLess(stage, self.position("actions/upload-pages-artifact"))
        self.assertRegex(self.text, r"upload-pages-artifact@v\d+\s+with:\s+path: site\b")

    def test_action_versions_are_pinned_to_major_tags(self) -> None:
        uses = re.findall(r"uses:\s*([\w./-]+)@(\S+)", self.text)
        self.assertGreaterEqual(len(uses), 5)
        for name, version in uses:
            self.assertRegex(version, r"^v\d+$", name)
        names = [name for name, _ in uses]
        self.assertEqual(len(names), len(set(names)), "each action should be used at one version")
        for required in ("actions/checkout", "actions/setup-python", "actions/upload-pages-artifact", "actions/deploy-pages"):
            self.assertIn(required, names)

    def test_no_new_deployment_targets(self) -> None:
        self.assertEqual(self.text.count("actions/deploy-pages"), 1)
        self.assertEqual(self.text.count("crazy-max/ghaction-github-pages"), 1)
        self.assertEqual(self.text.count("upload-pages-artifact"), 1)


class SocialCardTests(unittest.TestCase):
    def test_card_html_embeds_the_svg_and_identity(self) -> None:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
        import render_card

        page = render_card.card_html(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
        self.assertIn("data:image/svg+xml;base64,", page)
        self.assertIn("Abhishek Vishwakarma", page)
        self.assertIn("abhi-at-rei.github.io/abhi-at-rei", page)
        self.assertIn(f"width: {render_card.W}px; height: {render_card.H}px", page)
        self.assertEqual((render_card.W, render_card.H), (1200, 630))


def riff(*chunks: tuple[bytes, bytes]) -> bytes:
    body = b"WEBP" + b"".join(kind + len(data).to_bytes(4, "little") + data + (b"\0" if len(data) & 1 else b"") for kind, data in chunks)
    return b"RIFF" + len(body).to_bytes(4, "little") + body


ANIMATED = riff((b"VP8X", bytes([0x12, 0, 0, 0]) + bytes(6)), (b"ANIM", bytes(6)), (b"ANMF", bytes(16)), (b"ANMF", bytes(16)))
STATIC = riff((b"VP8 ", bytes(10)))


class OrbitTests(unittest.TestCase):
    def test_animated_webp_passes(self) -> None:
        self.assertEqual(check.orbit_errors(ANIMATED), [])

    def test_rejects_non_webp_static_and_single_frame(self) -> None:
        self.assertEqual(check.orbit_errors(b"GIF89a" + bytes(40)), ["not a WebP file"])
        self.assertTrue(any("animated" in error for error in check.orbit_errors(STATIC)))
        one = riff((b"VP8X", bytes([0x02, 0, 0, 0]) + bytes(6)), (b"ANIM", bytes(6)), (b"ANMF", bytes(16)))
        self.assertTrue(any("two frames" in error for error in check.orbit_errors(one)))
        flag_missing = riff((b"VP8X", bytes(10)), (b"ANIM", bytes(6)), (b"ANMF", bytes(16)), (b"ANMF", bytes(16)))
        self.assertTrue(any("animated" in error for error in check.orbit_errors(flag_missing)))

    def test_size_limit_is_2_5_mb(self) -> None:
        self.assertEqual(check.MAX_ORBIT_BYTES, 2_500_000)
        big = ANIMATED + bytes(check.MAX_ORBIT_BYTES)
        self.assertTrue(any("size" in error for error in check.orbit_errors(big)))

    def test_readme_may_name_orbit_webp_before_it_exists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "generator").mkdir()
            (root / "generator" / "build.py").write_text("RENDERERS = {'battlefield': 1}\n")
            (root / "dist").mkdir()
            self.assertEqual(check.readme_reference_errors([preview.RAW_OUTPUT + "orbit-light.webp", preview.RAW_OUTPUT + "orbit-dark.webp"], root), [])
            self.assertEqual(len(check.readme_reference_errors([preview.RAW_OUTPUT + "orbit-mystery.webp"], root)), 1)

    def test_webp_picture_pair_is_valid(self) -> None:
        markup = picture(dark="https://x.test/output/orbit-dark.webp", light="https://x.test/output/orbit-light.webp")
        self.assertEqual(check.picture_errors(parse(markup).pictures), [])
        self.assertTrue(check.picture_errors(parse(picture(dark="https://x.test/orbit.webp", light="https://x.test/orbit.webp")).pictures))

    def test_run_validates_recorded_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dist").mkdir()
            (root / "dist" / "orbit-light.webp").write_bytes(ANIMATED)
            (root / "dist" / "orbit-dark.webp").write_bytes(STATIC)
            import contextlib, io
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = check.run(root)
            self.assertEqual(code, 1)
            self.assertIn("PASS dist/orbit-light.webp", out.getvalue())
            self.assertIn("FAIL dist/orbit-dark.webp", out.getvalue())


class StatsExtrasTests(unittest.TestCase):
    def errors(self, extra: dict) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats.json"
            path.write_text(json.dumps(extra))
            return check.check_stats(path)

    def test_achievements_and_highlights_are_allowed_and_optional(self) -> None:
        self.assertEqual(self.errors({}), [])
        self.assertEqual(self.errors({"achievements": [{"name": "YOLO", "slug": "yolo", "tier": 1}], "highlights": ["Developer Program Member"]}), [])
        self.assertEqual(self.errors({"achievements": [], "highlights": []}), [])

    def test_achievement_shape_is_enforced(self) -> None:
        good = {"name": "YOLO", "slug": "yolo", "tier": 1}
        bad = [
            "x", [good, "y"], [{**good, "tier": 0}], [{**good, "tier": "2"}], [{**good, "tier": True}],
            [{**good, "extra": 1}], [{"name": "YOLO", "slug": "yolo"}], [{**good, "name": 3}], [{**good, "slug": None}],
        ]
        for value in bad:
            with self.subTest(value=value):
                self.assertTrue(self.errors({"achievements": value}))

    def test_highlights_must_be_strings(self) -> None:
        self.assertTrue(self.errors({"highlights": "one"}))
        self.assertTrue(self.errors({"highlights": ["ok", 2]}))


class RecordOrbitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import record_orbit
        cls.module = record_orbit

    def test_loop_is_seamless_and_ping_pongs_in_front_of_the_city(self) -> None:
        count = 72
        poses = [self.module.pose_at(index, count) for index in range(count)]
        self.assertAlmostEqual(poses[0][0], -35.0)
        self.assertAlmostEqual(poses[count // 2][0], 35.0)
        self.assertTrue(all(-35.0 - 1e-9 <= az <= 35.0 + 1e-9 for az, _ in poses))
        # The frame after the last equals the first, so the loop has no jump.
        wrap = self.module.pose_at(count, count)
        self.assertAlmostEqual(wrap[0], poses[0][0])
        self.assertAlmostEqual(wrap[1], poses[0][1])
        steps = [abs(poses[i + 1][0] - poses[i][0]) for i in range(count - 1)]
        self.assertLess(max(steps), 8.0)
        self.assertEqual(self.module.pose_at(5, count), self.module.pose_at(5, count))

    def test_budget_matches_the_checker(self) -> None:
        self.assertEqual(self.module.MAX_BYTES, check.MAX_ORBIT_BYTES)
        self.assertEqual((self.module.W, self.module.H), (840, 420))

    def test_server_serves_a_directory_on_a_free_port(self) -> None:
        import urllib.request
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "index.html").write_text("hi")
            server, port = self.module.serve(Path(directory))
            try:
                self.assertGreater(port, 0)
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/") as response:
                    self.assertEqual(response.read(), b"hi")
            finally:
                server.shutdown()

    def test_encode_produces_a_valid_looping_animation(self) -> None:
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow is CI-only")
        frames = [Image.new("RGB", (64, 32), (index * 20, 40, 90)) for index in range(4)]
        payload, quality = self.module.encode(frames, 12, 100_000)
        self.assertEqual(check.orbit_errors(payload), [])
        self.assertIn(quality, self.module.QUALITIES)

    def test_write_is_atomic_and_readable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "out" / "orbit-light.webp"
            self.module.write_atomic(target, b"abc")
            self.assertEqual(target.read_bytes(), b"abc")
            self.assertEqual([path.name for path in target.parent.iterdir()], ["orbit-light.webp"])


class OrbitWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = (ROOT / ".github" / "workflows" / "profile.yml").read_text(encoding="utf-8")

    def at(self, needle: str) -> int:
        index = self.text.find(needle)
        self.assertGreaterEqual(index, 0, f"workflow lacks {needle!r}")
        return index

    def test_step_order(self) -> None:
        order = ["python generator/fetch.py", "python generator/build.py", "cp data/stats.json site/stats.json",
                 "python -m unittest discover", "python scripts/check.py", "python scripts/render_card.py",
                 "python scripts/record_orbit.py", "crazy-max/ghaction-github-pages", "actions/upload-pages-artifact", "actions/deploy-pages"]
        positions = [self.at(item) for item in order]
        self.assertEqual(positions, sorted(positions))

    def test_playwright_and_pillow_are_installed_once_before_use(self) -> None:
        self.assertEqual(self.text.count("playwright install"), 1)
        self.assertEqual(self.text.count("pip install"), 1)
        self.assertIn("pillow", self.text)
        self.assertLess(self.at("playwright install"), self.at("python scripts/render_card.py"))

    def test_orbit_failure_cannot_block_publication(self) -> None:
        step = self.text[self.at("- name: Record orbit preview"):self.at("- name: Publish to output branch")]
        self.assertIn("continue-on-error: true", step)
        self.assertIn("timeout-minutes:", step)
        restore = self.text[self.at("- name: Restore previous orbit recordings"):self.at("- name: Record orbit preview")]
        self.assertIn("continue-on-error: true", restore)
        self.assertLess(self.at("- name: Restore previous orbit recordings"), self.at("python scripts/record_orbit.py"))

    def test_job_timeout_is_bounded(self) -> None:
        match = re.search(r"timeout-minutes:\s*(\d+)", self.text)
        self.assertIsNotNone(match)
        self.assertTrue(15 <= int(match[1]) <= 60)


class QualityWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = (ROOT / ".github" / "workflows" / "quality.yml").read_text(encoding="utf-8")
        cls.profile = (ROOT / ".github" / "workflows" / "profile.yml").read_text(encoding="utf-8")

    def test_structure_and_triggers(self) -> None:
        self.assertNotIn("\t", self.text)
        for key in ("\nname: quality", "workflow_dispatch:", "workflow_run:", 'workflows: ["profile"]', "types: [completed]", "\njobs:"):
            self.assertIn(key, self.text)
        self.assertNotIn("pages: write", self.text)
        self.assertNotIn("deploy-pages", self.text)

    def test_runs_all_browsers_against_the_deployed_site(self) -> None:
        self.assertIn("https://abhi-at-rei.github.io/abhi-at-rei/", self.text)
        for browser in ("chromium", "webkit", "firefox"):
            self.assertIn(browser, self.text)
        self.assertIn("scripts/browser_check.py", self.text)
        self.assertIn("--deployed", self.text)

    def test_lighthouse_is_pinned_and_asserted(self) -> None:
        self.assertRegex(self.text, r"npx --yes lighthouse@\d+\.\d+\.\d+")
        self.assertIn("--preset=desktop", self.text)
        self.assertRegex(self.text, r"(?i)mobile")
        self.assertIn("performance", self.text)
        self.assertIn("accessibility", self.text)
        self.assertIn("0.9", self.text)
        self.assertIn("upload-artifact", self.text)

    def test_never_blocks_deploys_and_pins_actions_like_profile(self) -> None:
        self.assertIn("workflow_run", self.text)
        uses = dict(re.findall(r"uses:\s*([\w./-]+)@(\S+)", self.text))
        profile_uses = dict(re.findall(r"uses:\s*([\w./-]+)@(\S+)", self.profile))
        for name, version in uses.items():
            self.assertRegex(version, r"^v\d+$", name)
            if name in profile_uses:
                self.assertEqual(version, profile_uses[name], name)
        self.assertIn("actions/upload-artifact", uses)

    def test_timeouts_are_bounded(self) -> None:
        self.assertGreaterEqual(self.text.count("timeout-minutes:"), 2)


if __name__ == "__main__":
    unittest.main()
