import AppKit
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

@main
struct NativeWindowCapture {
    static func main() async {
        do { try await run() }
        catch { fputs("Native screenshot error: \(error)\n", stderr); exit(1) }
    }
    static func run() async throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        let args = CommandLine.arguments
        guard args.count == 4, let pid = Int32(args[1]),
              let app = NSRunningApplication(processIdentifier: pid),
              app.bundleURL?.standardizedFileURL.path == URL(fileURLWithPath: args[2]).standardizedFileURL.path else {
            throw NSError(domain: "CustomizerNativeWindow", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected the exact isolated application PID and bundle"])
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.width > 300 && $0.frame.height > 200 }
        let metadata: [[String: Any]] = windows.map { ["id": $0.windowID, "title": $0.title ?? "", "width": $0.frame.width, "height": $0.frame.height] }
        print(String(data: try JSONSerialization.data(withJSONObject: metadata), encoding: .utf8)!)
        guard let window = windows.first(where: { ($0.title ?? "").contains("model.scad") }) else { return }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(window.frame.width)
        configuration.height = Int(window.frame.height)
        configuration.showsCursor = false
        let captured = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let target = URL(fileURLWithPath: args[3]) as CFURL
        guard let output = CGImageDestinationCreateWithURL(target, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "CustomizerNativeWindow", code: 2)
        }
        CGImageDestinationAddImage(output, captured, nil)
        guard CGImageDestinationFinalize(output) else { throw NSError(domain: "CustomizerNativeWindow", code: 3) }
    }
}
