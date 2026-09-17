import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('Apple PCC native source contract', () => {
  it('keeps fixed fixtures and PCC APIs in a standalone SDK-preflighted engine', () => {
    const engine = read('modules/apple-foundation-models/ios/ApplePccEvaluationEngine.swift');
    const probe = read('../../scripts/ci/probe-apple-sdk.sh');
    const podspec = read('modules/apple-foundation-models/ios/MindwtrAppleFoundationModels.podspec');
    const packageManifest = read('modules/apple-foundation-models/Package.swift');

    expect(engine).toContain('#if os(iOS) && compiler(>=6.4)');
    expect(engine).toContain('PrivateCloudComputeLanguageModel()');
    expect(engine).toContain('model.supportsLocale(locale)');
    expect(engine).toContain('model.quotaUsage.isLimitReached');
    expect(engine).toContain('case .networkFailure');
    expect(engine).toContain('case .serviceUnavailable');
    expect(engine).toContain('case .quotaLimitReached');
    expect(engine).toContain('let modelError = error as? LanguageModelError');
    expect(engine).toContain('case .refusal, .guardrailViolation');
    expect(engine).toContain('case .timeout');
    expect(engine).toContain('case smoke');
    expect(engine).toContain('case projectPlanning = "project_planning"');
    expect(probe).toContain('ApplePccEvaluationEngine.swift');
    expect(podspec).toContain("'ApplePccEvaluationEngine.swift'");
    expect(packageManifest).toContain('path: "ios"');
    expect(packageManifest).toContain('path: "Tests"');
    expect(packageManifest).not.toMatch(/exclude:\s*\[[^\]]*ApplePccEvaluationEngine\.swift/);
  });

  it('enforces build opt-in, consent, fixed request keys, and a separate registry in the bridge', () => {
    const bridge = read('modules/apple-foundation-models/ios/MindwtrAppleFoundationModelsModule.swift');

    expect(bridge).toContain('MindwtrPccEvaluationEnabled');
    expect(bridge).toContain('let allowedFields = Set(["requestId", "backend", "fixtureId", "consent"])');
    expect(bridge).toContain('backend != .privateCloudCompute || consent');
    expect(bridge).toContain('private let pccRequests');
    expect(bridge).not.toMatch(/runPccEvaluation[\s\S]{0,3000}(SQLite|CoreData|CloudKit|URLSession)/);
  });
});
