import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir, cpus } from 'node:os'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
const cli = process.env.SCAD_OPENSCAD_CSG_EXECUTABLE || process.env.SCAD_OPENSCAD_EXECUTABLE
if (!cli) throw new Error('Set SCAD_OPENSCAD_CSG_EXECUTABLE.')
const directory = await mkdtemp(join(tmpdir(), 'scad-pipeline-')),
    require = createRequire(import.meta.url)
let server, browser
try {
    await build({ entryPoints: ['src/core/csg/compile.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'core.cjs'), logLevel: 'silent' })
    const { compileCsg, configureCsgWorker } = require(join(directory, 'core.cjs'))
    configureCsgWorker(resolve('dist/csg-worker.mjs'))
    await build({
        stdin: {
            contents: `
        import {Stage} from './src/features/preview/webview/preview/Stage';
        import {readPreviewTheme} from './src/features/preview/webview/preview/Theme';
        window.setup=async forceWebGL=>{
            window.stage=new Stage(document.getElementById('root'),readPreviewTheme(getComputedStyle(document.body)),{forceWebGL});await stage.ready;
            const options={environment:'none',buildPlateOrigin:'center',renderMode:'solid',camera:'perspective',modelColor:null,shadows:true,fogDensity:0};
            stage.applySettings({options,get:key=>options[key],is:(key,value)=>options[key]===value,set:(key,value)=>options[key]=value});
            for(const type of ['ambient-light','directional-light','spot-light','point-light']){stage.addSceneObject(type,type);stage.setObjectVisible(type,false)}
            stage.initializeView(false);
        };
        window.draw=async(format,base64Data,modelVersion)=>{
            const timings={},started=performance.now();
            return new Promise((resolve,reject)=>{
                stage.setErrorCallback(reject);stage.setDeviceLossCallback(reject);
                stage.loadModelData({format,base64Data,modelVersion,isLoading:false,loadingMessage:'',export(){},sendToSlicer(){},reportPerformance:value=>Object.assign(timings,value),frameReady:(backend,firstFrameMs)=>resolve({backend,firstFrameMs,viewportMs:performance.now()-started,...timings})}).then(()=>stage.initializeView(false)).catch(reject);
            });
        };
    `,
            resolveDir: process.cwd(),
            sourcefile: 'pipeline.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: join(directory, 'fixture.js'),
        loader: { '.stl': 'binary', '.glsl': 'text' },
        logLevel: 'silent',
    })
    server = createServer(async (req, res) => {
        if (req.url === '/fixture.js') {
            res.setHeader('Content-Type', 'text/javascript')
            res.end(await readFile(join(directory, 'fixture.js')))
        } else res.end('<!doctype html><style>body{margin:0;--vscode-editor-background:#202020;--vscode-foreground:#ddd}#root{width:800px;height:600px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>')
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
    const samples = [],
        cached = new Map()
    const cases = { hole: 'difference(){cube(30,center=true);cylinder(h=40,r=5,center=true,$fn=32);}', grid: 'for(x=[0:3],y=[0:3])translate([x*15,y*15,0])difference(){cube(12);cylinder(h=15,r=3,$fn=16);}' }
    for (const forceWebGL of [false, true]) {
        cached.clear()
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.waitForFunction(() => typeof window.setup === 'function')
        await page.evaluate((force) => window.setup(force), forceWebGL)
        let version = 0
        for (const [name, source] of Object.entries(cases))
            for (const format of ['stl', 'csg', 'stl', 'csg']) {
                const started = performance.now(),
                    path = join(directory, `model.${format}`)
                const cacheKey = name + format,
                    cacheHit = cached.has(cacheKey)
                if (!cacheHit) execFileSync(cli, ['--export-format', format, '-D', `$preview=${format === 'csg'}`, '-o', path, '-'], { input: source, stdio: ['pipe', 'ignore', 'pipe'] })
                const cliMs = cacheHit ? 0 : performance.now() - started
                let bytes = cacheHit ? cached.get(cacheKey) : await readFile(path),
                    workerMs = 0,
                    coreTimings = {}
                if (format === 'csg' && !cacheHit) {
                    const workerStarted = performance.now()
                    bytes = await compileCsg(bytes.toString('utf8'), undefined, { cwd: directory })
                    workerMs = performance.now() - workerStarted
                    coreTimings = JSON.parse(bytes.toString()).timings
                }
                cached.set(cacheKey, bytes)
                const viewport = await page.evaluate(({ format, data, version }) => window.draw(format, data, version), { format, data: bytes.toString('base64'), version: ++version })
                samples.push({ name, format, cacheHit, width: 800, height: 600, shadows: true, cliMs, workerMs, ...coreTimings, ...viewport, totalMs: performance.now() - started, bytes: bytes.length })
                console.error(name, format, viewport.backend, Math.round(samples.at(-1).totalMs) + 'ms')
            }
        await page.evaluate(() => stage.dispose())
        await page.close()
    }
    const result = JSON.stringify({ cpu: cpus()[0].model, browser: browser.version(), samples }, null, 2) + '\n'
    if (process.argv[2]) await writeFile(process.argv[2], result)
    else process.stdout.write(result)
} finally {
    await browser?.close()
    if (server) await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
}
