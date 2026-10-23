// Gatepost Team: door-to-door route tracker. Loads data/index.json + each neighborhood .geojson (see README / data/SCHEMA.md).
(function(){
const ON_ROUTE_M=35, END_M=20, MAX_ACC_M=50;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ico=n=>`<svg><use href="#i-${n}"/></svg>`;
let NBS=[],RULES={},nb=null,ss=null,st=null,map,stepLayer,hiLayer,flowLayer,me=null,acc=null,last=null,prevFix=null,follow=true,prog=0,pickN=0,pickS=0,started=false;
const key=(n,s)=>`gpteam_progress_v1:${n.slug}:r${n.round||1}:s${s.n}`;
function hav(a,b){const r=Math.PI/180,dl=(b[0]-a[0])*r,dn=(b[1]-a[1])*r,x=Math.sin(dl/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dn/2)**2;return 12742000*Math.asin(Math.sqrt(x))}
function brg(a,b){const r=Math.PI/180,y=Math.sin((b[1]-a[1])*r)*Math.cos(b[0]*r),x=Math.cos(a[0]*r)*Math.sin(b[0]*r)-Math.sin(a[0]*r)*Math.cos(b[0]*r)*Math.cos((b[1]-a[1])*r);return(Math.atan2(y,x)/r+360)%360}
const fmt=m=>{const f=m*3.281;return f<1000?Math.max(0,Math.round(f/10)*10)+' ft':(m/1609).toFixed(2)+' mi'};
const cap=s=>s[0]+s.slice(1).toLowerCase();
// ---- data ----
function adapt(meta,gj){const fs=gj.features,pk=fs.find(f=>f.properties.kind==='parking');
  const sess=fs.filter(f=>f.properties.kind==='session_path').map(f=>({...f.properties,n:f.properties.session,path:f.geometry.coordinates.map(c=>[c[1],c[0]]),steps:[]})).sort((a,b)=>a.n-b.n);
  fs.filter(f=>f.properties.kind==='step').forEach(f=>{const s=sess.find(x=>x.n===f.properties.session);if(!s)return;
    const path=f.geometry.coordinates.map(c=>[c[1],c[0]]),cum=[0];for(let i=1;i<path.length;i++)cum.push(cum[i-1]+hav(path[i-1],path[i]));
    s.steps.push({...f.properties,path,cum,len:cum[cum.length-1]})});
  sess.forEach(s=>{s.steps.sort((a,b)=>a.step-b.step);s.totalLen=s.steps.reduce((t,x)=>t+x.len,0);s.knockLen=s.steps.reduce((t,x)=>t+(x.mode==='walk_no_knock'?0:x.len),0)});
  const pc=pk?pk.geometry.coordinates:meta.parking.coordinates;
  return {...meta,park:{...(meta.parking||{}),...(pk?pk.properties:{}),lat:pc[1],lng:pc[0]},sessions:sess}}
function getSt(n,s){let v=null;try{v=JSON.parse(localStorage.getItem(key(n,s)))}catch(e){}return v&&Array.isArray(v.done)?v:{done:[]}}
function save(){localStorage.setItem(key(nb,ss),JSON.stringify(st));localStorage.setItem('gpteam_last_v1',JSON.stringify([nb.slug,nb.round||1,ss.n]))}
const isDone=i=>st.done.includes(i);
const cur=()=>{for(let i=0;i<ss.steps.length;i++)if(!isDone(i))return i;return -1};
// ---- step semantics ----
function verb(t){if(/^Start/.test(t))return['straight','Head'];if(/^Turn around/.test(t))return['uturn','Turn around'];if(/^Continue/.test(t))return['straight','Continue'];
  if(/^Turn RIGHT/.test(t))return['right','Turn RIGHT'];if(/^Turn LEFT/.test(t))return['left','Turn LEFT'];if(/^Bear right/i.test(t))return['bright','Bear right'];if(/^Bear left/i.test(t))return['bleft','Bear left'];return['straight','Go']}
function knock(s){if(s.mode==='knock_both_sides')return['t-both','Knock both sides'];if(s.mode==='knock_one_side')return['t-one',s.pass_no===2?'Knock right side · way back':'Knock right side'];return['t-walk','Walk, no knocking']}
const toWhat=t=>{const m=/ to (.+)\.$/.exec(t);return m?m[1]:''};
function stats(){let dl=0,kl=0;ss.steps.forEach((x,i)=>{if(isDone(i)){dl+=x.len;if(x.mode!=='walk_no_knock')kl+=x.len}});const c=cur();if(c>=0){dl+=prog;if(ss.steps[c].mode!=='walk_no_knock')kl+=prog}
  const sd=streetState().filter(x=>x[1]).length;
  return{pct:Math.min(100,Math.round(dl/ss.totalLen*100)),doors:Math.round((ss.homes||0)*(ss.knockLen?kl/ss.knockLen:0)),streets:sd,nst:(ss.streets||[]).length,mi:dl/1609}}
function streetState(){return(ss.streets||[]).map(nm=>{const idx=ss.steps.map((x,i)=>x.street===nm&&x.mode!=='walk_no_knock'?i:-1).filter(i=>i>=0);return[nm,idx.length>0&&idx.every(isDone)]})}
// ---- map ----
function initMap(){map=L.map('map',{zoomControl:false,attributionControl:true,zoomSnap:.5});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  stepLayer=L.layerGroup().addTo(map);hiLayer=L.layerGroup().addTo(map);flowLayer=L.layerGroup().addTo(map);
  map.on('dragstart',()=>{follow=false;$('recenter').classList.remove('on')})}
function freeArea(){const top=document.querySelector('.hud-top').getBoundingClientRect().bottom;let bot=$('nav').getBoundingClientRect().top;
  if($('sheet').classList.contains('on'))bot=Math.min(bot,$('sheet').getBoundingClientRect().top);return[top,bot]}
function followTo(ll,anim){const [t,b]=freeArea(),H=map.getSize().y,off=(H-b-t)/2,z=map.getZoom()<16?16.5:map.getZoom();
  map.setView(map.unproject(map.project(ll,z).add([0,off]),z),z,{animate:anim!==false})}
function fitRoute(){const [t,b]=freeArea();map.fitBounds(L.latLngBounds(ss.path),{paddingTopLeft:[16,t+12],paddingBottomRight:[16,map.getSize().y-b+12]})}
function drawRoute(){stepLayer.clearLayers();const c=ss.color_hex;
  ss.steps.forEach((s,i)=>{s._l=L.polyline(s.path,{color:c,weight:s.mode==='walk_no_knock'?3:5,dashArray:s.mode==='walk_no_knock'?'2 7':null,lineCap:'round',lineJoin:'round',interactive:false}).addTo(stepLayer)});
  const p=nb.park;L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="pk">P</div>',iconSize:[34,34],iconAnchor:[17,17]}),keyboard:false}).addTo(stepLayer).bindPopup(esc(p.name));styleRoute()}
function styleRoute(){const c=cur(),col=ss.color_hex;
  ss.steps.forEach((s,i)=>{const d=isDone(i);s._l.setStyle({color:d?'#56635b':col,opacity:d?.55:(i===c?1:.8)})});
  hiLayer.clearLayers();flowLayer.clearLayers();if(c<0)return;
  const s=ss.steps[c];L.polyline(s.path,{color:col,weight:18,opacity:.35,className:'rt-glow',interactive:false,lineCap:'round'}).addTo(hiLayer);
  L.polyline(s.path,{color:col,weight:8,opacity:1,interactive:false,lineCap:'round'}).addTo(hiLayer);
  L.polyline(s.path,{color:'#fff',weight:3,opacity:.95,className:'rt-flow',interactive:false,lineCap:'round'}).addTo(flowLayer);
  const rest=[];ss.steps.slice(c+1).forEach(x=>rest.push(...x.path));if(rest.length)L.polyline(rest,{color:'#fff',weight:1.5,opacity:.4,className:'rt-flow',interactive:false}).addTo(flowLayer)}
// ---- start screen ----
function nbProgress(n){let d=0,t=0;n.sessions.forEach(s=>{d+=getSt(n,s).done.length;t+=s.steps.length});return t?Math.round(d/t*100):0}
function renderStart(){
  $('nbs').innerHTML=NBS.map((n,i)=>{const p=nbProgress(n);return `<button class="nb ${i===pickN?'on':''}" data-i="${i}"><span><b>${esc(n.name)}${(n.round||1)>1?' · R'+n.round:''}</b><small>${n.total_mi} mi · ~${n.total_homes} homes · ${n.sessions.length} sessions</small></span><span class="pr">${p?p+'%':''}</span></button>`}).join('');
  const n=NBS[pickN];
  $('sess').innerHTML=n.sessions.map((s,j)=>{const g=getSt(n,s),done=g.done.length>=s.steps.length;return `<button class="ses ${j===pickS?'on':''}" style="--c:${s.color_hex}" data-j="${j}">${done?`<span class="dn">${ico('check')}</span>`:''}<b>${cap(s.color)}</b><small>${s.mi} mi · ${s.homes} homes</small><small>${g.done.length?g.done.length+'/'+s.steps.length+' steps':'~'+(Math.round(s.minutes/30)/2)+' hr'}</small></button>`}).join('');
  const s=n.sessions[pickS],g=getSt(n,s);
  $('golabel').textContent=g.done.length>=s.steps.length?`Review ${cap(s.color)}`:g.done.length?`Resume ${cap(s.color)} · step ${g.done.length+1}`:`Start ${cap(s.color)} · ${s.mi} mi`;
  $('go').style.background=`linear-gradient(180deg,${s.color_hex},color-mix(in srgb,${s.color_hex} 70%,#000))`;$('go').style.color='#fff';$('go').style.boxShadow=`0 8px 22px color-mix(in srgb,${s.color_hex} 45%,transparent)`;
  if(!started){nb=n;ss=s;st=g;drawRoute();fitRouteStart()}}
function fitRouteStart(){const top=$('start').querySelector('.start-card').getBoundingClientRect().top;map.fitBounds(L.latLngBounds(ss.path),{paddingTopLeft:[24,24],paddingBottomRight:[24,map.getSize().y-top+16]})}
function showStart(){started=false;$('hud').hidden=true;$('start').classList.remove('out');$('start').hidden=false;closeSheet();renderStart()}
function begin(){nb=NBS[pickN];ss=nb.sessions[pickS];st=getSt(nb,ss);prog=0;started=true;save();
  document.documentElement.style.setProperty('--sc',ss.color_hex);
  $('sdot').style.background=ss.color_hex;$('sname').textContent=cap(ss.color);
  const p=nb.park,u=`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;$('parkbtn').href=u;$('finpark').href=u;
  $('park').innerHTML=`<b>${esc(p.name)}</b><p>${esc(p.address)}</p>${p.restroom?`<p>${esc(p.restroom)}</p>`:''}<a class="btn primary big" href="${u}" target="_blank" rel="noopener">${ico('car')}<span>Open in Google Maps</span></a>`;
  $('start').classList.add('out');setTimeout(()=>{if(started)$('start').hidden=true},350);$('hud').hidden=false;
  drawRoute();renderAll();requestAnimationFrame(()=>{measure();if(last&&follow)followTo(last,false);else fitRoute()});
  if(cur()<0)finish(false)}
// ---- HUD ----
function measure(){document.documentElement.style.setProperty('--navh',$('nav').getBoundingClientRect().height+'px')}
function renderNav(){const c=cur();const s=ss.steps[c];
  if(!s){$('action').textContent='Route complete';$('sub').textContent='Head back to the parking spot';$('then').innerHTML='';$('arrow').innerHTML=ico('flag');$('meter').style.width='100%';return}
  const [ic,vb]=verb(s.text),[cls,kn]=knock(s),left=Math.max(0,s.len-prog);
  $('arrow').innerHTML=ico(ic);$('action').textContent=`${vb} on ${s.street}`;
  $('sub').innerHTML=`<span class="tag ${cls}">${kn}</span> <b>${fmt(left)}</b>${toWhat(s.text)?' to '+esc(toWhat(s.text)):''}`;
  $('meter').style.width=Math.min(100,prog/s.len*100)+'%';
  const n1=ss.steps[c+1];$('then').innerHTML=n1?`<b>Then</b> ${esc(verb(n1.text)[1])} on ${esc(n1.street)} · ${esc(knock(n1)[1].toLowerCase())}`:'<b>Then</b> back to parking';
  const x=stats();$('pct').textContent=x.pct+'%';$('ringfg').style.strokeDashoffset=113.1*(1-x.pct/100);$('xdoors').textContent=x.doors;$('xstreets').textContent=`${x.streets}/${x.nst}`;$('xmiles').textContent=x.mi.toFixed(1)}
function renderSheet(){const c=cur();
  $('steps').innerHTML=ss.steps.map((x,i)=>`<li class="${isDone(i)?'done':''} ${i===c?'cur':''}" data-i="${i}" role="checkbox" aria-checked="${isDone(i)}" tabindex="0"><span class="ck">${ico('check')}</span><span class="n">${i+1}</span><span>${esc(x.text)}<small>${esc(knock(x)[1])}</small></span></li>`).join('');
  $('streets').innerHTML=streetState().map(([nm,d])=>`<li class="${d?'done':''}">${d?ico('check'):''}${esc(nm)}</li>`).join('')}
function renderAll(){renderNav();renderSheet();styleRoute();
  const x=stats();$('pct').textContent=x.pct+'%';$('ringfg').style.strokeDashoffset=113.1*(1-x.pct/100);$('xdoors').textContent=x.doors;$('xstreets').textContent=`${x.streets}/${x.nst}`;$('xmiles').textContent=x.mi.toFixed(1)}
let toastT;function toast(t){$('toasttxt').textContent=t;$('toast').classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>$('toast').classList.remove('show'),1800)}
function completed(i,manual){const before=streetState();st.done.push(i);if(manual)st.manual=true;prog=0;save();
  const after=streetState(),newSt=after.find((x,k)=>x[1]&&!before[k][1]);
  if(navigator.vibrate)navigator.vibrate(newSt?[40,60,40]:35);
  toast(newSt?`Street done · ${newSt[0]}`:`Step ${i+1} done`);
  $('arrow').classList.remove('pop');void $('arrow').offsetWidth;$('arrow').classList.add('pop');
  if(cur()<0)setTimeout(()=>finish(true),700)}
function setDone(i,v,manual){if(v&&!isDone(i))return completed(i,manual),renderAll();st.done=st.done.filter(x=>x!==i);prog=0;save();renderAll()}
// ---- finish ----
function streak(add){let days=[];try{days=JSON.parse(localStorage.getItem('gpteam_days_v1'))||[]}catch(e){}
  const today=new Date().toLocaleDateString('en-CA');if(add&&!days.includes(today)){days.push(today);localStorage.setItem('gpteam_days_v1',JSON.stringify(days.slice(-60)))}
  let n=0,d=new Date();while(days.includes(d.toLocaleDateString('en-CA'))){n++;d.setDate(d.getDate()-1)}return n}
function finish(fresh){const x=stats(),k=streak(fresh);
  $('medal').style.background=`radial-gradient(circle at 35% 30%,#fff6,transparent 60%),${ss.color_hex}`;$('medal').style.boxShadow=`0 0 0 6px rgba(255,255,255,.08),0 0 40px ${ss.color_hex}`;
  $('finsub').textContent=`${nb.name} · ${cap(ss.color)} session`;
  $('finstats').innerHTML=`<div><b>${ss.homes}</b><span>doors covered</span></div><div><b>${x.nst}</b><span>streets</span></div><div><b>${(ss.totalLen/1609).toFixed(1)}</b><span>miles walked</span></div><div><b>${ss.steps.length}</b><span>steps</span></div>`;
  const b=[['flag','Full route']];if(!st.manual)b.push(['gps','GPS tracked']);if(k>=2)b.push(['boot',`${k}-day streak`]);
  if(nb.sessions.every(s=>getSt(nb,s).done.length>=s.steps.length))b.push(['check','Neighborhood cleared']);
  $('badges').innerHTML=b.map(([i,t])=>`<span class="badge">${ico(i)}${t}</span>`).join('');
  $('fin').hidden=false;if(fresh&&navigator.vibrate)navigator.vibrate([60,80,60,80,120])}
// ---- sheet ----
function openSheet(){$('sheet').classList.add('on');$('scrim').classList.add('on');$('sheet').setAttribute('aria-hidden','false');renderSheet();const el=$('steps').querySelector('.cur');if(el)el.scrollIntoView({block:'center'})}
function closeSheet(){$('sheet').classList.remove('on');$('scrim').classList.remove('on');$('sheet').setAttribute('aria-hidden','true')}
// ---- GPS ----
function meIcon(){return L.divIcon({className:'',html:'<div class="me"><div class="cone"></div><div class="pulse"></div><div class="core"></div></div>',iconSize:[24,24],iconAnchor:[12,12]})}
function onPos(p){const ll=[p.coords.latitude,p.coords.longitude],a=p.coords.accuracy||0;
  let h=p.coords.heading;if(h==null||isNaN(h)||!(p.coords.speed>0.3))h=null;
  if(h==null&&prevFix&&hav(prevFix,ll)>3)h=brg(prevFix,ll);if(!prevFix||hav(prevFix,ll)>3)prevFix=ll;
  if(!me){me=L.marker(ll,{icon:meIcon(),interactive:false,keyboard:false,zIndexOffset:1000}).addTo(map);acc=L.circle(ll,{radius:a,color:'#3d8bff',weight:1,opacity:.5,fillOpacity:.1,interactive:false}).addTo(map);$('recenter').classList.toggle('on',follow)}
  else{me.setLatLng(ll);acc.setLatLng(ll).setRadius(a)}
  const el=me.getElement();if(el&&h!=null){el.firstChild.classList.add('h');el.querySelector('.cone').style.transform=`rotate(${h}deg)`}
  last=ll;const g=$('gps');g.className='gps'+(a>MAX_ACC_M?' warn':'');g.innerHTML=ico('gps')+(a>MAX_ACC_M?`Weak GPS (±${Math.round(a*3.281)} ft) · auto-check paused`:`GPS ±${Math.round(a*3.281)} ft · steps check off as you walk`);
  if(!started)return;
  if(follow)followTo(ll);
  if(a>MAX_ACC_M)return;
  let c=cur(),moved=false;
  for(let guard=0;c>=0&&guard<5;guard++){const s=ss.steps[c],[d,al]=project(s,ll);if(d<=ON_ROUTE_M)prog=Math.max(prog,al);
    if(prog>=s.len-END_M&&hav(ll,s.path[s.path.length-1])<=END_M+10){completed(c,false);moved=true;c=cur();continue}break}
  if(moved){renderSheet();styleRoute()}renderNav()}
function project(s,ll){const la=Math.cos(ll[0]*Math.PI/180),X=p=>[(p[1]-ll[1])*111320*la,(p[0]-ll[0])*111320];let best=[1e9,prog];
  for(let i=1;i<s.path.length;i++){if(s.cum[i]<prog-10)continue;const a=X(s.path[i-1]),b=X(s.path[i]),dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/L2)),d=Math.hypot(a[0]+t*dx,a[1]+t*dy);if(d<best[0])best=[d,s.cum[i-1]+t*(s.cum[i]-s.cum[i-1])]}return best}
function onErr(e){const g=$('gps');g.className='gps warn';g.innerHTML=ico('gps')+(e.code===1?'Location is blocked. Tap Step done as you go, or allow Location for this site in browser settings and reload.':'Looking for GPS… you can tap Step done as you go.');measure()}
function startGps(){if(!('geolocation' in navigator))return onErr({code:2});$('gps').innerHTML=ico('gps')+'Finding your location…';
  navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:3000,timeout:20000})}
