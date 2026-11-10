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
    for key in [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, kAXValueAttribute, kAXMinValueAttribute, kAXMaxValueAttribute, kAXEnabledAttribute, kAXFocusedAttribute, kAXSelectedAttribute, kAXMenuItemMarkCharAttribute] {
        if let value = attribute(element, key) {
            if let string = value as? String { result[key] = String(string.prefix(attribute(element, kAXRoleAttribute) as? String == kAXTextAreaRole ? 65536 : 4096)) }
            else if let number = value as? NSNumber { result[key] = number }
        }
    }
    var actions: CFArray?
    if AXUIElementCopyActionNames(element, &actions) == .success { result["actions"] = actions as? [String] ?? [] }
    if let raw = attribute(element, kAXPositionAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
        var point = CGPoint.zero
        if AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgPoint, &point) { result["position"] = ["x": point.x, "y": point.y] }
    }
    if let raw = attribute(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
        var size = CGSize.zero
        if AXValueGetValue(unsafeBitCast(raw, to: AXValue.self), .cgSize, &size) { result["size"] = ["width": size.width, "height": size.height] }
    }
    return result
}
func scopedClick(_ target: AXUIElement, _ pid: pid_t, _ x: Double, _ y: Double) throws {
    guard CGPreflightPostEventAccess(), (0...1).contains(x), (0...1).contains(y),
          let rawPosition = attribute(target, kAXPositionAttribute), let rawSize = attribute(target, kAXSizeAttribute),
          CFGetTypeID(rawPosition) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else { throw NSError(domain: "NativeControl", code: 18) }
    var position = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(rawPosition, to: AXValue.self), .cgPoint, &position), AXValueGetValue(unsafeBitCast(rawSize, to: AXValue.self), .cgSize, &size), size.width > 0, size.height > 0 else { throw NSError(domain: "NativeControl", code: 19) }
    let point = CGPoint(x: position.x + x * size.width, y: position.y + y * size.height)
    let visible = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let hit = visible.first { window in
        guard let bounds = window[kCGWindowBounds as String] as? [String: Double], let rectangle = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
        return rectangle.contains(point) && (window[kCGWindowAlpha as String] as? Double ?? 1) > 0.01
    }
    guard NSRunningApplication(processIdentifier: pid)?.isActive == true, hit?[kCGWindowOwnerPID as String] as? Int32 == pid else { throw NSError(domain: "NativeControl", code: 20, userInfo: [NSLocalizedDescriptionKey: "Target control is not in the frontmost window at \(point); owner PID \(String(describing: hit?[kCGWindowOwnerPID as String])), layer \(String(describing: hit?[kCGWindowLayer as String])), alpha \(String(describing: hit?[kCGWindowAlpha as String]))"]) }
    for type in [CGEventType.leftMouseDown, .leftMouseUp] {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
        event?.flags = []
        event?.setIntegerValueField(.mouseEventClickState, value: 1)
        event?.post(tap: .cghidEventTap)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
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
        if !running.isActive { running.activate(options: [.activateAllWindows]) }
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
        } else if operation == "windows" {
            var entries: [[String: Any]] = []
            func visit(_ element: AXUIElement, _ path: String, _ depth: Int) {
                if depth > 20 || entries.count >= 2000 { return }
                entries.append(describe(element, path))
                for (index, child) in children(element).enumerated() { visit(child, path + "." + String(index), depth + 1) }
            }
            for (index, window) in (attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).enumerated() { visit(window, String(index), 0) }
            output = entries
        } else if operation == "menus" {
            guard let bar = attribute(app, kAXMenuBarAttribute) else { throw NSError(domain: "NativeControl", code: 2) }
            var entries: [[String: Any]] = []
            func visit(_ element: AXUIElement, _ path: String, _ depth: Int) {
                if depth > 8 || entries.count >= 2000 { return }
                entries.append(describe(element, path))
                for (index, child) in children(element).enumerated() { visit(child, path + "." + String(index), depth + 1) }
            }
            visit(unsafeBitCast(bar, to: AXUIElement.self), "menu", 0)
            output = entries
        } else if operation == "enable-accessibility" {
            let result = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
            output = ["enhancedUserInterfaceSetError": result.rawValue]
        } else if operation == "dock" {
            guard args.count == 5, ["Customizer", "Editor", "Console"].contains(args[4]),
                  let bar = attribute(app, kAXMenuBarAttribute) else { throw NSError(domain: "NativeControl", code: 2) }
            var matches: [AXUIElement] = []
            // Window has both Jump To -> Customizer and a direct visibility
            // toggle. Only the latter is the intended operation.
            for menu in children(unsafeBitCast(bar, to: AXUIElement.self)) where attribute(menu, kAXTitleAttribute) as? String == "Window" {
                for list in children(menu) where attribute(list, kAXRoleAttribute) as? String == kAXMenuRole {
                    matches += children(list).filter { attribute($0, kAXRoleAttribute) as? String == kAXMenuItemRole && attribute($0, kAXTitleAttribute) as? String == args[4] }
                }
            }
            guard matches.count == 1 else { throw NSError(domain: "NativeControl", code: 3, userInfo: [NSLocalizedDescriptionKey: "Expected one native menu item, found \(matches.count)"] ) }
            let item = matches[0]
            output = describe(item, "native menu")
            let mark = attribute(item, kAXMenuItemMarkCharAttribute) as? String ?? ""
            if mark.isEmpty { guard AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else { throw NSError(domain: "NativeControl", code: 4) } }
        } else if operation == "key" {
            guard args.count == 5, CGPreflightPostEventAccess(), let code = UInt16(args[4]), [96,48,123,124,125,126,36,49,51,115].contains(code) else { throw NSError(domain: "NativeControl", code: 5) }
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
                event?.flags = []
                event?.postToPid(pid)
            }
            output = ["postedToPID": pid, "keyCode": code]
        } else {
            var windows: [AXUIElement] = []
            let windowDeadline = Date().addingTimeInterval(8)
            repeat {
                windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
                if windows.contains(where: { (attribute($0, kAXTitleAttribute) as? String ?? "").contains("model.scad") }) { break }
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            } while Date() < windowDeadline
            guard let window = windows.first(where: { (attribute($0, kAXTitleAttribute) as? String ?? "").contains("model.scad") }) else { throw NSError(domain: "NativeControl", code: 6, userInfo: [NSLocalizedDescriptionKey: "The exact live process did not expose its model.scad AXWindow within 8 seconds"]) }
            if operation == "dump" {
                var entries: [[String: Any]] = []
                func visit(_ element: AXUIElement, _ path: String, _ depth: Int) {
                    if depth > 20 || entries.count >= 2000 { return }
                    entries.append(describe(element, path))
                    for (index, child) in children(element).enumerated() { visit(child, path + "." + String(index), depth + 1) }
                }
                visit(window, "0", 0)
                output = entries
            } else if operation == "preset" || operation == "choice" {
                guard args.count == 5, (operation == "preset" ? ["A", "B", "<design default>"] : ["Round", "Square"]).contains(args[4]) else { throw NSError(domain: "NativeControl", code: 22) }
                func elements(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
                    if depth > 20 { return [] }
                    return [element] + children(element).flatMap { elements($0, depth + 1) }
                }
                let all = elements(window)
                let shapeIndex = all.firstIndex(where: { attribute($0, kAXRoleAttribute) as? String == kAXStaticTextRole && attribute($0, kAXValueAttribute) as? String == "shape" })
                let selectedCombo = operation == "preset" ? all.first(where: { attribute($0, kAXDescriptionAttribute) as? String == "preset selection" }) : all.dropFirst((shapeIndex ?? all.count) + 1).first(where: { attribute($0, kAXRoleAttribute) as? String == kAXMenuButtonRole })
                guard let combo = selectedCombo,
                      AXUIElementPerformAction(combo, kAXShowMenuAction as CFString) == .success else { throw NSError(domain: "NativeControl", code: 23) }
                RunLoop.current.run(until: Date().addingTimeInterval(0.15))
                let deadline = Date().addingTimeInterval(2)
                var candidates: [AXUIElement] = []
                repeat {
                    let popups = (attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { attribute($0, kAXSubroleAttribute) as? String == kAXDialogSubrole && (attribute($0, kAXTitleAttribute) as? String ?? "").isEmpty }
                    candidates = popups.flatMap { elements($0) }.filter { [kAXCellRole, kAXStaticTextRole].contains(attribute($0, kAXRoleAttribute) as? String ?? "") && attribute($0, kAXTitleAttribute) as? String == args[4] }
                    if candidates.count == 1 { break }
                    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
                } while Date() < deadline
                guard candidates.count == 1 else { throw NSError(domain: "NativeControl", code: 24, userInfo: [NSLocalizedDescriptionKey: "Expected one popup preset cell, observed \(candidates.count)"]) }
                guard let rawRow = attribute(candidates[0], kAXParentAttribute) else { throw NSError(domain: "NativeControl", code: 25) }
                let row = unsafeBitCast(rawRow, to: AXUIElement.self)
                guard let rawList = attribute(row, kAXParentAttribute) else { throw NSError(domain: "NativeControl", code: 25) }
                let list = unsafeBitCast(rawList, to: AXUIElement.self)
                let rows = children(list).filter { attribute($0, kAXRoleAttribute) as? String == kAXRowRole }
                guard let index = rows.firstIndex(where: { CFEqual($0, row) }), index < 32, running.isActive else { throw NSError(domain: "NativeControl", code: 26) }
                // Navigate the actual popup list in one call. Re-activating a
                // window between keystrokes would dismiss the popup.
                for code: CGKeyCode in [115] + Array(repeating: 125, count: index) + [36] {
                    for down in [true, false] {
                        let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
                        event?.flags = []
                        event?.postToPid(pid)
                    }
                    RunLoop.current.run(until: Date().addingTimeInterval(0.15))
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.15))
                output = describe(combo, "native preset")
            } else {
                guard args.count >= 5 else { throw NSError(domain: "NativeControl", code: 7) }
                var target = window
                if args[4].contains("|") {
                    var elements: [AXUIElement] = []
                    func collect(_ element: AXUIElement, _ depth: Int) {
                        if depth > 20 || elements.count >= 2000 { return }
                        elements.append(element)
                        for child in children(element) { collect(child, depth + 1) }
                    }
                    collect(window, 0)
                    let selector = args[4].components(separatedBy: "|")
                    if selector.count == 3 && selector[0] == "param" {
                        let names = ["width", "offgrid", "spin", "shape", "text", "checked", "vector"]
                        guard names.contains(selector[1]), let label = elements.firstIndex(where: { attribute($0, kAXRoleAttribute) as? String == kAXStaticTextRole && attribute($0, kAXValueAttribute) as? String == selector[1] }) else { throw NSError(domain: "NativeControl", code: 14) }
                        let following = elements.dropFirst(label + 1).prefix { !(attribute($0, kAXRoleAttribute) as? String == kAXStaticTextRole && names.contains(attribute($0, kAXValueAttribute) as? String ?? "")) }
                        guard let control = following.first(where: { attribute($0, kAXRoleAttribute) as? String == selector[2] }) else { throw NSError(domain: "NativeControl", code: 15) }
                        target = control
                    } else if selector.count == 2 && selector[0] == "cell" && ["A", "B", "<design default>"].contains(selector[1]) {
                        elements = []
                        for popup in windows { collect(popup, 0) }
                        let matches = elements.filter { attribute($0, kAXRoleAttribute) as? String == kAXCellRole && attribute($0, kAXTitleAttribute) as? String == selector[1] }
                        guard matches.count == 1 else { throw NSError(domain: "NativeControl", code: 21) }
                        target = matches[0]
                    } else if selector.count == 2 && selector[0] == "description" {
                        let matches = elements.filter { attribute($0, kAXDescriptionAttribute) as? String == selector[1] }
                        guard matches.count == 1 else { throw NSError(domain: "NativeControl", code: 16) }
                        target = matches[0]
                    } else { throw NSError(domain: "NativeControl", code: 17) }
                } else {
                    for component in args[4].split(separator: ".").dropFirst() {
                        guard let index = Int(component), children(target).indices.contains(index) else { throw NSError(domain: "NativeControl", code: 8) }
                        target = children(target)[index]
                    }
                }
                if operation == "inspect" {
                    output = describe(target, args[4])
                } else if operation == "click" {
                    guard args.count == 7, let x = Double(args[5]), let y = Double(args[6]) else { throw NSError(domain: "NativeControl", code: 18) }
                    try scopedClick(target, pid, x, y)
                } else if operation == "type" {
                    guard args.count == 6, args[5].utf16.count <= 256, CGPreflightPostEventAccess(),
                          attribute(target, kAXRoleAttribute) as? String == kAXTextFieldRole,
                          AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw NSError(domain: "NativeControl", code: 13) }
                    for down in [true, false] {
                        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
                        event?.flags = down ? .maskCommand : []
                        event?.postToPid(pid)
                    }
                    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
                    let characters = Array(args[5].utf16)
                    let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
                    event?.flags = []
                    characters.withUnsafeBufferPointer { event?.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: $0.baseAddress!) }
                    event?.postToPid(pid)
                    let release = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
                    release?.flags = []
                    release?.postToPid(pid)
                } else if operation == "set" {
                    guard args.count == 6, let data = args[5].data(using: .utf8) else { throw NSError(domain: "NativeControl", code: 9) }
                    let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
                    guard AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, value as CFTypeRef) == .success else { throw NSError(domain: "NativeControl", code: 10) }
                } else if operation == "focus" {
                    guard AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { throw NSError(domain: "NativeControl", code: 11) }
                } else {
                    let actions = ["press": kAXPressAction, "increment": kAXIncrementAction, "decrement": kAXDecrementAction, "confirm": kAXConfirmAction, "showmenu": kAXShowMenuAction]
                    guard let action = actions[operation], AXUIElementPerformAction(target, action as CFString) == .success else { throw NSError(domain: "NativeControl", code: 12) }
                }
                output = describe(target, args[4])
            }
        }
        print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    }
}
