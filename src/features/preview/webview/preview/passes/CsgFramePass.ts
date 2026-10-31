import { Camera, RenderTarget, Scene, Vector2 } from 'three'
import { MeshBasicNodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'

/** Submit bounded tiles and publish only a complete frame. Each fence gives the
 * GPU a bounded command buffer instead of one full-resolution CSG dispatch. */
export class CsgFramePass {
    private readonly target=new RenderTarget(1,1,{depthBuffer:true,stencilBuffer:true,samples:4})
    private readonly material=new MeshBasicNodeMaterial({depthTest:false,depthWrite:false,toneMapped:false})
    private readonly quad:QuadMesh
    private disposed=false
    private tileSize=32
    constructor(){this.material.fragmentNode=texture(this.target.texture);this.quad=new QuadMesh(this.material)}

    async render(renderer:WebGPURenderer,scene:Scene,camera:Camera,draw:(camera:Camera)=>void,current:()=>boolean):Promise<boolean>{
        const dimensions=renderer.getDrawingBufferSize(new Vector2()),width=dimensions.x,height=dimensions.y
        if(this.target.width!==width||this.target.height!==height)this.target.setSize(width,height)
        const target=renderer.getRenderTarget(),autoClear=renderer.autoClear,view=camera.clone()
        const shadows:Array<{shadow:{autoUpdate:boolean};autoUpdate:boolean}>=[]
        scene.traverse(object=>{const shadow=(object as unknown as {shadow?:{autoUpdate:boolean}}).shadow;if(shadow)shadows.push({shadow,autoUpdate:shadow.autoUpdate})})
        let first=true
        try{
            this.target.scissorTest=false;renderer.setRenderTarget(this.target);renderer.clear();renderer.autoClear=false
            for(let y=0;y<height;){
                const row=Math.min(this.tileSize,height-y)
                for(let x=0;x<width;){
                    if(this.disposed||!current())return false
                    const size=Math.min(this.tileSize,width-x),started=performance.now()
                    this.target.scissorTest=true;this.target.scissor.set(x,y,size,row)
                    renderer.setRenderTarget(this.target);draw(view);renderer.setRenderTarget(target)
                    await renderer.waitForGPU()
                    const elapsed=performance.now()-started
                    if(!first&&size<=16&&elapsed>250)throw new Error('CSG exceeded the GPU execution budget for a 16-pixel tile. The last complete frame is retained; choose Full mesh render for this model.')
                    if(!first){if(elapsed>12)this.tileSize=Math.max(16,this.tileSize/2);else if(elapsed<2)this.tileSize=Math.min(128,this.tileSize*2)}
                    first=false;for(const entry of shadows)entry.shadow.autoUpdate=false
                    x+=size
                }
                y+=row
            }
            if(this.disposed||!current())return false
            renderer.setRenderTarget(target);this.quad.render(renderer)
            return true
        }finally{
            for(const entry of shadows)entry.shadow.autoUpdate=entry.autoUpdate
            if(!this.disposed){renderer.setRenderTarget(target);renderer.autoClear=autoClear}
        }
    }
    dispose(){if(this.disposed)return;this.disposed=true;this.target.dispose();this.material.dispose()}
}
