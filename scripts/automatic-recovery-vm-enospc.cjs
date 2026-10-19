'use strict';
// Synthetic quota probe only; UID 999, no capabilities/network/socket.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
try{
  assert.equal(process.getuid(),999);assert.equal(process.getgid(),999);
  const anchor=JSON.parse(fs.readFileSync('/fixture-data/identity.json','utf8'));
  assert.equal(anchor.restoreId,process.argv[2]);assert.equal(anchor.storageId,process.argv[3]);
  const directory='/fixture-data/data',file=directory+'/.pluton-fixture-fill',initial=fs.statfsSync(directory);
  assert.equal(initial.type,0xef53);assert(initial.bsize*initial.blocks<=2147483648);
  const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);
  const allocate=(offset,bytes)=>{
    try{execFileSync('/usr/bin/fallocate',['--offset',String(offset),'--length',String(bytes),file],
      {encoding:'utf8',timeout:15000,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});return true;}
    catch(error){assert.equal(error.status,1);assert.match(String(error.stderr),/No space left on device/);return false;}
  };
  const first=Math.floor((initial.bavail*initial.bsize-16*1024**2)/4096)*4096;
  assert(first>1024**3);assert(allocate(0,first));
  let failures=0;
  for(const [chunk,limit] of [[8*1024**2,4],[1024**2,16],[4096,512]]){
    for(let attempt=0;attempt<limit;attempt++){
      const size=fs.statSync(file).size;assert(size<2147483648);
      if(!allocate(size,chunk)){failures++;break;}
      assert(attempt<limit-1);
    }
  }
  assert(failures>=2);
  const handle=fs.openSync(file,'r+');let writeFailed=false;
  try{
    for(let attempt=0;attempt<256;attempt++){
      try{fs.writeSync(handle,Buffer.alloc(4096),0,4096,fs.fstatSync(handle).size);}
      catch(error){assert.equal(error.code,'ENOSPC');writeFailed=true;break;}
    }
  }finally{fs.closeSync(handle);}
  assert(writeFailed);const stat=fs.statSync(file),final=fs.statfsSync(directory);
  assert(stat.size<2147483648);assert(stat.blocks*512<2147483648);
  console.log(JSON.stringify({enospc:true,filledBytes:stat.size,allocatedBytes:stat.blocks*512,
    filesystemBytes:final.blocks*final.bsize,availableBytes:final.bavail*final.bsize}));
}catch(error){console.error('ENOSPC fixture did not pass; no provider output printed.');process.exitCode=1;}
