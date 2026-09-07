Pod::Spec.new do |s|
  s.name = 'MindwtrWatchConnectivity'
  s.version = '1.0.0'
  s.summary = 'Mindwtr iPhone receiver for the Apple Watch companion app'
  s.description = 'Receives validated WatchConnectivity operations and durably queues them for Mindwtr.'
  s.homepage = 'https://github.com/dongdongbh/Mindwtr'
  s.license = { type: 'AGPL-3.0-only' }
  s.author = { 'Mindwtr' => 'dongdongli@dongdongli.com' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.0'
  s.source = { git: 'https://github.com/dongdongbh/Mindwtr.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AudioToolbox', 'WatchConnectivity'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
