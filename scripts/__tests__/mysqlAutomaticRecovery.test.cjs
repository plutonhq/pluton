const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'../..'),manual=require('../../deploy/persistent-restore/operator.cjs'),
  automatic=require('../../deploy/automatic-recovery/operator.cjs');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('Oracle Internal is a fixed automatic-only engine profile, never a MariaDB alias or caller image',()=>{
  assert.match(manual.images.mysql,/^mysql:8\.4\.11@sha256:[a-f0-9]{64}$/);
  const req={version:1,purpose:manual.PURPOSE,mode:'internal',action:'provision',restoreId:'a'.repeat(24),snapshotId:'b'.repeat(64),
    databaseId:'db_example',engine:'mysql',database:'example_db',sha256:'c'.repeat(64),bytes:1024,expiresAt:Date.now()+3600000,cleanupReady:false,targetFingerprint:null};
  const stat={isFile:()=>true,uid:10001,mode:0o600,size:1024};
  assert.throws(()=>manual.validateRequest(req,req.restoreId,stat));
  const op=manual.createOperator({automatic:true});assert.doesNotThrow(()=>op.validateRequest(req,req.restoreId,stat));
  for(const field of ['image','path','command','dockerSocket','network','credentials'])
    assert.throws(()=>op.validateRequest({...req,[field]:'not-authority'},req.restoreId,stat));
});
test('Oracle uses separate disposable/retained guards, SSL-only scoped non-admin grants and locked bootstrap root',()=>{
  const password=crypto.randomBytes(32).toString('hex'),activation='a'.repeat(32),storage='b'.repeat(32);
  for(const [mode,sql] of [['disposable',automatic.disposableSql(['example_db','other_db'],'mysql','example_db',password,activation,storage,'restore_user')],
    ['persistent',manual.bootstrapSql('mysql','example_db',password,activation,storage)]]){
    assert(sql.includes(mode==='persistent'?manual.PURPOSE:'pluton-phase6-recovery-only'));
    assert(sql.includes('REQUIRE SSL'));assert(sql.includes('example\\_db'));
    assert(!/ON \*\.\*|WITH GRANT OPTION|GRANT FILE|GRANT SUPER/.test(sql));
  }
  const boot=read('deploy/persistent-restore/bootstrap.sh'),lock=read('deploy/persistent-restore/mysql-lock.py');
  for(const flag of ['--require-secure-transport=ON','--mysqlx=0','--secure-file-priv=NULL','--local-infile=0','ACCOUNT LOCK','.pluton-bootstrap-complete','sha256sum'])assert(boot.includes(flag));
  assert(lock.includes('fcntl.LOCK_EX | fcntl.LOCK_NB'));assert(lock.includes('os.set_inheritable(9, True)'));
  for(const option of ['--performance-schema=OFF','--innodb-log-buffer-size=8M'])assert(boot.includes(option));
  assert(lock.includes('os.execv("/bin/bash", ["/bin/bash", "/opt/pluton-persistent/bootstrap.sh", "mysql-locked"])'));
  assert(!/sys\.argv|subprocess|socket|sudo|nsenter/.test(lock));
});
test('MySQL worker headroom is additional; existing native resource policy remains unchanged',()=>{
  const original=fs.readFileSync;
  try{
    fs.readFileSync=(file,...args)=>file==='/proc/meminfo'?'MemTotal: 4194304 kB\nMemAvailable: 2867200 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n':
      file==='/proc/pressure/memory'?'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n':original(file,...args);
    for(const engine of ['mariadb','postgresql'])assert.doesNotThrow(()=>manual.resourceAdmission(1024,engine));
    assert.throws(()=>manual.resourceAdmission(1024,'mysql'),{code:'resource-admission-refused'});
  }finally{fs.readFileSync=original;}
});