// ---- wire up ----
function init(){initMap();
  $('nbs').onclick=e=>{const b=e.target.closest('.nb');if(!b)return;pickN=+b.dataset.i;pickS=0;const n=NBS[pickN],f=n.sessions.findIndex(s=>getSt(n,s).done.length<s.steps.length);pickS=f<0?0:f;renderStart()};
  $('sess').onclick=e=>{const b=e.target.closest('.ses');if(!b)return;pickS=+b.dataset.j;renderStart()};
  $('go').onclick=begin;$('menu').onclick=showStart;
  $('done').onclick=()=>{const c=cur();if(c>=0)setDone(c,true,true)};
  $('back').onclick=()=>{if(!st.done.length)return;st.done.pop();prog=0;save();renderAll();toast('Step undone')};
  $('open').onclick=openSheet;$('scrim').onclick=closeSheet;$('sheetclose').onclick=closeSheet;
  document.querySelector('.tabs').onclick=e=>{const t=e.target.closest('[data-t]');if(!t)return;document.querySelectorAll('.tabs [data-t]').forEach(b=>b.classList.toggle('on',b===t));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.id==='t-'+t.dataset.t))};
  $('steps').onclick=e=>{const li=e.target.closest('li');if(li)setDone(+li.dataset.i,!isDone(+li.dataset.i),true)};
  $('recenter').onclick=()=>{follow=true;$('recenter').classList.add('on');if(last)followTo(last);else fitRoute()};
  $('reset').onclick=()=>{if(confirm('Reset progress for this session?')){st={done:[]};prog=0;save();renderAll();closeSheet()}};
  $('finclose').onclick=()=>{$('fin').hidden=true;showStart()};
  addEventListener('resize',()=>{measure()});
  fetch('data/index.json',{cache:'no-cache'}).then(r=>r.json()).then(ix=>{RULES=ix.rules||{};
    $('rules').innerHTML=['hours','badge','no_soliciting','mailboxes','permit','restroom','contact'].filter(k=>RULES[k]).map(k=>`<li>${esc(RULES[k])}</li>`).join('');
    return Promise.all(ix.neighborhoods.map(m=>fetch('data/'+m.file,{cache:'no-cache'}).then(x=>x.json()).then(g=>adapt(m,g))))})
  .then(list=>{NBS=list;let l=null;try{l=JSON.parse(localStorage.getItem('gpteam_last_v1'))}catch(e){}
    if(l){const i=NBS.findIndex(n=>n.slug===l[0]&&(n.round||1)===(l[1]||1));if(i>=0){pickN=i;pickS=Math.max(0,NBS[i].sessions.findIndex(s=>s.n===l[2]))}}
    renderStart();startGps()})
  .catch(()=>{$('nbs').innerHTML='<p>Could not load routes. Check your connection and reload.</p>'})}
document.addEventListener('DOMContentLoaded',init);
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
