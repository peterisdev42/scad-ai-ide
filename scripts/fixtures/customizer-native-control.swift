import AppKit
import ApplicationServices

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func describe(_ element: AXUIElement, _ path: String) -> [String: Any] {
    var result: [String: Any] = ["path": path]
    for key in [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, kAXValueAttribute, kAXMinValueAttribute, kAXMaxValueAttribute, kAXEnabledAttribute, kAXMenuItemMarkCharAttribute] {
        if let value = attribute(element, key) {
            if let string = value as? String { result[key] = String(string.prefix(4096)) }
            else if let number = value as? NSNumber { result[key] = number }
        }
    }
    return result
}
@main
struct NativeControl {
    static func main() {
        do { try run() }
        catch { fputs("Native control error: \(error)\n", stderr); exit(1) }
    }
    static func run() throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        let args = CommandLine.arguments
        guard args.count >= 4, let pid = Int32(args[1]), AXIsProcessTrusted(),
              let running = NSRunningApplication(processIdentifier: pid),
              running.bundleURL?.standardizedFileURL.path == URL(fileURLWithPath: args[2]).standardizedFileURL.path else {
            throw NSError(domain: "CustomizerNativeControl", code: 1, userInfo: [NSLocalizedDescriptionKey: "Require Accessibility trust and exact isolated PID/bundle"])
        }
        let app = AXUIElementCreateApplication(pid)
        running.activate(options: [.activateAllWindows])
        let activationDeadline = Date().addingTimeInterval(3)
        while !running.isActive && Date() < activationDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
        let operation = args[3]
        var output: Any = [:]
        if operation == "app" {
            var names: CFArray?
            let error = AXUIElementCopyAttributeNames(app, &names)
            let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
            var menus: [[String: Any]] = []
            if let bar = attribute(app, kAXMenuBarAttribute) {
                menus = children(unsafeBitCast(bar, to: AXUIElement.self)).map { describe($0, "menu") }
            }
            output = ["active": running.isActive, "attributeError": error.rawValue, "attributes": names as? [String] ?? [], "windows": windows.enumerated().map { describe($0.element, String($0.offset)) }, "menus": menus]
        } else if operation == "enable-accessibility" {
            let result = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
            output = ["enhancedUserInterfaceSetError": result.rawValue]
        } else if operation == "dock" {
            running.activate(options: [.activateAllWindows])
            guard args.count == 5, ["Customizer", "Editor"].contains(args[4]),
                  let bar = attribute(app, kAXMenuBarAttribute) else { throw NSError(domain: "NativeControl", code: 2) }
            var matches: [AXUIElement] = []
            func visit(_ element: AXUIElement, _ depth: Int) {
                if depth > 8 { return }
                if attribute(element, kAXRoleAttribute) as? String == kAXMenuItemRole && attribute(element, kAXTitleAttribute) as? String == args[4] { matches.append(element) }
                for child in children(element) { visit(child, depth + 1) }
            }
            visit(unsafeBitCast(bar, to: AXUIElement.self), 0)
            guard matches.count == 1 else { throw NSError(domain: "NativeControl", code: 3, userInfo: [NSLocalizedDescriptionKey: "Expected one native menu item, found \(matches.count)"] ) }
            let item = matches[0]
            let mark = attribute(item, kAXMenuItemMarkCharAttribute) as? String ?? ""
            if mark.isEmpty { guard AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else { throw NSError(domain: "NativeControl", code: 4) } }
            output = describe(item, "native menu")
        } else if operation == "key" {
            guard args.count == 5, CGPreflightPostEventAccess(), let code = UInt16(args[4]), [96,48,123,124,125,126,36,49,51].contains(code) else { throw NSError(domain: "NativeControl", code: 5) }
            running.activate(options: [.activateAllWindows])
            CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)?.postToPid(pid)
            CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)?.postToPid(pid)
            output = ["postedToPID": pid, "keyCode": code]
        } else {
            guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], let window = windows.first(where: { (attribute($0, kAXTitleAttribute) as? String ?? "").contains("model.scad") }) else { throw NSError(domain: "NativeControl", code: 6) }
            if operation == "dump" {
                var entries: [[String: Any]] = []
                func visit(_ element: AXUIElement, _ path: String, _ depth: Int) {
                    if depth > 20 || entries.count >= 2000 { return }
                    entries.append(describe(element, path))
                    for (index, child) in children(element).enumerated() { visit(child, path + "." + String(index), depth + 1) }
                }
                visit(window, "0", 0)
                output = entries
            } else {
                guard args.count >= 5 else { throw NSError(domain: "NativeControl", code: 7) }
                var target = window
                for component in args[4].split(separator: ".").dropFirst() {
                    guard let index = Int(component), children(target).indices.contains(index) else { throw NSError(domain: "NativeControl", code: 8) }
                    target = children(target)[index]
                }
                if operation == "set" {
                    guard args.count == 6, let data = args[5].data(using: .utf8) else { throw NSError(domain: "NativeControl", code: 9) }
                    let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
                    guard AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, value as CFTypeRef) == .success else { throw NSError(domain: "NativeControl", code: 10) }
                } else if operation == "focus" {
                    guard AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw NSError(domain: "NativeControl", code: 11) }
                } else {
                    let actions = ["press": kAXPressAction, "increment": kAXIncrementAction, "decrement": kAXDecrementAction, "confirm": kAXConfirmAction]
                    guard let action = actions[operation], AXUIElementPerformAction(target, action as CFString) == .success else { throw NSError(domain: "NativeControl", code: 12) }
                }
                output = describe(target, args[4])
            }
        }
        print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
