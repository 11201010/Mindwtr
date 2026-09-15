import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sourcePath = decodeURIComponent(new URL(
  '../modules/apple-image-capture/ios/AppleImageCaptureModule.swift',
  import.meta.url,
).pathname);
const source = readFileSync(sourcePath, 'utf8');
const podspec = readFileSync(decodeURIComponent(new URL(
  '../modules/apple-image-capture/ios/AppleImageCapture.podspec',
  import.meta.url,
).pathname), 'utf8');
const packageManifest = readFileSync(decodeURIComponent(new URL(
  '../modules/apple-image-capture/Package.swift',
  import.meta.url,
).pathname), 'utf8');

describe('Apple image native source compatibility contract', () => {
  it('hides iOS 27 image APIs from the normal Xcode 26 compiler', () => {
    const guardedBlocks = source.match(/#if compiler\(>=6\.4\) && canImport\(FoundationModels\)/g) ?? [];
    expect(guardedBlocks.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('@available(iOS 27.0, macOS 27.0, *)');
    expect(source).toContain('Attachment(image).label("selected-image")');
  });

  it('checks byte bounds before ImageIO metadata parsing and cancels on module teardown', () => {
    const inspectStart = source.indexOf('private static func inspect(url: URL)');
    const inputLimit = source.indexOf('try AppleImageBounds.validateInputBytes(inputBytes)', inspectStart);
    const imageSource = source.indexOf('CGImageSourceCreateWithURL', inspectStart);
    expect(inspectStart).toBeGreaterThan(-1);
    expect(inputLimit).toBeGreaterThan(inspectStart);
    expect(imageSource).toBeGreaterThan(inputLimit);
    expect(source).toContain('OnDestroy {');
    expect(source).toContain('await self.operations.cancelAll()');
    expect(source).toContain('withTaskCancellationHandler');
    expect(source).toContain('request.cancel()');
  });

  it('keeps XCTest sources out of the application pod and the bounds library target', () => {
    expect(podspec).toContain("s.source_files = 'AppleImageCaptureBounds.swift', 'AppleImageCaptureModule.swift', 'AppleImageAnalysisCoordinator.swift'");
    expect(podspec).not.toContain("s.source_files = '**/*");
    expect(packageManifest).toContain('"AppleImageCaptureModule.swift"');
    expect(packageManifest).toContain('"Tests"');
    expect(packageManifest).toContain('sources: ["AppleImageCaptureBounds.swift", "AppleImageAnalysisCoordinator.swift"]');
  });
});
