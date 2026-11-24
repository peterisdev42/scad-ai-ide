import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'

// Standalone Monaco uses the real VS Code editor core; the website intentionally
// does not start an extension host or claim to provide the desktop LSP.
globalThis.MonacoEnvironment = {
    getWorker: () => new Worker(new URL('./editor.worker.js', import.meta.url), { type:'module' }),
}
monaco.languages.register({id:'openscad'})
monaco.languages.setMonarchTokensProvider('openscad', {
    tokenizer: {
        root: [
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],
            [/"([^"\\]|\\.)*"/, 'string'],
            [/\b(import|include|use|module|function|if|else|for|let|difference|union|intersection|translate|rotate|cube|sphere|cylinder)\b/, 'keyword'],
            [/\b\d+(?:\.\d+)?\b/, 'number'],
            [/[{}()[\]]/, '@brackets'],
            [/[a-zA-Z_$][\w$]*/, 'identifier'],
        ],
        comment: [[/[^*/]+/,'comment'],[/\*\//,'comment','@pop'],[/[*/]/,'comment']],
    },
})
monaco.editor.defineTheme('scad-dark-modern', {
    base:'vs-dark', inherit:true, rules:[],
    colors:{'editor.background':'#1f1f1f','editor.foreground':'#cccccc','editorLineNumber.foreground':'#6e7681','editorLineNumber.activeForeground':'#cccccc','editor.selectionBackground':'#264f78','editor.lineHighlightBackground':'#ffffff0a'},
})
export function mountSource(root:HTMLElement,source:string) {
    root.replaceChildren()
    const stylesheet=document.createElement('link')
    stylesheet.rel='stylesheet';stylesheet.href=new URL('./editor.css',import.meta.url).href
    document.head.append(stylesheet)
    const model=monaco.editor.createModel(source,'openscad',monaco.Uri.parse('file:///cheese-demo/cheese.scad'))
    const editor=monaco.editor.create(root,{
        model,theme:'scad-dark-modern',readOnly:true,domReadOnly:true,
        automaticLayout:true,fontSize:14,lineHeight:21,
        fontFamily:'"SFMono-Regular",Consolas,"Liberation Mono",monospace',
        minimap:{enabled:true},scrollBeyondLastLine:false,renderLineHighlight:'all',
        padding:{top:4},contextmenu:true,wordWrap:'on',
    })
    return {layout:()=>editor.layout(),dispose:()=>{editor.dispose();model.dispose();stylesheet.remove()}}
}