test('root capacity measures every real ancestor cgroup; installed RAM cannot bypass memory/CPU/PSI/disk guards',()=>{
  const vm=require('node:vm'),MiB=1024**2,files=new Map(),base='/sys/fs/cgroup';
  const absent=()=>{throw Object.assign(new Error('missing observation'),{code:'ENOENT'});};
  const mocked={...fs,readFileSync:name=>files.has(name)?files.get(name):absent(),
    lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o700}),
    statfsSync:()=>({bavail:10*1024**3,bsize:1})};
  const context={module:{exports:{}},__dirname:'/reviewed/operator',process,Buffer,require:name=>
    name==='node:fs'?mocked:name==='node:path'?path.posix:name==='node:os'?{availableParallelism:()=>4}:
    name==='./storage.cjs'?{rootParent:()=>{}}:require(name)};
  vm.runInNewContext(read('deploy/persistent-restore/operator.cjs'),context);
  const op=context.module.exports.createOperator({automatic:true});
  const reset=()=>{
    files.clear();files.set('/proc/meminfo','MemTotal: 8388608 kB\nMemAvailable: 6291456 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n');
    files.set('/proc/pressure/memory','some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n');
    files.set('/proc/self/cgroup','0::/fixture.slice/operator.service\n');
    for(const directory of [base+'/fixture.slice/operator.service',base+'/fixture.slice',base])
      for(const [name,value] of Object.entries({'memory.max':'max','memory.current':'0','memory.swap.current':'0','memory.pressure':'some avg10=0.00','cpu.max':'max 100000'}))
        files.set(directory+'/'+name,value);
  };
  reset();const ancestor=base+'/fixture.slice/';
  files.set('/proc/self/cgroup','0::/\n');assert.equal(op.resourceCapacity().total,8192*MiB);
  reset();
  files.set(ancestor+'memory.max',String(4096*MiB));files.set(ancestor+'memory.current',String(1000*MiB));
  assert.equal(op.resourceCapacity().total,4096*MiB);assert.equal(op.resourceCapacity().available,3096*MiB);
  assert.doesNotThrow(()=>op.resourceAdmission(1024,'mysql'));
  files.set(ancestor+'memory.current',String(1400*MiB));
  for(const bytes of [MiB,16*MiB,96*MiB])assert.throws(()=>op.resourceAdmission(bytes,'mysql'),{code:'resource-admission-refused'});
  for(const [file,value,code] of [
    [ancestor+'cpu.max','100000 100000','resource-cpu-insufficient'],
    [ancestor+'memory.pressure','some avg10=2.00','resource-admission-refused'],
    [ancestor+'memory.swap.current','1','resource-admission-refused'],
    [ancestor+'memory.max','invalid','resource-admission-refused'],
  ]){reset();files.set(file,value);assert.throws(()=>op.resourceAdmission(1024,'mysql'),{code});}
  reset();mocked.statfsSync=()=>({bavail:1024,bsize:1});
  assert.throws(()=>op.resourceAdmission(1024,'mysql'),{code:'resource-disk-insufficient'});
  reset();files.set('/proc/self/cgroup','0::/../escape');assert.throws(()=>op.resourceCapacity(),{code:'resource-admission-refused'});
});
test('worker overlay is optional private IPC + root public proof, never host control or database storage',()=>{
  const overlay=read('deploy/compose.mysql-internal-recovery.yml');
  for(const value of ['PLUTON_MYSQL_WORKER_IMAGE_REF:?','user: "10001:10001"','cap_drop: [ALL]',
    'no-new-privileges:true','read_only: true','create_host_path: false','mem_limit: 384m','memswap_limit: 384m','size=160m',
    '/etc/pluton-automatic-recovery/mysql-public','/run/pluton-mysql-internal','external: true'])assert(overlay.includes(value));
  assert(!overlay.includes('source: /etc/pluton-automatic-recovery/public\n'));
  const source=read('deploy/automatic-recovery/operator.cjs');
  assert(source.includes("action==='approve-mysql'"));assert(source.includes('const mysql=mysqlApproved()'));
  assert(!/\n\s*(?:ports|expose|privileged|cap_add):|\/data|docker\.sock|\.env|ENCRYPTION_KEY|SECRET|\/var\/lib\/mysql/.test(overlay));
  const workflow=read('.github/workflows/container.yml');
  for(const mode of ['disposable','persistent'])assert(workflow.includes('validate-mysql-automatic-recovery.ps1 -Mode '+mode));
  const runner=read('scripts/validate-mysql-automatic-recovery.ps1');
  assert(!/--privileged|SYS_ADMIN|--publish|--network host|docker\.sock|loop-control/.test(runner));
  assert(runner.includes("org.pluton.fixture"));assert(runner.includes('type=tmpfs'));assert(runner.includes('WorkingTreeCode'));
});
test('MySQL root approval is explicit/idempotent, refuses adoption, and readiness never creates or repairs paths',()=>{
  const vm=require('node:vm'),base='/operator-fixture',files=new Map([[base+'/installation.json',JSON.stringify({version:1,installationId:'a'.repeat(32)})]]),
    dirs=new Map(),commands=[];let writes=0;
  const absent=()=>{throw Object.assign(new Error('absent'),{code:'ENOENT'});};
  const mocked={constants:fs.constants,existsSync:name=>files.has(name)||dirs.has(name),
    openSync:name=>files.has(name)?name:absent(),
    fstatSync:name=>({isFile:()=>true,uid:0,mode:0o600,nlink:1,size:Buffer.byteLength(files.get(name))}),
    readFileSync:name=>files.get(name),closeSync:()=>{},
    lstatSync:name=>{const st=dirs.get(name);if(!st)return absent();return {...st,isDirectory:()=>true,isSymbolicLink:()=>false};},
    mkdirSync:name=>{writes++;dirs.set(name,{uid:0,gid:0,mode:0o700});},
    chownSync:(name,uid,gid)=>Object.assign(dirs.get(name),{uid,gid}),chmodSync:(name,mode)=>Object.assign(dirs.get(name),{mode})};
  const persistent={images:manual.images,rootCode:()=>{},write:(name,value)=>{writes++;files.set(name,JSON.stringify(value));}};
  const context={module:{exports:{}},__dirname:path.join(root,'deploy/automatic-recovery'),process,Buffer,
    require:name=>name==='node:fs'?mocked:name==='../persistent-restore/operator.cjs'?persistent:
      name==='./systemdStorage.cjs'?{createSystemdStorage:()=>({rootParent:()=>{}})}:
      name==='node:child_process'?{execFileSync:(bin,args)=>{commands.push([bin,args]);return '[]';}}:require(name)};
  vm.runInNewContext(read('deploy/automatic-recovery/operator.cjs'),context);
  const op=context.module.exports.createLifecycleOperator({root:base});
  assert.equal(op.mysqlApproved(),false);assert.equal(writes,0);
  op.approveMysql();assert.equal(op.mysqlApproved(),true);
  assert.equal(JSON.stringify(commands),JSON.stringify([['docker',['image','inspect',manual.images.mysql]]]));
  const original=writes;op.approveMysql();assert.equal(writes,original);assert.equal(commands.length,1);
  dirs.delete(op.MYSQL_PUBLIC);assert.equal(op.mysqlApproved(),false);assert.equal(writes,original);
  assert.throws(()=>op.approveMysql(),{code:'mysql-approval-unsafe'});
  files.delete(base+'/mysql.json');dirs.set(op.MYSQL_PUBLIC,{uid:0,gid:10001,mode:0o750});
  assert.throws(()=>op.approveMysql(),{code:'mysql-approval-unsafe'});assert.equal(writes,original);
});
