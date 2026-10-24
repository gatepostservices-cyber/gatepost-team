// Gatepost Team: door-to-door route tracker. Loads data/index.json + each neighborhood .geojson (see README / data/SCHEMA.md).
(function(){
const ON_ROUTE_M=35, END_M=20, MAX_ACC_M=50;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ico=n=>`<svg><use href="#i-${n}"/></svg>`;
let NBS=[],RULES={},nb=null,ss=null,st=null,map,stepLayer,hiLayer,flowLayer,me=null,acc=null,last=null,prevFix=null,follow=true,prog=0,pickN=0,pickS=0,started=false;
const key=(n,s)=>`gpteam_progress_v4:${n.slug}:r${n.round||1}:s${s.n}`;
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
  const pc=pk?pk.geometry.coordinates:meta.parking.coordinates,np={...(meta.parking||{}),...(pk?pk.properties:{}),lat:pc[1],lng:pc[0]};
  // v4: each session has its own parking spot (parking feature with properties.session, or session_path.parking)
  sess.forEach(s=>{const f=fs.find(x=>x.properties.kind==='parking'&&x.properties.session===s.n),q=f?{...f.properties,c:f.geometry.coordinates}:(s.parking?{...s.parking,c:s.parking.coordinates}:null);
    s.park=q?{...np,...q,restroom:q.restroom||np.restroom,lat:q.c[1],lng:q.c[0],label:q.label||('P'+s.n)}:{...np,label:'P'}});
  return {...meta,park:np,sessions:sess}}
function getSt(n,s){let v=null;try{v=JSON.parse(localStorage.getItem(key(n,s)))}catch(e){}return v&&Array.isArray(v.done)?v:{done:[]}}
function save(){localStorage.setItem(key(nb,ss),JSON.stringify(st));localStorage.setItem('gpteam_last_v1',JSON.stringify([nb.slug,nb.round||1,ss.n]))}
const isDone=i=>st.done.includes(i);
const cur=()=>{for(let i=0;i<ss.steps.length;i++)if(!isDone(i))return i;return -1};
// ---- step semantics ----
function verb(t){if(/^Start/.test(t))return['straight','Head'];if(/^Turn around/.test(t))return['uturn','Turn around'];if(/^Continue/.test(t))return['straight','Continue'];
  if(/^Turn right/i.test(t))return['right','Turn right'];if(/^Turn left/i.test(t))return['left','Turn left'];if(/^Go straight/.test(t))return['straight','Go straight'];if(/^Bear right/i.test(t))return['bright','Bear right'];if(/^Bear left/i.test(t))return['bleft','Bear left'];return['straight','Go']}
function knock(s){if(s.mode==='knock_both_sides')return['t-both','Knock both sides'];if(s.mode==='knock_one_side')return['t-one',s.pass_no===2?'Knock right side · way back':'Knock right side'];return['t-walk','Walk, no knocking']}
const toWhat=t=>{const m=/ to (.+)\.$/.exec(t);return m?m[1]:''};
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
  const p=ss.park||nb.park;L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:`<div class="pk">${esc(p.label||'P')}</div>`,iconSize:[34,34],iconAnchor:[17,17]}),keyboard:false}).addTo(stepLayer).bindPopup(esc(p.name));styleRoute()}
function styleRoute(){const c=cur(),col=ss.color_hex;
  ss.steps.forEach((s,i)=>{const d=isDone(i);s._l.setStyle({color:d?'#56635b':col,opacity:d?.55:(i===c?1:.8)})});
  hiLayer.clearLayers();flowLayer.clearLayers();if(c<0)return;
  const s=ss.steps[c];L.polyline(s.path,{color:col,weight:18,opacity:.35,className:'rt-glow',interactive:false,lineCap:'round'}).addTo(hiLayer);
  L.polyline(s.path,{color:col,weight:8,opacity:1,interactive:false,lineCap:'round'}).addTo(hiLayer);
  L.polyline(s.path,{color:'#fff',weight:3,opacity:.95,className:'rt-flow',interactive:false,lineCap:'round'}).addTo(flowLayer);
  const rest=[];ss.steps.slice(c+1).forEach(x=>rest.push(...x.path));if(rest.length)L.polyline(rest,{color:'#fff',weight:1.5,opacity:.4,className:'rt-flow',interactive:false}).addTo(flowLayer)}
