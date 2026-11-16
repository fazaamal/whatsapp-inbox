// Grab evenly spaced still frames from a video with macOS's own AVFoundation,
// so Claude (which can look at images, not video) can see what's in it. No
// ffmpeg needed. Compiled once by src/video.js.
//
//   video-frames <video> <out-dir> <max-frames>
//
// Prints JSON: {"duration": s, "width": px, "height": px, "hasAudio": bool,
// "frames": [{"file": path, "at": s}, ...]}
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

// One decimal place, without 6.4000000000000004 in the JSON.
func tenths(_ x: Double) -> Decimal { Decimal(string: String(format: "%.1f", x))! }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(("video-frames: " + message + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count == 4, let maxFrames = Int(args[3]), maxFrames > 0 else {
  fail("usage: video-frames <video> <out-dir> <max-frames>")
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let duration = CMTimeGetSeconds(asset.duration)
guard duration.isFinite, duration > 0 else { fail("could not read the video's length") }
let videoTrack = asset.tracks(withMediaType: .video).first
guard let track = videoTrack else { fail("no video track") }
let size = track.naturalSize.applying(track.preferredTransform)

// About one frame every 4 seconds, but at least 3 for clips over 2 s and at
// most maxFrames, taken from the middle of each slice (the very first frame
// is often black).
let atLeast = min(maxFrames, 3, max(1, Int(duration.rounded(.up)) - 1))
let count = max(atLeast, min(maxFrames, Int((duration / 4).rounded(.up))))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true // phone videos come out upright
generator.maximumSize = CGSize(width: 1024, height: 1024)
generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)

var frames: [[String: Any]] = []
for i in 0..<count {
  let seconds = (Double(i) + 0.5) * duration / Double(count)
  var actual = CMTime.zero
  guard let image = try? generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: &actual) else { continue }
  let file = outDir.appendingPathComponent(String(format: "frame-%02d.jpg", i + 1))
  guard let dest = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary)
  if CGImageDestinationFinalize(dest) {
    frames.append(["file": file.path, "at": tenths(CMTimeGetSeconds(actual))])
  }
}
if frames.isEmpty { fail("could not read any frames") }

let result: [String: Any] = [
  "duration": tenths(duration),
  "width": Int(abs(size.width)),
  "height": Int(abs(size.height)),
  "hasAudio": !asset.tracks(withMediaType: .audio).isEmpty,
  "frames": frames,
]
let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
