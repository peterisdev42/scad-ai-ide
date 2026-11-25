import { initialize, getService, IEditorService, IWorkbenchLayoutService, IThemeService, type EditorInput, type IEditorGroup } from '@codingame/monaco-vscode-api'
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override'
import { SimpleEditorPane, SimpleEditorInput, registerEditorPane, registerEditor, RegisteredEditorPriority, Parts } from '@codingame/monaco-vscode-workbench-service-override/common'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override/common'
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getNotificationServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import getWorkspaceTrustServiceOverride from '@codingame/monaco-vscode-workspace-trust-service-override'
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override'
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'
import { RegisteredFileSystemProvider, RegisteredReadOnlyFile, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override'
import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions'
import 'vscode/localExtensionHost'
import * as vscode from 'vscode'
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-theme-seti-default-extension'

const root=document.getElementById('workbench')!
const boot=document.getElementById('boot')!
const folder=vscode.Uri.file('/cheese-demo')
const source=vscode.Uri.joinPath(folder,'cheese.scad')
const previewId='scad-ai-ide.demo.preview'
const asset=(name:string)=>new URL('../../../assets/'+name,window.location.href)
const previewUrl=new URL('../../preview.html',window.location.href)
const options={pinned:true,preserveFocus:false}

// The marketing page is the theme authority; all frames are same-origin.
type DemoTheme='light'|'dark'
function websiteTheme():DemoTheme{
  try{
    const mode=window.parent.document.documentElement.dataset.theme
    if(mode==='light'||mode==='dark')return mode
  }catch{}
  return new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light'
}
let desiredTheme=websiteTheme()
document.documentElement.dataset.demoTheme=desiredTheme
const themeName=(mode:DemoTheme)=>mode==='dark'?'Dark Modern':'Light Modern'
const previewFrames=new Set<HTMLIFrameElement>()
let sendTheme:(frame:HTMLIFrameElement)=>void=()=>{}


// The v38 worker service accepts the same URL/options contract as the upstream demo.
class Worker {
  constructor(public url:URL,public options:WorkerOptions){}
}
const workers:Record<string,Worker>={
  editorWorkerService:new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js',import.meta.url),{type:'module'}),
  TextMateWorker:new Worker(new URL('@codingame/monaco-vscode-textmate-service-override/worker',import.meta.url),{type:'module'})
}
window.MonacoEnvironment={
  getWorkerUrl(_id,label){return workers[label]?.url.toString()},
  getWorkerOptions(_id,label){return workers[label]?.options}
}

class PreviewInput extends SimpleEditorInput {
  constructor(resource:vscode.Uri){
    super(resource)
    this.setName(resource.path.split('/').pop()!)
    this.setTitle(resource.path)
    this.setDescription('cheese-demo')
  }
  get typeId(){return previewId}
  override matches(other:EditorInput | unknown){return other instanceof PreviewInput && other.resource?.toString()===this.resource?.toString()}
}
class PreviewPane extends SimpleEditorPane {
  constructor(group:IEditorGroup){super(previewId,group)}
  initialize(){
    const node=document.createElement('div')
    node.style.cssText='width:100%;height:100%;overflow:hidden'
    return node
  }
  async renderInput(){
    const frame=document.createElement('iframe')
    frame.title='SCAD AI IDE Preview'
    const url=new URL(previewUrl)
    url.searchParams.set('theme',desiredTheme)
    frame.src=url.href
    previewFrames.add(frame)
    frame.addEventListener('load',()=>sendTheme(frame))
    frame.style.cssText='display:block;border:0;width:100%;height:100%'
    this.container.replaceChildren(frame)
    return {dispose(){previewFrames.delete(frame);frame.remove()}}
  }
}
registerEditorPane(previewId,'OpenSCAD Preview',PreviewPane,[PreviewInput])
{ const glob='*.scad'
  registerEditor(glob,{
    id:previewId,label:'OpenSCAD Preview',
    priority:{editor:RegisteredEditorPriority.option,
      diff:RegisteredEditorPriority.option,merge:RegisteredEditorPriority.option}
  },{singlePerResource:true},{
    async createEditorInput(input){return {editor:new PreviewInput(input.resource)}}
  })
}

const extension=registerExtension({
  name:'scad-preview-demo',publisher:'scad-ai-ide',version:'1.0.0',engines:{vscode:'*'},
  contributes:{
    languages:[{id:'openscad',aliases:['OpenSCAD','openscad'],extensions:['.scad']}],
    grammars:[{language:'openscad',scopeName:'source.openscad',path:'./openscad.tmLanguage.json'}],
    commands:[
      {command:'scad-demo.showPreview',title:'Open as Preview',icon:'$(preview)'},
      {command:'scad-demo.showSource',title:'Reopen as source file',icon:'$(file-code)'}
    ],
    menus:{'editor/title':[
      {command:'scad-demo.showPreview',group:'navigation@2',when:"resourceExtname == .scad && activeEditor != "+previewId},
      {command:'scad-demo.showSource',group:'navigation@2',when:"resourceExtname == .scad && activeEditor == "+previewId}
    ]}
  }
},ExtensionHostKind.LocalProcess)
extension.registerFileUrl('./openscad.tmLanguage.json',new URL('../../syntaxes/openscad.tmLanguage.json',import.meta.url).href,'application/json')

async function start(){
  const response=await fetch(asset('cheese.scad'))
  if(!response.ok)throw new Error('Failed to load cheese.scad')
  const scad=new Uint8Array(await response.arrayBuffer())
  const fs=new RegisteredFileSystemProvider(false)
  fs.registerFile(new RegisteredReadOnlyFile(source,async()=>scad,scad.length))
  registerFileSystemOverlay(1,fs)
  await initUserConfiguration(JSON.stringify({
    'workbench.colorTheme':themeName(desiredTheme),'workbench.iconTheme':'vs-seti',
    'workbench.startupEditor':'none','workbench.editor.enablePreview':false,
    'workbench.editor.showTabs':'multiple','workbench.sideBar.location':'left',
    'workbench.activityBar.location':'default','workbench.statusBar.visible':true,
    'workbench.secondarySideBar.defaultVisibility':'hidden','window.titleBarStyle':'custom',
    'window.commandCenter':true,'window.menuBarVisibility':'compact','window.title':'cheese-demo',
    'editor.readOnly':true,'files.readonlyInclude':{'**/cheese-demo/**':true},
    'editor.minimap.enabled':true,'telemetry.telemetryLevel':'off',
    'extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,
    'security.workspace.trust.enabled':false,'update.mode':'none'
  }))
  await initialize({
    ...getWorkbenchServiceOverride(),
    ...getConfigurationServiceOverride(),
    ...getExtensionServiceOverride({enableWorkerExtensionHost:false}),
    ...getExplorerServiceOverride(),
    ...getThemeServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getModelServiceOverride(),
    ...getNotificationServiceOverride(),
    ...getPreferencesServiceOverride(),
    ...getStorageServiceOverride(),
    ...getLifecycleServiceOverride(),
    ...getEnvironmentServiceOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getWorkspaceTrustServiceOverride(),
    ...getLogServiceOverride(),
    ...getDialogsServiceOverride()
  },root,{
    enableWorkspaceTrust:false,
    workspaceProvider:{workspace:{folderUri:folder},trusted:true,async open(){return false}},
    defaultLayout:{force:true,views:[{id:'workbench.view.explorer'}]},
    productConfiguration:{nameShort:'SCAD AI IDE',nameLong:'SCAD AI IDE Demo'}
  },{userHome:vscode.Uri.file('/')})
  await extension.whenReady()
  const api=await extension.getApi()
  const themeService=await getService(IThemeService)
  // Pass actual Code-OSS color tokens to the shared Preview WebView.
  const colorKeys=["foreground","disabledForeground","descriptionForeground","errorForeground","editor.background","editor.foreground","editorError.foreground","editorWarning.foreground","editorGhostText.border","editorWidget.background","editorWidget.foreground","editorWidget.border","panel.background","panel.foreground","panel.border","panelTitle.foreground","sideBar.background","sideBar.foreground","sideBar.border","titleBar.activeBackground","titleBar.activeForeground","activityBar.background","activityBar.foreground","activityBar.inactiveForeground","activityBar.activeBorder","statusBar.background","statusBar.foreground","tab.activeBackground","tab.activeForeground","tab.activeBorderTop","tab.inactiveBackground","tab.inactiveForeground","focusBorder","input.background","input.foreground","input.border","input.placeholderForeground","inputOption.activeBackground","inputOption.activeBorder","inputOption.activeForeground","dropdown.background","dropdown.border","dropdown.foreground","dropdown.listBackground","button.background","button.foreground","button.hoverBackground","button.border","button.secondaryBackground","button.secondaryForeground","button.secondaryHoverBackground","list.activeSelectionBackground","list.activeSelectionForeground","list.hoverBackground","list.inactiveSelectionBackground","list.focusOutline","list.highlightForeground","toolbar.hoverBackground","widget.shadow","contrastBorder","scrollbarSlider.background","scrollbarSlider.hoverBackground","scrollbarSlider.activeBackground","charts.blue","charts.orange","charts.purple"]
  sendTheme=frame=>{
    const theme=themeService.getColorTheme()
    const colors:Record<string,string>={}
    for(const key of colorKeys){
      const value=theme.getColor(key)
      if(value)colors['--vscode-'+key.replaceAll('.','-')]=value.toString()
    }
    frame.contentWindow?.postMessage({type:'scad-demo-theme',theme:theme.type==='light'?'light':'dark',colors},location.origin)
  }
  function publishTheme(){
    const mode=themeService.getColorTheme().type==='light'?'light':'dark'
    root.dataset.demoTheme=mode
    document.documentElement.dataset.demoTheme=mode
    previewFrames.forEach(sendTheme)
  }
  themeService.onDidColorThemeChange(publishTheme)
  let themeQueue=Promise.resolve()
  function syncWebsiteTheme(){
    desiredTheme=websiteTheme()
    themeQueue=themeQueue.catch(()=>{}).then(async()=>{
      const config=api.workspace.getConfiguration('workbench')
      const name=themeName(desiredTheme)
      if(config.get('colorTheme')!==name)await config.update('colorTheme',name,true)
      publishTheme()
    }).catch(error=>console.error('Demo theme sync failed',error))
  }
  try{
    const observer=new MutationObserver(syncWebsiteTheme)
    observer.observe(window.parent.document.documentElement,{attributes:true,attributeFilter:['data-theme']})
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true})
  }catch{}
  syncWebsiteTheme()
  await themeQueue
  const editor=await getService(IEditorService)
  const layout=await getService(IWorkbenchLayoutService)
  const reopen=async(id:string)=>{await api.commands.executeCommand('reopenActiveEditorWith',id)}
  api.commands.registerCommand('scad-demo.showPreview',()=>reopen(previewId))
  api.commands.registerCommand('scad-demo.showSource',()=>reopen('default'))
  layout.setPartHidden(true,Parts.PANEL_PART)
  layout.setPartHidden(true,Parts.AUXILIARYBAR_PART)
  layout.setPartHidden(window.innerWidth<580,Parts.SIDEBAR_PART)
  await api.commands.executeCommand('workbench.view.explorer')
  if(window.innerWidth<580)layout.setPartHidden(true,Parts.SIDEBAR_PART)
  await editor.openEditor({resource:source,options:{...options,override:previewId}})
  // The native Activity Bar is visual context only in this product demo.
  // Inert preserves its layout/theme while suppressing pointer, focus and
  // keyboard interaction, including the bottom Accounts/Manage controls.
  let activityBar:HTMLElement|null=null
  const lockActivityBar=()=>{
    if(activityBar?.isConnected)return
    activityBar=root.querySelector<HTMLElement>('.part.activitybar')
    if(activityBar)activityBar.inert=true
  }
  lockActivityBar()
  const activityBarObserver=new MutationObserver(lockActivityBar)
  activityBarObserver.observe(root,{childList:true,subtree:true})
  window.addEventListener('pagehide',event=>{
    if(!event.persisted)activityBarObserver.disconnect()
  })
  root.dataset.workbenchReady='true'
  boot.hidden=true
}
start().catch(error=>{
  console.error('SCAD demo startup failed',error)
  boot.textContent='Unable to initialize VS Code Workbench: '+String(error)
  boot.dataset.error='true'
  const link=document.createElement('a');link.href=previewUrl.href;link.textContent='Open standalone 3D Preview';boot.append(document.createElement('br'),link)
})
