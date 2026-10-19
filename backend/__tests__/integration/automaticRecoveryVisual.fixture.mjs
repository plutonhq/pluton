// Pure synthetic UI metadata, never a production plan migration/default change.
export function visualPlanSettings() {
  const notifications = {
    email:{enabled:false,case:'failure',type:'smtp',emails:''},
    webhook:{enabled:false,case:'failure',method:'POST',contentType:'application/json',url:''},
    push:{enabled:false,case:'failure',url:'',authType:'none',authToken:'',tags:''},
    slack:{enabled:false,case:'failure',url:''},discord:{enabled:false,case:'failure',url:''},
  };
  return {
    interval:{type:'daily',time:'10:00AM',days:'',hours:'',minutes:5},
    compression:true,encryption:true,retries:5,retryDelay:300,notification:notifications,
    prune:{snapCount:5,policy:'forgetByAge',forgetAge:'1m',revisions:false},
    performance:{scan:true},
    integrity:{enabled:false,interval:{type:'weekly',time:'10:00AM',days:'sun',hours:'',minutes:5},
      method:'no-read',notification:structuredClone(notifications)},
    scripts:{onBackupStart:[],onBackupEnd:[],onBackupError:[],onBackupFailure:[],onBackupComplete:[]},
    replication:{enabled:false,storages:[]},
  };
}
export function visualSnapshotStats(summary) {
  if (!/^[a-f0-9]{64}$/.test(summary?.snapshot_id) ||
      !Number.isSafeInteger(summary.total_files_processed) || summary.total_files_processed<1 ||
      !Number.isSafeInteger(summary.total_bytes_processed) || summary.total_bytes_processed<1)
    throw new Error('Invalid synthetic snapshot statistics.');
  return {size:summary.total_bytes_processed,snapshots:[summary.snapshot_id]};
}
