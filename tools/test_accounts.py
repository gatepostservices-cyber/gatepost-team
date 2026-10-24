# Accounts test with fully mocked Supabase Auth + REST (no real accounts, no network writes). Chromium + WebKit, 390x844.
# Run: python3 -m http.server 47613 --bind 127.0.0.1 &  python3 tools/test_accounts.py   -> /workspace/team-preview/acct_*
import json,sys,time,re
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:47613/';OUT='/workspace/team-preview';SB='https://hssevqgkoeuludwoxyuo.supabase.co'
ix=json.load(open('data/index.json'));g=json.load(open('data/'+ix['neighborhoods'][1]['file']))
st=sorted([f for f in g['features'] if f['properties']['kind']=='step' and f['properties']['session']==1],key=lambda f:f['properties']['step'])
pts=[[y,x] for f in st[:4] for x,y in f['geometry']['coordinates']]
UID='11111111-2222-4333-8444-555555555555';ok=True
def run(name,p):
  global ok
  S={'approved':False,'routes':[ix['neighborhoods'][1]['slug']],'posts':[],'offline':True,'log':[]}
  b=getattr(p,name).launch();ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,geolocation={'latitude':pts[0][0],'longitude':pts[0][1],'accuracy':6},permissions=['geolocation'],service_workers='block')
  CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
  def h(route):
    r=route.request;u=r.url;
    if r.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
    S['log'].append(r.method+' '+u.split('.co')[1].split('?')[0])
    J=lambda o,s=200:route.fulfill(status=s,headers=CORS,content_type='application/json',body=json.dumps(o))
    sess={'access_token':'tok','refresh_token':'rt','expires_in':3600,'user':{'id':UID,'email':'test@example.com'}}
    if '/auth/v1/signup' in u: return J({'id':UID,'email':'test@example.com'})   # email confirmation on: no session
    if '/auth/v1/token' in u:
      d=json.loads(r.post_data);return J(sess) if d.get('password')=='correct-horse' or 'refresh_token' in d else J({'error_description':'Invalid login credentials'},400)
    if '/auth/v1/recover' in u: S['recover']=u; return J({})
    if '/auth/v1/logout' in u: return route.fulfill(status=204,headers=CORS)
    if '/rest/v1/team_members' in u: return J([{'user_id':UID,'name':'Pat Tester','email':'test@example.com','approved':S['approved']}])
    if '/rest/v1/route_assignments' in u: return J([{'route_id':x} for x in S['routes']])
    if '/rest/v1/rpc/team_my_hours' in u: return J([{'id':x['id'],'clock_in':x['clock_in'],'clock_out':x['clock_out'],'hours':x['hours']} for x in S['posts'] if 'clock_in' in x]+[{'id':'old','clock_in':'2026-01-01T10:00:00Z','clock_out':'2026-01-01T13:00:00Z','hours':3}])
    if r.method=='POST' and ('/team_shifts' in u or '/team_shift_paths' in u):
      if S['offline']: return route.abort()
      S['posts'].append(json.loads(r.post_data)|{'_t':u.split('/rest/v1/')[1]});return route.fulfill(status=201,headers=CORS)
    return J({},404)
  ctx.route(SB+'/**',h);pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto(URL);pg.wait_for_selector('#onboard:not([hidden])');pg.wait_for_timeout(500);pg.screenshot(path=f'{OUT}/acct_signin_{name}.png')
  pg.click('#obtabs [data-m=up]');pg.fill('#obname','Pat Tester');pg.fill('#obemail','test@example.com');pg.fill('#obpw','correct-horse');pg.screenshot(path=f'{OUT}/acct_signup_{name}.png')
  pg.click('#obsubmit');pg.wait_for_function("document.getElementById('obmsg').textContent.includes('Check your email')");pg.screenshot(path=f'{OUT}/acct_signup_sent_{name}.png')
  pg.fill('#obpw','wrong-pass');pg.click('#obsubmit');pg.wait_for_function("document.getElementById('obmsg').textContent.includes('not right')")
  pg.click('#forgot');pg.click('#obsubmit');pg.wait_for_function("document.getElementById('obmsg').textContent.includes('reset link')");pg.screenshot(path=f'{OUT}/acct_reset_sent_{name}.png')
  ok&='redirect_to=' in S.get('recover','')
  pg.fill('#obpw','correct-horse');pg.click('#obsubmit');pg.wait_for_selector('#pending:not([hidden])');pg.wait_for_timeout(300);pg.screenshot(path=f'{OUT}/acct_pending_{name}.png')
  ok&=pg.is_hidden('#home') and not any('route_assignments' in x for x in S['log'])
  S['approved']=True;pg.click('#pendcheck');pg.wait_for_selector('#home:not([hidden])');pg.wait_for_timeout(600);pg.screenshot(path=f'{OUT}/acct_home_{name}.png')
  rl=pg.inner_text('#myroutes');print(name,'routes:',rl.replace('\n',' '),'| total:',pg.inner_text('#htotal'))
  ok&=ix['neighborhoods'][1]['name'] in rl and ix['neighborhoods'][0]['name'] not in rl and pg.inner_text('#htotal')=='3.0'
  pg.click('#clockbtn');pg.wait_for_selector('#locnote:not([hidden])');pg.screenshot(path=f'{OUT}/acct_location_notice_{name}.png');pg.click('#locok');pg.wait_for_timeout(300)
  pg.click('#toroute');pg.wait_for_selector('.nb');n=pg.locator('.nb').count();print(name,'tracker routes:',n);ok&=n==1
  pg.screenshot(path=f'{OUT}/acct_tracker_{name}.png')
  for q in pts: ctx.set_geolocation({'latitude':q[0],'longitude':q[1],'accuracy':6});pg.wait_for_timeout(60)
  pg.click('#tohome');pg.wait_for_selector('#home:not([hidden])')
  np=pg.evaluate("JSON.parse(localStorage.getItem('gpteam_path_v1')||'[]').length");print(name,'path points while clocked in:',np);ok&=np>=3
  pg.click('#clockbtn');pg.wait_for_timeout(1500)
  q=pg.evaluate("[JSON.parse(localStorage.getItem('gpteam_outbox_v1')).length,JSON.parse(localStorage.getItem('gpteam_path_outbox_v1')).length]");print(name,'offline queue (shift,path):',q);ok&=q==[1,1]
  pg.screenshot(path=f'{OUT}/acct_offline_queue_{name}.png')
  ctx.set_geolocation({'latitude':pts[0][0],'longitude':pts[0][1],'accuracy':6});pg.wait_for_timeout(1200)
  ok&=pg.evaluate("JSON.parse(localStorage.getItem('gpteam_path_v1')||'[]').length")==0  # no tracking when clocked out
  S['offline']=False;pg.evaluate("dispatchEvent(new Event('online'))");pg.wait_for_timeout(2000)
  sh=[x for x in S['posts'] if x['_t'].startswith('team_shifts')];pa=[x for x in S['posts'] if x['_t'].startswith('team_shift_paths')]
  print(name,'sent shifts',len(sh),'paths',len(pa),'| user_id set:',sh and sh[0]['user_id']==UID,'| path pts',pa and len(pa[0]['points']),'| total now',pg.inner_text('#htotal'),'| text:',pg.inner_text('#home').replace('\n',' ')[:160])
  ok&=len(sh)==1 and len(pa)==1 and sh[0]['user_id']==UID and pa[0]['shift_id']==sh[0]['id'] and not re.search(r'houses|pace|miles|/hr',pg.inner_text('body'),re.I)
  pg.screenshot(path=f'{OUT}/acct_home_after_{name}.png')
  pg.click('#signout');pg.wait_for_selector('#onboard:not([hidden])');ok&=pg.evaluate("localStorage.getItem('gpteam_session_v1')")is None
  # recovery link from email
  pg.goto(URL+'#access_token=tok&refresh_token=rt&expires_in=3600&type=recovery')
  ctx.unroute(SB+'/**');ctx.route(SB+'/**',lambda r:r.fulfill(status=200,headers=CORS,content_type='application/json',body=json.dumps({'id':UID,'email':'test@example.com'})) if '/auth/v1/user' in r.request.url else h(r))
  pg.reload();pg.wait_for_function("document.getElementById('obtitle').textContent.includes('new password')");pg.screenshot(path=f'{OUT}/acct_new_password_{name}.png')
  print(name,'errors:',errs);ok&=not errs;b.close()
with sync_playwright() as p:
  for n in ('chromium','webkit'): run(n,p)
print('PASS' if ok else 'FAIL');sys.exit(0 if ok else 1)
