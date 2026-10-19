'use strict';
// Disposable VM browser fixture only, never installed or mounted in Pluton.
// Transparent loopback SSH access: the user must complete normal Pluton login.
// No credential loading, token creation, auto-login or app security changes.
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const fixture=process.argv[2];assert.equal(process.getuid(),0);
assert.match(fixture,/^\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(fixture),fixture);
const manifest=JSON.parse(fs.readFileSync(fixture+'/manifest.json'));assert.equal(manifest.purpose,'disposable-lifecycle-rehearsal');
const profile=JSON.parse(fs.readFileSync(fixture+'/api/browser.json','utf8'));
assert.match(profile.address,/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/);
const server=http.createServer((incoming,outgoing)=>{
  if(incoming.headers.host!=='127.0.0.1:15173'||incoming.socket.remoteAddress!=='127.0.0.1'){
    outgoing.writeHead(403);outgoing.end();return;
  }
  if(incoming.url.startsWith('/__fixture/')){outgoing.writeHead(404);outgoing.end();return;}
  const headers={...incoming.headers};delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];delete headers['x-forwarded-for'];
  delete headers.forwarded;
  const request=http.request({host:profile.address,port:5173,path:incoming.url,
    method:incoming.method,headers,timeout:90000},response=>{
    outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
  });
  request.on('timeout',()=>request.destroy());request.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
  incoming.pipe(request);
});
server.maxConnections=16;server.requestTimeout=95000;server.headersTimeout=15000;
server.listen(15174,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
