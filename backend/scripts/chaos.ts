import { spawn, ChildProcess } from 'child_process';
import { env } from '../src/config.js';

console.log('🔥 Starting Chaos Testing for ReachInbox Worker...');
console.log('This script will spawn a worker, randomly kill it (SIGKILL), and respawn it.');
console.log('Watch the API logs to see the Boot Reconciler pick up the pieces!');

let workerProcess: ChildProcess | null = null;
let isShuttingDown = false;

function startWorker() {
  if (isShuttingDown) return;

  console.log('\n🟢 [Chaos] Spawning new worker process...');
  // We run tsx src/worker.ts directly to avoid npm wrapper layers which might not pass SIGKILL to child
  workerProcess = spawn('npx', ['tsx', 'src/worker.ts'], { 
    stdio: 'inherit',
    shell: true 
  });

  workerProcess.on('exit', (code, signal) => {
    console.log(`🔴 [Chaos] Worker process exited with code ${code} and signal ${signal}`);
    workerProcess = null;
    
    if (!isShuttingDown) {
      const respawnDelay = Math.floor(Math.random() * 3000) + 1000;
      console.log(`⏳ [Chaos] Waiting ${respawnDelay}ms before respawning...`);
      setTimeout(startWorker, respawnDelay);
    }
  });

  // Schedule next random kill (between 5 and 15 seconds)
  const timeToLive = Math.floor(Math.random() * 10000) + 5000;
  console.log(`⏱️ [Chaos] This worker will be brutally murdered in ${timeToLive}ms`);
  
  setTimeout(() => {
    if (workerProcess && !isShuttingDown) {
      console.log('🔪 [Chaos] Executing SIGKILL (kill -9) on worker process!');
      // On Windows, child.kill('SIGKILL') doesn't always forcefully kill the tree.
      // But we will use 'SIGTERM' or 'SIGKILL' standard node approach. 
      workerProcess.kill('SIGKILL');
    }
  }, timeToLive);
}

startWorker();

process.on('SIGINT', () => {
  isShuttingDown = true;
  console.log('🛑 [Chaos] Stopping chaos testing...');
  if (workerProcess) {
    workerProcess.kill('SIGTERM');
  }
  process.exit(0);
});
