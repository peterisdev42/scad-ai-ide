// Only workbench navigation here. Rendering is delegated to the real Preview WebView.
const workbench = document.querySelector('.workbench');
if (workbench) {
  const previewRoot = document.querySelector('#preview-root');
  const editorRoot = document.querySelector('#text-editor');
  const sourcePane = document.querySelector('[data-pane="source"]');
  const previewPane = document.querySelector('[data-pane="preview"]');
  const reopen = document.querySelector('[data-reopen]');
  const status = document.querySelector('[data-demo-status]');
  let mode = 'preview', file = 'source', preview, editor, previewLoad, editorLoad;
  const sourceUrl = new URL('./assets/cheese.scad', import.meta.url);
  const stlUrl = new URL('./assets/cheese.stl', import.meta.url);
  const setStatus = text => { status.textContent = text; };
  const fail = (root,error) => {
    const p = document.createElement('p');
    p.className = 'loading error';
    p.textContent = 'Unable to initialize demo: ' + (error?.message || String(error));
    root.replaceChildren(p);
  };
  const loadPreview = () => {
    if (preview || previewLoad) return;
    previewLoad = import('./demo/generated/preview.js').then(module => {
      if (mode !== 'preview') return;
      preview = module.mountPreview(previewRoot, stlUrl, setStatus);
    }).catch(error => { previewRoot.dataset.previewState='error';fail(previewRoot,error); }).finally(() => { previewLoad = undefined; });
  };
  const loadSource = () => {
    if (editor || editorLoad) return;
    editorLoad = Promise.all([import('./demo/generated/editor.js'), fetch(sourceUrl).then(r => { if (!r.ok) throw new Error('Could not load SCAD source');return r.text(); })])
      .then(([module,source]) => {
        if (mode !== 'source') return;
        editor = module.mountSource(editorRoot, source);
      }).catch(error => fail(editorRoot,error)).finally(() => { editorLoad=undefined; });
  };
  let inView = true;
  const updateActivity = () => preview?.setActive(mode === 'preview' && inView && !document.hidden);
  function select(next, target=file) {
    file = target;
    mode = target === 'mesh' ? 'preview' : next;
    workbench.dataset.mode=mode;
    workbench.dataset.file=file;
    previewPane.hidden=mode !== 'preview';
    sourcePane.hidden=mode !== 'source';
    document.querySelector('[data-breadcrumbs]').hidden=mode !== 'source';
    document.querySelector('[data-tab-name]').textContent=file === 'mesh' ? 'cheese.stl' : 'cheese.scad';
    document.querySelector('[data-tab-icon]').className='codicon '+(file==='mesh'?'codicon-file-binary mesh-file-icon':'codicon-file-code scad-file-icon');
    document.querySelector('[data-status-language]').textContent=file==='mesh'?'STL':'OpenSCAD';
    document.querySelectorAll('[data-open]').forEach(button=>button.classList.toggle('selected',button.dataset.open===file));
    // Same editor-title action and icon as the extension's reopen commands.
    const title=mode==='preview'?'Reopen as source file':'Open as Preview';
    reopen.title=title;reopen.setAttribute('aria-label',title);
    reopen.hidden=file==='mesh';
    document.querySelector('[data-reopen-icon]').className='codicon '+(mode==='preview'?'codicon-file-code':'codicon-preview');
    if (mode==='preview') { loadPreview();setStatus('Bundled STL'); }
    else { loadSource();setStatus('Read-only');requestAnimationFrame(()=>editor?.layout()); }
    updateActivity();
  }
  reopen.addEventListener('click',()=>select(mode==='preview'?'source':'preview','source'));
  document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.open==='mesh'?'preview':'source',button.dataset.open)));
  function setExplorer(open) {
    workbench.dataset.explorer=open?'open':'closed';
    document.querySelectorAll('[data-toggle-explorer]').forEach(button=>{button.setAttribute('aria-pressed',String(open));if(button.classList.contains('activity'))button.classList.toggle('active',open);});
  }
  document.querySelectorAll('[data-toggle-explorer]').forEach(button=>button.addEventListener('click',()=>setExplorer(workbench.dataset.explorer==='closed')));
  setExplorer(!matchMedia('(max-width: 680px)').matches);
  document.addEventListener('visibilitychange',updateActivity);
  if ('IntersectionObserver' in window) new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;updateActivity();}).observe(workbench);
  window.addEventListener('pagehide',event=>{if(event.persisted){preview?.setActive(false);return;}preview?.dispose();editor?.dispose();});
  window.addEventListener('pageshow',updateActivity);
  select('preview','source');
}
