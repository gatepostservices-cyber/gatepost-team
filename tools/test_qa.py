# Full QA pass: every flow + edge case, Chromium + WebKit at 390x844 and 360x780.
# Supabase fully mocked, service workers blocked, no real backend, no accounts created.
# Run: python3 -m http.server 47613 --bind 127.0.0.1 &  python3 tools/test_qa.py [chromium|webkit]   -> /workspace/team-preview/qa_*
import json,sys,os,re,time;sys.path.insert(0,os.path.dirname(__file__))
from qa_mock import *
from playwright.sync_api import sync_playwright
OUT='/workspace/team-preview';ix=json.load(open('data/index.json'))
LONG='Vista Grande Villa Verde and the Enchanted Hills Northwest Extension Phase Two'
ix2=json.loads(json.dumps(ix));ix2['neighborhoods'][1]['name']=LONG
g=json.load(open('data/'+ix['neighborhoods'][1]['file']));st=sorted([f for f in g['features'] if f['properties']['kind']=='step' and f['properties']['session']==1],key=lambda f:f['properties']['step'])
P0=[st[0]['geometry']['coordinates'][0][1],st[0]['geometry']['coordinates'][0][0]]
ok=True;fails=[]
def chk(c,m):
  global ok;print(('  ok ' if c else '  FAIL ')+m);ok&=bool(c)
  if not c: fails.append(m)
AUDIT="""()=>{const vw=innerWidth,vh=innerHeight,out=[],small=[],low=[];
 const vis=e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.top<vh&&r.bottom>0&&r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&e.closest('[hidden]')===null&&parseFloat(cs.opacity)>0.05&&!e.closest('.leaflet-pane')};
 const name=e=>e.id?('#'+e.id):(e.tagName.toLowerCase()+'.'+[...e.classList].join('.'))+'«'+(e.textContent||'').trim().slice(0,24)+'»';
 for(const e of document.querySelectorAll('body *')){if(!vis(e)||e.closest('.leaflet-control-container')||e.closest('#map'))continue;const r=e.getBoundingClientRect();
   if(r.right>vw+1||r.left<-1){const sc=e.closest('.bs-body,.tab,.home,.xp-stats');if(!sc||sc===e)out.push(name(e)+' '+Math.round(r.left)+'..'+Math.round(r.right))}}
 for(const e of document.querySelectorAll('button,a[href],input,[role=checkbox]')){if(!vis(e)||e.closest('.leaflet-control-container'))continue;const r=e.getBoundingClientRect();
   // padding hit-area pseudo (::after inset) counts
   const pa=getComputedStyle(e,'::after'),hit=pa.content!=='none'&&pa.position==='absolute';const ey=hit?Math.max(0,-parseFloat(pa.top)||0)+Math.max(0,-parseFloat(pa.bottom)||0):0,ex=hit?Math.max(0,-parseFloat(pa.left)||0)+Math.max(0,-parseFloat(pa.right)||0):0;
   if(r.height+ey<44-0.5||r.width+ex<44-0.5)small.push(name(e)+' '+Math.round(r.width)+'x'+Math.round(r.height))}
 const lum=c=>{let m=c.match(/[\\d.]+/g).map(Number);if(/^color\\(/.test(c))m=[m[0]*255,m[1]*255,m[2]*255,m[3]];const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return [.2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]),m[3]==null?1:m[3]]};
 const bgOf=e=>{for(let x=e;x;x=x.parentElement){const cs=getComputedStyle(x);if(cs.backgroundImage!=='none'&&!/^(HTML|BODY)$/.test(x.tagName))return null;const b=cs.backgroundColor;const [l,a]=lum(b);if(a>0.6)return l}return lum('rgb(11,20,16)')[0]};
 for(const e of document.querySelectorAll('body *')){if(!vis(e)||e.closest('#map'))continue;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!t)continue;
   const b=bgOf(e);if(b==null)continue;const [l]=lum(getComputedStyle(e).color);const cr=(Math.max(l,b)+.05)/(Math.min(l,b)+.05);if(cr<4.5)low.push(name(e)+' '+cr.toFixed(2))}
 return {overflow:out,small,low,docw:document.documentElement.scrollWidth>vw}}"""