// ---- start screen ----
function nbProgress(n){let d=0,t=0;n.sessions.forEach(s=>{d+=getSt(n,s).done.length;t+=s.steps.length});return t?Math.round(d/t*100):0}
function renderStart(){if(MYROUTES&&!MYROUTES.includes((NBS[pickN]||{}).slug)){const f=NBS.findIndex(n=>MYROUTES.includes(n.slug));if(f>=0){pickN=f;pickS=0}}
  $('nbs').innerHTML=NBS.map((n,i)=>{if(!MYROUTES||!MYROUTES.includes(n.slug))return '';const p=nbProgress(n);return `<button class="nb ${i===pickN?'on':''}" data-i="${i}"><span><b>${esc(n.name)}${(n.round||1)>1?' · R'+n.round:''}</b><small>${n.sessions.length} sessions · ${n.total_mi} mi</small></span><span class="pr">${p?p+'%':''}</span></button>`}).join('');
  const n=NBS[pickN];
  $('sess').innerHTML=n.sessions.map((s,j)=>{const g=getSt(n,s),done=g.done.length>=s.steps.length;return `<button class="ses ${j===pickS?'on':''}" style="--c:${s.color_hex}" data-j="${j}">${done?`<span class="dn">${ico('check')}</span>`:''}<b>${cap(s.color)}</b><small>${s.mi} mi</small><small class="spk">${esc(s.park&&s.park.label||'P')}: ${esc(s.park?s.park.name.replace(/^Street parking /,''):'')}</small><small>${g.done.length?g.done.length+'/'+s.steps.length+' steps':s.steps.length+' steps'}</small></button>`}).join('');
  const s=n.sessions[pickS],g=getSt(n,s);
  $('golabel').textContent=g.done.length>=s.steps.length?`Review ${cap(s.color)}`:g.done.length?`Resume ${cap(s.color)} · step ${g.done.length+1}`:`Start ${cap(s.color)} · ${s.mi} mi`;
  $('go').style.background=`linear-gradient(180deg,${s.color_hex},color-mix(in srgb,${s.color_hex} 70%,#000))`;$('go').style.color='#fff';$('go').style.boxShadow=`0 8px 22px color-mix(in srgb,${s.color_hex} 45%,transparent)`;
  if(!started){nb=n;ss=s;st=g;drawRoute();fitRouteStart()}}
