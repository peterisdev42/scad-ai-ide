import { mountPreview } from './generated/preview.js'
const root=document.querySelector('#preview-root')
let applied=[]
function applyTheme(mode,colors={}){
  const light=mode==='light'
  document.body.classList.toggle('vscode-light',light)
  document.body.classList.toggle('vscode-dark',!light)
  document.body.dataset.vscodeThemeKind=light?'vscode-light':'vscode-dark'
  document.body.dataset.vscodeThemeId=light?'Default Light Modern':'Default Dark Modern'
  for(const key of applied)document.body.style.removeProperty(key)
  applied=[]
  for(const [key,value] of Object.entries(colors)){
    if(/^--vscode-[a-zA-Z0-9-]+$/.test(key)&&typeof value==='string'&&CSS.supports('color',value)){
      document.body.style.setProperty(key,value);applied.push(key)
    }
  }
}
applyTheme(new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light')
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='scad-demo-theme')return
  if(event.data.theme==='light'||event.data.theme==='dark')applyTheme(event.data.theme,event.data.colors)
})
const view=mountPreview(root,new URL('./generated/cheese.3mf',import.meta.url),text=>{root.dataset.status=text})
let visible=true
function update(){view.setActive(visible&&!document.hidden)}
document.addEventListener('visibilitychange',update)
if('IntersectionObserver' in window)new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()}).observe(root)
window.addEventListener('pagehide',event=>{if(event.persisted)view.setActive(false);else view.dispose()})
window.addEventListener('pageshow',update)
