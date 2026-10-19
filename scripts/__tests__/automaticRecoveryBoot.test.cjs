const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {render}=require('../../deploy/automatic-recovery/bootUnits.cjs');
const {assertAnchorShape}=require('../../deploy/automatic-recovery/systemdStorage.cjs');
const {observeContainer}=require('../../deploy/automatic-recovery/operator.cjs');
const escape=p=>p.slice(1).replaceAll('/','-')+'.mount';
test('six persistent independent anchors precede Docker; private RO seed is never shared',()=>{
  const units=render({escape});
  const mounts=Object.entries(units).filter(([name])=>name.endsWith('.mount'));
  assert.equal(mounts.length,6);
  for(const [name,unit] of mounts){
    assert.match(unit,/RequiresMountsFor=\/var\/lib\//);assert.match(unit,/Before=pluton-recovery-anchors.service docker.service/);
    assert.match(unit,/Type=none/);assert.match(unit,/What=(.+)\nWhere=\1/);
    assert.match(unit,name.includes('readonly-stage')?/Options=bind,private\n/:/Options=bind,private,rshared\n/);
  }
  const anchors=units['pluton-recovery-anchors.service'];
  for(const [name] of mounts)assert(anchors.includes(name));
  assert.match(anchors,/Before=docker.service/);assert.match(anchors,/PrivateTmp=true/);assert.match(anchors,/ProtectHome=true/);
  assert.match(units['docker.service.d/50-pluton-recovery.conf'],/Requires=pluton-recovery-anchors.service/);
  const app=units['pluton-recovery-application.service'];
  assert.match(app,/After=docker.service pluton-recovery-anchors.service pluton-recovery-lifecycle.service/);
  assert.match(app,/PartOf=docker.service/);assert.match(app,/application.cjs start/);
  assert.doesNotMatch(Object.values(units).join(''),/PrivateTmp=false|ProtectHome=false|nsenter|docker\.sock:/);
});
test('unit renderer refuses injection, path escape, duplicate roots and arbitrary unit names',()=>{
  for(const patch of [{roots:['/srv/a','/srv/a']},{roots:['/srv/../a','/srv/b']},{node:'/usr/bin/node\nExecStart=evil'},
    {code:'/srv/with space'},{docker:'docker.service\nAfter=evil'},{prefix:'x;command'}, {escape:()=> '../foreign.mount'}])
    assert.throws(()=>render({escape,...patch}));
});
test('anchor verifier refuses foreign backing roots, peer groups, missing/stacked or different sandbox views',()=>{
  const parent={target:'/srv/example-fixture',root:'/',device:'8:16',source:'/dev/sdb1',fstype:'ext4',propagation:['shared:2']};
  const anchor={...parent,target:'/srv/example-fixture/retained/view',root:'/retained/view',options:['rw'],propagation:['shared:3']};
  assert.doesNotThrow(()=>assertAnchorShape(anchor,parent,anchor,true,new Set()));
  for(const patch of [{root:'/foreign'},{source:'/dev/sdc1'},{propagation:['shared:2']},{propagation:[]},
    {propagation:['shared:3','master:2']},{options:['ro']}])
    assert.throws(()=>assertAnchorShape({...anchor,...patch},parent,anchor,true,new Set()));
  assert.throws(()=>assertAnchorShape(anchor,parent,{...anchor,device:'8:32'},true,new Set()));
  assert.throws(()=>assertAnchorShape(anchor,parent,anchor,true,new Set(['shared:3'])));
  assert.throws(()=>assertAnchorShape(null,parent,anchor,true,new Set()));
  const seed={...anchor,propagation:[]};
  assert.doesNotThrow(()=>assertAnchorShape(seed,parent,seed,false,new Set()));
  assert.throws(()=>assertAnchorShape(anchor,parent,anchor,false,new Set()));
});
test('cold boot observation publishes Stopped only after exact storage/container verification, without auto-start or import',()=>{
  const calls=[],meta={id:'a'.repeat(24),volume:{file:'/srv/example-fixture/owned.ext4'}};
  const storage={resume:v=>{assert.equal(v,meta.volume);calls.push('verify-storage');}};
  const op={inspect:m=>{assert.equal(m,meta);calls.push('verify-container');return {State:{Running:false}};},
    nativeReady:()=>calls.push('native-ready'),state:(m,state)=>{assert.equal(m,meta);calls.push(state);}};
  assert.deepEqual(observeContainer(op,meta,storage),{meta,running:false});
  assert.deepEqual(calls,['verify-storage','verify-container','stopped']);
  calls.length=0;
  assert.throws(()=>observeContainer({...op,inspect:()=>{throw new Error('foreign identity');}},meta,storage));
  assert.deepEqual(calls,['verify-storage']);
  calls.length=0;
  assert.throws(()=>observeContainer(op,meta,{resume:()=>{throw new Error('wrong filesystem');}}));assert.deepEqual(calls,[]);
  const active={...op,inspect:()=>({State:{Running:true}})};
  assert.equal(observeContainer(active,meta,storage).running,true);
  assert.deepEqual(calls,['verify-storage','native-ready']);
});
test('boot uses sealed overlays/mount contract and starts only an existing immutable non-root application',()=>{
  const source=fs.readFileSync('deploy/compose-tools.py','utf8').split('def boot(')[1].split('def main(')[0];
  assert.match(source,/\.deploy-contract.json/);assert.match(source,/\.deploy-compose-files.json/);
  assert.match(source,/selection\(directory\) == load/);assert.match(source,/validate_config\(/);
  assert.match(source,/check_container\(/);assert.match(source,/boot-existing-container-required/);
  assert.match(source,/boot-container-policy-mismatch/);assert.match(source,/\["start", "pluton"\]/);
  assert.doesNotMatch(source,/\["up"|\["pull"|\["rm"|\["down"/);
  const overlay=fs.readFileSync('deploy/compose.automatic-recovery.yml','utf8');
  assert.match(overlay,/restart: on-failure/);
  assert.match(fs.readFileSync('deploy/compose.yml','utf8'),/restart: unless-stopped/);
  const launcher=fs.readFileSync('deploy/automatic-recovery/application.cjs','utf8');
  assert.match(launcher,/mode&0o777\)!==0o600/);assert.match(launcher,/rootCode\(profile\)/);
  assert.match(launcher,/stdio:\['ignore','pipe','pipe'\]/);assert.doesNotMatch(launcher,/shell:true|process.env/);
});
