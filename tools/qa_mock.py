# Shared Playwright helpers: fully mocked Supabase (no real backend, no accounts), service workers blocked.
import json
SB='https://hssevqgkoeuludwoxyuo.supabase.co';URL='http://127.0.0.1:47613/'
UID='11111111-2222-4333-8444-555555555555'
CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
def new_state(ix,**kw):
  S={'approved':True,'routes':[n['slug'] for n in ix['neighborhoods']],'posts':[],'offline':False,'delay':0,'expired':False,'log':[]};S.update(kw);return S
def mock(ctx,S,page_ref=None):
  hits=[]
  def h(route):
    r=route.request;u=r.url
    if r.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
    S['log'].append(r.method+' '+u.split('.co')[1].split('?')[0])
    if S['offline']: return route.abort('internetdisconnected')
    J=lambda o,s=200:route.fulfill(status=s,headers=CORS,content_type='application/json',body=json.dumps(o))
    if '/auth/v1/token' in u:
      d=json.loads(r.post_data or '{}')
      if 'refresh_token' in d and S['expired']: return J({'error_description':'Invalid Refresh Token: Refresh Token Not Found'},400)
      if d.get('password') in (None,'correct-horse') or 'refresh_token' in d: return J({'access_token':'tok','refresh_token':'rt','expires_in':3600,'user':{'id':UID,'email':'test@example.com'}})
      return J({'error_description':'Invalid login credentials'},400)
    if '/auth/v1/logout' in u: return route.fulfill(status=204,headers=CORS)
    if '/auth/v1/' in u: return J({})
    if S['expired']: return J({'message':'JWT expired'},401)
    if '/rest/v1/team_members' in u: return J([{'user_id':UID,'name':S.get('name','Pat Tester'),'email':'test@example.com','approved':S['approved']}])
    if '/rest/v1/route_assignments' in u: return J([{'route_id':x} for x in S['routes']])
    if '/rest/v1/rpc/team_my_hours' in u: return J([])
    if r.method=='POST': S['posts'].append(json.loads(r.post_data)|{'_t':u.split('/rest/v1/')[1]});return route.fulfill(status=201,headers=CORS)
    return J({},404)
  ctx.route(SB+'/**',h);ctx.route(lambda u:'supabase' in u and not u.startswith(SB),lambda r:(hits.append(r.request.url),r.abort()))
  return hits
def seed_session(pg,extra=''):
  pg.add_init_script("""if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('gpteam_session_v1',JSON.stringify({access_token:'tok',refresh_token:'rt',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'%s',email:'test@example.com'}}));%s}"""%(UID,extra))

# page-side helpers: optional slow network for Supabase calls; skip the first-run tips unless asked
INIT="""(()=>{const f=window.fetch;window.fetch=async(u,o)=>{if(window.__slow&&String(u).includes('supabase.co'))await new Promise(r=>setTimeout(r,window.__slow));return f(u,o)}})();"""
def prep(pg,tour_seen=True,extra=''):
  pg.add_init_script(INIT+("localStorage.setItem('gpteam_tour_v1','true');" if tour_seen else '')+extra)
