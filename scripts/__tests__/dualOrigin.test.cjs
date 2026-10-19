const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..');
test('deployment exposes only explicit origin/Agent settings, with no new listener or privileged access',()=>{
  const source=fs.readFileSync(path.join(root,'deploy/compose.yml'),'utf8');
  for(const name of ['APP_URL','APP_ALLOWED_ORIGINS','AGENT_SERVER_URL','ALLOW_INSECURE_AGENT_HTTP'])assert(source.includes(name+':'));
  assert(!source.includes('TRUST_PROXY:-true'));assert(!/docker\.sock|privileged:/.test(source));
  assert(source.includes('${PLUTON_PORT:-5173}:5173'));
});
test('production CORS, session and CSP wiring never reflects arbitrary Host or forwarded origins',()=>{
  const source=fs.readFileSync(path.join(root,'backend/src/createApp.ts'),'utf8');
  for(const name of ['webAccess(webPolicy)','sameOriginCors(webPolicy)','originAwareSession(webPolicy'])assert(source.includes(name));
  assert(!source.includes('dynamicOrigin'));assert(source.includes('const connectSrc: string[] = ["\'self\'"]'));
  assert(source.includes('(req as AgentRequest).rawBody = buffer.toString(\'utf8\')'));
});
test('native web fixture has no Docker socket, host network, published port or persistent data mount',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/validate-dual-origin.ps1'),'utf8');
  assert(source.includes("'--network','none'"));assert(source.includes("'--cap-drop','ALL'"));
  assert(!/--privileged|--publish|docker\.sock|type=volume|--network.?host/.test(source));
});
