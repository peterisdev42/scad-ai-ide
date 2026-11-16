// Reuse the isolated production-compatible Host runner; no Agent model is called here.
process.env.SCAD_HOST_LABEL='phase4'
await import('./test-assembly-host.mjs')
