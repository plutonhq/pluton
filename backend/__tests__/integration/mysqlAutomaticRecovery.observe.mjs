// Disposable CI authority fixture, NOT the production operator or host acceptance.
// Its own bounded 4 GiB/2 CPU cgroup is measured, never an invented RAM value.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createOperator } = require('/fixture-deploy/persistent-restore/operator.cjs');
const operator = createOperator({ data: '/fixture', storage: { rootParent() {} } });
const context = JSON.parse(fs.readFileSync('/fixture/images/context.json'));
if (process.getuid() !== 0 || !/^[a-f0-9]{24}$/.test(context.id)) throw new Error('Fixture authority refused.');
let sequence = 100, count = 0;
function write(name, value) {
   const file = '/fixture/images/' + name, temporary = file + '.observation.tmp';
   fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o640 });
   fs.chownSync(temporary, 0, 10001);
   fs.renameSync(temporary, file);
}
function observe() {
   let sample = null;
   try { sample = operator.resourceCapacity(); } catch { /* Unknown never approves. */ }
   write('capacity.json', { version: 1, observedAt: Date.now(), sample });
   write(context.id + '.receipt.json', { version: 1, id: context.id,
      bindingHash: require('/fixture-deploy/automatic-recovery/operator.cjs').hash({ binding: context.binding, ownerToken: context.ownerToken }),
      state: 'ready', code: null, observedAt: Date.now(), sequence: sequence++ });
   if (++count >= 600) clearInterval(timer); // Maximum 20 min; never orphan a heartbeat.
}
let timer;
observe();
timer = setInterval(observe, 2000);
