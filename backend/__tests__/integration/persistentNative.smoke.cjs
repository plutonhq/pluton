// Local operator ONLY: database and application children drop all capabilities, UIDs 999/10001.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),storage=require('/fixture/storage.cjs'),operator=require('/fixture/operator.cjs');
const [engine,phase,mode='internal']=process.argv.slice(2);
if(!['mariadb','postgresql'].includes(engine)||!['import','inspect-delete'].includes(phase)||!['internal','custom'].includes(mode)||process.getuid()!==0)throw new Error('Unsafe fixture input');
const state='/fixture/state',id='a'.repeat(24),activation='b'.repeat(32),host='persistent-db-'+id;
function run(binary,args){return execFileSync(binary,args,{stdio:'pipe',encoding:'utf8',timeout:60000});}
function write(file,text,uid=0,gid=0,perm=0o600){fs.writeFileSync(file,text,{mode:perm});fs.chownSync(file,uid,gid);fs.chmodSync(file,perm);}
function directory(file,uid=0,gid=0,mode=0o755){fs.mkdirSync(file,{mode,recursive:true});fs.chownSync(file,uid,gid);fs.chmodSync(file,mode);}
for(let i=0;i<256;i++)if(!fs.existsSync('/dev/loop'+i))run('/bin/mknod',['/dev/loop'+i,'b','7',String(i)]);
for(const file of [state+'/images',state+'/view',state+'/application',state+'/private'])directory(file,0,0,file.endsWith('/images')?0o700:0o755);
directory(state+'/application',10001,10001,0o700);directory(state+'/private',0,999,0o750);
for(const file of ['/run/pluton-persistent-bootstrap','/run/pluton-persistent-restores','/run/pluton-persistent-storage','/run/pluton-persistent-restore-requests',
   '/run/pluton-internal-lock'])directory(file);
directory('/run/pluton-internal-lock',999,999,0o700);
const publicDir=state+'/public';directory(publicDir,0,10001,0o750);
let volume,approval,child;
const app=action=>run('setpriv',['--reuid=10001','--regid=10001','--clear-groups','--bounding-set=-all','--no-new-privs',
   'node','--experimental-loader','/app/backend/loader.mjs','/fixture/native-app.mjs',action]);
