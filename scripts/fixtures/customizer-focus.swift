import AppKit
import Foundation

// Test-only foreground activation. Refuse a normal user window even if the
// caller supplied its PID accidentally: both app bundle and test flags match.
guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleURL?.standardizedFileURL.path == URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL.path else {
    fputs("Test application identity mismatch\n", stderr); exit(2)
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/bin/ps")
process.arguments = ["-p", String(pid), "-o", "command="]
let pipe = Pipe()
process.standardOutput = pipe
try process.run()
let data = pipe.fileHandleForReading.readDataToEndOfFile()
process.waitUntilExit()
let command = String(data: data, encoding: .utf8) ?? ""
guard command.contains("--extensionTestsPath"), command.contains("--extensionDevelopmentPath") else {
    fputs("Refusing activation outside an explicit Extension Host test\n", stderr); exit(3)
}
let activated = app.activate(options: [.activateAllWindows])
print("Native test application activation requested: \(activated)")