function fitRouteStart(){const top=$('start').querySelector('.start-card').getBoundingClientRect().top;map.fitBounds(L.latLngBounds(ss.path),{paddingTopLeft:[24,24],paddingBottomRight:[24,map.getSize().y-top+16]})}
function showStart(){if(!MYROUTES||!MYROUTES.some(s=>NBS.some(n=>n.slug===s)))return goHome();SH.routeStop();started=false;$('home').hidden=true;$('hud').hidden=true;$('start').classList.remove('out');$('start').hidden=false;closeSheet();renderStart()}
function begin(){if(!(MYROUTES||[]).includes(NBS[pickN].slug))return goHome();nb=NBS[pickN];ss=nb.sessions[pickS];st=getSt(nb,ss);prog=0;started=true;save();SH.routeStart();
  document.documentElement.style.setProperty('--sc',ss.color_hex);
  $('sdot').style.background=ss.color_hex;$('sname').textContent=cap(ss.color);
  const p=ss.park||nb.park,u=`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;$('parkbtn').href=u;$('finpark').href=u;
  $('park').innerHTML=`<b>${esc((p.label?p.label+' · ':'')+p.name)}</b><p>${esc(p.address)}</p>${p.restroom?`<p>${esc(p.restroom)}</p>`:''}<a class="btn primary big" href="${u}" target="_blank" rel="noopener">${ico('car')}<span>Open in Google Maps</span></a>`;
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
  hudCounts()}
function hudCounts(){const sd=streetState();$('xsteps').textContent=`${st.done.length}/${ss.steps.length}`;$('xstreets').textContent=`${sd.filter(x=>x[1]).length}/${sd.length}`;$('shiftdot').hidden=!SH.cur()}
function renderSheet(){const c=cur();
  $('steps').innerHTML=ss.steps.map((x,i)=>`<li class="${isDone(i)?'done':''} ${i===c?'cur':''}" data-i="${i}" role="checkbox" aria-checked="${isDone(i)}" tabindex="0"><span class="ck">${ico('check')}</span><span class="n">${i+1}</span><span>${esc(x.text)}<small>${esc(knock(x)[1])}</small></span></li>`).join('');
  $('streets').innerHTML=streetState().map(([nm,d])=>`<li class="${d?'done':''}">${d?ico('check'):''}${esc(nm)}</li>`).join('')}
function renderAll(){renderNav();renderSheet();styleRoute();hudCounts()}
let toastT;function toast(t){$('toasttxt').textContent=t;$('toast').classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>$('toast').classList.remove('show'),1800)}
function completed(i,manual){const before=streetState();st.done.push(i);SH.step(i,true);if(manual)st.manual=true;prog=0;save();
  const after=streetState(),newSt=after.find((x,k)=>x[1]&&!before[k][1]);
  if(navigator.vibrate)navigator.vibrate(newSt?[40,60,40]:35);
  toast(newSt?`Street done · ${newSt[0]}`:`Step ${i+1} done`);
  $('arrow').classList.remove('pop');void $('arrow').offsetWidth;$('arrow').classList.add('pop');
  if(cur()<0)setTimeout(()=>finish(true),700)}
function setDone(i,v,manual){if(v&&!isDone(i))return completed(i,manual),renderAll();st.done=st.done.filter(x=>x!==i);SH.step(i,false);prog=0;save();renderAll()}
// ---- finish ----
function finish(fresh){SH.routeStop();
  $('medal').style.background=`radial-gradient(circle at 35% 30%,#fff6,transparent 60%),${ss.color_hex}`;$('medal').style.boxShadow=`0 0 0 6px rgba(255,255,255,.08),0 0 40px ${ss.color_hex}`;
  $('finsub').textContent=`${nb.name} · ${cap(ss.color)} session · all ${ss.steps.length} steps checked`;
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
  TRK.add(ll,a);
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

// ---- accounts (Supabase Auth over REST), shifts, walked path ----
// Workers only see clock, hours and their assigned routes; houses/hr, pace and miles are recorded silently.
const CFG=window.GATEPOST_TEAM_CONFIG||{};
const LS={get:(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const uuid=()=>(crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)}));
const SKEY='gpteam_session_v1';
const AU={
  s:()=>LS.get(SKEY,null),
  save(j){const s={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600),user:j.user};LS.set(SKEY,s);return s},
  async call(path,body,method,tok){const r=await fetch(CFG.SUPABASE_URL+'/auth/v1/'+path,{method:method||'POST',headers:{apikey:CFG.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined});
    let j={};try{j=await r.json()}catch(e){}if(!r.ok)throw new Error(j.msg||j.error_description||j.message||('Error '+r.status));return j},
  redirect:()=>location.origin+location.pathname,
  signUp:(email,password,name)=>AU.call('signup?redirect_to='+encodeURIComponent(AU.redirect()),{email,password,data:{signup_as:'team',full_name:name}}),
  async signIn(email,password){return AU.save(await AU.call('token?grant_type=password',{email,password}))},
  recover:email=>AU.call('recover?redirect_to='+encodeURIComponent(AU.redirect()),{email}),
  async setPassword(password){const s=AU.s();return AU.call('user',{password},'PUT',s&&s.access_token)},
  async token(){let s=AU.s();if(!s)return null;if(s.expires_at-60>Date.now()/1000)return s.access_token;
    try{s=AU.save(await AU.call('token?grant_type=refresh_token',{refresh_token:s.refresh_token}));return s.access_token}catch(e){if(navigator.onLine===false)return s.access_token;if(/invalid|not found|revoked/i.test(e.message))localStorage.removeItem(SKEY);return null}},
  async signOut(){const s=AU.s();localStorage.removeItem(SKEY);try{if(s)await AU.call('logout',null,'POST',s.access_token)}catch(e){}},
  uid:()=>{const s=AU.s();return s&&s.user&&s.user.id}};
async function rest(path,opt){const t=await AU.token();if(!t)throw Object.assign(new Error('signed out'),{status:401});
  return fetch(CFG.SUPABASE_URL+'/rest/v1/'+path,{...(opt||{}),headers:{apikey:CFG.SUPABASE_ANON_KEY,Authorization:'Bearer '+t,'Content-Type':'application/json',...((opt&&opt.headers)||{})}})}
let ME=null,MYROUTES=null; // team_members row; assigned route slugs
const worker=()=>ME&&{id:ME.user_id,name:ME.name||ME.email};
function stepEst(s,x){const homes=x.mode==='walk_no_knock'||!s.knockLen?0:(s.homes||0)*x.len/s.knockLen;return{homes,min:x.len/1609*20+homes*0.75,mi:x.len/1609}}
// walked path: only while clocked in; thinned to ~12 m or 15 s
const TRK={add(ll,a){const c=SH.cur();if(!c||a>MAX_ACC_M)return;const p=LS.get('gpteam_path_v1',[]),l=p[p.length-1],t=Date.now();
  if(l&&hav([l[0],l[1]],ll)<12&&t-l[2]<15000)return;p.push([+ll[0].toFixed(6),+ll[1].toFixed(6),t,Math.round(a)]);LS.set('gpteam_path_v1',p)}};
const SH={
  cur:()=>LS.get('gpteam_shift_v1',null),
  put:v=>LS.set('gpteam_shift_v1',v),
  step(i,on){const c=SH.cur();if(!c||!ss)return;const k=`${nb.slug}|${nb.round||1}|${ss.n}|${i}`;
    if(on){if(!c.steps[k]){const e=stepEst(ss,ss.steps[i]);c.steps[k]={h:e.homes,m:e.min,mi:e.mi,nb:nb.name,s:cap(ss.color),slug:nb.slug}}}else delete c.steps[k];SH.put(c)},
  routeStart(){const c=SH.cur();if(!c)return;if(!c.open)c.open=Date.now();c.rs=c.rs||{};const rk=nb.name+' · '+cap(ss.color);c.rs[rk]=c.rs[rk]||{neighborhood:nb.name,session:cap(ss.color),route_id:nb.slug,session_n:ss.n};c.openK=rk;SH.put(c)},
  routeStop(){const c=SH.cur();if(!c||!c.open)return;c.routeMs=(c.routeMs||0)+(Date.now()-c.open);c.open=null;SH.put(c)},
  clockIn(){localStorage.removeItem('gpteam_path_v1');SH.put({id:uuid(),uid:AU.uid(),in:new Date().toISOString(),steps:{},routeMs:0,open:started?Date.now():null,rs:{}});if(started)SH.routeStart();if(last)TRK.add(last,0)},
  clockOut(){SH.routeStop();const c=SH.cur();if(!c)return;const w=worker()||{id:c.uid,name:''},out=new Date(),hrs=(out-new Date(c.in))/3600000;
    const v=Object.values(c.steps),houses=Math.round(v.reduce((t,x)=>t+x.h,0)),est=v.reduce((t,x)=>t+x.m,0),act=(c.routeMs||0)/60000,mi=v.reduce((t,x)=>t+x.mi,0);
    const by={};Object.entries(c.steps).forEach(([k,x])=>{const q=x.nb+' · '+x.s;by[q]=(by[q]||0)+1});
    const sessions=Object.entries(c.rs||{}).map(([q,r])=>({...r,steps_checked:by[q]||0}));Object.keys(by).forEach(q=>{if(!c.rs||!c.rs[q]){const[a,b]=q.split(' · ');sessions.push({neighborhood:a,session:b,steps_checked:by[q]})}});
    const r2=n=>Math.round(n*100)/100;
    const row={id:c.id,user_id:c.uid||w.id,worker_id:c.uid||w.id,worker_name:w.name,clock_in:c.in,clock_out:out.toISOString(),hours:r2(hrs),houses,houses_per_hour:hrs>0?r2(houses/hrs):0,
      est_minutes:Math.round(est*10)/10,actual_minutes:Math.round(act*10)/10,pace_ratio:est>0?r2(act/est):null,miles:r2(mi),
      neighborhood:[...new Set(sessions.map(x=>x.neighborhood))].join(', ')||null,sessions};
    const hist=LS.get('gpteam_hours_v1',[]);hist.push({id:c.id,in:c.in,out:row.clock_out,h:hrs,uid:row.user_id});LS.set('gpteam_hours_v1',hist);
    const ob=LS.get('gpteam_outbox_v1',[]);ob.push(row);LS.set('gpteam_outbox_v1',ob);
    const pq=LS.get('gpteam_path_outbox_v1',[]);pq.push({shift_id:c.id,user_id:row.user_id,points:LS.get('gpteam_path_v1',[])});LS.set('gpteam_path_outbox_v1',pq);
    localStorage.removeItem('gpteam_path_v1');localStorage.removeItem('gpteam_shift_v1');SH.flush()},
  busy:false,
  async send(table,k,idk,rows){for(const row of rows){let r;try{r=await rest(table,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)})}catch(e){return false}
      const drop=()=>LS.set(k,LS.get(k,[]).filter(x=>x[idk]!==row[idk]));
      if(r.ok||r.status===409)drop();else if(r.status>=400&&r.status<500&&r.status!==401&&r.status!==403&&r.status!==429){console.warn(table+' rejected',r.status);drop();LS.set('gpteam_rejected_v1',LS.get('gpteam_rejected_v1',[]).concat([{table,row}]))}else return false}return true},
  async flush(){if(SH.busy||!CFG.SUPABASE_URL||!AU.s())return paintSync();SH.busy=true;
    try{const ob=LS.get('gpteam_outbox_v1',[]);if(ob.length&&await SH.send('team_shifts','gpteam_outbox_v1','id',ob)){
        // paths go after their shift row (both sit in the offline queue until sent)
        const sent=new Set(LS.get('gpteam_outbox_v1',[]).map(x=>x.id));await SH.send('team_shift_paths','gpteam_path_outbox_v1','shift_id',LS.get('gpteam_path_outbox_v1',[]).filter(p=>!sent.has(p.shift_id)))}
      else if(!ob.length){const pq=LS.get('gpteam_path_outbox_v1',[]);if(pq.length)await SH.send('team_shift_paths','gpteam_path_outbox_v1','shift_id',pq)}
      if(!LS.get('gpteam_outbox_v1',[]).length)loadHours()}
    catch(e){}finally{SH.busy=false;paintSync()}}};
