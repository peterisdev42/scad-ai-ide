import { mountPreview } from './generated/preview.js'
const root=document.querySelector('#preview-root')
const view=mountPreview(root,new URL('../assets/cheese.stl',import.meta.url),text=>{root.dataset.status=text})
let visible=true
function update(){view.setActive(visible&&!document.hidden)}
document.addEventListener('visibilitychange',update)
if('IntersectionObserver' in window)new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()}).observe(root)
window.addEventListener('pagehide',event=>{if(event.persisted)view.setActive(false);else view.dispose()})
window.addEventListener('pageshow',update)
