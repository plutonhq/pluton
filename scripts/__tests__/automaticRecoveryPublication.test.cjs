const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
function setup(ca='synthetic public CA data'){
  const root='/operator-fixture',privateCa=path.join(root,'private','a'.repeat(24),'ca.pem');
  const files=new Map([[privateCa,Buffer.from(ca)]]),fds=new Map(),attrs=new Map();let next=0,executed=0;
  const fake={
    lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o640}),
    readFileSync:file=>files.get(file),openSync:(file,flag)=>{const fd=++next;fds.set(fd,{file,flag});return fd;},
    writeFileSync:(fd,value)=>files.set(fds.get(fd).file,Buffer.from(value)),
    fchownSync:(fd,uid,gid)=>attrs.set(fds.get(fd).file,{uid,gid}),
    fchmodSync:(fd,mode)=>attrs.set(fds.get(fd).file,{...attrs.get(fds.get(fd).file),mode}),
    fsyncSync:()=>{},closeSync:()=>{},renameSync:(from,to)=>{files.set(to,files.get(from));attrs.set(to,attrs.get(from));files.delete(from);}
  };
  const context={Buffer,process,require:name=>name==='node:fs'?fake:name==='./storage.cjs'?{rootParent:()=>{}}:
    name==='node:child_process'?{execFileSync:()=>{executed++;throw new Error('No native execution permitted in publication');}}:require(name),module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync('deploy/persistent-restore/operator.cjs','utf8'),context);
  const operator=context.module.exports.createOperator({root});
  const meta={id:'a'.repeat(24),request:{snapshotId:'b'.repeat(64)},containerId:'c'.repeat(64),approval:{
    caSha256:crypto.createHash('sha256').update(ca).digest('hex'),activationId:'d'.repeat(32),storage:{id:'synthetic-storage'},
    target:{reference:'unchanged synthetic marker'}}};
  return {root,files,attrs,operator,meta,get executed(){return executed;}};
}
test('readiness interruption can republish the existing verified approval/CA without generating credentials or starting a container',()=>{
  const f=setup(),original=JSON.stringify(f.meta.approval);
  f.operator.publish(f.meta);f.operator.publish(f.meta);
  const published=path.join(f.root,'public',f.meta.id+'.json');
  assert.equal(f.files.get(published).toString(),original);assert.equal(f.executed,0);
  assert.deepEqual(f.attrs.get(published),{uid:0,gid:10001,mode:0o640});
  assert.equal(f.files.get(path.join(f.root,'public',f.meta.id+'-ca.pem')).toString(),'synthetic public CA data');
});
test('changed CA never publishes an approval or a replacement credential',()=>{
  const f=setup();f.meta.approval.caSha256='f'.repeat(64);
  assert.throws(()=>f.operator.publish(f.meta),{code:'target-tls-failed'});
  assert.equal(f.files.size,1);assert.equal(f.executed,0);
});
