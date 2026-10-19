#!/usr/local/bin/node
const args = process.argv.slice(2);
if (args[0] === 'obscure') { process.stdin.resume(); process.stdin.on('end', () => console.log('synthetic-obscured-value')); }
else if (args[0] === 'lsf') { /* Empty managed target. */ }