addEventListener('online',()=>SH.flush());setInterval(()=>SH.flush(),60000);
function paintSync(){const n=LS.get('gpteam_outbox_v1',[]).length;$('sync').textContent=n?`${n} shift${n>1?'s':''} waiting to send. It will send when you have signal.`:''}
const hm=ms=>{const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),x=t%60;return`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`};
function weekStart(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
// hours: server rows (team_my_hours) + any not-yet-sent local rows
async function loadHours(){try{const r=await rest('rpc/team_my_hours',{method:'POST',body:'{}'});if(r.ok)LS.set('gpteam_srvhours_v1',{uid:AU.uid(),rows:await r.json()})}catch(e){}if(!$('home').hidden)paintHome()}
function hourRows(){const uid=AU.uid(),sv=LS.get('gpteam_srvhours_v1',null),srv=sv&&sv.uid===uid?sv.rows:[],ids=new Set(srv.map(x=>x.id));
  const pend=new Set(LS.get('gpteam_outbox_v1',[]).map(x=>x.id));
  return srv.map(x=>({in:x.clock_in,h:+x.hours||0})).concat(LS.get('gpteam_hours_v1',[]).filter(x=>x.uid===uid&&!ids.has(x.id)&&pend.has(x.id)).map(x=>({in:x.in,h:x.h})))}
function paintHome(){const w=worker(),c=SH.cur(),hist=hourRows(),ws=weekStart();if(!w)return;
  $('hello').textContent='Hi, '+(w.name||'').split(' ')[0];
  let tot=hist.reduce((t,x)=>t+x.h,0),wk=hist.filter(x=>new Date(x.in)>=ws).reduce((t,x)=>t+x.h,0);
  const live=c?(Date.now()-new Date(c.in))/3600000:0;tot+=live;if(c&&new Date(c.in)>=ws)wk+=live;
  $('htotal').textContent=tot.toFixed(1);$('hweek').textContent=wk.toFixed(1);
  $('clockbtn').classList.toggle('on',!!c);$('cblabel').textContent=c?'Clock Out':'Clock In';$('cbtimer').textContent=c?hm(Date.now()-new Date(c.in)):'';
  $('cbsince').textContent=c?'Clocked in at '+new Date(c.in).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Tap to start your shift';paintSync()}
function paintRoutes(){const list=NBS.filter(n=>(MYROUTES||[]).includes(n.slug));
  $('myroutes').innerHTML=list.length?list.map(n=>`<li><b>${esc(n.name)}${(n.round||1)>1?' · R'+n.round:''}</b><small>${n.sessions.length} sessions</small></li>`).join(''):'<li class="none">No routes assigned yet. An owner will assign your routes.</li>';
  $('toroute').hidden=!list.length}
setInterval(()=>{if(!$('home').hidden)paintHome()},1000);
function goHome(){if(started){SH.routeStop();started=false;$('hud').hidden=true;closeSheet()}$('start').hidden=true;$('fin').hidden=true;$('home').hidden=false;paintRoutes();paintHome()}
function clearMap(){[stepLayer,hiLayer,flowLayer].forEach(l=>l&&l.clearLayers())}
function hideAll(){['onboard','pending','home','start','hud','fin','locnote'].forEach(i=>$(i).hidden=true)}
let MODE='in';
function setMode(m){MODE=m;document.querySelectorAll('#obtabs button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));$('obtabs').hidden=m==='reset'||m==='newpw';
  $('obnamewrap').hidden=m!=='up';$('obemailwrap').hidden=m==='newpw';$('obpwwrap').hidden=m==='reset';$('forgot').hidden=m!=='in';
  $('obtitle').textContent={in:'Sign in',up:'Create account',reset:'Reset password',newpw:'Set a new password'}[m];
  $('obsubmitlbl').textContent={in:'Sign in',up:'Create account',reset:'Email me a reset link',newpw:'Save new password'}[m];
  $('obpw').autocomplete=m==='in'?'current-password':'new-password';msg('')}
function msg(t,err){$('obmsg').textContent=t;$('obmsg').className='fin-sub'+(err?' err':'')}
function showAuth(m){hideAll();clearMap();$('onboard').hidden=false;setMode(m||'in')}
// load profile + assignments; route the user to auth / pending / home
async function enter(){if(!AU.s())return showAuth('in');
  let r;try{r=await rest('team_members?select=user_id,name,email,approved&user_id=eq.'+AU.uid())}catch(e){
    if(e.status===401)return showAuth('in');ME=LS.get('gpteam_me_v1',null);MYROUTES=LS.get('gpteam_routes_v1',[])}
  if(r){if(r.status===401){await AU.signOut();return showAuth('in')}
    if(r.ok){ME=(await r.json())[0]||{user_id:AU.uid(),email:(AU.s().user||{}).email,approved:false};LS.set('gpteam_me_v1',ME);
      if(ME.approved){const q=await rest('route_assignments?select=route_id&user_id=eq.'+AU.uid());MYROUTES=q.ok?(await q.json()).map(x=>x.route_id):LS.get('gpteam_routes_v1',[]);LS.set('gpteam_routes_v1',MYROUTES)}}
    else{ME=LS.get('gpteam_me_v1',null);MYROUTES=LS.get('gpteam_routes_v1',[])}}
  if(!ME||ME.user_id!==AU.uid()){ME=null;return showAuth('in')}
  hideAll();if(!ME.approved){clearMap();$('pending').hidden=false;$('pendemail').textContent=ME.email||'';return}
  const i=NBS.findIndex(n=>MYROUTES.includes(n.slug));if(i>=0&&!MYROUTES.includes(NBS[pickN].slug)){pickN=i;pickS=0}
  goHome();loadHours();SH.flush()}
function locNotice(){if(LS.get('gpteam_locnote_v1',false))return Promise.resolve(true);
  return new Promise(res=>{$('locnote').hidden=false;$('locok').onclick=()=>{LS.set('gpteam_locnote_v1',true);$('locnote').hidden=true;res(true)};$('loccancel').onclick=()=>{$('locnote').hidden=true;res(false)}})}
function boot(){
  $('clockbtn').onclick=async()=>{const c=SH.cur();if(c){SH.clockOut();toast('Clocked out')}else{if(!(await locNotice()))return;SH.clockIn();toast('Clocked in')}if(navigator.vibrate)navigator.vibrate(40);paintHome()};
  $('signout').onclick=async()=>{if(SH.cur())return alert('Clock out first.');if(LS.get('gpteam_outbox_v1',[]).length&&!confirm('A shift has not sent yet. It will send next time you sign in. Sign out anyway?'))return;await AU.signOut();ME=null;showAuth('in')};
  $('pendout').onclick=async()=>{await AU.signOut();showAuth('in')};$('pendcheck').onclick=()=>enter();
  $('obtabs').onclick=e=>{const b=e.target.closest('[data-m]');if(b)setMode(b.dataset.m)};
  $('forgot').onclick=()=>setMode('reset');
  $('obform').onsubmit=async e=>{e.preventDefault();const email=$('obemail').value.trim().toLowerCase(),pw=$('obpw').value,name=$('obname').value.trim();
    if(MODE!=='newpw'&&!/^\S+@\S+\.\S+$/.test(email))return msg('Enter your email.',1);
    if((MODE==='up'||MODE==='newpw')&&pw.length<8)return msg('Password must be at least 8 characters.',1);
    if(MODE==='up'&&!name)return msg('Enter your name.',1);
    $('obsubmit').disabled=true;msg('Working…');
    try{if(MODE==='in'){await AU.signIn(email,pw);await enter()}
      else if(MODE==='up'){const j=await AU.signUp(email,pw,name);if(j.access_token){AU.save(j);await enter()}else{setMode('in');$('obemail').value=email;msg('Check your email for a link to confirm your account, then sign in.')}}
      else if(MODE==='reset'){await AU.recover(email);setMode('in');$('obemail').value=email;msg('If that email has an account, a reset link is on its way.')}
      else{await AU.setPassword(pw);history.replaceState(null,'',location.pathname);await enter();toast('Password saved')}}
    catch(err){msg(/invalid login/i.test(err.message)?'Email or password is not right.':/not confirmed/i.test(err.message)?'Confirm your email first (check your inbox), then sign in.':err.message,1)}
    finally{$('obsubmit').disabled=false}};
  // links from Supabase emails land here with tokens in the hash (signup confirm or password recovery)
  const hp=new URLSearchParams(location.hash.slice(1));
  if(hp.get('access_token')){AU.save({access_token:hp.get('access_token'),refresh_token:hp.get('refresh_token'),expires_in:+hp.get('expires_in')||3600,user:null});
    AU.call('user',null,'GET',hp.get('access_token')).then(u=>{const s=AU.s();s.user=u;LS.set(SKEY,s);if(hp.get('type')==='recovery')showAuth('newpw');else{history.replaceState(null,'',location.pathname);enter()}}).catch(()=>showAuth('in'));return}
  if(hp.get('error_description')){showAuth('in');msg(hp.get('error_description').replace(/\+/g,' '),1);history.replaceState(null,'',location.pathname);return}
  $('start').hidden=true;enter()}
// ---- wire up ----
function init(){initMap();
  $('nbs').onclick=e=>{const b=e.target.closest('.nb');if(!b||!(MYROUTES||[]).includes(NBS[+b.dataset.i].slug))return;pickN=+b.dataset.i;pickS=0;const n=NBS[pickN],f=n.sessions.findIndex(s=>getSt(n,s).done.length<s.steps.length);pickS=f<0?0:f;renderStart()};
  $('sess').onclick=e=>{const b=e.target.closest('.ses');if(!b)return;pickS=+b.dataset.j;renderStart()};
  $('go').onclick=begin;$('menu').onclick=showStart;
  $('done').onclick=()=>{const c=cur();if(c>=0)setDone(c,true,true)};
  $('back').onclick=()=>{if(!st.done.length)return;SH.step(st.done.pop(),false);prog=0;save();renderAll();toast('Step undone')};
  $('open').onclick=openSheet;$('scrim').onclick=closeSheet;$('sheetclose').onclick=closeSheet;
  document.querySelector('.tabs').onclick=e=>{const t=e.target.closest('[data-t]');if(!t)return;document.querySelectorAll('.tabs [data-t]').forEach(b=>b.classList.toggle('on',b===t));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.id==='t-'+t.dataset.t))};
  $('steps').onclick=e=>{const li=e.target.closest('li');if(li)setDone(+li.dataset.i,!isDone(+li.dataset.i),true)};
  $('recenter').onclick=()=>{follow=true;$('recenter').classList.add('on');if(last)followTo(last);else fitRoute()};
  $('reset').onclick=()=>{if(confirm('Reset progress for this session?')){st={done:[]};prog=0;save();renderAll();closeSheet()}};
  $('finclose').onclick=()=>{$('fin').hidden=true;goHome()};$('tohome').onclick=goHome;$('toroute').onclick=showStart;
  addEventListener('resize',()=>{measure()});
  fetch('data/index.json',{cache:'no-cache'}).then(r=>r.json()).then(ix=>{RULES=ix.rules||{};
    $('rules').innerHTML=['hours','badge','no_soliciting','mailboxes','permit','restroom','contact'].filter(k=>RULES[k]).map(k=>`<li>${esc(RULES[k])}</li>`).join('');
    return Promise.all(ix.neighborhoods.map(m=>fetch('data/'+m.file,{cache:'no-cache'}).then(x=>x.json()).then(g=>adapt(m,g))))})
  .then(list=>{NBS=list;let l=null;try{l=JSON.parse(localStorage.getItem('gpteam_last_v1'))}catch(e){}
    if(l){const i=NBS.findIndex(n=>n.slug===l[0]&&(n.round||1)===(l[1]||1));if(i>=0){pickN=i;pickS=Math.max(0,NBS[i].sessions.findIndex(s=>s.n===l[2]))}}
    MYROUTES=MYROUTES||[];renderStart();startGps();boot()})
  .catch(()=>{$('nbs').innerHTML='<p>Could not load routes. Check your connection and reload.</p>'})}
document.addEventListener('DOMContentLoaded',init);
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
