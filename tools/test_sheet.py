# Bottom-sheet test (route tracker + nav card). Supabase fully mocked, service workers blocked, no real backend. Chromium + WebKit, 390x844.
# Run: python3 -m http.server 47613 --bind 127.0.0.1 &  python3 tools/test_sheet.py   -> /workspace/team-preview/sheet_*
import json,sys
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:47613/';OUT='/workspace/team-preview';SB='https://hssevqgkoeuludwoxyuo.supabase.co'
ix=json.load(open('data/index.json'));UID='11111111-2222-4333-8444-555555555555';ok=True
g=json.load(open('data/'+ix['neighborhoods'][1]['file']));f0=[f for f in g['features'] if f['properties']['kind']=='step'][0];x0,y0=f0['geometry']['coordinates'][0]
def chk(c,msg):
  global ok;print(('  ok ' if c else '  FAIL ')+msg);ok&=bool(c)
def run(name,p):
  b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,service_workers='block',geolocation={'latitude':y0,'longitude':x0,'accuracy':6},permissions=['geolocation'],has_touch=(name=='chromium'))
  CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'};hits=[]
  def h(route):
    r=route.request;u=r.url
    if r.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
    J=lambda o,s=200:route.fulfill(status=s,headers=CORS,content_type='application/json',body=json.dumps(o))
    if '/auth/v1/token' in u: return J({'access_token':'tok','refresh_token':'rt','expires_in':3600,'user':{'id':UID,'email':'test@example.com'}})
    if '/rest/v1/team_members' in u: return J([{'user_id':UID,'name':'Pat Tester','email':'test@example.com','approved':True}])
    if '/rest/v1/route_assignments' in u: return J([{'route_id':n['slug']} for n in ix['neighborhoods']])
    if '/rest/v1/rpc/team_my_hours' in u: return J([])
    if r.method=='POST': return route.fulfill(status=201,headers=CORS)
    return J({},404)
  ctx.route(SB+'/**',h);ctx.route(lambda u:'supabase' in u and not u.startswith(SB),lambda r:(hits.append(r.request.url),r.abort()))
  pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto(URL);pg.wait_for_selector('#onboard:not([hidden])');pg.fill('#obemail','test@example.com');pg.fill('#obpw','correct-horse');pg.click('#obsubmit')
  pg.wait_for_selector('#home:not([hidden])');pg.click('#toroute');pg.wait_for_selector('.nb');pg.wait_for_timeout(1500)
  H=lambda:pg.evaluate("document.querySelector('#start .start-card').getBoundingClientRect().height")
  St=lambda:pg.evaluate("GP_SHEETS.start.state");sn=pg.evaluate("GP_SHEETS.start.snaps");print(name,'snaps',sn)
  grab=pg.locator('#start .bs-grab').bounding_box();gx,gy=grab['x']+grab['width']/2,grab['y']+grab['height']/2
  chk(St()=='expanded','starts expanded');pg.screenshot(path=f'{OUT}/sheet_expanded_{name}.png')
  def mdrag(x,y,dy,steps,delay=16):
    pg.mouse.move(x,y);pg.mouse.down()
    for i in range(1,steps+1): pg.mouse.move(x,y+dy*i/steps);pg.wait_for_timeout(delay)
    pg.wait_for_timeout(120);pg.mouse.up();pg.wait_for_timeout(600)
  mdrag(gx,gy,700,25);chk(St()=='collapsed' and abs(H()-sn['collapsed'])<2,f'drag handle down -> collapsed ({H():.0f}px)')
  pg.wait_for_timeout(500);pg.screenshot(path=f'{OUT}/sheet_collapsed_{name}.png')
  c0=pg.evaluate("JSON.stringify(GP_SHEETS.map.getCenter())");z0=pg.evaluate("GP_SHEETS.map.getZoom()")
  mdrag(195,300,180,12);c1=pg.evaluate("JSON.stringify(GP_SHEETS.map.getCenter())");chk(c0!=c1,'map pans while collapsed')
  pg.mouse.move(195,350);pg.mouse.wheel(0,-400);pg.wait_for_timeout(900);chk(pg.evaluate("GP_SHEETS.map.getZoom()")!=z0,'map zooms while collapsed')
  pg.click('#start .bs-grab');pg.wait_for_timeout(600);chk(St()=='expanded','tap handle toggles collapsed -> expanded')
  pg.click('#start .bs-grab');pg.wait_for_timeout(600);chk(St()=='collapsed','tap handle toggles expanded -> collapsed')
  gy=pg.locator('#start .bs-grab').bounding_box()['y']+10
  mdrag(195,gy,-(sn['expanded']-sn['collapsed']+40),25);chk(St()=='expanded','drag up -> expanded')
  # slow drag to the middle -> half
  if 'half' in sn:
    gy=pg.locator('#start .bs-grab').bounding_box()['y']+10;mdrag(gx,gy,sn['expanded']-sn['half'],30,25);chk(St()=='half',f'slow drag -> half ({H():.0f}px)')
    pg.wait_for_timeout(500);c2=pg.evaluate("JSON.stringify(GP_SHEETS.map.getCenter())");mdrag(195,150,120,10);chk(pg.evaluate("JSON.stringify(GP_SHEETS.map.getCenter())")!=c2,'map pans at half')
    pg.screenshot(path=f'{OUT}/sheet_half_{name}.png')
    gy=pg.locator('#start .bs-grab').bounding_box()['y']+10;mdrag(gx,gy,-(sn['expanded']-sn['half']),20);chk(St()=='expanded','back to expanded')
  # fling: short fast flick down on the body (content at top) -> next lower snap
  pg.mouse.move(195,pg.locator('#nbs').bounding_box()['y']+20);pg.mouse.down()
  bx=pg.locator('#nbs').bounding_box()['y']+20
  for i in range(1,5): pg.mouse.move(195,bx+15*i);pg.wait_for_timeout(8)
  pg.mouse.up();pg.wait_for_timeout(600);chk(St()==('half' if 'half' in sn else 'collapsed'),f'fast 60px fling down on body -> {St()}')
  gy=pg.locator('#start .bs-grab').bounding_box()['y']+10;pg.mouse.move(gx,gy);pg.mouse.down()
  for i in range(1,5): pg.mouse.move(gx,gy-15*i);pg.wait_for_timeout(8)
  pg.mouse.up();pg.wait_for_timeout(600);chk(St()=='expanded',f'fast fling up -> {St()}')
  # tapping a session card still works (drag != tap) and the selection persists
  pg.click('.ses >> nth=1');pg.wait_for_timeout(300);chk(pg.locator('.ses.on').count()==1 and 'on' in pg.get_attribute('.ses >> nth=1','class'),'session tap still selects')
  if name=='chromium':  # real touch via CDP
    cdp=ctx.new_cdp_session(pg);gy=pg.locator('#start .bs-grab').bounding_box()['y']+10
    T=lambda t,y:cdp.send('Input.dispatchTouchEvent',{'type':t,'touchPoints':[] if t=='touchEnd' else [{'x':gx,'y':y}]})
    T('touchStart',gy)
    for i in range(1,21): T('touchMove',gy+30*i);pg.wait_for_timeout(16)
    pg.wait_for_timeout(100);T('touchEnd',0);pg.wait_for_timeout(600);chk(St()=='collapsed','touch drag down -> collapsed')
    gy=pg.locator('#start .bs-grab').bounding_box()['y']+10;T('touchStart',gy)
    for i in range(1,21): T('touchMove',gy-30*i);pg.wait_for_timeout(16)
    pg.wait_for_timeout(100);T('touchEnd',0);pg.wait_for_timeout(600);chk(St()=='expanded','touch drag up -> expanded')
  # in-route nav sheet
  pg.click('#go');pg.wait_for_timeout(1500);Ns=lambda:pg.evaluate("GP_SHEETS.nav.state")
  chk(Ns()=='expanded' and pg.is_visible('#done'),'nav sheet expanded on start')
  ng=pg.locator('#nav .bs-grab').bounding_box();mdrag(ng['x']+100,ng['y']+10,300,20);chk(Ns()=='collapsed' and pg.is_visible('#done'),'nav drag down -> collapsed (Step done still visible)')
  fb=pg.evaluate("document.getElementById('fabs').getBoundingClientRect().bottom");nt=pg.evaluate("document.getElementById('nav').getBoundingClientRect().top");chk(fb<nt,f'fabs sit above collapsed nav ({fb:.0f}<{nt:.0f})')
  pg.screenshot(path=f'{OUT}/sheet_nav_collapsed_{name}.png');pg.click('#nav .bs-grab');pg.wait_for_timeout(600);chk(Ns()=='expanded','nav handle tap -> expanded')
  pg.click('#done');pg.wait_for_timeout(500);chk(pg.evaluate("Object.keys(localStorage).some(k=>k.startsWith('gpteam_progress'))"),'step done still records progress')
  pg.screenshot(path=f'{OUT}/sheet_nav_expanded_{name}.png')
  chk(not errs,f'no page errors {errs}');chk(not hits,'no unmocked supabase hits');b.close()
with sync_playwright() as p:
  for n in ('chromium','webkit'): run(n,p)
print('PASS' if ok else 'FAIL');sys.exit(0 if ok else 1)