async function start(){
   const base=engine==='mariadb'?'/var/lib/mysql':'/var/lib/postgresql';
   run('/usr/bin/mount',['--bind',volume.mountpoint,base]);
   child=spawn('setpriv',['--reuid=999','--regid=999','--clear-groups','--bounding-set=-all','--no-new-privs',
      '/bin/bash','/fixture/bootstrap.sh',engine],{stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C',HOME:'/tmp'}});
   let privateError='';child.stderr.on('data',chunk=>{privateError+=chunk;});
   for(let attempt=0;attempt<100;attempt++){
      await new Promise(resolve=>setTimeout(resolve,300));
      if(child.exitCode!==null)throw new Error('Native fixture bootstrap stopped '+child.exitCode+' '+(privateError.match(/persistent-target-failed stage=[a-z-]+/)?.[0]||'no-stage'));
      const endpoint=engine==='mariadb'?3306:5432;
      const ok=await new Promise(resolve=>{const socket=require('node:net').connect({host:'127.0.0.1',port:endpoint});
         socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
      if(ok){
         assert.match(fs.readFileSync('/proc/'+child.pid+'/status','utf8'),/^CapEff:\s+0+$/m);return;
      }
   }
   throw new Error('Native fixture readiness timeout');
}
async function stop(){
   if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
   const base=engine==='mariadb'?'/var/lib/mysql':'/var/lib/postgresql';
   if(storage.mounted(base))run('/usr/bin/umount',[base]);
}
(async()=>{
try{
   if(phase==='import'){
      volume=storage.create(state+'/images',state+'/view',id,activation,2*1024**3);
      const password=crypto.randomBytes(32).toString('hex');
      const openssl=args=>run('openssl',args);
      openssl(['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Disposable retained fixture CA','-keyout',state+'/ca.key','-out',state+'/private/ca.pem']);
      openssl(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+host,'-keyout',state+'/private/server.key','-out',state+'/server.csr']);
      write(state+'/server.ext','subjectAltName=DNS:'+host+',IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
      openssl(['x509','-req','-in',state+'/server.csr','-CA',state+'/private/ca.pem','-CAkey',state+'/ca.key','-set_serial','0x'+activation,
         '-days','2','-sha256','-extfile',state+'/server.ext','-out',state+'/private/server.pem']);
      for(const file of ['server.key','server.pem','ca.pem']){fs.chownSync(state+'/private/'+file,0,999);fs.chmodSync(state+'/private/'+file,0o640);}
      write(state+'/private/identity.json',fs.readFileSync(volume.mountpoint+'/identity.json'),0,999,0o640);
      write(state+'/private/bootstrap.sql',operator.bootstrapSql(engine,'example_db',password,activation,volume.identity.storageId),0,999,0o640);
      const sql="CREATE TABLE fixture_entries(value TEXT);\n"+("INSERT INTO fixture_entries VALUES ('"+'x'.repeat(1024)+"');\n").repeat(8192);
      const sha256=crypto.createHash('sha256').update(sql).digest('hex'),snapshot='c'.repeat(64);
      write(state+'/application/dump.sql',sql,10001,10001);
      write(state+'/application/fixture.json',JSON.stringify({id,snapshot,sha256,bytes:Buffer.byteLength(sql)}),10001,10001);
      write(state+'/application/key',crypto.randomBytes(32).toString('hex'),10001,10001);
      const ca=fs.readFileSync(state+'/private/ca.pem');
      approval={version:1,id,purpose:operator.PURPOSE,mode,engine,activationId:activation,database:'example_db',
         target:{engine,host,port:engine==='mariadb'?3306:5432,username:'restore_user',password,tls:'verify-identity',enabled:true,dedicated:true},
         caSha256:crypto.createHash('sha256').update(ca).digest('hex'),maxSqlBytes:128*1024**2,maxRetentionSeconds:86400,
         storage:{id:volume.identity.storageId,quotaBytes:volume.identity.quotaBytes,kind:mode==='internal'?'fixed-ext4':'operator-approved-external'},
         ...(mode==='internal'?{binding:{restoreId:id,snapshotId:snapshot,sha256},containerId:crypto.randomBytes(32).toString('hex')}:{})};
      write(state+'/volume.json',JSON.stringify(volume));write(state+'/approval.json',JSON.stringify(approval));
      if(mode==='custom'){
         const root='/etc/pluton-persistent-restores';directory(root+'/private',0,0,0o700);directory(root+'/public',0,10001,0o750);
         write(root+'/installation.json',JSON.stringify({purpose:operator.PURPOSE,installationId:crypto.randomBytes(16).toString('hex')}));
         write(root+'/private/'+id+'.candidate.json',JSON.stringify(approval));
         write(root+'/private/'+id+'-ca.pem',ca);
         for(const action of ['prepare-custom','approve-custom']){
            const output=run('node',['/fixture/operator.cjs',action,id]);
            assert(!output.includes(password));assert(!output.includes('CREATE USER'));assert(!output.includes('CREATE ROLE'));
         }
         const contract=root+'/private/'+id+'.bootstrap.sql';assert.equal(fs.statSync(contract).mode&0o777,0o600);
         assert(fs.readFileSync(contract,'utf8').includes(operator.PURPOSE));
         write(state+'/private/bootstrap.sql',fs.readFileSync(contract),0,999,0o640);
         assert.equal(operator.approvalFingerprint(JSON.parse(fs.readFileSync(root+'/public/'+id+'.json'))),operator.approvalFingerprint(approval));
         console.log('PASS actual root Custom registration/bootstrap export; purpose-bound approval; no secret stdout');
      }
      write(publicDir+'/'+id+'.json',JSON.stringify(approval),0,10001,0o640);write(publicDir+'/'+id+'-ca.pem',ca,0,10001,0o640);
   }else{volume=JSON.parse(fs.readFileSync(state+'/volume.json'));approval=JSON.parse(fs.readFileSync(state+'/approval.json'));storage.resume(volume);}
   run('/usr/bin/mount',['--bind',state+'/private','/run/pluton-persistent-bootstrap']);
   run('/usr/bin/mount',['-o','remount,bind,ro','/run/pluton-persistent-bootstrap']);
   for(const [from,to] of [[publicDir,'/run/pluton-persistent-restores'],[state+'/view','/run/pluton-persistent-storage']]){
      run('/usr/bin/mount',['--rbind',from,to]);run('/usr/bin/mount',['-o','remount,bind,ro',to]);
   }
   await start();
   process.stdout.write(app(phase));
   await stop();
   if(phase==='import'){
      run('/usr/bin/umount',['/run/pluton-persistent-storage/'+id]);run('/usr/bin/umount',[volume.mountpoint]);
      console.log('PASS retained storage left on disk for next disposable container/application process');
   }else{
      run('/usr/bin/umount',['/run/pluton-persistent-storage/'+id]);storage.remove(volume,true);
      // No physical-container receipt is fabricated by a fixture running INSIDE that container.
      // The actual host operator must verify Docker removal. API receipt transitions have separate contract tests.
      if(mode==='internal')console.log('CHECK physical container receipt deliberately not issued inside the local operator fixture');
      assert(!fs.existsSync(volume.file));assert(!fs.existsSync(volume.mountpoint));console.log('PASS native owned database AND actual bounded storage removed');
   }
}catch(error){console.error('FAIL operator fixture '+(error.code||error.message||'fixture-failed')+
   (['openssl','setpriv','node','/usr/bin/mount','/usr/bin/umount'].includes(error.path)?' tool='+error.path:''));process.exitCode=1;}
finally{await stop();}
})().catch(()=>{console.error('FAIL fixture reconciliation');process.exitCode=1;});
