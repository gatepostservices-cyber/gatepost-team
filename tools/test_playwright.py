# Mocked-GPS walk test. Run: python3 -m http.server 8790 & python3 tools/test_playwright.py
import json,math
from playwright.sync_api import sync_playwright
ix=json.load(open('data/index.json'));g=json.load(open('data/'+ix['neighborhoods'][0]['file']))
S=sorted([f for f in g['features'] if f['properties']['kind']=='step' and f['properties']['session']==1],key=lambda f:f['properties']['step'])
def interp(a,b,step=6):
  d=math.hypot((b[0]-a[0])*111320,(b[1]-a[1])*111320*math.cos(math.radians(a[0])));n=max(1,int(d/step))
  return [[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n] for k in range(1,n+1)]
pts=[];N=6
for f in S[:N]:
  c=[[y,x] for x,y in f['geometry']['coordinates']];pts+= [c[0]] if not pts else []
  for a,b in zip(c,c[1:]): pts+=interp(a,b)
out='/workspace/team-preview'
with sync_playwright() as p:
  for name in ('chromium','webkit'):
    b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,geolocation={'latitude':pts[0][0],'longitude':pts[0][1],'accuracy':8},permissions=['geolocation'])
    pg=ctx.new_page();pg.goto('http://127.0.0.1:47613/');pg.wait_for_selector('#steps li',state='attached');pg.wait_for_timeout(2000)
    pg.screenshot(path=f'{out}/{name}_normal_start.png')
    half=None
    for k,q in enumerate(pts):
      ctx.set_geolocation({'latitude':q[0],'longitude':q[1],'accuracy':8});pg.wait_for_timeout(50)
      if k==len(pts)//2: half=pg.eval_on_selector_all('#steps li.done','e=>e.length')
    pg.wait_for_timeout(1500)
    done=pg.eval_on_selector_all('#steps li.done','e=>e.length')
    print(name,'gps points',len(pts),'walked steps',N,'auto-checked at half:',half,'at end:',done,'|',pg.inner_text('#stepno'),'|',pg.inner_text('#left'))
    pg.screenshot(path=f'{out}/{name}_normal_walking.png')
    pg.click('#grab');pg.wait_for_timeout(500);pg.screenshot(path=f'{out}/{name}_expanded.png')
    pg.click('#grab');pg.wait_for_timeout(500);pg.screenshot(path=f'{out}/{name}_collapsed.png')
    pg.click('#slim');pg.reload();pg.wait_for_selector('#steps li',state='attached');pg.wait_for_timeout(1000)
    print(name,'after reload done:',pg.eval_on_selector_all('#steps li.done','e=>e.length'))
    pg.click('#sess button:nth-child(3)');pg.wait_for_timeout(1200);pg.screenshot(path=f'{out}/{name}_gold.png')
    b.close()
  b=p.chromium.launch();ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2);pg=ctx.new_page();pg.goto('http://127.0.0.1:47613/');pg.wait_for_timeout(3000)
  print('no-permission:',pg.inner_text('#gps'));pg.screenshot(path=f'{out}/chromium_denied.png');b.close()
