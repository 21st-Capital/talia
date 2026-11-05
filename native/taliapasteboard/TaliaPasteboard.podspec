Pod::Spec.new do |s|
  s.name         = "TaliaPasteboard"
  s.version      = "0.1.0"
  s.summary      = "Talia's secret copy: this phone only, and gone after a short while"
  s.homepage     = "https://github.com/21st-Capital/talia"
  s.license      = { :type => "Apache-2.0" }
  s.author       = "21st Capital"
  s.platform     = :ios, "15.0"
  s.source       = { :path => "." }
  s.source_files = "TaliaPasteboard.m"
  s.dependency "React-Core"
end
