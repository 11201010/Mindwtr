import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = 'scripts/ci/validate-ios-scene-lifecycle.js';
const sourceId = '111111111111111111111111';
const sourcePhaseId = '222222222222222222222222';
const configId = '333333333333333333333333';
const targetId = '444444444444444444444444';
const configListId = '555555555555555555555555';

const infoPlist = (
  delegate = '$(PRODUCT_MODULE_NAME).MindwtrSceneDelegate',
  launchScreen = true,
) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  ${launchScreen ? '<key>UILaunchStoryboardName</key><string>SplashScreen</string>' : ''}
  <key>UIApplicationSceneManifest</key><dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
    <key>UISceneConfigurations</key><dict>
      <key>UIWindowSceneSessionRoleApplication</key><array><dict>
        <key>UISceneDelegateClassName</key><string>${delegate}</string>
      </dict></array>
    </dict>
  </dict>
</dict></plist>`;

const project = ({ includeSource = true, deploymentTarget = '16.4' } = {}) => `
${sourceId} /* MindwtrSceneDelegate.swift */ = {isa = PBXFileReference; path = MindwtrSceneDelegate.swift; };
${sourcePhaseId} /* Sources */ = {
  isa = PBXSourcesBuildPhase;
  files = (
    ${includeSource ? `${sourceId} /* MindwtrSceneDelegate.swift in Sources */,` : ''}
  );
};
${configId} /* Debug */ = {
  isa = XCBuildConfiguration;
  buildSettings = { IPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget}; };
};
${configListId} /* Build configuration list for PBXNativeTarget "Mindwtr" */ = {
  isa = XCConfigurationList;
  buildConfigurations = (${configId} /* Debug */,);
};
${targetId} /* Mindwtr */ = {
  isa = PBXNativeTarget;
  buildConfigurationList = ${configListId} /* Build configuration list for PBXNativeTarget "Mindwtr" */;
  buildPhases = (${sourcePhaseId} /* Sources */,);
  name = Mindwtr;
};
`;

const sceneDelegate = `
final class MindwtrSceneDelegate: UIResponder, UIWindowSceneDelegate {
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    appDelegate.window?.windowScene = windowScene
    appDelegate.mindwtrStartReactNative(in: appDelegate.window, launchOptions: [:])
    appDelegate.mindwtrRecordSceneDiagnostic(stage: "sceneConnected", deliveryKind: "url")
    appDelegate.mindwtrRecordSceneDiagnostic(stage: "rootStarted", deliveryKind: "url")
    appDelegate.mindwtrRecordSceneDiagnostic(stage: "coldDelivery", deliveryKind: "url")
  }
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    appDelegate.mindwtrRecordSceneDiagnostic(stage: "warmDelivery", deliveryKind: "url")
  }
}
`;

const appDelegate = (launchBody = 'window = UIWindow()') => `
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    ${launchBody}
    return true
  }
}
`;

const makeFixture = (options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'mindwtr-ios-scene-'));
  const app = join(directory, 'Mindwtr');
  const projectDirectory = join(directory, 'Mindwtr.xcodeproj');
  mkdirSync(app, { recursive: true });
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(
    join(app, 'Info.plist'),
    infoPlist(options.delegate, options.launchScreen !== false),
  );
  writeFileSync(join(app, 'MindwtrSceneDelegate.swift'), sceneDelegate);
  writeFileSync(join(app, 'AppDelegate.swift'), appDelegate(options.launchBody));
  writeFileSync(join(projectDirectory, 'project.pbxproj'), project(options));
  return directory;
};

const run = (directory) => execFileSync('node', [script, directory], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

test('accepts scene-owned React startup and the preserved iOS 16.4 host floor', () => {
  const directory = makeFixture();
  try {
    expect(run(directory)).toContain('Validated scene lifecycle');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([
  ['a wrong manifest delegate', { delegate: '$(PRODUCT_MODULE_NAME).OtherSceneDelegate' }, 'does not point'],
  ['a missing launch screen declaration', { launchScreen: false }, 'launch screen keys'],
  ['an uncompiled scene source', { includeSource: false }, 'not compiled'],
  ['a changed deployment floor', { deploymentTarget: '17.0' }, 'deployment floor'],
  ['legacy AppDelegate root startup', { launchBody: 'factory.startReactNative(withModuleName: "main", in: window)' }, 'legacy root-window startup'],
  ['legacy screen geometry', { launchBody: 'window = UIWindow(frame: UIScreen.main.bounds)' }, 'legacy screen geometry'],
])('rejects %s', (_label, options, expectedError) => {
  const directory = makeFixture(options);
  try {
    expect(() => run(directory)).toThrow(expectedError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
