import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(__dirname, 'ios', 'MindwtrAppleTaskSearchModule.swift'),
  'utf8',
);

describe('MindwtrAppleTaskSearch native source contract', () => {
  it('keeps the iOS 27 APIs behind compile, runtime, and development guards', () => {
    expect(source).toContain('#if DEBUG && compiler(>=6.4) && canImport(FoundationModels)');
    expect(source).toContain('if #available(iOS 27.0, *)');
    expect(source).toContain('SystemLanguageModel.default.availability');
  });

  it('scopes Spotlight output to items and accepts only exact Mindwtr task links', () => {
    expect(source).toContain('source.maximumResultCount = 50');
    expect(source).toContain('guide: .focused(.items)');
    expect(source).toContain('components.scheme?.lowercased() == "mindwtr"');
    expect(source).toContain('components.host?.lowercased() == "open"');
    expect(source).toContain('$0.name == "task"');
  });

  it('caps requests and results and performs a bounded final-result drain', () => {
    expect(source).toContain('guard query.count <= 500');
    expect(source).toContain('private static let resultLimit = 50');
    expect(source).toContain('case .complete:');
    expect(source).toContain('queryToken: reply.queryToken');
    expect(source).toContain('completedQueryTokens.isSuperset(of: observedQueryTokens)');
    expect(source).toContain('for _ in 0..<10');
    expect(source).toContain('Task.sleep(for: .milliseconds(25))');
    expect(source).toContain('guard didReachStableCompletion else');
    expect(source).toContain('MindwtrAppleTaskSearchFailure.resultStreamIncomplete');
    expect(source).toContain('return results');
  });

  it('cancels replacement searches, explicit cancellation, and module destruction', () => {
    expect(source).toContain('activeTask?.cancel()');
    expect(source).toContain('AsyncFunction("cancel")');
    expect(source).toContain('OnDestroy');
    expect(source).toContain('await self.coordinator.cancel()');
  });
});
