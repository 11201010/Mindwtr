Pod::Spec.new do |s|
  s.name = 'MindwtrIosSceneLifecycle'
  s.version = '1.0.0'
  s.summary = 'Mindwtr iOS scene lifecycle diagnostics bridge'
  s.description = 'Drains bounded, privacy-safe native scene lifecycle diagnostics into the app log.'
  s.homepage = 'https://github.com/dongdongbh/Mindwtr'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Mindwtr' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/dongdongbh/Mindwtr.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
