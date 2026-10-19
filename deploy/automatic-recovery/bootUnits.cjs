'use strict';
// Reviewed host code only. No caller paths, unit properties or commands come
// from application requests. Rendering never enables/restarts a host service.
const {execFileSync}=require('node:child_process');
const retained='/var/lib/pluton-persistent-restores',disposable='/var/lib/pluton-automatic-recovery/disposable';
const fail=()=>{throw new Error('Recovery boot configuration refused.');};
function render({roots=[retained,disposable],node='/usr/bin/node',code='/opt/pluton-recovery-operator',
  docker='docker.service',prefix='pluton-recovery',escape=point=>execFileSync('/usr/bin/systemd-escape',
    ['--path','--suffix=mount','--',point],{encoding:'utf8',timeout:5000}).trim()}={}){
  if(roots.length!==2||new Set(roots).size!==2||[...roots,node,code].some(p=>
    !/^\/[A-Za-z0-9_./-]+$/.test(p)||p.includes('..')||p.endsWith('/'))||
    !/^[a-zA-Z0-9_-]+\.service$/.test(docker)||!/^[a-zA-Z0-9_-]+$/.test(prefix))fail();
  const units={};
  for(const root of roots)for(const plane of ['view','app-view','readonly-stage']){
    const point=root+'/'+plane,shared=plane!=='readonly-stage',name=escape(point);
    if(!/^[A-Za-z0-9_\\.-]+\.mount$/.test(name)||units[name])fail();
    units[name]='[Unit]\nDescription=Pluton recovery persistent '+plane+' anchor\n'+
      'RequiresMountsFor='+root+'\nBefore='+prefix+'-anchors.service '+docker+'\n\n'+
      '[Mount]\nWhat='+point+'\nWhere='+point+'\nType=none\n'+
      'Options=bind,private'+(shared?',rshared':'')+'\nDirectoryMode='+(shared?'0750':'0700')+'\nTimeoutSec=30\n';
  }
  const mounts=Object.keys(units).join(' ');
  units[prefix+'-anchors.service']='[Unit]\nDescription=Verify Pluton recovery boot anchors\n'+
    'Requires='+mounts+'\nAfter='+mounts+'\nBefore='+docker+'\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\n'+
    'User=root\nGroup=root\nUMask=0077\nExecStart='+node+' '+code+'/deploy/automatic-recovery/operator.cjs anchors\n'+
    'PrivateTmp=true\nProtectHome=true\nNoNewPrivileges=true\nLockPersonality=true\nRestrictAddressFamilies=AF_UNIX\nTimeoutStartSec=30\n';
  units[docker+'.d/50-'+prefix+'.conf']='[Unit]\nRequires='+prefix+'-anchors.service\nAfter='+prefix+'-anchors.service\n'+
    'Wants='+prefix+'-application.service\n';
  units[prefix+'-application.service']='[Unit]\nDescription=Pluton after verified recovery reconciliation\n'+
    'Requires='+docker+' '+prefix+'-anchors.service '+prefix+'-lifecycle.service\n'+
    'After='+docker+' '+prefix+'-anchors.service '+prefix+'-lifecycle.service\nPartOf='+docker+'\nBindsTo='+docker+'\n\n'+
    '[Service]\nType=oneshot\nRemainAfterExit=yes\nUser=root\nGroup=root\nUMask=0077\n'+
    'ExecStart='+node+' '+code+'/deploy/automatic-recovery/application.cjs start\n'+
    'ExecStop='+node+' '+code+'/deploy/automatic-recovery/application.cjs stop\n'+
    'TimeoutStartSec=180\nTimeoutStopSec=90\nPrivateTmp=true\nProtectHome=true\nNoNewPrivileges=true\n'+
    'LockPersonality=true\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n';
  return units;
}
module.exports={render};
if(require.main===module){
  // Operator reviews this manifest before installation; stdout contains only
  // fixed unit text, no environment, application configuration or credentials.
  try{if(process.argv.length!==2)fail();process.stdout.write(JSON.stringify(render(),null,2)+'\n');}
  catch{process.stderr.write('Recovery boot unit rendering failed closed.\n');process.exitCode=1;}
}
