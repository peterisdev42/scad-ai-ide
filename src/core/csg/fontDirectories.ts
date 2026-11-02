export function fontDirectoriesFromArgs(args: readonly string[]): string[] {
    const paths: string[] = []
    for (let i = 0; i < args.length; i++)
        if (args[i] === '--fontdir' && args[i + 1]) paths.push(args[++i])
        else if (args[i].startsWith('--fontdir=')) paths.push(args[i].slice(10))
    return paths
}
