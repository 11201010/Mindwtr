import importlib.util
import pathlib
import plistlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('watch_bundle', pathlib.Path(__file__).with_name('validate-watch-bundle.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WatchBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = pathlib.Path(self.temp.name) / 'Mindwtr.app'
        self.host = dict(CFBundleIdentifier='tech.example.mindwtr', CFBundleVersion='42', CFBundleShortVersionString='1.2.9', MindwtrWatchEnabled=False)
        self.write(self.app, self.host)

    def write(self, path, info):
        path.mkdir(parents=True, exist_ok=True)
        (path / 'Info.plist').write_bytes(plistlib.dumps(info))

    def enable(self):
        self.host['MindwtrWatchEnabled'] = True
        self.write(self.app, self.host)
        self.watch_path = self.app / 'Watch/MindwtrWatch.app'
        self.watch = dict(self.host, CFBundleIdentifier='tech.example.mindwtr.watchkitapp', WKCompanionAppBundleIdentifier='tech.example.mindwtr')
        self.widget = dict(self.host, CFBundleIdentifier='tech.example.mindwtr.watchkitapp.widgets')
        self.write(self.watch_path, self.watch)
        self.write(self.watch_path / 'PlugIns/MindwtrWatchWidgets.appex', self.widget)

    def test_stable_without_watch(self):
        module.validate(self.app, False)

    def test_beta_requires_both_targets(self):
        with self.assertRaises(ValueError):
            module.validate(self.app, True)
        self.enable()
        module.validate(self.app, True)
        (self.watch_path / 'PlugIns/MindwtrWatchWidgets.appex/Info.plist').unlink()
        with self.assertRaises(OSError):
            module.validate(self.app, True)

    def test_stable_rejects_embedded_watch(self):
        self.enable()
        with self.assertRaises(ValueError):
            module.validate(self.app, False)

    def test_beta_rejects_mismatched_companion_and_versions(self):
        self.enable()
        for field, value in [('WKCompanionAppBundleIdentifier', 'other'), ('CFBundleVersion', '41'), ('CFBundleIdentifier', 'other'), ('WKRunsIndependentlyOfCompanionApp', True)]:
            with self.subTest(field=field):
                self.write(self.watch_path, dict(self.watch, **{field: value}))
                with self.assertRaises(ValueError):
                    module.validate(self.app, True)
        self.write(self.watch_path, self.watch)
        self.write(self.watch_path / 'PlugIns/MindwtrWatchWidgets.appex', dict(self.widget, CFBundleShortVersionString='1.2.8'))
        with self.assertRaises(ValueError):
            module.validate(self.app, True)


if __name__ == '__main__':
    unittest.main()
