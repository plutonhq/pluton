// Read-only synthetic content assertion after the real API has completed import.
// Runs as the actual application UID, using the ordinary ownership/TLS boundary.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sqlite} from '/app/backend/dist/db/index.js';
import {configService} from '/app/backend/dist/services/ConfigService.js';
import {DatabaseRestoreStore} from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import {AutomaticRecoveryLifecycle} from '/app/backend/dist/utils/automaticRecoveryLifecycle.js';
import {PersistentRestoreTargets} from '/app/backend/dist/utils/persistentRestoreTargets.js';
import {PersistentDatabaseImporter} from '/app/backend/dist/utils/persistentDatabaseImporter.js';
assert.equal(process.getuid(),10001);assert.equal(process.getgid(),10001);
const id=process.argv[2];assert.match(id,/^[a-f0-9]{24}$/);
const store=new DatabaseRestoreStore(sqlite,configService.config.SECRET),row=store.get(id);
assert.equal(row.status,'active');assert(row.completedAt>0);
const targets=new PersistentRestoreTargets(undefined,undefined,undefined,undefined,new AutomaticRecoveryLifecycle(sqlite));
const approval=await targets.assertBinding(row),directory=await fs.mkdtemp('/data/api-inspection-');
let connection;
try{
  const point='/run/pluton-persistent-storage/'+id;
  const mounts=(await fs.readFile('/proc/self/mountinfo','utf8')).split('\n').filter(line=>line.split(' ')[4]===point);
  assert.equal(mounts.length,1);
  for(const flag of ['ro','nodev','nosuid','noexec'])assert(mounts[0].split(' ')[5].split(',').includes(flag));
  const anchor=await fs.stat(point+'/identity.json');assert.equal(anchor.uid,0);assert.equal(anchor.mode&0o777,0o444);
  let denied;
  try{await fs.writeFile(point+'/.synthetic-write-refused','synthetic',{flag:'wx'});}catch(error){denied=error.code;}
  assert(['EROFS','EACCES'].includes(denied));
  const importer=new PersistentDatabaseImporter(store,approval,await targets.ca(approval));
  const inspected=await importer.inspect(row,directory,new AbortController().signal);assert.equal(inspected.tables,1);
  connection=await importer.open(directory,new AbortController().signal);
  const result=await connection.query(row.database,'SELECT value FROM fixture_entries;','database-import-validation');
  assert.equal(result.trim(),'synthetic API recovery content');
  console.log(JSON.stringify({event:'synthetic_api_import_content_verified',engine:row.artifact.engine,exactSnapshot:true,ownership:true,tls:true,tables:1,kernelReadonly:true}));
}finally{await connection?.close();await fs.rm(directory,{recursive:true});sqlite.close();}
