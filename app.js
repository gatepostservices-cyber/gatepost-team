// Gatepost Team: door-to-door route tracker. Loads data/index.json + each neighborhood .geojson (see README / data/SCHEMA.md).
(function(){
const ON_ROUTE_M=35, END_M=20, MAX_ACC_M=50;
const $=id=>document.getElementById(id);
let IDX=null,NBS=[],nb=null,ss=null,st=null,map,layers,me,acc,last=null,follow=true,prog=0;
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const key=()=>`gpteam_progress_v1:${nb.slug}:r${nb.round||1}:s${ss.n}`;
function hav(a,b){const r=Math.PI/180,dl=(b[0]-a[0])*r,dn=(b[1]-a[1])*r,x=Math.sin(dl/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dn/2)**2;return 12742000*Math.asin(Math.sqrt(x))}
const ft=m=>{const f=m*3.281;return f<1000?Math.round(f/10)*10+' ft':(m/1609).toFixed(2)+' mi'};
function modeInfo(s){if(s.mode==='knock_both_sides')return['m-both','Knock BOTH sides'];
  if(s.mode==='knock_one_side')return['m-one',`Knock RIGHT side · pass ${s.pass_no||1}${s.pass_no===2?' (back)':''}`];return['m-walk','Walk, no knocking']}
// ---- data ----
function adapt(meta,gj){const fs=gj.features,pk=fs.find(f=>f.properties.kind==='parking');
  const sess=fs.filter(f=>f.properties.kind==='session_path').map(f=>({...f.properties,n:f.properties.session,path:f.geometry.coordinates.map(c=>[c[1],c[0]]),steps:[]})).sort((a,b)=>a.n-b.n);
  fs.filter(f=>f.properties.kind==='step').forEach(f=>{const s=sess.find(x=>x.n===f.properties.session);if(!s)return;
    const path=f.geometry.coordinates.map(c=>[c[1],c[0]]),cum=[0];for(let i=1;i<path.length;i++)cum.push(cum[i-1]+hav(path[i-1],path[i]));
    s.steps.push({...f.properties,path,cum,len:cum[cum.length-1]})});
  sess.forEach(s=>s.steps.sort((a,b)=>a.step-b.step));
  const pc=(pk?pk.geometry.coordinates:meta.parking.coordinates);
  return {...meta,park:{...(meta.parking||{}),...(pk?pk.properties:{}),lat:pc[1],lng:pc[0]},sessions:sess}}
// ---- state ----
function load(){try{st=JSON.parse(localStorage.getItem(key()))}catch(e){st=null}if(!st||!Array.isArray(st.done))st={done:[]};prog=0}
function save(){localStorage.setItem(key(),JSON.stringify(st));localStorage.setItem('gpteam_last_v1',JSON.stringify([nb.slug,nb.round,ss.n]))}
const isDone=i=>st.done.includes(i);
const cur=()=>{for(let i=0;i<ss.steps.length;i++)if(!isDone(i))return i;return -1};
function setDone(i,v){st.done=st.done.filter(x=>x!==i);if(v)st.done.push(i);prog=0;save();render()}
// ---- UI ----
function setPanel(m){document.body.classList.toggle('exp',m==='expanded');$('panel').className='glass panel '+m;localStorage.setItem('gpteam_panel_v1',m)}
function init(){
  map=L.map('map',{zoomControl:false,attributionControl:true});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  map.on('dragstart',()=>{follow=false;$('recenter').classList.remove('on')});layers=L.layerGroup().addTo(map);
  setPanel(localStorage.getItem('gpteam_panel_v1')||'normal');
  $('grab').onclick=()=>{const c=$('panel').classList;setPanel(c.contains('slim')?'normal':c.contains('normal')?'expanded':'slim')};
  $('slim').onclick=()=>setPanel('normal');
  $('recenter').onclick=()=>{follow=true;$('recenter').classList.add('on');if(last)map.setView(last,Math.max(map.getZoom(),17));else fitRoute()};
  $('nb').onchange=e=>pickNb(+e.target.value);
  $('done').onclick=()=>{const c=cur();if(c>=0)setDone(c,true)};
  $('back').onclick=()=>{if(!st.done.length)return;st.done.pop();prog=0;save();render()};
  $('reset').onclick=()=>{if(confirm('Reset progress for this session?')){st={done:[]};prog=0;save();render()}};
  $('steps').onchange=e=>{if(e.target.dataset.i!=null)setDone(+e.target.dataset.i,e.target.checked)};
  fetch('data/index.json',{cache:'no-cache'}).then(r=>r.json()).then(ix=>{IDX=ix;
    const r=ix.rules||{};$('rules').innerHTML=['hours','badge','no_soliciting','mailboxes','permit','restroom','contact'].filter(k=>r[k]).map(k=>`<li>${esc(r[k])}</li>`).join('');
    return Promise.all(ix.neighborhoods.map(m=>fetch('data/'+m.file,{cache:'no-cache'}).then(x=>x.json()).then(g=>adapt(m,g))))})
  .then(list=>{NBS=list;
    $('nb').innerHTML=NBS.map((n,i)=>`<option value="${i}">${esc(n.name)}${(n.round||1)>1?' (round '+n.round+')':''}</option>`).join('');
    let l=null;try{l=JSON.parse(localStorage.getItem('gpteam_last_v1'))}catch(e){}
    const ni=l?Math.max(0,NBS.findIndex(n=>n.slug===l[0]&&(n.round||1)===(l[1]||1))):0;$('nb').value=ni;pickNb(ni,l&&l[2]);startGps()})
  .catch(()=>{$('ntext').textContent='Could not load routes. Check your connection and reload.'})}
function fitRoute(){map.fitBounds(L.latLngBounds(ss.path).pad(.08),{paddingTopLeft:[0,120],paddingBottomRight:[0,260]})}
function pickNb(i,sn){nb=NBS[i];
  $('sess').innerHTML=nb.sessions.map((s,j)=>`<button style="--c:${s.color_hex}" data-j="${j}">${esc(s.color[0]+s.color.slice(1).toLowerCase())}</button>`).join('');
  $('sess').querySelectorAll('button').forEach(b=>b.onclick=()=>pickSess(+b.dataset.j));
  const p=nb.park,u=`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;$('parkbtn').href=u;
  $('park').innerHTML=`<div><b>${esc(p.name)}</b></div><div>${esc(p.address)}</div>${p.restroom?`<div style="margin-top:4px">${esc(p.restroom)}</div>`:''}<a href="${u}" target="_blank" rel="noopener">Open in Google Maps</a>`;
  pickSess(Math.max(0,nb.sessions.findIndex(s=>s.n===sn)))}
function pickSess(j){ss=nb.sessions[j];load();save();
  $('sess').querySelectorAll('button').forEach((b,k)=>b.classList.toggle('on',k===j));$('panel').style.setProperty('--sc',ss.color_hex);
  layers.clearLayers();
  ss.steps.forEach(s=>{s._l=L.polyline(s.path,{color:ss.color_hex,weight:s.mode==='walk_no_knock'?3:6,dashArray:s.mode==='walk_no_knock'?'4 8':null}).addTo(layers)});
  const p=nb.park;L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div style="background:#1f3a2b;color:#fff;font-weight:800;border:2px solid #fff;border-radius:6px;width:26px;height:26px;display:grid;place-items:center;box-shadow:0 1px 4px #0006">P</div>',iconSize:[26,26]})}).addTo(layers).bindPopup(esc(p.name));
  if(follow&&last)map.setView(last,17);else fitRoute();render()}
function render(){const c=cur(),n=ss.steps.length,s=ss.steps[c];
  if(c<0){$('stepno').textContent='Done';$('mode').textContent='';$('left').textContent='';$('ntext').textContent='Session complete. Head back to the parking spot.';$('street').textContent='';$('upnext').innerHTML='';$('slim').textContent='Session complete ✓'}
  else{const [cls,lab]=modeInfo(s);$('stepno').textContent=`Step ${c+1}/${n}`;$('mode').className='mode '+cls;$('mode').textContent=lab;
    $('left').textContent=ft(Math.max(0,s.len-prog))+' left';$('ntext').textContent=s.text;$('street').textContent=s.street;
    $('upnext').innerHTML=ss.steps.slice(c+1,c+3).map((x,k)=>`<li><b>Then${k?' ':''}:</b> ${esc(x.text)}</li>`).join('');
    $('slim').textContent=`${c+1}/${n} · ${s.street} · ${lab} · ${ft(Math.max(0,s.len-prog))}`}
  $('prog').textContent=`${st.done.length}/${n} done`;
  $('steps').innerHTML=ss.steps.map((x,i)=>`<li class="${isDone(i)?'done':''} ${i===c?'cur':''}"><input type="checkbox" aria-label="Step ${i+1} done" data-i="${i}" ${isDone(i)?'checked':''}><b>${i+1}</b><span>${esc(x.text)}<small>${esc(modeInfo(x)[1])}</small></span></li>`).join('');
  ss.steps.forEach((x,i)=>x._l.setStyle({opacity:isDone(i)?.3:.95,weight:i===c?9:(x.mode==='walk_no_knock'?3:6)}));if(s)s._l.bringToFront();
  $('streets').innerHTML=(ss.streets||[]).map(nm=>{const idx=ss.steps.map((x,i)=>x.street===nm&&x.mode!=='walk_no_knock'?i:-1).filter(i=>i>=0);const d=idx.length&&idx.every(isDone);return `<li class="${d?'done':''}">${d?'✓ ':''}${esc(nm)}</li>`}).join('')}
// project point onto step path at/after current progress; returns [distance to path, along-distance]
function project(s,ll){const la=Math.cos(ll[0]*Math.PI/180),X=p=>[(p[1]-ll[1])*111320*la,(p[0]-ll[0])*111320];let best=[1e9,prog];
  for(let i=1;i<s.path.length;i++){if(s.cum[i]<prog-10)continue;const a=X(s.path[i-1]),b=X(s.path[i]),dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/L2)),d=Math.hypot(a[0]+t*dx,a[1]+t*dy);if(d<best[0])best=[d,s.cum[i-1]+t*(s.cum[i]-s.cum[i-1])]}
  return best}
function onPos(p){const ll=[p.coords.latitude,p.coords.longitude],a=p.coords.accuracy||0;last=ll;
  if(!me){me=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#1a73e8',fillOpacity:1}).addTo(map);acc=L.circle(ll,{radius:a,color:'#1a73e8',weight:1,fillOpacity:.12,interactive:false}).addTo(map);$('recenter').classList.toggle('on',follow)}
  else{me.setLatLng(ll);acc.setLatLng(ll).setRadius(a)}me.bringToFront();
  $('gps').className='gps';$('gps').textContent=`GPS on · ±${Math.round(a*3.281)} ft`+(a>MAX_ACC_M?' · weak signal, auto-check paused':' · steps check off as you walk');
  if(follow)map.panTo(ll,{animate:true});
  if(a>MAX_ACC_M)return;
  let c=cur(),moved=false;
  for(let guard=0;c>=0&&guard<5;guard++){const s=ss.steps[c],[d,al]=project(s,ll);
    if(d<=ON_ROUTE_M)prog=Math.max(prog,al);
    const end=s.path[s.path.length-1];
    if(prog>=s.len-END_M&&hav(ll,end)<=END_M+10){st.done.push(c);prog=0;moved=true;c=cur();continue}
    break}
  if(moved)save();render()}
function onErr(e){$('gps').className='gps warn';$('gps').textContent=e.code===1?'Location is blocked for this site. You can still check steps by hand. To turn it on, allow Location for this site in your browser settings and reload.':'Waiting for GPS… you can check steps by hand.'}
function startGps(){if(!('geolocation' in navigator)){onErr({code:2});return}
  $('gps').textContent='Finding your location…';navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:5000,timeout:20000})}
document.addEventListener('DOMContentLoaded',init);
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
