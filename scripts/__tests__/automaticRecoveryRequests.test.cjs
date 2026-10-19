'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const input={version:1,binding:{id:'a'.repeat(24),mode:'persistent',engine:'mariadb',snapshotId:'b'.repeat(64),
  artifacts:[{databaseId:'db_example',database:'example_db',sha256:'c'.repeat(64),bytes:1024}],
  createdAt:Date.now()-1000,expiresAt:Date.now()+3600000},ownerToken:'d'.repeat(48),action:'provision',cleanupReady:false};
const text=JSON.stringify(input);
function reader({raw=Buffer.from(text),stat={},nonblocking=false,change=false}={}){
  let closed=0,reads=0,opened=0;
  const constants={O_RDONLY:0,O_NOFOLLOW:131072,O_NONBLOCK:2048};
  const value={isFile:()=>true,uid:10001n,mode:0o600n,nlink:1n,size:BigInt(raw.length),
    mtimeNs:2n,ctimeNs:3n,dev:1n,ino:9n,...stat};
  const mocked={constants,openSync(_file,flags){
    opened++;
    assert(flags&constants.O_NOFOLLOW);
    if(nonblocking)assert(flags&constants.O_NONBLOCK,'Untrusted FIFO must never block open.');
    return 7;
  },fstatSync(){reads++;return {...value,...(change&&reads>1?{ctimeNs:4n}:{})};},
  readFileSync(){assert.fail('Untrusted mailbox must not use an unbounded readFileSync.');},
  readSync(fd,buffer,offset,length,position){
    assert.equal(fd,7);assert(buffer.length<=8193);assert(length<=8193);
    return raw.copy(buffer,offset,position,position+length);
  },closeSync(){closed++;}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'deploy/automatic-recovery/operator.cjs'),'utf8'),{
    require:name=>name==='node:fs'?mocked:name==='../persistent-restore/operator.cjs'?{images:{mariadb:'reviewed'}}:
      name==='./systemdStorage.cjs'?{createSystemdStorage:()=>({directory(){}})}:require(name),
    module,process,Buffer,
  });
  return {read:(id=input.binding.id)=>module.exports.readRequest(id),closed:()=>closed,opened:()=>opened};
}
test('invalid mailbox identity is rejected before opening any caller-selected path',()=>{
  const fixture=reader();
  for(const id of ['../escape','a/b','constructor','\0'])assert.throws(()=>fixture.read(id),{code:'request-unsafe'});
  assert.equal(fixture.opened(),0);
});
test('untrusted mailbox uses nonblocking no-follow open, bounded reads and closes the verified descriptor',()=>{
  for(const length of [Buffer.byteLength(text),8192]){
    const fixture=reader({raw:Buffer.from(text.padEnd(length)),nonblocking:true});
    assert.equal(JSON.stringify(fixture.read()),text);assert.equal(fixture.closed(),1);
  }
});
test('FIFO/device and file growth between stat and read fail closed within the byte budget',()=>{
  const fifo=reader({stat:{isFile:()=>false},nonblocking:true});
  assert.throws(()=>fifo.read(),{code:'request-unsafe'});assert.equal(fifo.closed(),1);
  const growth=reader({raw:Buffer.from(text.padEnd(8193)),stat:{size:BigInt(Buffer.byteLength(text))}});
  assert.throws(()=>growth.read(),{code:'request-unsafe'});assert.equal(growth.closed(),1);
});
test('concurrent request replacement/mutation cannot acquire a valid observed revision',()=>{
  const fixture=reader({change:true});
  assert.throws(()=>fixture.read(),{code:'request-unsafe'});assert.equal(fixture.closed(),1);
});
