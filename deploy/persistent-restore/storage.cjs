/* Root operator only. Fixed-size fully allocated ext4, never tmpfs or an unbounded Docker volume. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
// Only reviewed root-owned host code may provide a mount driver. Never mailbox input.
function createStorage(driver={}){
function fail(){throw new Error('Persistent storage ownership/quota verification refused.');}
function command(binary,args){
  return execFileSync(binary,args,{encoding:'utf8',timeout:60000,killSignal:'SIGKILL',maxBuffer:65536,
    env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C'},stdio:['ignore','pipe','pipe']}).trim();
}
function directory(file,uid=0,gid=0,mode=0o700){
  if(!fs.existsSync(file)){
    fs.mkdirSync(file,{mode});
    const created=fs.lstatSync(file);if(!created.isDirectory()||created.isSymbolicLink()||created.uid!==0)fail();
    fs.chmodSync(file,mode); // Normalize only a just-created owned directory, independent of umask.
  }
  const stat=fs.lstatSync(file);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==uid||stat.gid!==gid||(stat.mode&0o777)!==mode) fail();
}
function rootParent(file){
  for(let parent=path.dirname(file);;parent=path.dirname(parent)){
    const stat=fs.lstatSync(parent);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))fail();
    if(parent===path.dirname(parent)) break;
  }
}
function imageStat(file,expected){
  rootParent(file);const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o777)!==0o600||
    stat.nlink!==1||stat.size!==expected.quotaBytes||stat.blocks*512<expected.quotaBytes||
    String(stat.ino)!==expected.inode||String(stat.dev)!==expected.device) fail();
  return stat;
}
function mounted(mountpoint){
  try{
    const result=JSON.parse(command('/usr/bin/findmnt',['--json','--mountpoint',mountpoint,'--output','TARGET,SOURCE,FSTYPE,OPTIONS,UUID']));
    if(!Array.isArray(result.filesystems)||result.filesystems.length!==1)fail();
    return result.filesystems[0];
  }catch(error){
    // findmnt's documented no-match exit is absence; a timeout, invalid JSON,
    // permission failure or other command error is NOT permission to overmount.
    if(error.status===1&&!String(error.stdout||'').trim()&&!String(error.stderr||'').trim())return null;
    fail();
  }
}
function verify(file,mountpoint,identity){
  imageStat(file,identity);
  const mount=mounted(mountpoint);if(!mount||mount.target!==mountpoint||mount.fstype!=='ext4'||!/^\/dev\/loop\d+$/.test(mount.source)) fail();
  for(const option of ['nodev','nosuid','noexec'])if(!mount.options.split(',').includes(option))fail();
  const backing=JSON.parse(command('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices
    ?.find(item=>item.name===mount.source);
  if(!backing||backing['back-file']!==file)fail();
  // Query the actual loop device, not an optional/stale udev UUID cache (e.g. in an operator fixture).
  if(command('/usr/sbin/blkid',['--probe','--output','value','--match-tag','UUID',mount.source])!==identity.uuid)fail();
  const stat=fs.statfsSync(mountpoint);
  if(stat.type!==0xef53||stat.bsize*stat.blocks>identity.quotaBytes)fail();
  const anchorPath=path.join(mountpoint,'identity.json'),anchorStat=fs.lstatSync(anchorPath);
  if(!anchorStat.isFile()||anchorStat.isSymbolicLink()||anchorStat.uid!==0||(anchorStat.mode&0o777)!==0o444)fail();
  const anchor=JSON.parse(fs.readFileSync(anchorPath,'utf8'));
  if(anchor.restoreId!==identity.restoreId||anchor.storageId!==identity.storageId||anchor.activationId!==identity.activationId)fail();
  driver.visible?.(file,mountpoint);
  return {bytes:stat.bsize*stat.blocks,free:stat.bavail*stat.bsize,source:mount.source};
}
function create(imageRoot,viewRoot,id,activationId,quotaBytes=2*1024**3){
  if(process.getuid()!==0||!/^[a-f0-9]{24}$/.test(id)||!/^[a-f0-9]{32}$/.test(activationId)||
    !Number.isSafeInteger(quotaBytes)||quotaBytes<512*1024**2||quotaBytes>2*1024**3)fail();
  directory(imageRoot);rootParent(path.join(imageRoot,'probe'));
  const file=path.join(imageRoot,id+'.ext4'),mountpoint=path.join(viewRoot,id);
  driver.target?.(file,mountpoint);
  if(fs.existsSync(file)||fs.existsSync(mountpoint))fail();
  const capacity=fs.statfsSync(imageRoot);if(capacity.bavail*capacity.bsize<quotaBytes+1024**3)fail();
  const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  fs.closeSync(fd);
  // Retain partial/new resources on error for investigation; never adopt or format an existing image.
  command('/usr/bin/fallocate',['--length',String(quotaBytes),file]);
  command('/usr/sbin/mkfs.ext4',['-q','-F','-m','0','-E','nodiscard,lazy_itable_init=0,lazy_journal_init=0',file]);
  fs.mkdirSync(mountpoint,{mode:0o755});
  fs.chmodSync(mountpoint,0o755);
  if(driver.mount)driver.mount(file,mountpoint,true);
  else command('/usr/bin/mount',['--options','loop,nodev,nosuid,noexec',file,mountpoint]);
  const stat=fs.lstatSync(file),uuid=command('/usr/sbin/blkid',['--probe','--output','value','--match-tag','UUID',file]);
  const identity={restoreId:id,activationId,storageId:crypto.randomUUID(),quotaBytes,inode:String(stat.ino),device:String(stat.dev),uuid};
  const anchor=fs.openSync(path.join(mountpoint,'identity.json'),fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o444);
  try{fs.writeFileSync(anchor,JSON.stringify(identity));fs.fchmodSync(anchor,0o444);fs.fsyncSync(anchor);}finally{fs.closeSync(anchor);}
  fs.mkdirSync(path.join(mountpoint,'data'),{mode:0o700});fs.chownSync(path.join(mountpoint,'data'),999,999);
  verify(file,mountpoint,identity);
  return {file,mountpoint,identity};
}
function resume(volume){
  driver.target?.(volume.file,volume.mountpoint);
  imageStat(volume.file,volume.identity);
  if(!mounted(volume.mountpoint)) {
    const stat=fs.lstatSync(volume.mountpoint);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||fs.readdirSync(volume.mountpoint).length)fail();
    const uuid=command('/usr/sbin/blkid',['--probe','--output','value','--match-tag','UUID',volume.file]);
    if(uuid!==volume.identity.uuid)fail();
    if(driver.mount)driver.mount(volume.file,volume.mountpoint,false);
    else command('/usr/bin/mount',['--options','loop,nodev,nosuid,noexec',volume.file,volume.mountpoint]);
  }
  return verify(volume.file,volume.mountpoint,volume.identity);
}
function remove(volume,deletionIntent=false){
  driver.target?.(volume.file,volume.mountpoint);
  if(!fs.existsSync(volume.file)){
    if(!deletionIntent||mounted(volume.mountpoint))fail();
    const loops=JSON.parse(command('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices||[];
    if(loops.some(loop=>loop['back-file']===volume.file))fail();
    if(fs.existsSync(volume.mountpoint)){
      directory(volume.mountpoint,0,0,0o755);
      if(fs.readdirSync(volume.mountpoint).length)fail();
      fs.rmdirSync(volume.mountpoint);
    }
    return;
  }
  if(!fs.existsSync(volume.mountpoint)){
    if(!deletionIntent)fail();
    rootParent(volume.mountpoint);fs.mkdirSync(volume.mountpoint,{mode:0o755});fs.chmodSync(volume.mountpoint,0o755);
  }
  const result=resume(volume);
  if(driver.unmount)driver.unmount(volume.file,volume.mountpoint);
  else command('/usr/bin/umount',[volume.mountpoint]);
  if(mounted(volume.mountpoint))fail();
  const loops=JSON.parse(command('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices||[];
  const loop=loops.find(item=>item.name===result.source);
  if(loop) {if(loop['back-file']!==volume.file)fail();command('/usr/sbin/losetup',['--detach',result.source]);}
  const remaining=JSON.parse(command('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices||[];
  if(remaining.some(item=>item['back-file']===volume.file||item.name===result.source))fail();
  imageStat(volume.file,volume.identity);
  if(fs.readdirSync(volume.mountpoint).length)fail();
  fs.rmdirSync(volume.mountpoint);fs.unlinkSync(volume.file);
  if(fs.existsSync(volume.file)||fs.existsSync(volume.mountpoint)||mounted(volume.mountpoint))fail();
}
return {create,resume,verify,remove,mounted,imageStat,directory,rootParent};
}
module.exports={...createStorage(),createStorage};
