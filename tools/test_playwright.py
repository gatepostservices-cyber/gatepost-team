# Mocked-GPS walk test (Chromium + WebKit, 390x844).
# Run: python3 -m http.server 47613 --bind 127.0.0.1 &  python3 tools/test_playwright.py
# Walks a full short session (2nd neighborhood, 2nd session) to the done screen; screenshots to /workspace/team-preview/v2_*.
import json,math,sys
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:47613/';OUT='/workspace/team-preview';NI,SI=1,1
ix=json.load(open('data/index.json'));g=json.load(open('data/'+ix['neighborhoods'][NI]['file']))
sess=sorted({f['properties']['session'] for f in g['features'] if f['properties']['kind']=='step'})[SI]
S=sorted([f for f in g['features'] if f['properties']['kind']=='step' and f['properties']['session']==sess],key=lambda f:f['properties']['step'])
def interp(a,b,step):
  d=math.hypot((b[0]-a[0])*111320,(b[1]-a[1])*111320*math.cos(math.radians(a[0])));n=max(1,int(d/step))
  return [[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n] for k in range(1,n+1)]
pts=[];idx=[]
for k,f in enumerate(S):
  c=[[y,x] for x,y in f['geometry']['coordinates']]
  if not pts: pts.append(c[0]);idx.append(0)
  for a,b in zip(c,c[1:]):
    for q in interp(a,b,10): pts.append(q);idx.append(k)
ok=True
with sync_playwright() as p:
  for name in ('chromium','webkit'):
    b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,geolocation={'latitude':pts[0][0],'longitude':pts[0][1],'accuracy':6},permissions=['geolocation'])
    pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(URL);pg.wait_for_selector('.nb');pg.click(f'.nb >> nth={NI}');pg.click(f'.ses >> nth={SI}');pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{OUT}/v2_start_{name}.png')
    pg.click('#go');pg.wait_for_timeout(900)
    count=lambda:len(pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('gpteam_progress'))||'{\"done\":[]}')).done"))
    shot_w=shot_c=False;prev=0
    for j,q in enumerate(pts):
      ctx.set_geolocation({'latitude':q[0],'longitude':q[1],'accuracy':6});pg.wait_for_timeout(25)
      if not shot_w and idx[j]==3 and j+1<len(idx) and idx[j+1]==3 and j>0 and idx[j-3]==3:
        pg.wait_for_timeout(500);pg.screenshot(path=f'{OUT}/v2_walking_{name}.png');shot_w=True
      if shot_w and not shot_c:
        n=count()
        if n>=4: pg.wait_for_timeout(250);pg.screenshot(path=f'{OUT}/v2_step_complete_{name}.png');shot_c=True
      if j==len(pts)//2:
        pg.click('#open');pg.wait_for_timeout(700);pg.screenshot(path=f'{OUT}/v2_expanded_{name}.png');pg.click('#sheetclose');pg.wait_for_timeout(400)
        print(name,'halfway: auto-checked',count(),'of',len(S))
    pg.wait_for_selector('#fin:not([hidden])',timeout=8000);pg.wait_for_timeout(1200)
    print(name,'end: auto-checked',count(),'of',len(S),'| done screen:',pg.is_visible('#fin'),'| badges:',pg.inner_text('#badges').replace('\n',', '),'| errors:',errs)
    ok&=count()==len(S) and not errs
    pg.screenshot(path=f'{OUT}/v2_session_done_{name}.png');b.close()
  b=p.chromium.launch();ctx=b.new_context(viewport={'width':390,'height':844});pg=ctx.new_page();pg.goto(URL);pg.wait_for_selector('.nb');pg.click('#go');pg.wait_for_timeout(2500)
  print('no permission:',pg.inner_text('#gps'));b.close()
print('PASS' if ok else 'FAIL');sys.exit(0 if ok else 1)
