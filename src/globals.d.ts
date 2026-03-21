declare function require(moduleName: string): any

declare function setTimeout(callback: () => void, ms: number): number
declare function clearTimeout(id: number): void

declare const process: {
    platform: string
    arch: string
    env: Record<string, string | undefined>
    cwd(): string
}
