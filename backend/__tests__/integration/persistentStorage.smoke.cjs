// Real Linux mount fixture, run only by an explicitly authorized local test operator.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const storage=require('/fixture/storage.cjs');
assert.equal(process.getuid(),0);
// Docker Desktop exposes loop-control but not the device nodes. Only the operator fixture gets this rule.
for(let number=0;number<256;number++) {
   const device='/dev/loop'+number;
   if(!fs.existsSync(device))execFileSync('/bin/mknod',[device,'b','7',String(number)],{stdio:'pipe'});
}
for(const name of ['images','view']){const mode=name==='images'?0o700:0o755;fs.mkdirSync('/fixture/state/'+name,{mode,recursive:true});fs.chmodSync('/fixture/state/'+name,mode);}
const id=crypto.randomBytes(12).toString('hex'),activation=crypto.randomBytes(16).toString('hex');
let volume;
try {
   volume=storage.create('/fixture/state/images','/fixture/state/view',id,activation,512*1024**2);
   const data=path.join(volume.mountpoint,'data','retained.bin');
   execFileSync('setpriv',['--reuid=999','--regid=999','--clear-groups','--bounding-set=-all','--no-new-privs','node','-e',
      'require("fs").writeFileSync(process.argv[1],Buffer.alloc(8*1024**2,65),{mode:0o600,flag:"wx"});',data],{stdio:'pipe'});
   assert.equal(fs.statSync(data).uid,999);assert.equal(fs.statSync(data).size,8*1024**2);
   const digest=crypto.createHash('sha256').update(fs.readFileSync(data)).digest('hex');
   execFileSync('/usr/bin/umount',[volume.mountpoint],{stdio:'pipe'});storage.resume(volume);
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(data)).digest('hex'),digest);
   assert.throws(()=>storage.verify(volume.file,volume.mountpoint,{...volume.identity,storageId:crypto.randomUUID()}));
   assert.throws(()=>storage.verify(volume.file,volume.mountpoint,{...volume.identity,inode:'0'}));
   assert.throws(()=>storage.create('/fixture/state/images','/fixture/state/view',id,activation,512*1024**2));
   const filler=path.join(volume.mountpoint,'data','quota-filler');
   const fd=fs.openSync(filler,'wx',0o600),chunk=Buffer.alloc(4*1024**2);
   let bounded=false,written=0;
   try {for(let i=0;i<160;i++){fs.writeSync(fd,chunk);written+=chunk.length;}}
   catch(error){assert.equal(error.code,'ENOSPC');bounded=true;}finally{fs.closeSync(fd);}
   assert(bounded);assert(written<512*1024**2);assert.equal(fs.statSync(data).size,8*1024**2);fs.unlinkSync(filler);
   // Root deletion intent recovery after unmount, including an already-removed mountpoint.
   execFileSync('/usr/bin/umount',[volume.mountpoint],{stdio:'pipe'});fs.rmdirSync(volume.mountpoint);
   storage.remove(volume,true);storage.remove(volume,true);
   assert(!fs.existsSync(volume.file));assert(!fs.existsSync(volume.mountpoint));
   console.log('PASS actual ext4 quota ENOSPC / non-root writes / remount persistence / ownership refusal / crash-boundary deletion');
} finally {
   if(volume&&fs.existsSync(volume.file))storage.remove(volume,true);
}
