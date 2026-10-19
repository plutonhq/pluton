'use strict';
// Root-only boot launcher. The application cannot choose the deployment,
// Compose files, commands, image, environment or mount contract.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {rootCode}=require('../persistent-restore/operator.cjs');
function launch(action,{profile='/etc/pluton-automatic-recovery/application.json'}={}){
  if(process.platform!=='linux'||process.getuid()!==0||!['start','stop'].includes(action))throw new Error('refused');
  rootCode(__filename);rootCode(profile);
  const stat=fs.lstatSync(profile);
  if((stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size>2048)throw new Error('refused');
  const value=JSON.parse(fs.readFileSync(profile,'utf8'));
  if(Object.keys(value).sort().join(',')!=='deploymentDirectory,version'||value.version!==1||
    !/^\/[A-Za-z0-9_./-]+$/.test(value.deploymentDirectory)||value.deploymentDirectory.includes('..')||
    fs.realpathSync(value.deploymentDirectory)!==value.deploymentDirectory)throw new Error('refused');
  require('../persistent-restore/storage.cjs').rootParent(value.deploymentDirectory+'/profile');
  const policy=path.resolve(__dirname,'../compose-tools.py');rootCode(policy);
  execFileSync('/usr/bin/python3',[policy,'boot',value.deploymentDirectory,action],{
    timeout:action==='start'?170000:80000,killSignal:'SIGKILL',maxBuffer:65536,
    stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C'}});
}
module.exports={launch};
if(require.main===module){try{if(process.argv.length!==3)throw new Error('refused');launch(process.argv[2]);}
  catch{process.stderr.write('Pluton boot action failed closed; inspect approved deployment/anchors locally.\n');process.exitCode=1;}}
