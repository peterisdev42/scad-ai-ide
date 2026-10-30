/** Extract the parser diagnostic without the CLI exit status and output noise. */
export function syntaxErrorMessage(error: Error): string | undefined {
    const diagnostic = error.message.match(/^\s*(?:ERROR:\s*)?Parser error:\s*([^\r\n]+)/im)?.[1]?.trim()
    if (!diagnostic) return undefined
    return /^syntax error\b/i.test(diagnostic) ? diagnostic[0].toUpperCase() + diagnostic.slice(1) : `Syntax error: ${diagnostic}`
}