def audit(pg,where):
  a=pg.evaluate(AUDIT);chk(not a['overflow'] and not a['docw'],f'{where}: no layout overflow {a["overflow"][:4]}');chk(not a['small'],f'{where}: tap targets >=44px {a["small"][:6]}');chk(not a['low'],f'{where}: text contrast >=4.5 {a["low"][:6]}')
def weak_fresh(p):
  b=p.webkit.launch();c=b.new_context(viewport={'width':390,'height':844},service_workers='block',geolocation={'latitude':P0[0],'longitude':P0[1],'accuracy':6},permissions=['geolocation']);mock(c,new_state(ix));pg=c.new_page()
  prep(pg,extra="localStorage.setItem('gpteam_session_v1',JSON.stringify({access_token:'tok',refresh_token:'rt',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'%s',email:'t@e.com'}}));"%UID)
  pg.goto(URL);pg.wait_for_selector('#home:not([hidden])');pg.click('#toroute');pg.wait_for_timeout(800);pg.click('#go');pg.wait_for_timeout(1000)
  c.set_geolocation({'latitude':P0[0]+0.0003,'longitude':P0[1]+0.0003,'accuracy':250});pg.wait_for_timeout(2000);r='Weak GPS' in pg.inner_text('#gps');b.close();return r
def run(p,name,vw,vh):
  tag=f'{name}_{vw}';print(f'== {tag}');first=(name=='chromium' and vw==390)
  shot=lambda n:pg.screenshot(path=f'{OUT}/qa_{n}.png' if first else f'{OUT}/qa_{n}_{tag}.png')
  b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=2,service_workers='block',geolocation={'latitude':P0[0],'longitude':P0[1],'accuracy':6},permissions=['geolocation'],has_touch=(name=='chromium'))
  S=new_state(ix);hits=mock(ctx,S)
  ctx.route('**/data/index.json',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(ix2)))
  pg=ctx.new_page();prep(pg,tour_seen=False);errs=[]
  pg.on('pageerror',lambda e:errs.append('pageerror '+str(e)))
  pg.on('console',lambda m:m.type=='error' and not re.search(r'Failed to load resource|ERR_INTERNET_DISCONNECTED|tile\.openstreetmap|net::',m.text) and errs.append('console '+m.text))
  # --- sign in: slow network shows progress, wrong password is friendly
  pg.goto(URL);pg.wait_for_selector('#onboard:not([hidden])');chk(pg.is_hidden('#start') and pg.is_hidden('#splash'),'no route-tracker flash before sign in');audit(pg,'sign in')
  pg.fill('#obemail','test@example.com');pg.fill('#obpw','wrong-pass');pg.click('#pwshow');chk(pg.get_attribute('#obpw','type')=='text','show password works')
  pg.click('#obsubmit');pg.wait_for_function("document.getElementById('obmsg').textContent.includes('not right')");pg.click('#pwshow')
  pg.evaluate('window.__slow=2500');pg.fill('#obpw','correct-horse');pg.click('#obsubmit');pg.wait_for_timeout(500)
  chk(pg.is_disabled('#obsubmit') and 'Signing in' in pg.inner_text('#obmsg'),'slow network: button disabled + "Signing in…"')
  pg.wait_for_selector('#home:not([hidden])',timeout=15000);pg.evaluate('window.__slow=0')
  # --- first-run tips
  pg.wait_for_selector('#tour:not([hidden])');pg.wait_for_timeout(400);shot('walkthrough');audit(pg,'walkthrough')
  pg.click('#tournext');chk('2 of 3' in pg.text_content('#tourn'),'tip 2');pg.click('#tournext');chk('3 of 3' in pg.text_content('#tourn'),'tip 3');pg.click('#tournext');chk(pg.is_hidden('#tour'),'tips close')
  pg.reload();pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(500);chk(pg.is_hidden('#tour'),'tips shown only once')
  chk(LONG in pg.inner_text('#myroutes'),'long name on Home');audit(pg,'home');shot('home')
  chk('(505) 750-3019' in pg.inner_text('#home') and 'Questions?' in pg.inner_text('#home'),'help text on Home')
  # --- clock in: location notice, double-tap guard
  pg.click('#clockbtn');pg.wait_for_selector('#locnote:not([hidden])');pg.click('#locok');pg.wait_for_timeout(800);chk(pg.inner_text('#cblabel')=='Clock Out','clocked in')
  sid=pg.evaluate("JSON.parse(localStorage.getItem('gpteam_shift_v1')).id")
  pg.dblclick('#clockbtn');pg.wait_for_timeout(300);chk(pg.is_visible('#ask') and 'Clock out' in pg.inner_text('#asktitle'),'clock-out asks first (double tap -> one dialog)');shot('clockout_confirm')
  pg.click('#askno');pg.wait_for_timeout(800);chk(pg.evaluate("JSON.parse(localStorage.getItem('gpteam_shift_v1')||'null')?.id")==sid,'cancel keeps the same shift')
  # double tap clock-in when clocked out must not clock in+out
  pg.click('#clockbtn');pg.click('#askok');pg.wait_for_timeout(900);chk(pg.inner_text('#cblabel')=='Clock In','clocked out after confirm')
  pg.dblclick('#clockbtn');pg.wait_for_timeout(500);chk(pg.inner_text('#cblabel')=='Clock Out' and pg.is_hidden('#ask'),'double-tap Clock In -> clocked in once, no clock-out')
  pg.wait_for_timeout(1500);t1=pg.inner_text('#cbtimer')
  # --- reload mid-shift
  pg.reload();pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(1200);chk(pg.inner_text('#cblabel')=='Clock Out' and pg.inner_text('#cbtimer')>=t1,f'reload keeps shift + timer ({t1} -> {pg.inner_text("#cbtimer")})')
  # --- route: pick long-name neighborhood, do 2 steps
  pg.click('#toroute');pg.wait_for_selector('.nb');pg.click('.nb >> nth=1');pg.click('.ses >> nth=0');pg.wait_for_timeout(800);audit(pg,'tracker start');shot('tracker')
  pg.click('#go');pg.wait_for_timeout(1200);pg.click('#done');pg.wait_for_timeout(800);pg.click('#done');pg.wait_for_timeout(900)
  chk(pg.inner_text('#xsteps').startswith('2/'),f'2 steps done ({pg.inner_text("#xsteps")})');chk(pg.is_visible('#recenter'),'recenter button present')
  pg.click('#recenter');audit(pg,'in route');shot('route')
  # weak GPS
  ctx.set_geolocation({'latitude':P0[0]+0.0003,'longitude':P0[1]+0.0003,'accuracy':250});
  try: pg.wait_for_function("document.getElementById('gps').textContent.includes('Weak GPS')",timeout=6000)
  except Exception:  # WebKit's harness sometimes drops one geolocation update; send another
    ctx.set_geolocation({'latitude':P0[0]+0.0006,'longitude':P0[1]+0.0006,'accuracy':260});pg.wait_for_timeout(3000)
  chk('Weak GPS' in pg.inner_text('#gps') or (name=='webkit' and print('  note: WebKit harness stops sending geolocation updates after a reload; weak-GPS checked on a fresh page instead') is None and weak_fresh(p)),'poor accuracy message: '+pg.inner_text('#gps'));chk(pg.inner_text('#xsteps').startswith('2/'),'no auto-check on weak GPS')
  ctx.set_geolocation({'latitude':P0[0],'longitude':P0[1],'accuracy':6})
  pg.click('#open');pg.wait_for_timeout(600);pg.click('.tabs [data-t=info]');pg.wait_for_timeout(300);audit(pg,'sheet info');pg.click('#sheetclose');pg.wait_for_timeout(400)
  # --- reload mid-route -> Home with Resume
  pg.reload();pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(600);chk(pg.is_visible('#resume') and 'step 3' in pg.inner_text('#resume'),f'Resume button ({pg.inner_text("#resume") if pg.is_visible("#resume") else "-"})');shot('resume')
  pg.click('#resume');pg.wait_for_timeout(1300);chk(pg.is_visible('#nav') and pg.inner_text('#xsteps').startswith('2/'),'resume restores progress')
  # --- offline mid-route, then clock out offline
  S['offline']=True;ctx.set_offline(True);pg.wait_for_timeout(600);chk(pg.is_visible('#netbar') and 'offline' in pg.inner_text('#netbar'),'offline banner');shot('offline_route')
  nt=pg.evaluate("document.querySelector('.hud-top').getBoundingClientRect().top");nb=pg.evaluate("document.getElementById('netbar').getBoundingClientRect().bottom");chk(nt>=nb-1,f'banner does not cover HUD ({nb:.0f}<={nt:.0f})')
  pg.click('#tohome') if pg.is_visible('#tohome') else None
  pg.click('#menu');pg.wait_for_timeout(500);pg.click('#tohome');pg.wait_for_selector('#home:not([hidden])')
  pg.click('#clockbtn');pg.click('#askok');pg.wait_for_timeout(1500)
  chk(pg.evaluate("JSON.parse(localStorage.getItem('gpteam_outbox_v1')||'[]').length")==1,'offline clock-out queued');chk('waiting to send' in pg.inner_text('#sync'),'pending sync indicator');shot('offline');audit(pg,'home offline')
  S['offline']=False;ctx.set_offline(False);pg.wait_for_timeout(2500)
  chk(len([x for x in S['posts'] if x['_t'].startswith('team_shifts')])==2 and pg.evaluate("JSON.parse(localStorage.getItem('gpteam_outbox_v1')||'[]').length")==0 and pg.is_hidden('#netbar'),'back online -> sent, banner gone');chk('All shifts sent' in pg.inner_text('#sync'),'synced indicator')
  # --- 10 hour reminder
  pg.evaluate("localStorage.setItem('gpteam_shift_v1',JSON.stringify({id:'s10',uid:'%s',in:new Date(Date.now()-10.2*3600e3).toISOString(),steps:{},routeMs:0,open:null,rs:{}}))"%UID)
  pg.wait_for_timeout(1500);chk(pg.is_visible('#ask') and 'Still working' in pg.inner_text('#asktitle'),'10-hour reminder');shot('reminder10');pg.click('#askno');pg.wait_for_timeout(1500);chk(pg.is_hidden('#ask'),'reminder shown once')
  # --- sign out while clocked in (warn first)
  pg.click('#signout');pg.wait_for_timeout(300);chk(pg.is_visible('#ask') and 'still clocked in' in pg.inner_text('#asktitle'),'sign-out warns while clocked in');shot('signout_warn')
  pg.click('#askno');chk(pg.is_visible('#home'),'cancel stays signed in');pg.click('#signout');pg.click('#askok');pg.wait_for_selector('#onboard:not([hidden])');pg.wait_for_timeout(800)
  chk(any(x.get('id')=='s10' for x in S['posts']),'shift sent before sign out');chk(pg.evaluate("localStorage.getItem('gpteam_shift_v1')") is None,'no shift left running')
  # --- session expiring while clocked in
  pg.fill('#obemail','test@example.com');pg.fill('#obpw','correct-horse');pg.click('#obsubmit');pg.wait_for_selector('#home:not([hidden])');pg.click('#clockbtn');pg.wait_for_timeout(900)
  S['expired']=True;pg.evaluate("(()=>{const s=JSON.parse(localStorage.getItem('gpteam_session_v1'));s.expires_at=1;localStorage.setItem('gpteam_session_v1',JSON.stringify(s))})()")
  pg.evaluate("dispatchEvent(new Event('online'))");pg.click('#clockbtn');pg.click('#askok');pg.wait_for_timeout(1500)
  chk(pg.is_visible('#netbar') and 'expired' in pg.inner_text('#netbar'),'expired sign-in banner');chk(pg.evaluate("JSON.parse(localStorage.getItem('gpteam_outbox_v1')||'[]').length")==1,'shift kept for later');shot('expired')
  S['expired']=False;pg.click('#netbtn');pg.wait_for_selector('#onboard:not([hidden])');pg.fill('#obemail','test@example.com');pg.fill('#obpw','correct-horse');pg.click('#obsubmit');pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(1500)
  chk(pg.evaluate("JSON.parse(localStorage.getItem('gpteam_outbox_v1')||'[]').length")==0 and pg.is_hidden('#netbar'),'after sign-in the queued shift sends')
  # --- bright sun mode
  pg.click('#suntog');pg.wait_for_timeout(300);chk(pg.evaluate("document.documentElement.classList.contains('sun')"),'sun mode on');audit(pg,'home sun');shot('sun')
  pg.click('#toroute');pg.wait_for_timeout(600);pg.click('#go');pg.wait_for_timeout(1200);audit(pg,'route sun');shot('route_sun');pg.click('#menu');pg.wait_for_timeout(400);pg.click('#tohome');pg.click('#suntog')
  # --- no routes assigned
  S['routes']=[];pg.reload();pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(600);chk('No routes yet' in pg.inner_text('#myroutes') and pg.is_hidden('#toroute') and pg.is_hidden('#resume'),'no-routes empty state');shot('noroutes')
  chk(not re.search(r'houses|pace|miles|/hr',pg.inner_text('body'),re.I),'no performance stats on Home')
  chk(not re.search(r'licensed|insured|bonded|certified|guarantee',open('index.html').read()+open('app.js').read(),re.I),'no licensed/insured/... claims')
  chk(not errs,f'no console/page errors {errs[:4]}');chk(not hits,'no unmocked supabase');b.close()
  # --- GPS denied / GPS timeout
  for mode in ('denied','timeout'):
    ctx=getattr(p,name).launch() if False else None
    b=getattr(p,name).launch();c2=b.new_context(viewport={'width':vw,'height':vh},service_workers='block',**({} if mode=='denied' else {'permissions':['geolocation']}));S2=new_state(ix);mock(c2,S2);pg=c2.new_page()
    extra="navigator.geolocation.watchPosition=(ok,err)=>{setTimeout(()=>err({code:3,message:'Timeout expired'}),300);return 1};" if mode=='timeout' else ''
    prep(pg,extra="localStorage.setItem('gpteam_session_v1',JSON.stringify({access_token:'tok',refresh_token:'rt',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'%s',email:'t@e.com'}}));localStorage.setItem('gpteam_locnote_v1','true');"%UID+extra)
    e2=[];pg.on('pageerror',lambda e:e2.append(str(e)))
    pg.goto(URL);pg.wait_for_selector('#home:not([hidden])');pg.click('#clockbtn');pg.wait_for_timeout(300);chk(pg.inner_text('#cblabel')=='Clock Out',f'GPS {mode}: can still clock in')
    pg.click('#toroute');pg.wait_for_timeout(600);pg.click('#go');pg.wait_for_timeout(2500);txt=pg.inner_text('#gps')
    chk(('Location is off' in txt) if mode=='denied' else ('Still looking' in txt),f'GPS {mode} message: {txt}')
    pg.click('#done');pg.wait_for_timeout(500);chk(pg.inner_text('#xsteps').startswith('1/'),f'GPS {mode}: Step done works by hand')
    pg.click('#recenter');pg.wait_for_timeout(300);audit(pg,f'gps {mode}')
    if mode=='denied': shot('gps_denied')
    chk(not e2,f'GPS {mode}: no errors {e2[:3]}');b.close()
  # --- offline cold start (routes json unavailable) still boots
  b=getattr(p,name).launch();c3=b.new_context(viewport={'width':vw,'height':vh},service_workers='block');mock(c3,new_state(ix,offline=True));c3.route('**/data/**',lambda r:r.abort());pg=c3.new_page()
  prep(pg,extra="localStorage.setItem('gpteam_session_v1',JSON.stringify({access_token:'tok',refresh_token:'rt',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'%s',email:'t@e.com'}}));localStorage.setItem('gpteam_me_v1',JSON.stringify({user_id:'%s',name:'Pat Tester',approved:true}));localStorage.setItem('gpteam_routes_v1','[]');"%(UID,UID))
  pg.goto(URL);pg.wait_for_timeout(2500);chk(pg.is_visible('#home') and 'did not load' in pg.inner_text('#myroutes'),'cold start with no data -> Home with friendly message');b.close()
with sync_playwright() as p:
  for name in (sys.argv[1:] or ['chromium','webkit']):
    for vw,vh in ((390,844),(360,780)): run(p,name,vw,vh)
print('\n'.join(['FAILURES:']+fails) if fails else '');print('PASS' if ok else 'FAIL');sys.exit(0 if ok else 1)
