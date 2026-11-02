// Maps macOS window IDs (CGWindowID) to the Mission Control desktop they live on.
//
//   spaces <windowId> [<windowId> ...]
//   -> {"current":"Desktop 8","windows":{"84458":"Desktop 8","56096":"Desktop 5"}}
//
// macOS has no public API for this; it uses the private SkyLight calls that tools
// like yabai use for *reading* spaces. Reading needs no special permission and no
// SIP change. Private API => may break with a macOS update; the server then simply
// shows no desktop number.
import Foundation

typealias CID = Int32
guard let handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) else {
  print("{\"error\":\"SkyLight not available\"}"); exit(0)
}
func sym<T>(_ name: String, _ type: T.Type) -> T? {
  guard let p = dlsym(handle, name) else { return nil }
  return unsafeBitCast(p, to: type)
}
guard
  let mainConnection = sym("SLSMainConnectionID", (@convention(c) () -> CID).self),
  let copyManagedDisplaySpaces = sym("SLSCopyManagedDisplaySpaces", (@convention(c) (CID) -> Unmanaged<CFArray>).self),
  let copySpacesForWindows = sym("SLSCopySpacesForWindows", (@convention(c) (CID, Int32, CFArray) -> Unmanaged<CFArray>).self)
else { print("{\"error\":\"SkyLight symbols missing\"}"); exit(0) }

let cid = mainConnection()
let displays = copyManagedDisplaySpaces(cid).takeRetainedValue() as? [[String: Any]] ?? []
var label: [Int: String] = [:]
var current: [String] = []
for (index, display) in displays.enumerated() {
  var desktop = 0
  for space in display["Spaces"] as? [[String: Any]] ?? [] {
    let id = space["id64"] as? Int ?? space["ManagedSpaceID"] as? Int ?? 0
    let type = space["type"] as? Int ?? 0 // 0 = normal desktop, 4 = full-screen app
    if type == 0 {
      desktop += 1
      label[id] = displays.count > 1 ? "Desktop \(desktop) · Bildschirm \(index + 1)" : "Desktop \(desktop)"
    } else {
      label[id] = displays.count > 1 ? "Vollbild · Bildschirm \(index + 1)" : "Vollbild"
    }
  }
  if let cur = display["Current Space"] as? [String: Any], let id = cur["id64"] as? Int ?? cur["ManagedSpaceID"] as? Int {
    current.append(label[id] ?? "Space \(id)")
  }
}

var windows: [String: String] = [:]
for arg in CommandLine.arguments.dropFirst() {
  guard let wid = Int(arg) else { continue }
  let spaces = copySpacesForWindows(cid, 0x7, [wid] as CFArray).takeRetainedValue() as? [Int] ?? []
  if let first = spaces.first { windows[arg] = label[first] ?? "Space \(first)" }
}
let out: [String: Any] = ["current": current, "windows": windows]
let data = try! JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
