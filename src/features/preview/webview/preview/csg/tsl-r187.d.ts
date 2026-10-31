// @types/three currently stops at r186. This public r187 surface override API
// is the sole additional declaration; remove it when the upstream types catch up.
import type { ContextNode, Node } from 'three/webgpu'
declare module 'three/tsl' {
    export function overrideNodes(overrides: [Node, Node | ((builder: unknown) => Node)][], flowNode?: Node | null, shaderStage?: 'vertex' | 'fragment' | null): ContextNode & { value: { inlineVaryings: boolean } }
}
