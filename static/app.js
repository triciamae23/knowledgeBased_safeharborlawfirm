const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',file:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6',check:'M20 6L9 17l-5-5',clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M13 6l6 6-6 6',chevron:'M9 5l7 7-7 7',down:'M6 9l6 6 6-6',logout:'M9 4H3v16h6 M10 12h11 M17 8l4 4-4 4',compass:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M16 8l-3 5-5 3 3-5z',code:'M8 5l-7 7 7 7 M16 5l7 7-7 7 M14 3l-4 18',layers:'M12 2L2 7l10 5 10-5z M2 12l10 5 10-5 M2 17l10 5 10-5',folder:'M3 5h6l2 3h10v12H3z',book:'M12 5v16 M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1',edit:'M16 3l5 5-12 12H4v-5z M14 5l5 5',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',close:'M6 6l12 12 M6 18L18 6',list:'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',shield:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',image:'M3 3h18v18H3z M8 8h.01 M3 17l5-5 4 4 3-3 6 6',link:'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l2-2',video:'M3 5h13v14H3z M16 9l5-3v12l-5-3z',menu:'M3 6h18 M3 12h18 M3 18h18'};
const icon = (name,cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
let state, page='home', filter='all', query='', spaceId=null, departmentId=null, layout='list';
const admin = ()=>state.user.role==='admin';
const canEdit = d=>admin()||(state.user.can_submit_edits&&d?.id&&d.status==='published');
function editorSubmitButtons(d){return admin()?`<button type="submit" name="status" value="draft" class="secondary">Save unpublished</button><button type="submit" name="status" value="published" class="primary">${icon('check')} ${d.status==='published'?'Save changes':'Publish'}</button>`:'<button type="submit" name="status" value="pending" class="primary">Submit for approval</button>';}
function readerEditingControl(enabled){return `<fieldset class="folder-permissions"><legend>Reader editing</legend><label class="folder-checkbox"><input type="checkbox" name="can_submit_edits" ${enabled?'checked':''}><span>Allow edits for admin approval</span></label><p>This reader can propose changes to published pages they can access. Only an administrator can publish them. Leave unchecked for view-only access.</p></fieldset>`;}
async function approvals(){
  const target=$('#content');
  target.innerHTML='<p role="status">Loading submissions…</p>';
  try{
    const items=await api('revisions');
    if(page!=='approvals'||target!==$('#content'))return;
    target.innerHTML=`<section class="page-heading"><div><h1>${admin()?'Document approvals':'My submissions'}</h1><p>${admin()?'Review reader changes before publishing.':'Published pages stay unchanged until an administrator approves your edits.'}</p></div></section><div class="review-list">${items.map(r=>`<button class="review-row" data-review="${esc(r.id)}"><span><b>${esc(r.title)}</b><small>${esc(r.submitted_name)} · ${esc(new Date(r.submitted_at).toLocaleString())}</small></span><span class="review-status">${esc(({pending:'For approval',approving:'Approval in progress',approved:'Approved',rejected:'Rejected',conflict:'Needs a new edit'})[r.status]||r.status)}</span>${icon('chevron')}</button>`).join('')||'<p class="empty">No submissions yet.</p>'}</div>`;
    target.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>reviewSubmission(b.dataset.review));
  }catch(error){if(target===$('#content'))target.innerHTML=`<p class="form-error" role="alert">${esc(error.message)}</p>`;}
}
async function reviewSubmission(id){
  try{
    const r=await api('revisions/'+id);
    const reviewable=admin()&&['pending','approving'].includes(r.status);
    modal(`<h2 id="modal-title">${esc(r.title)}</h2><p>Submitted by ${esc(r.submitted_name)} · ${esc(r.status)}</p><div class="revision-comparison"><section><h3>Original at submission</h3><h4>${esc(r.base.title)}</h4><div class="document-body">${renderDocumentBody({...r.base,id:r.document_id})}</div></section><section><h3>Proposed update</h3><h4>${esc(r.proposed.title)}</h4><div class="document-body">${renderDocumentBody({...r.proposed,id:r.document_id})}</div></section></div><div class="form-error" role="alert"></div><div class="modal-actions">${reviewable?`${r.status==='pending'?'<button class="secondary" data-decision="reject">Reject</button>':''}<button class="primary" data-decision="approve">${r.status==='approving'?'Retry approval':'Approve & publish'}</button>`:'<button class="secondary" id="close-review">Close</button>'}</div>`);
    $('.modal').classList.add('revision-modal');
    $('#close-review')?.addEventListener('click',closeModal);
    document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=async()=>{
      const buttons=[...document.querySelectorAll('[data-decision]')];buttons.forEach(button=>button.disabled=true);
      try{await api('revisions/review',{id,decision:b.dataset.decision});closeModal();await refresh();toast(b.dataset.decision==='approve'?'Approved and published':'Submission rejected');}
      catch(error){const field=$('.revision-modal .form-error');if(field)field.textContent=error.message;else toast(error.message);buttons.forEach(button=>button.disabled=false);}
    });
  }catch(error){toast(error.message);}
}
async function api(path,data){const r=await fetch('/api/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const result=await r.json();if(!r.ok){if(r.status===401&&path!=='login')login();throw Error(result.error||'Something went wrong.');}return result;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3500);}
async function boot(){try{state=restrictWorkspace(await api('bootstrap'));page='home';spaceId=null;departmentId=null;query='';render();const linkedId=pageIdFromHash();if(linkedId)await openDocument(linkedId,false);}catch(e){login();}}
function pageIdFromHash(){const match=location.hash.match(/^#\/documents\/([1-9]\d*)$/);return match?Number(match[1]):null;}
let transparentLogoUrl;
function removeLogoMatte(img){
  if(!transparentLogoUrl){
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0);
    const frame=ctx.getImageData(0,0,canvas.width,canvas.height), pixels=frame.data;
    const background=Array.from(pixels.slice(0,3));
    // Find the two original ink colors, then undo their gray matte.
    // Recovering fractional coverage keeps the lettering edges smooth.
    const counts=[new Map(),new Map()];
    for(let i=0;i<pixels.length;i+=4){
      const color=Array.from(pixels.slice(i,i+3));
      if(Math.max(...color)-Math.min(...color)<50)continue;
      const group=color[2]>color[0]?0:1,key=color.join(',');
      counts[group].set(key,(counts[group].get(key)||0)+1);
    }
    const inks=counts.map(colors=>[...colors].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number));
    for(let i=0;i<pixels.length;i+=4){
      let bestError=Infinity,bestAlpha=0,bestInk=inks[0];
      for(const ink of inks){
        const direction=ink.map((value,c)=>value-background[c]);
        const alpha=Math.max(0,Math.min(1,direction.reduce((sum,value,c)=>sum+value*(pixels[i+c]-background[c]),0)/direction.reduce((sum,value)=>sum+value*value,0)));
        const error=direction.reduce((sum,value,c)=>sum+(pixels[i+c]-background[c]-alpha*value)**2,0);
        if(error<bestError){bestError=error;bestAlpha=alpha;bestInk=ink;}
      }
      for(let c=0;c<3;c++)pixels[i+c]=bestInk[c];
      pixels[i+3]=Math.round(bestAlpha*255);
    }
    ctx.putImageData(frame,0,0);
    transparentLogoUrl=canvas.toDataURL('image/png');
  }
  img.src=transparentLogoUrl;
  img.classList.remove('logo-pending');
}
// Image load events do not bubble; capture also covers logos added by later renders.
document.addEventListener('load',event=>{
  const img=event.target;
  if(img instanceof HTMLImageElement&&img.classList.contains('logo-pending'))removeLogoMatte(img);
},true);
function logo(){return `<img class="firm-logo${transparentLogoUrl?'':' logo-pending'}" src="${transparentLogoUrl||'/safe-harbor-logo.png'}" alt="Safe Harbor Law Firm" width="570" height="178">`;}
function login(){closeVsa();navigationVersion++;state=null;$('#app').innerHTML=`<main class="login"><section class="login-story"><div class="brand">${logo()}</div><div><span class="eyebrow">A LITTLE CLARITY GOES A LONG WAY</span><h1>Great work starts<br>with shared knowledge.</h1><p>A home for your team’s ideas, answers, and everything you learn along the way.</p><div class="story-art"><div class="art-doc">${icon('book')}<b>One source of truth.</b><span>Built together. Shared with everyone.</span><i></i><i></i><i></i></div><span class="art-check">${icon('check')}</span></div></div><small>A connected team. An organized mind.</small></section><section class="login-form"><form id="login-form"><span class="tiny-label">YOUR TEAM’S KNOWLEDGE, CONNECTED</span><h2>Welcome back</h2><p>Sign in to your knowledge workspace.</p><label>Email address<input type="email" name="email" placeholder="you@company.com" autocomplete="username" required></label><label>Password<input type="password" name="password" placeholder="Enter your password" autocomplete="current-password" required></label><div id="form-error" class="form-error" role="alert"></div><button class="primary login-submit">Sign in ${icon('arrow')}</button><p class="login-help">Need access? Contact your workspace administrator.</p></form><small class="login-footer">A little less searching. A lot more knowing.</small></section></main>`;$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;b.textContent='Signing in…';try{await api('login',Object.fromEntries(new FormData(e.target)));await boot();}catch(err){$('#form-error').textContent=err.message;b.disabled=false;b.innerHTML='Sign in '+icon('arrow');}};}
function nav(label,key,ic,count){return `<button class="nav-item ${page===key?'active':''}" data-nav="${key}">${icon(ic)}<span>${label}</span>${count!==undefined?`<small>${count}</small>`:''}</button>`;}
function departmentFolders(){
  const department=state.departments.find(d=>d.id===departmentId);
  return department?state.spaces.filter(f=>department.folder_ids.includes(f.id)):state.spaces;
}
function folderDropdown(){
  return `<details class="folder-dropdown" id="nav-folders"><summary>Folders ${icon('down')}</summary><div class="folder-dropdown-panel"><nav aria-label="Folders">${state.spaces.map(f=>`<button data-space="${f.id}" class="${page==='space'&&spaceId===f.id?'selected':''}">${icon('folder')}<span>${esc(f.name)}</span></button>`).join('')||'<p>No folders available. Contact your administrator for access.</p>'}</nav>${admin()?`<button class="folder-dropdown-create" data-action="add-space">${icon('plus')} Create folder</button>`:''}</div></details>`;
}
function bindFolderDropdown(){
  const menu=$('#nav-folders');
  menu.onkeydown=e=>{if(e.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}};
}
document.addEventListener('pointerdown',e=>{const menu=$('#nav-folders');if(menu&&!menu.contains(e.target))menu.open=false;});
function departmentCheckboxes(selected){
  return `<fieldset class="folder-permissions"><legend>Enabled departments</legend><p>Select the departments this reader may browse. Then enable their individual folders below.</p><div class="folder-checkbox-list">${state.departments.map(d=>`<label class="folder-checkbox"><input type="checkbox" name="department_ids" value="${esc(d.id)}" ${selected.includes(d.id)?'checked':''}>${icon('users')}<span>${esc(d.name)} <small>(${d.folder_ids.length} folders)</small></span></label>`).join('')}</div></fieldset>`;
}
function selectedDepartmentIds(form){return [...form.querySelectorAll('input[name="department_ids"]:checked')].map(input=>input.value);}
function departmentSettings(){
  return `<section class="settings-card"><h2>Department folders</h2><p>Assign folders to the departments from KB Category.xlsx. A folder may belong to more than one department. Only administrators can change these assignments.</p><div class="department-settings-list">${state.departments.map(d=>`<div class="department-settings-row"><div><b>${esc(d.name)}</b><small>${d.folder_ids.length} folders assigned</small></div><button type="button" class="secondary" data-map-department="${esc(d.id)}">Assign folders</button></div>`).join('')}</div><p>The Admin department does not grant the administrator role.</p></section>`;
}
function departmentFoldersModal(id){
  const department=state.departments.find(d=>d.id===id);
  modal(`<h2 id="modal-title">${esc(department.name)} folders</h2><p>Select folders belonging to this department. Readers still need individual folder access. Removing a folder revokes access through this department immediately.</p><form id="department-folders-form"><fieldset class="folder-permissions"><legend>Department folders</legend><div class="folder-checkbox-list">${state.spaces.map(f=>`<label class="folder-checkbox"><input type="checkbox" name="folder_ids" value="${f.id}" ${department.folder_ids.includes(f.id)?'checked':''}>${icon('folder')}<span>${esc(f.name)}</span></label>`).join('')||'<p>Create a folder from the Folders menu first.</p>'}</div></fieldset><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="secondary" id="cancel-department">Cancel</button><button class="primary">Save folders</button></div></form>`);
  $('#cancel-department').onclick=closeModal;
  $('#department-folders-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('departments/folders',{id,folder_ids:selectedFolderIds(e.target)});closeModal();await refresh();toast('Department folders updated');}catch(err){const error=$('#department-folders-form .form-error');if(error)error.textContent=err.message;else toast(err.message);button.disabled=false;}};
}
function render(){document.title=`${state.settings.workspace_name} · Knowledge`;const title=page==='home'?'Home':page==='approvals'?(admin()?'Approvals':'My submissions'):page==='settings'?'Administration':page==='published'?'Published pages':page==='drafts'?'Unpublished pages':page==='department'?state.departments.find(d=>d.id===departmentId)?.name:page==='space'?state.spaces.find(s=>s.id===spaceId)?.name:'All pages';$('#app').innerHTML=`<div class="reference-app"><button class="vsa-launcher" id="vsa-launcher" aria-controls="vsa-panel" aria-expanded="false">${icon('book')} KB Assistant</button><header class="global-header"><a class="brand" href="#" data-nav="home">${logo()}</a><nav class="global-nav" aria-label="Main navigation"><button data-nav="home" class="${page==='home'?'active':''}">Home</button><button data-nav="documents" class="${['documents','published','drafts','space','department','document'].includes(page)?'active':''}">Workspace</button>${folderDropdown()}${admin()?`<button data-nav="settings" class="${page==='settings'?'active':''}">Administration</button><button class="primary" data-action="new">Create</button>`:''}</nav><button class="global-search" id="header-search">${icon('search')}<span>Search knowledge</span></button><details class="account-menu"><summary aria-label="Account menu"><span class="avatar">${esc(state.user.name.split(' ').map(n=>n[0]).slice(0,2).join(''))}</span></summary><div class="account-dropdown"><b>${esc(state.user.name)}</b><small>${esc(state.user.email)}</small><span>${admin()?'Administrator':'Reader'}</span><button data-action="logout">${icon('logout')} Sign out</button></div></details></header><div class="library-shell"><aside class="folder-sidebar"><div class="space-identity"><span>${icon('book')}</span><div><b>${esc(state.settings.workspace_name)} workspace</b><small>Team knowledge base</small></div></div><nav class="workspace-nav" aria-label="Workspace navigation"><button data-nav="home" class="${page==='home'?'selected':''}">${icon('grid')} Home</button><button data-nav="documents" class="${page==='documents'?'selected':''}">${icon('file')} All pages</button><button data-nav="published" class="${page==='published'?'selected':''}">${icon('check')} Published</button>${admin()?`<button data-nav="drafts" class="${page==='drafts'?'selected':''}">${icon('edit')} Unpublished <small>${state.documents.filter(d=>d.status==='draft').length}</small></button>`:''}</nav><button class="sidebar-settings" data-nav="approvals">${icon('check')} ${admin()?'Approvals':'My submissions'}</button><div class="folder-section-heading"><span class="folder-title">DEPARTMENTS</span></div><nav id="department-tree" aria-label="Departments">${state.departments.map(d=>`<button class="folder-link ${page==='department'&&departmentId===d.id?'selected':''}" data-department="${esc(d.id)}">${icon('users')}<span>${esc(d.name)}</span><small>${state.documents.filter(doc=>d.folder_ids.includes(doc.space_id)).length}</small></button>`).join('')||'<p class="department-empty">No departments enabled. Contact your administrator for access.</p>'}</nav><div class="sidebar-note">${icon('book')}<strong>A home for your team’s knowledge</strong><p>Find answers. Share ideas.<br>Build something great together.</p></div>${admin()?'<button class="sidebar-settings" data-nav="settings">'+icon('settings')+' Workspace settings</button>':''}</aside><div class="workspace-main"><div class="workspace-breadcrumb"><span>${esc(state.settings.workspace_name)} workspace</span>${icon('chevron')}<span>${esc(page==='document'?'Page':title)}</span></div><main id="content"></main></div></div></div>`;if(page==='home')dashboard();else if(page==='settings')settings();else if(page==='approvals')approvals();else if(page==='document')readDoc();else overview();bindShell();$('#header-search').onclick=async()=>{await navigate('documents');$('#search')?.focus();};bindFolderDropdown();}
function bindShell(){document.querySelectorAll('[data-department]').forEach(b=>b.onclick=()=>{departmentId=b.dataset.department;spaceId=null;navigate('department');});$('#vsa-launcher').onclick=openVsa;document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=e=>{e.preventDefault();navigate(b.dataset.nav);});document.querySelectorAll('[data-space]').forEach(b=>b.onclick=()=>{spaceId=+b.dataset.space;departmentId=null;navigate('space');});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));}
let navigationVersion=0;
function restrictWorkspace(data){if(data.user.role==='admin')return data;const enabled=new Set(data.user.folder_ids||[]);return {...data,spaces:data.spaces.filter(f=>enabled.has(f.id)),documents:data.documents.filter(d=>d.status==='published'&&enabled.has(d.space_id))};}
async function navigate(p){const version=++navigationVersion;page=p;if(p!=='department')departmentId=null;filter='all';query='';if(state&&!admin()){state={...state,documents:[]};$('#content').innerHTML='<div class="access-loading" role="status">Checking your page access…</div>';try{const data=await api('bootstrap');if(version!==navigationVersion)return;state=restrictWorkspace(data);if(page==='space'&&!state.spaces.some(f=>f.id===spaceId)){spaceId=null;page='documents';}if(page==='department'&&!state.departments.some(d=>d.id===departmentId)){departmentId=null;page='documents';}if(page==='settings'||page==='drafts')page='documents';}catch(err){if(version===navigationVersion&&state){$('#content').innerHTML='<div class="empty">Unable to verify access. Refresh to try again.</div>';toast(err.message);}return;}}history.replaceState(null,'',location.pathname+location.search);render();}
async function action(a){if(a==='logout'){await api('logout',{});homeChatVersion++;homeChatMessages=[];homeChatPending=false;login();}if(a==='new')editor();if(a==='add-space')spaceModal();if(a==='menu')$('.sidebar').classList.toggle('open');}
function overview(){$('#content').innerHTML=`<section class="document-library"><div class="library-heading"><div><h1>${esc(page==='department'?state.departments.find(d=>d.id===departmentId)?.name:page==='space'?state.spaces.find(s=>s.id===spaceId)?.name:page==='published'?'Published pages':page==='drafts'?'Unpublished pages':'All pages')}</h1><p>${page==='drafts'?'Work in progress, ready for your next idea. Only administrators can see unpublished pages.':(admin()?'You have administrator access to all workspace pages.':'Only published pages in your enabled departments and folders appear here, including search results.')}</p></div>${admin()?`<button class="primary" data-action="new">${icon('plus')} Create page</button>`:''}</div><div class="library-tabs"><button data-nav="documents" class="${page==='documents'||page==='space'?'active':''}">All pages</button><button data-nav="published" class="${page==='published'?'active':''}">Published</button>${admin()?`<button data-nav="drafts" class="${page==='drafts'?'active':''}">Unpublished</button>`:''}</div><div class="reference-filters"><label class="search">${icon('search')}<input id="search" placeholder="Search pages…" aria-label="Search documents"></label><select id="sort" aria-label="Sort documents"><option value="recent">Last updated</option><option value="title">Title A–Z</option></select><select id="folder-filter" aria-label="Filter by folder"><option value="">All folders</option>${departmentFolders().map(s=>`<option value="${s.id}" ${page==='space'&&spaceId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select><select id="author-filter" aria-label="Filter by author"><option value="">Any author</option>${[...new Set(state.documents.map(d=>d.author))].map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter by publication status"><option value="all">All statuses</option><option value="published" ${page==='published'?'selected':''}>Published</option>${admin()?`<option value="draft" ${page==='drafts'?'selected':''}>Unpublished</option>`:''}</select></div><div class="list-summary"><span id="doc-count"></span><button class="text-button" id="hide-folders">Hide sidebar</button></div><div id="document-list"></div></section>`;listDocs();$('#search').oninput=e=>{query=e.target.value;listDocs();};$('#sort').onchange=listDocs;$('#author-filter').onchange=listDocs;$('#folder-filter').onchange=e=>{spaceId=e.target.value?+e.target.value:null;if(!departmentId)page=spaceId?'space':'documents';listDocs();};$('#status-filter').onchange=e=>{filter=e.target.value;listDocs();};$('#hide-folders').onclick=e=>{const shell=$('.library-shell');shell.classList.toggle('folders-hidden');e.target.textContent=shell.classList.contains('folders-hidden')?'Show sidebar':'Hide sidebar';};}
function relativeDate(s){const days=Math.max(0,Math.floor((Date.now()-new Date(s.replace(' ','T')+'Z'))/86400000));if(days===0)return 'Edited today';if(days===1)return 'Edited yesterday';if(days<30)return `Edited ${days} days ago`;if(days<365)return `Edited ${Math.floor(days/30)} month${Math.floor(days/30)===1?'':'s'} ago`;return `Edited ${Math.floor(days/365)} year${Math.floor(days/365)===1?'':'s'} ago`;}
function documentActions(d){modal(`<h2 id="modal-title">${esc(d.title)}</h2><p>${esc(d.space)} · ${d.status==='draft'?'Unpublished':'Published'}</p><div class="document-action-list"><button class="secondary" id="action-open">${icon('file')} View document</button>${canEdit(d)?`<button class="secondary" id="action-edit">${icon('edit')} Edit document</button>`:''}${admin()?`<button class="secondary" id="action-publish">${icon(d.status==='draft'?'check':'edit')} ${d.status==='draft'?'Publish':'Unpublish'}</button>`:''}</div><div class="form-error" role="alert"></div>`);$('#action-open').onclick=()=>{closeModal();openDocument(d.id);};if(canEdit(d))$('#action-edit').onclick=()=>{closeModal();editor(d);};if(admin()){$('#action-publish').onclick=async()=>{try{await api('documents',{...d,status:d.status==='draft'?'published':'draft'});closeModal();await refresh();toast(d.status==='draft'?'Document published':'Document unpublished');}catch(e){$('.form-error').textContent=e.message;}};}}
function date(s){return new Date(s.replace(' ','T')+'Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
function listDocs(){const status=$('#status-filter').value;const folder=$('#folder-filter').value;const author=$('#author-filter').value;let docs=state.documents.filter(d=>(!departmentId||state.departments.find(dep=>dep.id===departmentId)?.folder_ids.includes(d.space_id))&&(!folder||d.space_id===+folder)&&(status==='all'||d.status===status)&&(!author||d.author===author)&&(`${d.title} ${d.body} ${d.space}`.toLowerCase().includes(query.toLowerCase())));if($('#sort').value==='title')docs.sort((a,b)=>a.title.localeCompare(b.title));$('#doc-count').textContent=`${docs.length} page${docs.length===1?'':'s'}`;$('#document-list').innerHTML=docs.length?`<div class="reference-document-list"><div class="document-column-headings"><span>Title</span><span>Status</span><span>Folder</span><span>Last updated</span><span></span></div>${docs.map(d=>`<div class="reference-row"><button class="document-link" data-doc="${d.id}">${icon('file')}<strong>${esc(d.title)}</strong></button><span class="badge ${d.status}"><i></i>${d.status==='published'?'Published':'Unpublished'}</span><span class="row-folder" title="${esc(d.space)}">${icon('folder')}<span>${esc(d.space)}</span></span><span class="edited-date" title="${esc(d.author)} · ${date(d.updated)}">${relativeDate(d.updated)}</span><button class="row-more icon-button" data-more="${d.id}" aria-label="Actions for ${esc(d.title)}">⋮</button></div>`).join('')}</div>`:`<div class="empty">${icon('search')}<h3>${query?'No matching documents':'No documents found'}</h3><p>${!admin()&&!state.spaces.length?'No folders are enabled within your departments. Contact your administrator to request access.':'Try a different search or adjust your filters.'}</p>${admin()?'<button class="secondary" id="empty-create">Create a document</button>':''}</div>`;document.querySelectorAll('[data-doc]').forEach(b=>b.onclick=()=>openDocument(+b.dataset.doc));document.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>documentActions(state.documents.find(d=>d.id===+b.dataset.more)));if($('#empty-create'))$('#empty-create').onclick=()=>editor();}
function readDoc(){const d=state.documents.find(x=>x.id===state.currentDoc);if(!d){navigate('documents');return;}$('#content').innerHTML=`<div class="read-top"><button class="text-button" id="back">← All documents</button>${canEdit(d)?`<div class="button-group"><button class="secondary" id="edit-doc">${icon('edit')} Edit document</button>${admin()?`<button class="icon-button danger" id="delete-doc" aria-label="Delete document">${icon('trash')}</button>`:''}</div>`:''}</div><article class="document"><div class="eyebrow">${esc(d.space)}</div><h1>${esc(d.title)}</h1><div class="document-meta"><span class="avatar mini">${esc(d.author[0])}</span>${esc(d.author)}<span>·</span>Updated ${date(d.updated)}<span class="badge ${d.status}"><i></i>${d.status==='draft'?'Draft':'Published'}</span></div>${d.status==='draft'?'<div class="draft-notice">This document is unpublished. Only administrators can view it.</div>':''}<div class="document-body">${renderDocumentBody(d)}</div><div class="document-end">${icon('check')} You’re all caught up.</div></article>`;document.querySelectorAll('.document-image').forEach(img=>{img.onerror=()=>{const note=document.createElement('p');note.className='image-unavailable';note.textContent='This image could not be loaded. Refresh the page to try again.';img.replaceWith(note);};});$('.document-body').onclick=e=>{const link=e.target.closest('[data-linked-page]');if(link){e.preventDefault();openDocument(Number(link.dataset.linkedPage));}};$('#back').onclick=()=>navigate('documents');if(canEdit(d))$('#edit-doc').onclick=()=>editor(d);if(admin()){$('#delete-doc').onclick=()=>confirmModal('Delete this document?',`“${d.title}” will be permanently removed.`,async()=>{await api('documents/delete',{id:d.id});page='documents';await refresh();toast('Document deleted');});}}
let previousFocus;
function modal(html){previousFocus=document.activeElement;$('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}<button class="icon-button modal-close" id="close-modal" aria-label="Close dialog">${icon('close')}</button></section></div>`;$('#close-modal').onclick=closeModal;$('.modal-overlay').onclick=e=>{if(e.target===e.currentTarget)closeModal();};$('.modal').querySelector('input,button,textarea')?.focus();$('.modal').onkeydown=e=>{if(e.key==='Escape')closeModal();if(e.key==='Tab'){const els=[...$('.modal').querySelectorAll('button,input,select,textarea,[contenteditable="true"]')].filter(x=>!x.disabled&&!x.hidden);if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}}};}
function closeModal(){$('#modal-root').innerHTML='';previousFocus?.focus();}
async function refresh(){const data=await api('bootstrap');state=restrictWorkspace({...state,...data});if(page==='document'&&state.documents.some(d=>d.id===state.currentDoc)){const doc=await api('documents/'+state.currentDoc);state.documents=state.documents.map(d=>d.id===doc.id?doc:d);}render();}
let editorMedia=[];
async function editor(d={}){
  if(!canEdit(d))return;
  if(d.id){try{d=await api('documents/'+d.id);}catch(error){toast(error.message);return;}}
  modal(`<form id="editor" class="page-editor"><div class="editor-top"><div><span class="eyebrow">${d.id?'EDITING PAGE':'NEW PAGE'}</span><h2 id="modal-title">${d.id?'Edit page':'Create a page'}</h2></div><div class="editor-top-actions"><button type="button" class="secondary" id="editor-cancel">Cancel</button>${editorSubmitButtons(d)}</div></div><div class="editor-scroll"><div class="editor-canvas"><div class="editor-title-row"><span class="editor-page-icon">${icon('file')}</span><div class="editor-title-field"><label class="editor-title-label" for="editor-title">Page title</label><input id="editor-title" class="editor-title" name="title" value="${esc(d.title||'')}" placeholder="Give your page a title" maxlength="200" required></div></div><label class="editor-folder-label" for="editor-document-type">Document type</label><div class="editor-type-control"><input type="hidden" id="editor-document-type" name="document_type" value="procedure"><button type="button" id="editor-type-button" class="editor-type-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="editor-type-menu"><span id="editor-type-value">Procedure</span><span class="editor-type-chevron" aria-hidden="true"></span></button><div id="editor-type-menu" class="editor-type-menu" role="listbox" aria-label="Document type" hidden><button type="button" role="option" data-document-type="procedure" aria-selected="true">Procedure</button><button type="button" role="option" data-document-type="policy" aria-selected="false">Policy</button></div></div><label class="editor-folder-label" for="editor-folder-button">Folder</label><div class="editor-type-control editor-folder-control"><input type="hidden" id="editor-folder" name="space_id"><button type="button" id="editor-folder-button" class="editor-type-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="editor-folder-menu"><span id="editor-folder-value">Select a folder</span><span class="editor-type-chevron" aria-hidden="true"></span></button><div id="editor-folder-menu" class="editor-type-menu" role="listbox" aria-label="Folder" hidden>${state.spaces.map(s=>`<button type="button" role="option" data-folder-id="${s.id}" aria-selected="false">${esc(s.name)}</button>`).join('')}</div></div><div class="editor-writing"><div class="editor-toolbar" role="toolbar" aria-label="Writing tools"><button type="button" data-format="bold" title="Bold" aria-label="Bold"><b>B</b></button><button type="button" data-format="italic" title="Italic" aria-label="Italic"><i>I</i></button><span class="toolbar-divider"></span><div class="editor-list-control"><button type="button" data-format="number" title="Ordered list" aria-label="Ordered list"><svg class="list-toolbar-svg" viewBox="0 0 38 32" aria-hidden="true"><text x="2" y="9" font-size="9" font-weight="700" fill="currentColor">1</text><text x="2" y="19" font-size="9" font-weight="700" fill="currentColor">2</text><text x="2" y="29" font-size="9" font-weight="700" fill="currentColor">3</text><path d="M12 6h23M12 16h23M12 26h23" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button><button type="button" id="ordered-list-options" class="editor-list-arrow" aria-label="Ordered list options" aria-expanded="false" aria-controls="ordered-list-menu"><span class="list-dropdown-triangle" aria-hidden="true"></span></button><div id="ordered-list-menu" class="editor-list-menu" hidden><button type="button" data-list-style="number">Default</button><button type="button" data-list-style="alpha">Alpha</button><button type="button" data-list-style="roman">Roman</button></div></div><div class="editor-list-control"><button type="button" data-format="bullet" title="Unordered list" aria-label="Unordered list"><svg class="list-toolbar-svg unordered-toolbar-svg" viewBox="0 0 38 32" aria-hidden="true"><circle cx="5" cy="6" r="2.6"/><circle cx="5" cy="16" r="2.6"/><circle cx="5" cy="26" r="2.6"/><path d="M12 6h23M12 16h23M12 26h23" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button><button type="button" id="unordered-list-options" class="editor-list-arrow" aria-label="Unordered list options" aria-expanded="false" aria-controls="unordered-list-menu"><span class="list-dropdown-triangle" aria-hidden="true"></span></button><div id="unordered-list-menu" class="editor-list-menu" hidden><button type="button" data-bullet-style="bullet">Default</button><button type="button" data-bullet-style="circle">Circle</button><button type="button" data-bullet-style="disc">Disc</button><button type="button" data-bullet-style="square">Square</button></div></div><span class="toolbar-divider"></span><div class="paragraph-control"><button type="button" id="paragraph-format" aria-label="Paragraph format" aria-expanded="false" aria-controls="paragraph-menu" title="Paragraph format"><span class="paragraph-icon" aria-hidden="true">¶</span><span class="list-dropdown-triangle" aria-hidden="true"></span></button><div id="paragraph-menu" class="paragraph-menu" hidden><button type="button" data-paragraph="normal">Normal</button><button type="button" data-paragraph="heading">Heading</button><button type="button" data-paragraph="heading2">Heading 2</button><button type="button" data-paragraph="heading3">Heading 3</button><button type="button" data-paragraph="quote">Quote</button></div></div><button type="button" id="editor-more-button" class="editor-more-button" aria-label="More text formatting" aria-expanded="false" aria-controls="editor-more-menu" title="More text formatting">⋮</button><span class="toolbar-divider"></span><div class="editor-media-control"><button type="button" data-format="image" class="media-toolbar-button" title="Insert image" aria-label="Insert image" aria-expanded="false" aria-controls="image-popover">${icon('image')}</button><div id="image-popover" class="media-popover" role="dialog" aria-label="Insert image" hidden><div class="media-popover-tabs"><button type="button" data-media-tab="upload" data-media-kind="image" class="active">Upload</button><button type="button" data-media-tab="link" data-media-kind="image">Link</button></div><div class="media-popover-panel" data-media-panel="upload" data-media-kind="image"><button type="button" class="media-dropzone" data-media-upload="image"><strong>Drop image</strong><span>(or click)</span></button><small>PNG, JPG, GIF or WebP, up to 450 KB</small></div><div class="media-popover-panel" data-media-panel="link" data-media-kind="image" hidden><label>Image URL<input id="image-url" type="url" placeholder="https://example.com/image.png"></label><button type="button" class="primary" data-media-insert="image">Insert image</button></div><div class="media-error" data-media-error="image" role="alert"></div></div></div><div class="editor-media-control"><button type="button" data-format="video" class="media-toolbar-button" title="Insert video" aria-label="Insert video" aria-expanded="false" aria-controls="video-popover">${icon('video')}</button><div id="video-popover" class="media-popover" role="dialog" aria-label="Insert video" hidden><div class="media-popover-tabs"><button type="button" data-media-tab="upload" data-media-kind="video" class="active">Upload</button><button type="button" data-media-tab="link" data-media-kind="video">Link</button></div><div class="media-popover-panel" data-media-panel="upload" data-media-kind="video"><button type="button" class="media-dropzone" data-media-upload="video"><strong>Drop video</strong><span>(or click)</span></button><small>MP4, WebM or OGG, up to 450 KB</small></div><div class="media-popover-panel" data-media-panel="link" data-media-kind="video" hidden><label>Direct video URL<input id="video-url" type="url" placeholder="https://example.com/video.mp4"></label><button type="button" class="primary" data-media-insert="video">Insert video</button></div><div class="media-error" data-media-error="video" role="alert"></div></div></div><div class="editor-link-control"><button type="button" data-format="link" class="link-toolbar-button" title="Insert link" aria-label="Insert link" aria-expanded="false" aria-controls="link-popover">${icon('link')}</button><div id="link-popover" class="link-popover" role="dialog" aria-label="Insert link" hidden><label>URL<input id="link-url" type="url" placeholder="https://example.com" autocomplete="url"></label><label>Text<input id="link-text" type="text" placeholder="Text to display"></label><div class="link-popover-footer"><span id="link-error" role="alert"></span><button type="button" id="insert-link-button">Insert</button></div></div></div><div class="editor-table-control"><button type="button" data-format="table" class="table-toolbar-button" title="Insert table" aria-label="Insert table" aria-expanded="false" aria-controls="table-popover"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></svg></button><div id="table-popover" class="table-popover" role="dialog" aria-label="Choose table size" hidden><div id="table-size-label" aria-live="polite">1 × 1</div><div id="table-size-grid" class="table-size-grid" role="grid" aria-label="Table size"></div></div></div><div class="editor-page-link-control"><button type="button" data-format="internal-link" class="page-link-toolbar-button" title="Link to page" aria-label="Link to page" aria-expanded="false" aria-controls="page-link-popover"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M13 3h8v8M21 3 10 14"/></svg></button><div id="page-link-popover" class="page-link-popover" role="dialog" aria-label="Link to knowledge page" hidden><h3>Search for procedures, policies and processes</h3><div class="page-link-search"><input id="page-link-search" type="search" placeholder="Type document name…" aria-label="Search pages" autocomplete="off"><button type="button" id="page-link-show-all" aria-label="Show pages">⌄</button></div><div id="page-link-results" class="page-link-results" role="listbox" hidden></div><input id="page-link-text" type="text" placeholder="Link text" aria-label="Link text"><div id="page-link-destination" class="page-link-destination" hidden><small>Destination URL</small><a id="page-link-url" target="_blank" rel="noopener noreferrer"></a></div><div class="page-link-footer"><span id="page-link-error" role="alert"></span><button type="button" id="insert-page-link">Insert</button></div></div></div><input type="file" id="editor-image-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><input type="file" id="editor-video-file" accept="video/mp4,video/webm,video/ogg" hidden><input type="file" id="editor-dropzone-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div><div id="editor-more-menu" class="editor-extra-toolbar" role="toolbar" aria-label="More text formatting tools" hidden><button type="button" data-format="underline" aria-label="Underline" title="Underline"><u>U</u></button><button type="button" data-format="align-left" aria-label="Align left" title="Align left"><span class="align-icon align-left" aria-hidden="true"><i></i><i></i><i></i></span></button><button type="button" data-format="align-center" aria-label="Align center" title="Align center"><span class="align-icon align-center" aria-hidden="true"><i></i><i></i><i></i></span></button><button type="button" data-format="align-right" aria-label="Align right" title="Align right"><span class="align-icon align-right" aria-hidden="true"><i></i><i></i><i></i></span></button><button type="button" data-format="align-justify" aria-label="Align justify" title="Align justify"><span class="align-icon align-justify" aria-hidden="true"><i></i><i></i><i></i></span></button><label class="extra-color-tool" title="Text color" aria-label="Text color"><span class="color-tool-icon" aria-hidden="true">A</span><input type="color" id="editor-text-color" value="#172b4d" aria-label="Text color"></label><label class="extra-color-tool" title="Background color" aria-label="Background color"><span class="color-tool-icon background" aria-hidden="true">▰</span><input type="color" id="editor-background-color" value="#fff2b3" aria-label="Background color"></label><div class="editor-callout"><button type="button" id="callout-button" aria-label="Callout style" aria-expanded="false" aria-controls="callout-menu" title="Callout style"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 17 7l2 2L6 22zM15 3l.7 1.8L17.5 5.5l-1.8.7L15 8l-.7-1.8-1.8-.7 1.8-.7zM20 12l.5 1.5L22 14l-1.5.5L20 16l-.5-1.5L18 14l1.5-.5z" fill="currentColor"/></svg><span class="list-dropdown-triangle" aria-hidden="true"></span></button><div id="callout-menu" class="callout-menu" hidden><button type="button" data-format="callout-success">Success</button><button type="button" data-format="callout-info">Info</button><button type="button" data-format="callout-secondary">Secondary</button><button type="button" data-format="callout-warning">Warning</button><button type="button" data-format="callout-danger">Danger</button></div></div><button type="button" data-format="title-case" aria-label="Title Case" title="Title Case">T↕</button><button type="button" data-format="clear" aria-label="Clear formatting" title="Clear formatting">⌫</button><button type="button" data-format="uppercase" aria-label="Uppercase" title="Uppercase">TT</button></div><label class="sr-only" for="editor-body">Page content</label><div id="editor-body" class="editor-rich-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Page content" data-placeholder="Type something…"></div><textarea id="editor-serialized" name="body" hidden></textarea></div><section id="editor-media-section" class="editor-media-section" aria-label="Videos and images" hidden><h3>VIDEOS/IMAGES</h3><div id="editor-media-gallery" class="editor-media-gallery"></div></section><div id="editor-image-dropzone" class="editor-image-dropzone" role="group" aria-label="Add images to page"><div class="dropzone-prompt"><span class="dropzone-cloud" aria-hidden="true">☁</span><span>Drag &amp; drop images here</span></div><button type="button" id="editor-browse-images" class="secondary">Or browse your computer</button><div id="editor-image-uploads" class="editor-image-uploads" aria-live="polite"></div></div><div class="editor-help">Use the toolbar to format text. Blank lines separate paragraphs.</div><div class="form-error" role="alert"></div><div class="editor-bottom"><span>${admin()?'Unpublished pages are visible only to administrators.':'Your changes require admin approval. The published page stays unchanged.'}</span>${editorSubmitButtons(d)}</div></div></div></form>`);
  $('.modal').classList.add('page-editor-modal');
  if(!admin())$('#editor-folder-button').disabled=true;
  $('#editor-cancel').onclick=closeModal;
  const pageContent=readRichPage(d);
  editorMedia=pageContent.media;
  $('#editor-body').innerHTML=pageContent.content;
  setEditorDocumentType(pageContent.documentType);
  $('#editor-type-button').onclick=()=>toggleEditorTypeMenu();
  $('#editor-type-button').onkeydown=e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();toggleEditorTypeMenu(true);$('#editor-type-menu button[aria-selected="true"]').focus();}};
  $('#editor-type-menu').onclick=e=>{const option=e.target.closest('[data-document-type]');if(option){setEditorDocumentType(option.dataset.documentType);toggleEditorTypeMenu(false);$('#editor-type-button').focus();}};
  $('#editor-type-menu').onkeydown=e=>{const options=[...$('#editor-type-menu').querySelectorAll('button')],index=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();toggleEditorTypeMenu(false);$('#editor-type-button').focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();options[(index+(e.key==='ArrowDown'?1:options.length-1))%options.length].focus();}};
  setEditorFolder(d.space_id||spaceId||state.spaces[0]?.id);
  $('#editor-folder-button').onclick=()=>{toggleEditorTypeMenu(false);toggleEditorFolderMenu();};
  $('#editor-folder-button').onkeydown=e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();toggleEditorTypeMenu(false);toggleEditorFolderMenu(true);$('#editor-folder-menu button[aria-selected="true"]')?.focus();}};
  $('#editor-folder-menu').onclick=e=>{const option=e.target.closest('[data-folder-id]');if(option){setEditorFolder(option.dataset.folderId);toggleEditorFolderMenu(false);$('#editor-folder-button').focus();}};
  $('#editor-folder-menu').onkeydown=e=>{const options=[...$('#editor-folder-menu').querySelectorAll('button')],index=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();toggleEditorFolderMenu(false);$('#editor-folder-button').focus();}else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&options.length){e.preventDefault();options[(index+(e.key==='ArrowDown'?1:options.length-1))%options.length].focus();}};
  $('#editor').addEventListener('pointerdown',e=>{if(!e.target.closest('.editor-type-control:not(.editor-folder-control)'))toggleEditorTypeMenu(false);if(!e.target.closest('.editor-folder-control'))toggleEditorFolderMenu(false);});
  renderEditorMedia();
  $('#editor-body').onmouseup=rememberEditorRange;$('#editor-body').onkeyup=rememberEditorRange;
  $('.editor-toolbar').onmousedown=e=>{rememberEditorRange();if(e.target.closest('button'))e.preventDefault();};
  $('#editor-more-menu').onmousedown=e=>{rememberEditorRange();if(e.target.closest('button'))e.preventDefault();};
  document.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>applyRichFormat(button.dataset.format));
  $('#ordered-list-options').onclick=()=>{const menu=$('#ordered-list-menu');menu.hidden=!menu.hidden;$('#ordered-list-options').setAttribute('aria-expanded',String(!menu.hidden));};
  document.querySelectorAll('[data-list-style]').forEach(button=>button.onclick=()=>{applyRichFormat(button.dataset.listStyle);$('#ordered-list-menu').hidden=true;$('#ordered-list-options').setAttribute('aria-expanded','false');});
  $('#unordered-list-options').onclick=()=>{const menu=$('#unordered-list-menu');menu.hidden=!menu.hidden;$('#unordered-list-options').setAttribute('aria-expanded',String(!menu.hidden));};
  document.querySelectorAll('[data-bullet-style]').forEach(button=>button.onclick=()=>{applyRichFormat(button.dataset.bulletStyle);$('#unordered-list-menu').hidden=true;$('#unordered-list-options').setAttribute('aria-expanded','false');});

  $('#paragraph-format').onclick=()=>{const menu=$('#paragraph-menu');menu.hidden=!menu.hidden;$('#paragraph-format').setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden){const tag=window.getSelection()?.anchorNode?.parentElement?.closest('p,h1,h2,h3,blockquote')?.tagName?.toLowerCase();const current={p:'normal',h1:'heading',h2:'heading2',h3:'heading3',blockquote:'quote'}[tag]||'normal';menu.querySelectorAll('[data-paragraph]').forEach(button=>{if(button.dataset.paragraph===current)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');});}};
  document.querySelectorAll('[data-paragraph]').forEach(button=>button.onclick=()=>{applyRichFormat(button.dataset.paragraph);$('#paragraph-menu').hidden=true;$('#paragraph-format').setAttribute('aria-expanded','false');});
  $('#editor-more-button').onclick=()=>{const menu=$('#editor-more-menu');menu.hidden=!menu.hidden;$('#editor-more-button').setAttribute('aria-expanded',String(!menu.hidden));};
  $('#callout-button').onclick=()=>{const menu=$('#callout-menu');menu.hidden=!menu.hidden;$('#callout-button').setAttribute('aria-expanded',String(!menu.hidden));};
  $('#callout-menu').onclick=e=>{if(e.target.closest('[data-format]')){$('#callout-menu').hidden=true;$('#callout-button').setAttribute('aria-expanded','false');}};
  document.querySelectorAll('[data-media-tab]').forEach(button=>button.onclick=()=>{const kind=button.dataset.mediaKind;document.querySelectorAll(`[data-media-tab][data-media-kind="${kind}"]`).forEach(tab=>tab.classList.toggle('active',tab===button));document.querySelectorAll(`[data-media-panel][data-media-kind="${kind}"]`).forEach(panel=>panel.hidden=panel.dataset.mediaPanel!==button.dataset.mediaTab);$(`[data-media-error="${kind}"]`).textContent='';});
  document.querySelectorAll('[data-media-upload]').forEach(button=>{const kind=button.dataset.mediaUpload;button.onclick=()=>$('#editor-'+kind+'-file').click();button.ondragover=e=>{e.preventDefault();button.classList.add('drag-over');};button.ondragleave=()=>button.classList.remove('drag-over');button.ondrop=e=>{e.preventDefault();button.classList.remove('drag-over');insertMediaFile(e.dataTransfer.files[0],kind);};});
  document.querySelectorAll('[data-media-insert]').forEach(button=>button.onclick=()=>{const kind=button.dataset.mediaInsert,value=$('#'+kind+'-url').value.trim();let source;try{const url=new URL(value);if(url.protocol!=='https:')throw Error();source=kind==='video'?safeMediaUrl(value,['.mp4','.webm','.ogg']):url.href;}catch{}if(!source){$(`[data-media-error="${kind}"]`).textContent=kind==='video'?'Enter a direct HTTPS video URL ending in .mp4, .webm, or .ogg.':'Enter an HTTPS image URL.';return;}insertRichHtml(kind==='image'?`<img src="${esc(source)}" alt="Inserted image">`:`<video controls src="${esc(source)}"></video>`);closeMediaPopover(kind);});
  $('#insert-link-button').onclick=()=>{let url;try{url=new URL($('#link-url').value.trim());if(!['http:','https:'].includes(url.protocol))throw Error();}catch{$('#link-error').textContent='Enter a valid URL.';$('#link-url').focus();return;}const label=$('#link-text').value.trim()||url.href;insertRichHtml(`<a href="${esc(url.href)}">${esc(label)}</a>`);closeLinkPopover();};
  for(const input of [$('#link-url'),$('#link-text')])input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#insert-link-button').click();}};
  $('#table-size-grid').innerHTML=Array.from({length:8},(_,row)=>Array.from({length:10},(_,col)=>`<button type="button" role="gridcell" data-cols="${col+1}" data-rows="${row+1}" aria-label="${col+1} columns by ${row+1} rows"></button>`).join('')).join('');
  $('#table-size-grid').querySelectorAll('button').forEach(cell=>{const preview=()=>previewTableSize(Number(cell.dataset.cols),Number(cell.dataset.rows));cell.onpointerenter=preview;cell.onfocus=preview;cell.onclick=()=>{const cols=Number(cell.dataset.cols),rows=Number(cell.dataset.rows);const html='<table><tbody>'+Array.from({length:rows},()=>'<tr>'+Array.from({length:cols},()=>'<td><br></td>').join('')+'</tr>').join('')+'</tbody></table><p><br></p>';insertRichHtml(html);closeTablePopover();};});
  previewTableSize(1,1);
  $('#page-link-search').oninput=()=>{delete $('#page-link-search').dataset.pageId;const exact=exactPageLinkMatch();if(exact)$('#page-link-search').dataset.pageId=exact.id;updatePageLinkDestination(exact);renderPageLinkResults();};
  $('#page-link-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#page-link-results').querySelector('[data-page-id]')?.click();}else if(e.key==='ArrowDown'){$('#page-link-results').querySelector('[data-page-id]')?.focus();}else if(e.key==='Escape'){e.stopPropagation();closePageLinkPopover();}};
  $('#page-link-show-all').onclick=()=>renderPageLinkResults(true);
  $('#page-link-results').onclick=e=>{const item=e.target.closest('[data-page-id]');if(!item)return;const doc=state.documents.find(page=>page.id===Number(item.dataset.pageId));if(!doc)return;$('#page-link-search').value=doc.title;$('#page-link-search').dataset.pageId=doc.id;$('#page-link-results').hidden=true;if(!$('#page-link-text').value.trim())$('#page-link-text').value=doc.title;updatePageLinkDestination(doc);$('#page-link-error').textContent='';};
  $('#insert-page-link').onclick=()=>{const doc=state.documents.find(page=>page.id===Number($('#page-link-search').dataset.pageId))||exactPageLinkMatch();if(!doc){$('#page-link-error').textContent='Choose a page from the search results or enter its exact name.';renderPageLinkResults();return;}insertRichHtml(`<a href="/#/documents/${doc.id}" data-linked-page="${doc.id}">${esc($('#page-link-text').value.trim()||doc.title)}</a>`);closePageLinkPopover();};
  $('#page-link-text').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#insert-page-link').click();}};
  for(const [id,kind] of [['editor-text-color','text-color'],['editor-background-color','background-color']]){
    const picker=$('#'+id);
    picker.onpointerdown=rememberEditorRange;
    picker.onchange=()=>applyRichFormat(kind,picker.value);
  }
  for(const kind of ['image','video'])$('#editor-'+kind+'-file').onchange=e=>{insertMediaFile(e.target.files[0],kind);e.target.value='';};
  $('#editor-browse-images').onclick=()=>$('#editor-dropzone-file').click();
  $('#editor-dropzone-file').onchange=e=>{insertMediaFile(e.target.files[0],'image',true);e.target.value='';};
  const dropzone=$('#editor-image-dropzone');
  dropzone.ondragover=e=>{e.preventDefault();dropzone.classList.add('drag-over');};
  dropzone.ondragleave=e=>{if(!dropzone.contains(e.relatedTarget))dropzone.classList.remove('drag-over');};
  dropzone.ondrop=e=>{e.preventDefault();dropzone.classList.remove('drag-over');insertMediaFile(e.dataTransfer.files[0],'image',true);};
  $('#editor').onsubmit=async e=>{e.preventDefault();$('#editor-serialized').value='::rich2::'+JSON.stringify({content:sanitizeRichHtml($('#editor-body').innerHTML),media:editorMedia,documentType:$('#editor-document-type').value});const data=Object.fromEntries(new FormData(e.target));data.status=e.submitter?.value||'pending';data.id=d.id;data.base_version=d.version;const buttons=[...e.target.querySelectorAll('button[type="submit"]')];buttons.forEach(b=>b.disabled=true);try{const result=await api(admin()?'documents':'revisions',data);closeModal();state.currentDoc=result.id;page=admin()?'document':'approvals';await refresh();toast(admin()?(data.status==='published'?'Page published':'Unpublished page saved'):'Submitted for admin approval');}catch(err){$('.page-editor .form-error').textContent=err.message;buttons.forEach(b=>b.disabled=false);}};
}
function validEditorMedia(item){if(!item||!['image','video'].includes(item.kind)||typeof item.src!=='string')return false;const mime=item.kind==='image'?'image\/(?:png|jpeg|gif|webp)':'video\/(?:mp4|webm|ogg)';return new RegExp(`^data:${mime};base64,[A-Za-z0-9+/=]+$`).test(item.src)&&item.src.length<750000;}
function setEditorDocumentType(value){const type=value==='policy'?'policy':'procedure';$('#editor-document-type').value=type;$('#editor-type-value').textContent=type==='policy'?'Policy':'Procedure';$('#editor-type-menu').querySelectorAll('[data-document-type]').forEach(option=>option.setAttribute('aria-selected',String(option.dataset.documentType===type)));}
function toggleEditorTypeMenu(open){const menu=$('#editor-type-menu'),show=open===undefined?menu.hidden:open;menu.hidden=!show;$('#editor-type-button').setAttribute('aria-expanded',String(show));menu.closest('.editor-type-control').classList.toggle('open',show);}
function setEditorFolder(value){const option=[...$('#editor-folder-menu').querySelectorAll('[data-folder-id]')].find(item=>item.dataset.folderId===String(value))||$('#editor-folder-menu [data-folder-id]');$('#editor-folder').value=option?.dataset.folderId||'';$('#editor-folder-value').textContent=option?.textContent||'Select a folder';$('#editor-folder-menu').querySelectorAll('[data-folder-id]').forEach(item=>item.setAttribute('aria-selected',String(item===option)));}
function toggleEditorFolderMenu(open){const menu=$('#editor-folder-menu'),show=open===undefined?menu.hidden:open;menu.hidden=!show;$('#editor-folder-button').setAttribute('aria-expanded',String(show));menu.closest('.editor-type-control').classList.toggle('open',show);}
function readRichPage(doc){
  const body=doc.body||'';
  if(body.startsWith('::rich2::')){try{const parsed=JSON.parse(body.slice(9));return {content:sanitizeRichHtml(parsed.content||''),media:Array.isArray(parsed.media)?parsed.media.filter(validEditorMedia):[],documentType:parsed.documentType==='policy'?'policy':'procedure'};}catch{}}
  if(body.startsWith('::rich::')){
    return {content:sanitizeRichHtml(body.slice(8)),media:[],documentType:'procedure'};
  }
  return {content:legacyToRich(doc),media:[],documentType:'procedure'};
}
function mediaAttachmentHtml(item,index,editable){const content=item.kind==='image'?`<img src="${item.src}" alt="${esc(item.name||'Uploaded image')}">`:`<video src="${item.src}" controls preload="metadata"></video>`;return `<div class="editor-media-item">${content}${editable?`<button type="button" data-remove-media="${index}" aria-label="Remove ${esc(item.name||item.kind)}">×</button>`:''}</div>`;}
function renderEditorMedia(){const section=$('#editor-media-section'),gallery=$('#editor-media-gallery');section.hidden=!editorMedia.length;gallery.innerHTML=editorMedia.map((item,index)=>mediaAttachmentHtml(item,index,true)).join('');gallery.querySelectorAll('[data-remove-media]').forEach(button=>button.onclick=()=>{editorMedia.splice(Number(button.dataset.removeMedia),1);renderEditorMedia();});renderUploadRows();}
function renderUploadRows(){const list=$('#editor-image-uploads');list.innerHTML=editorMedia.map(item=>`<div class="image-upload-row"><span class="upload-check" aria-hidden="true">✓</span><span class="upload-name">${esc(item.name||'Uploaded media')}</span><span class="upload-size">${item.size?`${(item.size/1024).toFixed(1)} KB`:''}</span><span class="upload-complete" aria-label="Added to page"></span></div>`).join('');}
function closeMediaPopover(kind){const panel=$('#'+kind+'-popover'),button=$(`[data-format="${kind}"]`);panel.hidden=true;button.setAttribute('aria-expanded','false');}
function toggleMediaPopover(kind){closeLinkPopover();closeTablePopover();closePageLinkPopover();for(const other of ['image','video'])if(other!==kind)closeMediaPopover(other);const panel=$('#'+kind+'-popover'),button=$(`[data-format="${kind}"]`);panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));$(`[data-media-error="${kind}"]`).textContent='';}
function closeLinkPopover(){const panel=$('#link-popover');panel.hidden=true;$('[data-format="link"]').setAttribute('aria-expanded','false');}
function toggleLinkPopover(){closeTablePopover();closePageLinkPopover();for(const kind of ['image','video'])closeMediaPopover(kind);const panel=$('#link-popover'),button=$('[data-format="link"]');panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){$('#link-error').textContent='';$('#link-text').value=window.getSelection()?.toString()||'';$('#link-url').focus();}}
function closeTablePopover(){const panel=$('#table-popover');panel.hidden=true;$('[data-format="table"]').setAttribute('aria-expanded','false');}
function toggleTablePopover(){closeLinkPopover();closePageLinkPopover();for(const kind of ['image','video'])closeMediaPopover(kind);const panel=$('#table-popover'),button=$('[data-format="table"]');panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)previewTableSize(1,1);}
function previewTableSize(cols,rows){$('#table-size-label').textContent=`${cols} × ${rows}`;$('#table-size-grid').querySelectorAll('button').forEach(cell=>cell.classList.toggle('selected',Number(cell.dataset.cols)<=cols&&Number(cell.dataset.rows)<=rows));}
function closePageLinkPopover(){const panel=$('#page-link-popover');panel.hidden=true;$('[data-format="internal-link"]').setAttribute('aria-expanded','false');}
function togglePageLinkPopover(){closeTablePopover();closeLinkPopover();for(const kind of ['image','video'])closeMediaPopover(kind);const panel=$('#page-link-popover'),button=$('[data-format="internal-link"]');panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){$('#page-link-search').value='';delete $('#page-link-search').dataset.pageId;$('#page-link-text').value=window.getSelection()?.toString()||'';$('#page-link-results').hidden=true;updatePageLinkDestination(null);$('#page-link-error').textContent='';$('#page-link-search').focus();}}
function exactPageLinkMatch(){const query=$('#page-link-search').value.trim().toLocaleLowerCase();if(!query)return null;const matches=state.documents.filter(page=>page.title.trim().toLocaleLowerCase()===query);return matches.length===1?matches[0]:null;}
function updatePageLinkDestination(doc){const box=$('#page-link-destination');box.hidden=!doc;if(!doc)return;const url=new URL(`/#/documents/${doc.id}`,location.origin).href;const link=$('#page-link-url');link.href=url;link.textContent=url;}
function renderPageLinkResults(showAll=false){const query=$('#page-link-search').value.trim().toLowerCase(),results=$('#page-link-results');if(!query&&!showAll){results.hidden=true;return;}const matches=state.documents.filter(page=>page.title.toLowerCase().includes(query)).slice(0,8);results.innerHTML=matches.length?matches.map(page=>`<button type="button" role="option" data-page-id="${page.id}"><span>${esc(page.title)}</span><small>${esc(page.space||'')}</small></button>`).join(''):'<p>No matching pages</p>';results.hidden=false;}
function placeEditorCaretAtEnd(){editorSavedRange=document.createRange();editorSavedRange.selectNodeContents($('#editor-body'));editorSavedRange.collapse(false);}
function showMediaError(kind,message,showInZone){if(showInZone){const note=document.createElement('p');note.className='image-upload-error';note.setAttribute('role','alert');note.textContent=message;$('#editor-image-uploads').append(note);}else $(`[data-media-error="${kind}"]`).textContent=message;}
function insertMediaFile(file,kind,showInZone=false){
  if(!file)return;
  const accepted=kind==='image'?['image/png','image/jpeg','image/gif','image/webp']:['video/mp4','video/webm','video/ogg'];
  if(!accepted.includes(file.type)){showMediaError(kind,`Choose a supported ${kind} file.`,showInZone);return;}
  if(file.size>450000){showMediaError(kind,`Choose a ${kind} under 450 KB, or use the Link tab.`,showInZone);return;}
  const reader=new FileReader();reader.onload=()=>{
    const item={kind,src:reader.result,name:file.name,size:file.size};
    if(!validEditorMedia(item)){showMediaError(kind,'The file could not be added.',showInZone);return;}
    const content=sanitizeRichHtml($('#editor-body').innerHTML);
    const inlineHtml=kind==='image'?`<img src="${item.src}" alt="${esc(item.name)}">`:`<video controls src="${item.src}"></video>`;
    const candidate=showInZone?{content,media:[...editorMedia,item]}:{content:content+inlineHtml,media:editorMedia};
    if(('::rich2::'+JSON.stringify(candidate)).length>900000){showMediaError(kind,'This page has reached its upload limit. Remove an attachment before adding another.',showInZone);return;}
    if(showInZone){editorMedia.push(item);renderEditorMedia();}
    else insertRichHtml(inlineHtml);
    closeMediaPopover(kind);
  };reader.onerror=()=>showMediaError(kind,'The file could not be read.',showInZone);reader.readAsDataURL(file);
}
function legacyToRich(doc){return sanitizeRichHtml(renderDocumentBody({...doc,body:doc.body||'',images:doc.images||[]}));}
function sanitizeRichHtml(html){
  const source=new DOMParser().parseFromString(html,'text/html'),output=document.createElement('div');
  const allowed=new Set(['P','DIV','BR','B','STRONG','I','EM','U','UL','OL','LI','H1','H2','H3','A','IMG','VIDEO','TABLE','THEAD','TBODY','TR','TH','TD','SPAN','FONT','FIGURE','BLOCKQUOTE']);
  const copy=node=>{
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
    if(node.nodeType!==Node.ELEMENT_NODE||['SCRIPT','STYLE','IFRAME','OBJECT','SVG'].includes(node.tagName))return null;
    if(!allowed.has(node.tagName))return document.createTextNode(node.textContent);
    const clean=document.createElement(node.tagName==='FONT'?'span':node.tagName.toLowerCase());
    if(node.tagName==='A'){
      if(/^[1-9]\d*$/.test(node.dataset.linkedPage||'')){clean.dataset.linkedPage=node.dataset.linkedPage;clean.href=`/#/documents/${node.dataset.linkedPage}`;clean.className='document-internal-link';}
      else{try{const url=new URL(node.getAttribute('href'));if(['http:','https:'].includes(url.protocol)){clean.href=url.href;clean.target='_blank';clean.rel='noopener noreferrer';}}catch{}}
    }
    if(node.tagName==='IMG'){
      const src=node.getAttribute('src')||'';
      if(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)&&src.length<750000)clean.src=src;
      else if(/^\/api\/documents\/\d+\/images\/\d+$/.test(src))clean.src=src;
      else{try{const url=new URL(src);if(url.protocol==='https:')clean.src=url.href;}catch{}}
      clean.alt=node.getAttribute('alt')||'';
    }
    if(node.tagName==='VIDEO'){
      const raw=node.getAttribute('src')||'';
      const src=/^data:video\/(?:mp4|webm|ogg);base64,[A-Za-z0-9+/=]+$/.test(raw)&&raw.length<750000?raw:safeMediaUrl(raw,['.mp4','.webm','.ogg']);
      if(src){clean.src=src;clean.controls=true;clean.preload='metadata';}
    }
    if(node.tagName==='OL'&&['1','a','i'].includes(node.getAttribute('type')))clean.type=node.getAttribute('type');
    if(node.tagName==='BLOCKQUOTE'){
      const kind=(node.className||'').match(/(?:^|\s)callout-(success|info|secondary|warning|danger)(?:\s|$)/)?.[1];
      if(kind)clean.className=`callout callout-${kind}`;
    }
    if(node.tagName==='UL'&&['disc','circle','square'].includes(node.style.listStyleType))clean.style.listStyleType=node.style.listStyleType;
    for(const property of ['color','backgroundColor']){
      const value=node.style[property];if(/^(?:#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/.test(value))clean.style[property]=value;
    }
    if(node.tagName==='FONT'&&/^#[0-9a-fA-F]{6}$/.test(node.getAttribute('color')||''))clean.style.color=node.getAttribute('color');
    if(['left','center','right','justify'].includes(node.style.textAlign))clean.style.textAlign=node.style.textAlign;
    for(const child of node.childNodes){const safe=copy(child);if(safe)clean.append(safe);}
    return clean;
  };
  for(const child of source.body.childNodes){const safe=copy(child);if(safe)output.append(safe);}
  return output.innerHTML;
}
let editorSavedRange=null;
function rememberEditorRange(){const selection=window.getSelection();if(selection.rangeCount&&$('#editor-body')?.contains(selection.anchorNode))editorSavedRange=selection.getRangeAt(0).cloneRange();}
function focusEditorSelection(){const editor=$('#editor-body');editor.focus();if(editorSavedRange){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(editorSavedRange);}}
function insertRichHtml(html){
  const safe=sanitizeRichHtml(html);focusEditorSelection();
  let inserted=false;try{inserted=document.execCommand('insertHTML',false,safe);}catch{}
  if(!inserted){
    const selection=window.getSelection(),range=selection.rangeCount?selection.getRangeAt(0):document.createRange();
    if(!selection.rangeCount){range.selectNodeContents($('#editor-body'));range.collapse(false);}
    range.deleteContents();const template=document.createElement('template');template.innerHTML=safe;
    const last=template.content.lastChild;range.insertNode(template.content);
    if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
  }
  rememberEditorRange();
}
function applyRichFormat(kind,value){
  rememberEditorRange();focusEditorSelection();
  const command=(name,arg)=>document.execCommand(name,false,arg);
  if(['bold','italic','underline'].includes(kind))command(kind);
  else if(['number','alpha','roman'].includes(kind)){
    command('insertOrderedList');const list=window.getSelection()?.anchorNode?.parentElement?.closest('ol');if(list)list.type={number:'1',alpha:'a',roman:'i'}[kind];
  }else if(['bullet','circle','disc','square'].includes(kind)){
    command('insertUnorderedList');const list=window.getSelection()?.anchorNode?.parentElement?.closest('ul');if(list)list.style.listStyleType={bullet:'disc',circle:'circle',disc:'disc',square:'square'}[kind];
  }else if(['normal','heading','heading2','heading3','quote','paragraph-style'].includes(kind))command('formatBlock',({normal:'p',heading:'h1',heading2:'h2',heading3:'h3',quote:'blockquote','paragraph-style':'h2'})[kind]);
  else if(kind.startsWith('align-'))command({left:'justifyLeft',center:'justifyCenter',right:'justifyRight',justify:'justifyFull'}[kind.slice(6)]);
  else if(kind==='text-color')command('foreColor',value);
  else if(kind==='background-color')command('hiliteColor',value);
  else if(kind==='clear')command('removeFormat');
  else if(kind.startsWith('callout-')){
    command('formatBlock','blockquote');
    const block=window.getSelection()?.anchorNode?.parentElement?.closest('blockquote');
    if(block)block.className=`callout ${kind}`;
  }
  else if(kind==='uppercase'||kind==='title-case'){
    const selected=window.getSelection()?.toString()||'';if(selected)command('insertText',kind==='uppercase'?selected.toUpperCase():selected.toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase()));
  }else if(kind==='image'||kind==='video')toggleMediaPopover(kind);
  else if(kind==='table')toggleTablePopover();
  else if(kind==='link')toggleLinkPopover();
  else if(kind==='internal-link')togglePageLinkPopover();
  rememberEditorRange();
}
function applyEditorFormat(kind,value,range){
  const area=$('#editor-body');let start=range?.start??area.selectionStart,end=range?.end??area.selectionEnd;
  if(kind==='clear'&&start===end){start=area.value.lastIndexOf('\n',start-1)+1;const next=area.value.indexOf('\n',end);end=next<0?area.value.length:next;}
  const selected=area.value.slice(start,end);
  let replacement=selected||'text';
  if(kind==='bold')replacement=`**${replacement}**`;
  else if(kind==='italic')replacement=`*${replacement}*`;
  else if(kind==='underline')replacement=`__${replacement}__`;
  else if(kind==='text-color'||kind==='background-color')replacement=`::${kind}:${value}::${replacement}::end::`;
  else if(kind==='uppercase')replacement=replacement.toUpperCase();
  else if(kind==='title-case')replacement=replacement.toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase());
  else if(kind==='clear')replacement=replacement.replace(/^(?:#{1,2} |[•○●■] |\d+\. |::(?:left|center|right|justify):: ?)/gm,'').replace(/\*\*|\*|__|::(?:text-color|background-color):#[0-9a-fA-F]{6}::|::end::/g,'');
  else if(kind==='image'){ $('#editor-image-file').click();return; }
  else if(kind==='video'){
    const url=prompt('Direct video URL (.mp4, .webm, or .ogg)');if(!url)return;
    const parsed=safeMediaUrl(url,['.mp4','.webm','.ogg']);if(!parsed)return toast('Enter a direct HTTPS video URL.');
    replacement=`\n\n::video::${parsed}\n\n`;
  }else if(kind==='table')replacement='\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n\n';
  else if(kind==='internal-link'){
    const candidates=state.documents.filter(doc=>doc.id&&doc.title);
    const answer=prompt('Enter a page ID or exact title:\n'+candidates.slice(0,12).map(doc=>`${doc.id}: ${doc.title}`).join('\n'));
    if(!answer)return;
    const target=candidates.find(doc=>String(doc.id)===answer.trim()||doc.title.toLowerCase()===answer.trim().toLowerCase());
    if(!target)return toast('Page not found.');
    replacement=`[[page:${target.id}|${selected||target.title}]]`;
  }
  else if(kind==='link'){
    const url=prompt('Link URL (https://)');if(!url)return;
    let parsed;try{parsed=new URL(url);}catch{return toast('Enter a valid link URL.');}
    if(!['http:','https:'].includes(parsed.protocol))return toast('Use an http or https link.');
    replacement=`[${selected||parsed.hostname}](${parsed.href})`;
  }else{
    const lineStart=area.value.lastIndexOf('\n',start-1)+1;
    const lineEnd=area.value.indexOf('\n',end);
    const blockEnd=lineEnd<0?area.value.length:lineEnd;
    const lines=area.value.slice(lineStart,blockEnd).split('\n');
    const formatted=lines.map((line,i)=>{
      const plain=line.replace(/^(?:#{1,2} |[•○●■] |(?:\d+|[a-z]+)\. |::(?:left|center|right|justify):: ?)/,'');
      if(['number','alpha','roman'].includes(kind))return `${orderedLabel(kind,i+1)}. ${plain}`;
      if(['bullet','circle','disc','square'].includes(kind))return `${{bullet:'•',circle:'○',disc:'●',square:'■'}[kind]} ${plain}`;
      if(kind==='heading')return `# ${plain}`;
      if(kind==='subheading')return `## ${plain}`;
      if(kind==='paragraph')return plain;
      if(kind==='paragraph-style')return `# ${plain}`;
      if(kind.startsWith('align-'))return `::${kind.slice(6)}:: ${plain}`;
      return line;
    }).join('\n');
    area.setRangeText(formatted,lineStart,blockEnd,'select');area.focus();return;
  }
  area.setRangeText(replacement,start,end,'select');area.focus();
}
function safeMediaUrl(value,extensions){try{const url=new URL(value);return url.protocol==='https:'&&extensions.some(ext=>url.pathname.toLowerCase().endsWith(ext))?url.href:null;}catch{return null;}}
function orderedLabel(style,index){
  if(style==='number')return String(index);
  if(style==='alpha'){let result='';for(let n=index;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(97+(n-1)%26)+result;return result;}
  let n=index,result='';for(const [value,letter] of [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']])while(n>=value){result+=letter;n-=value;}return result;
}
function continueEditorList(event){
  if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;
  const area=event.currentTarget,start=area.selectionStart;if(start!==area.selectionEnd)return;
  const before=area.value.slice(0,start),line=before.slice(before.lastIndexOf('\n')+1),bullet=line.match(/^(\s*)([•○●■]) (.*)$/);
  if(bullet){event.preventDefault();if(!bullet[3].trim()){area.setRangeText('',start-line.length,start,'end');return;}area.setRangeText(`\n${bullet[1]}${bullet[2]} `,start,start,'end');return;}
  const match=line.match(/^(\s*)((?:\d+|[a-z]+))\. (.*)$/);
  if(!match)return;
  event.preventDefault();
  if(!match[3].trim()){const lineStart=start-line.length;area.setRangeText('',lineStart,start,'end');return;}
  const prior=before.split('\n'),list=[];
  for(let i=prior.length-1;i>=0&&/^(\s*)(?:\d+|[a-z]+)\. /.test(prior[i]);i--)list.unshift(prior[i]);
  const first=list[0].trimStart().match(/^([a-z]+|\d+)\. /)[1];
  const style=/^\d+$/.test(first)?'number':first==='i'?'roman':'alpha';
  area.setRangeText(`\n${match[1]}${orderedLabel(style,list.length+1)}. `,start,start,'end');
}
function spaceModal(){modal(`<h2 id="modal-title">Create a folder</h2><p>Bring related knowledge together.</p><form id="space-form"><label>Folder name<input name="name" placeholder="e.g. Customer success" maxlength="80" required></label><div class="form-error" role="alert"></div><div class="modal-actions"><button class="primary">Create folder</button></div></form>`);$('#space-form').onsubmit=async e=>{e.preventDefault();try{await api('spaces',Object.fromEntries(new FormData(e.target)));closeModal();await refresh();toast('Folder created');}catch(err){$('.form-error').textContent=err.message;}};}
function confirmModal(title,desc,fn){modal(`<h2 id="modal-title">${esc(title)}</h2><p>${esc(desc)}</p><div class="form-error" role="alert"></div><div class="modal-actions"><button class="secondary" id="cancel">Cancel</button><button class="primary destructive" id="confirm">Delete</button></div>`);$('#cancel').onclick=closeModal;$('#confirm').onclick=async()=>{try{await fn();closeModal();}catch(e){$('.form-error').textContent=e.message;}};}
async function settings(){if(!admin())return navigate('home');$('#content').innerHTML=`<section class="page-heading"><div><div class="eyebrow">WORKSPACE MANAGEMENT</div><h1>Make this space yours.</h1><p>Manage your workspace, your people, and how knowledge is shared.</p></div></section><section class="settings-card"><h2>General settings</h2><p>The name your team sees across the workspace.</p><form id="settings-form"><label>Workspace name<input name="workspace_name" value="${esc(state.settings.workspace_name)}" maxlength="40" required></label><button class="primary">Save changes</button><span class="form-error" role="alert"></span></form></section>${departmentSettings()}<section class="settings-card"><div class="section-title"><div><h2>People & permissions</h2><p>Give the right people the right access.</p></div><button class="primary" id="add-user">${icon('plus')} Add user</button></div><div class="permission-note">${icon('shield')} Administrators manage documents and settings. Readers can view published documents only when both their department and folder access are enabled. Administrators have access to all departments and folders.</div><div id="users-list">Loading people…</div></section>`;$('#settings-form').onsubmit=async e=>{e.preventDefault();try{await api('settings',Object.fromEntries(new FormData(e.target)));await refresh();toast('Workspace settings saved');}catch(err){$('.form-error').textContent=err.message;}};$('#add-user').onclick=userModal;document.querySelectorAll('[data-map-department]').forEach(b=>b.onclick=()=>departmentFoldersModal(b.dataset.mapDepartment));try{const users=await api('users');if(!$('#users-list'))return;$('#users-list').innerHTML=users.map(u=>`<div class="user-row"><span class="avatar">${esc(u.name[0])}</span><div><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div><span class="role-label">${u.role==='admin'?'Administrator':'Reader'}</span>${u.role==='reader'?`<button class="secondary folder-access-button" data-access="${u.id}">${icon('shield')} ${u.can_submit_edits?'Editing with approval · ':''}${u.department_ids.length} department${u.department_ids.length===1?'':'s'} · ${u.folder_ids.length} folder${u.folder_ids.length===1?'':'s'}</button>`:'<span class="all-folder-access">All departments & folders</span>'}${u.id!==state.user.id?`<button class="icon-button danger" data-remove="${u.id}" aria-label="Remove ${esc(u.name)}">${icon('trash')}</button>`:'<small>You</small>'}</div>`).join('');document.querySelectorAll('[data-access]').forEach(b=>b.onclick=()=>folderAccessModal(users.find(u=>u.id===+b.dataset.access)));document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>confirmModal('Remove this user?','They will no longer be able to sign in to this workspace.',async()=>{await api('users/delete',{id:+b.dataset.remove});await settings();toast('User removed');}));}catch(e){toast(e.message);}}
function userModal(){modal(`<h2 id="modal-title">Add a teammate</h2><p>Create an account to give someone workspace access.</p><form id="user-form"><label>Full name<input name="name" required autocomplete="name"></label><label>Email address<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" minlength="10" required autocomplete="new-password" placeholder="At least 10 characters"></label><label>Role<select name="role" id="new-user-role"><option value="reader">Reader — view enabled departments and folders</option><option value="admin">Administrator — manage the workspace</option></select></label><div id="new-user-folders">${readerEditingControl(false)}${departmentCheckboxes([])}${folderCheckboxes([])}</div><p id="admin-access-note" hidden>Administrators can manage all folders, including unpublished documents.</p><div class="form-error" role="alert"></div><div class="modal-actions"><button class="primary">Create account</button></div></form>`);$('#new-user-role').onchange=e=>{const isAdmin=e.target.value==='admin';$('#new-user-folders').hidden=isAdmin;$('#admin-access-note').hidden=!isAdmin;};$('#user-form').onsubmit=async e=>{e.preventDefault();try{await api('users',{...Object.fromEntries(new FormData(e.target)),folder_ids:e.target.elements.role.value==='reader'?selectedFolderIds(e.target):[],department_ids:e.target.elements.role.value==='reader'?selectedDepartmentIds(e.target):[],can_submit_edits:e.target.elements.role.value==='reader'&&e.target.elements.can_submit_edits.checked});closeModal();await settings();toast('User account created');}catch(err){$('.form-error').textContent=err.message;}};}
function folderCheckboxes(selected){return `<fieldset class="folder-permissions"><legend>Enabled folders</legend><p>Enable individual folders. Readers can open them only if they also have access to a department containing that folder. No selection means no document access.</p><div class="folder-checkbox-list">${state.spaces.map(f=>`<label class="folder-checkbox"><input type="checkbox" name="folder_ids" value="${f.id}" ${selected.includes(f.id)?'checked':''}>${icon('folder')}<span>${esc(f.name)}</span></label>`).join('')||'<p>Create a folder before granting access.</p>'}</div></fieldset>`;}
function selectedFolderIds(form){return [...form.querySelectorAll('input[name="folder_ids"]:checked')].map(input=>Number(input.value));}
function folderAccessModal(user){modal(`<h2 id="modal-title">Department & folder access</h2><p>Choose which departments and folders ${esc(user.name)} can view.</p><form id="folder-access-form">${readerEditingControl(user.can_submit_edits)}${departmentCheckboxes(user.department_ids)}${folderCheckboxes(user.folder_ids)}<div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="secondary" id="cancel-access">Cancel</button><button class="primary">Save access</button></div></form>`);$('#cancel-access').onclick=closeModal;$('#folder-access-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('users/access',{id:user.id,folder_ids:selectedFolderIds(e.target),department_ids:selectedDepartmentIds(e.target),can_submit_edits:e.target.elements.can_submit_edits.checked});closeModal();await settings();toast('Department and folder access updated');}catch(err){$('#folder-access-form .form-error').textContent=err.message;button.disabled=false;}};}
async function openDocument(id,updateUrl=true){try{const doc=await api('documents/'+id);state.documents=state.documents.filter(d=>d.id!==id);state.documents.push(doc);state.currentDoc=id;page='document';if(updateUrl)history.pushState(null,'',`/#/documents/${id}`);render();}catch(err){if(state){page='documents';history.replaceState(null,'',location.pathname+location.search);await refresh();}toast(err.message);}}

let homeChatMessages=[];
let homeChatPending=false;
let homeChatVersion=0;
function renderHomeChatSource(source){
  const id=Number(source.id);
  if(!Number.isSafeInteger(id)||id<1)return '';
  const images=(Array.isArray(source.images)?source.images:[]).filter(image=>new RegExp(`^/api/documents/${id}/(?:images|attachments)/[0-9]+$`).test(image.url));
  return `<div class="home-chat-source"><button type="button" data-chat-source="${id}">${icon('file')} ${esc(source.title)}</button>${images.length?`<div class="home-chat-images">${images.map(image=>`<a href="${esc(image.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(image.alt||'attached image')}"><img src="${esc(image.url)}" alt="${esc(image.alt||'Attached image')}" loading="lazy" decoding="async"></a>`).join('')}</div>`:''}</div>`;
}
function renderHomeChat(){
  const log=$('#home-chat-log');if(!log)return;
  log.hidden=!homeChatMessages.length;
  $('.dashboard-welcome').classList.toggle('chat-active',!!homeChatMessages.length);
  $('#home-new-chat').hidden=!homeChatMessages.length;
  log.innerHTML=homeChatMessages.map(message=>`<div class="home-chat-message ${message.role==='user'?'from-user':'from-assistant'}"><span class="home-chat-author">${message.role==='user'?'You':'Knowledge assistant'}</span><p>${esc(message.content)}</p>${message.sources?.length?`<div class="home-chat-sources">${message.sources.map(renderHomeChatSource).join('')}</div>`:''}</div>`).join('')+(homeChatPending?'<div class="home-chat-message from-assistant" role="status">Searching your accessible pages and writing an answer…</div>':'');
  log.scrollTop=log.scrollHeight;
  log.querySelectorAll('[data-chat-source]').forEach(button=>button.onclick=()=>openDocument(Number(button.dataset.chatSource)));
  log.querySelectorAll('.home-chat-images img').forEach(img=>img.onerror=()=>{const note=document.createElement('span');note.className='image-unavailable';note.textContent='Image unavailable';img.replaceWith(note);});
}
function dashboard(){
  $('#content').innerHTML=`<section class="help-dashboard"><div class="dashboard-welcome"><span class="dashboard-eyebrow">${esc(state.settings.workspace_name)} KNOWLEDGE BASE</span><h1>How can we help you?</h1><p>Find a guide, explore a topic, or get the answer you need.</p><div id="home-chat-log" class="home-chat-log" role="log" aria-label="Knowledge chat" aria-live="polite" hidden></div><form class="dashboard-search home-chat-form" id="dashboard-search-form"><label class="sr-only" for="dashboard-search-input">Ask the knowledge assistant</label><textarea id="dashboard-search-input" rows="2" maxlength="1000" placeholder="Ask a question about a procedure or policy…" required></textarea><button class="primary" type="submit" aria-label="Send message">Send ${icon('arrow')}</button></form><button type="button" id="home-new-chat" class="text-button home-new-chat" hidden>New chat</button><div id="home-chat-status" class="home-chat-status" role="status" aria-live="polite"></div><span class="dashboard-search-note">${icon('shield')} Answers use only published pages you have access to.</span></div><div class="dashboard-topics"><div class="dashboard-section-title"><div><h2>Common help topics</h2><p>Browse your knowledge by department.</p></div><button class="text-button" data-nav="documents">View all pages ${icon('arrow')}</button></div><div class="topic-grid">${state.departments.map(f=>{const count=state.documents.filter(d=>f.folder_ids.includes(d.space_id)).length;return `<button class="topic-card" data-department="${esc(f.id)}"><span class="topic-icon">${icon('users')}</span><h3>${esc(f.name)}</h3><p>${count} ${count===1?'page':'pages'}</p><span class="topic-link">Explore topic ${icon('arrow')}</span></button>`;}).join('')||`<div class="dashboard-empty">${icon('shield')}<h3>No topics available yet</h3><p>${admin()?'Assign folders to departments in Administration.':'Your administrator needs to enable departments and folders for your account.'}</p>${admin()?'<button class="secondary" data-action="add-space">Create folder</button>':''}</div>`}</div></div><div class="dashboard-footer">${icon('book')} Knowledge shared. Questions answered.</div></section>`;
  renderHomeChat();
  $('#home-new-chat').onclick=()=>{homeChatVersion++;homeChatMessages=[];homeChatPending=false;renderHomeChat();$('#home-chat-status').textContent='';$('#dashboard-search-form button[type="submit"]').disabled=false;$('#dashboard-search-input').focus();};
  $('#dashboard-search-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#dashboard-search-form').requestSubmit();}};
  $('#dashboard-search-form').onsubmit=async e=>{
    e.preventDefault();if(homeChatPending)return;
    const input=$('#dashboard-search-input'),question=input.value.trim();if(!question)return;
    const history=homeChatMessages.slice(-8).map(({role,content})=>({role,content}));
    const version=++homeChatVersion;
    homeChatMessages.push({role:'user',content:question});input.value='';homeChatPending=true;renderHomeChat();
    const button=$('#dashboard-search-form button[type="submit"]');button.disabled=true;
    try{const response=await api('chat',{question,history});if(version!==homeChatVersion)return;homeChatMessages.push({role:'assistant',content:response.answer,sources:response.sources||[]});$('#home-chat-status')?.replaceChildren();}
    catch(error){if(version!==homeChatVersion)return;homeChatMessages.push({role:'assistant',content:error.message});if($('#home-chat-status'))$('#home-chat-status').textContent='The answer could not be generated.';}
    finally{if(version===homeChatVersion){homeChatPending=false;button.disabled=false;renderHomeChat();input.focus();}}
  };
}

function renderDocumentBody(doc){
  if(doc.body.startsWith('::rich2::')||doc.body.startsWith('::rich::')){
    const page=readRichPage(doc);
    return page.content+(page.media.length?`<section class="document-media-section" aria-label="Videos and images"><h2>Videos/Images</h2><div class="editor-media-gallery">${page.media.map((item,index)=>mediaAttachmentHtml(item,index,false)).join('')}</div></section>`:'');
  }
  const text=value=>value.split('\n\n').filter(p=>p.trim()).map(renderDocumentParagraph).join('');
  let result='',cursor=0;
  for(const item of doc.images||[]){
    const at=doc.body.indexOf(item.placeholder,cursor);
    if(at<0||!new RegExp('^/api/documents/'+doc.id+'/images/[0-9]+$').test(item.url))continue;
    result+=text(doc.body.slice(cursor,at));
    result+=`<figure class="document-figure"><img class="document-image" src="${esc(item.url)}" alt="${esc(item.alt||'Document illustration')}" loading="lazy" decoding="async"></figure>`;
    cursor=at+item.placeholder.length;
  }
  return result+text(doc.body.slice(cursor));
}
function renderDocumentParagraph(value){
  if(value.startsWith('::image::')){
    const match=value.match(/^::image::(data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)::([^\n]*)$/);
    if(match)return `<figure class="document-figure"><img class="document-image" src="${match[1]}" alt="${esc(decodeURIComponent(match[2]))}" loading="lazy"></figure>`;
  }
  if(value.startsWith('::video::')){
    const url=safeMediaUrl(value.slice(9).trim(),['.mp4','.webm','.ogg']);
    if(url)return `<video class="document-video" controls preload="metadata" src="${esc(url)}">Your browser does not support video playback.</video>`;
  }
  if(/^\|[^\n]+\|\n\|(?:\s*:?-+:?\s*\|)+/.test(value)){
    const rows=value.split('\n').map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
    if(rows.length>=3&&rows.every(row=>row.length===rows[0].length))return `<div class="document-table-wrap"><table><thead><tr>${rows[0].map(cell=>`<th>${linkDocumentText(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row=>`<tr>${row.map(cell=>`<td>${linkDocumentText(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const lines=value.trimEnd().split('\n');
  if(lines.every(line=>/^[•○●■] /.test(line))){const type={'•':'disc','○':'circle','●':'disc','■':'square'}[lines[0][0]];return `<ul class="list-${type}">${lines.map(line=>`<li>${linkDocumentText(line.slice(2))}</li>`).join('')}</ul>`;}
  if(lines.every(line=>/^(?:\d+|[a-z]+)\. /.test(line))){
    const first=lines[0].match(/^([a-z]+|\d+)\. /)[1];
    const type=/^\d+$/.test(first)?'1':first==='i'?'i':'a';
    return `<ol type="${type}">${lines.map(line=>`<li>${linkDocumentText(line.replace(/^(?:\d+|[a-z]+)\. /,''))}</li>`).join('')}</ol>`;
  }
  if(value.startsWith('## '))return `<h3>${linkDocumentText(value.slice(3)).replace(/\n/g,'<br>')}</h3>`;
  if(value.startsWith('# '))return `<h2>${linkDocumentText(value.slice(2)).replace(/\n/g,'<br>')}</h2>`;
  const alignment=value.match(/^::(left|center|right|justify):: ?/);
  if(alignment)return `<p class="text-align-${alignment[1]}">${linkDocumentText(value.slice(alignment[0].length)).replace(/\n/g,'<br>')}</p>`;
  return `<p>${linkDocumentText(value).replace(/\n/g,'<br>')}</p>`;
}

function renderAssistantBlocks(response,source){
  if(!response.blocks?.length)return esc(response.answer||'');
  return response.blocks.map(block=>{
    if(block.type==='text')return `<div class="kb-answer-text">${esc(block.text)}</div>`;
    if(block.type==='image'&&new RegExp('^/api/documents/'+Number(source.id)+'/images/[0-9]+$').test(block.url))return `<figure class="kb-answer-figure"><a href="${esc(block.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open procedure image at full size"><img class="kb-answer-image" src="${esc(block.url)}" alt="${esc(block.alt||'Procedure illustration')}" loading="lazy" decoding="async"></a></figure>`;
    return '';
  }).join('');
}

let vsaRequestVersion = 0;

function closeVsa(){
  vsaRequestVersion++;
  document.getElementById('vsa-panel')?.remove();
  document.getElementById('vsa-launcher')?.setAttribute('aria-expanded','false');
}

function openVsa(){
  if(document.getElementById('vsa-panel')){
    document.getElementById('vsa-question').focus();
    return;
  }
  const panel=document.createElement('section');
  panel.id='vsa-panel';
  panel.className='vsa-panel';
  panel.setAttribute('aria-labelledby','vsa-title');
  panel.innerHTML=`<header class="vsa-heading"><div><span class="vsa-eyebrow">YOUR KNOWLEDGE ASSISTANT</span><h2 id="vsa-title">KB Assistant</h2></div><button type="button" class="icon-button" id="vsa-close" aria-label="Close KB Assistant">${icon('close')}</button></header><div class="vsa-body vsa-chat" id="vsa-results" role="log" aria-label="Conversation" aria-live="polite"><div class="kb-message kb-reply"><b>KB Assistant</b><p>Ask me about a procedure or policy. I’ll quote the instructions from your published knowledge pages here.</p></div></div><form id="vsa-form" class="kb-composer"><label for="vsa-question">Your question</label><textarea id="vsa-question" name="question" rows="2" maxlength="1000" placeholder="How do I process billing?" required></textarea><div id="vsa-status" role="status" aria-live="polite"></div><button class="primary" type="submit">${icon('arrow')} Send</button><small>Answers quote published pages in your available folders.</small></form>`;
  document.body.append(panel);
  document.getElementById('vsa-launcher')?.setAttribute('aria-expanded','true');
  const input=panel.querySelector('textarea');
  const close=()=>{closeVsa();document.getElementById('vsa-launcher')?.focus();};
  panel.querySelector('#vsa-close').onclick=close;
  panel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close();}};
  panel.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    const question=input.value.trim();
    if(!question){input.focus();return;}
    const version=++vsaRequestVersion;
    const button=panel.querySelector('button[type="submit"]');
    const status=panel.querySelector('#vsa-status');
    const results=panel.querySelector('#vsa-results');
    button.disabled=true;
    status.textContent='Searching your published procedures and policies…';
    results.insertAdjacentHTML('beforeend',`<div class="kb-message kb-question"><b>You</b><p>${esc(question)}</p></div>`);
    input.value='';
    results.scrollTop=results.scrollHeight;
    try{
      const response=await api('vsa',{question});
      if(version!==vsaRequestVersion||!state)return;
      status.textContent='';
      const source=response.sources[0];
      results.insertAdjacentHTML('beforeend',`<div class="kb-message kb-reply"><b>KB Assistant</b>${(response.answer||response.blocks?.length)?`<p>According to <strong>${esc(response.title)}</strong>:</p><div class="kb-exact-answer">${renderAssistantBlocks(response,source)}</div><button class="text-button" type="button" data-vsa-source="${Number(source.id)}">View full page ${icon('arrow')}</button>`:`<p>${esc(response.message)}</p>`}</div>`);
      results.querySelectorAll('.kb-answer-image').forEach(img=>{img.onerror=()=>{const note=document.createElement('p');note.className='image-unavailable';note.textContent='This source image is currently unavailable. Open the full page to try again.';img.replaceWith(note);};});
      results.scrollTop=results.scrollHeight;
      results.querySelectorAll('[data-vsa-source]').forEach(link=>link.onclick=()=>{const id=Number(link.dataset.vsaSource);closeVsa();openDocument(id);});
    }catch(error){
      if(version===vsaRequestVersion)status.textContent=error.message;
    }finally{
      if(version===vsaRequestVersion){button.disabled=false;input.focus();}
    }
  };
  input.focus();
}

function syncPageUrl(){if(!state)return;const id=pageIdFromHash();if(id)openDocument(id,false);else navigate('documents');}
window.addEventListener('hashchange',syncPageUrl);
boot();

// Escape document text before linking source URLs.
function linkDocumentText(value){
  const parts=[];let last=0;
  for(const match of value.matchAll(/\[\[page:(\d+)\|([^\]\n]+)\]\]/g)){
    parts.push(linkExternalText(value.slice(last,match.index)));
    parts.push(`<a class="document-internal-link" href="/#/documents/${match[1]}" data-linked-page="${match[1]}">${esc(match[2])}</a>`);
    last=match.index+match[0].length;
  }
  parts.push(linkExternalText(value.slice(last)));
  return parts.join('');
}
function linkExternalText(value){
  const parts=[];let last=0;
  for(const match of value.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g)){
    parts.push(formatDocumentText(value.slice(last,match.index)));
    parts.push(`<a class="source-link" href="${esc(match[2])}" target="_blank" rel="noopener noreferrer">${esc(match[1])}</a>`);
    last=match.index+match[0].length;
  }
  parts.push(formatDocumentText(value.slice(last)));
  return parts.join('');
}
function formatDocumentText(value){return esc(value).replace(/https?:\/\/[^\s<>]+/g,match=>{const url=match.replace(/[).,;]+$/,'');return `<a class="source-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${match.slice(url.length)}`;}).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/__([^_\n]+)__/g,'<u>$1</u>').replace(/::text-color:(#[0-9a-fA-F]{6})::(.*?)::end::/g,'<span style="color:$1">$2</span>').replace(/::background-color:(#[0-9a-fA-F]{6})::(.*?)::end::/g,'<span style="background-color:$1">$2</span>');}
