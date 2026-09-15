Pod::Spec.new do |s|
  s.name = 'AppleImageCapture'
  s.version = '0.1.0'
  s.summary = 'Development-only on-device image capture evaluation for Mindwtr'
  s.description = 'Bounds a selected image and compares iOS Foundation Models image input with a Vision OCR baseline.'
  s.homepage = 'https://github.com/dongdongbh/Mindwtr'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Mindwtr' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/dongdongbh/Mindwtr.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ImageIO', 'Vision'
  s.weak_frameworks = 'FoundationModels'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = 'AppleImageCaptureBounds.swift', 'AppleImageCaptureModule.swift'
end
