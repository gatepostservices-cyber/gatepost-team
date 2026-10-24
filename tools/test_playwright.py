# Mocked-GPS full walk (Chromium + WebKit, 390x844). Supabase fully mocked, service workers blocked, no accounts created.
# Run: python3 -m http.server 47613 --bind 127.0.0.1 &  python3 tools/test_playwright.py   -> /workspace/team-preview/walk_*
# Signs in (mock), clocks in, walks a whole session to the done screen, clocks out, checks the shift row was sent.
import json,math,sys,os,re;sys.path.insert(0,os.path.dirname(__file__))
from qa_mock import *
from playwright.sync_api import sync_playwright
OUT='/workspace/team-preview';NI,SI=1,1
ix=json.load(open('data/index.json'));g=json.load(open('data/'+ix['neighborhoods'][NI]['file']))
sess=sorted({f['properties']['session'] for f in g['features'] if f['properties']['kind']=='step'})[SI]
S0=sorted([f for f in g['features'] if f['properties']['kind']=='step' and f['properties']['session']==sess],key=lambda f:f['properties']['step'])
def interp(a,b,step):
  d=math.hypot((b[0]-a[0])*111320,(b[1]-a[1])*111320*math.cos(math.radians(a[0])));n=max(1,int(d/step))
  return [[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n] for k in range(1,n+1)]
pts=[]
for f in S0:
  c=[[y,x] for x,y in f['geometry']['coordinates']];pts.append(c[0])
  for i in range(1,len(c)): pts+=interp(c[i-1],c[i],8)
ok=True
def chk(c,m):
  global ok;print(('  ok ' if c else '  FAIL ')+m);ok&=bool(c)
with sync_playwright() as p:
  for name in (sys.argv[1:] or ['chromium','webkit']):
    print(name)
    b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':390,'height':844},service_workers='block',geolocation={'latitude':pts[0][0],'longitude':pts[0][1],'accuracy':6},permissions=['geolocation'])
    S=new_state(ix);hits=mock(ctx,S);pg=ctx.new_page();prep(pg,extra="localStorage.setItem('gpteam_locnote_v1','true');");errs=[];pg.on('pageerror',lambda e:errs.append(str(e)+' @ '+(e.stack or '')[:600]))
    pg.goto(URL);pg.wait_for_selector('#onboard:not([hidden])');pg.fill('#obemail','test@example.com');pg.fill('#obpw','correct-horse');pg.click('#obsubmit')
    pg.wait_for_selector('#home:not([hidden])');pg.click('#clockbtn');pg.wait_for_timeout(300);chk(pg.inner_text('#cblabel')=='Clock Out','clocked in')
    pg.click('#toroute');pg.wait_for_selector('.nb');pg.click(f'.nb >> nth={NI}');pg.click(f'.ses >> nth={SI}');pg.wait_for_timeout(800);pg.click('#go');pg.wait_for_timeout(900)
    count=lambda:pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('gpteam_progress'))||'{\"done\":[]}')).done.length")
    for j,q in enumerate(pts):
      ctx.set_geolocation({'latitude':q[0],'longitude':q[1],'accuracy':6});pg.wait_for_timeout(25)
      if j==len(pts)//2: pg.screenshot(path=f'{OUT}/walk_half_{name}.png');print('  halfway auto-checked',count(),'of',len(S0))
    pg.wait_for_selector('#fin:not([hidden])',timeout=8000);chk(count()==len(S0),f'all {len(S0)} steps auto-checked by GPS');pg.screenshot(path=f'{OUT}/walk_done_{name}.png')
    pg.click('#finclose');pg.wait_for_selector('#home:not([hidden])');pg.click('#clockbtn');pg.wait_for_selector('#ask:not([hidden])');pg.click('#askok');pg.wait_for_timeout(2000)
    sh=[x for x in S['posts'] if x['_t'].startswith('team_shifts')];chk(len(sh)==1 and sh[0]['sessions'] and sh[0]['user_id']==UID,'shift row sent with session')
    chk(pg.evaluate("JSON.parse(localStorage.getItem('gpteam_outbox_v1')||'[]').length")==0,'outbox empty')
    chk(not re.search(r'houses|pace|miles|/hr',pg.inner_text('body'),re.I),'no performance stats shown')
    chk(not errs,f'no page errors {errs}');chk(not hits,'no unmocked supabase');b.close()
print('PASS' if ok else 'FAIL');sys.exit(0 if ok else 1)
