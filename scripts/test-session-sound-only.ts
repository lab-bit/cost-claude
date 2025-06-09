#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

console.log('Testing --session-sound-only option...');

// Create test directory
const testDir = join(homedir(), '.claude-code-test-session-sound');
execSync(`mkdir -p ${testDir}`, { stdio: 'inherit' });

// Create a test JSONL file
const testFile = join(testDir, 'test-session.jsonl');
const sessionId = `test-session-${Date.now()}`;

// Helper function to create messages
function createMessage(type: string, content: any, costUSD?: number) {
  return JSON.stringify({
    uuid: `${sessionId}-${Date.now()}-${Math.random()}`,
    type,
    timestamp: new Date().toISOString(),
    sessionId,
    costUSD,
    durationMs: 1234,
    message: JSON.stringify(content)
  });
}

console.log('\n1. Testing with --session-sound-only (task should be silent, session should have sound)');
console.log('Starting watch with --session-sound-only...');

// Start the watcher in background
const watchProcess = exec(`npm run dev -- watch --path ${testDir} --session-sound-only --notify --verbose`, {
  detached: true,
  stdio: 'pipe'
});

let output = '';
watchProcess.stdout?.on('data', (data: Buffer) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);
});

watchProcess.stderr?.on('data', (data: Buffer) => {
  process.stderr.write(data);
});

// Wait for watcher to initialize
await new Promise(resolve => setTimeout(resolve, 3000));

console.log('\n2. Creating a task (should NOT play sound)...');

// Create user message
writeFileSync(testFile, createMessage('user', {
  role: 'user',
  content: 'Test task that should complete'
}) + '\n');

await new Promise(resolve => setTimeout(resolve, 1000));

// Create assistant messages for task
for (let i = 0; i < 3; i++) {
  writeFileSync(testFile, createMessage('assistant', {
    role: 'assistant',
    content: `Working on task step ${i + 1}...`,
    model: 'claude-opus-4-20250514',
    usage: {
      input_tokens: 100,
      output_tokens: 50
    }
  }, 0.01) + '\n', { flag: 'a' });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
}

console.log('\n3. Waiting for delayed task completion (should be SILENT)...');
await new Promise(resolve => setTimeout(resolve, 35000)); // Wait for delayed completion

console.log('\n4. Creating session completion (should PLAY sound)...');

// Create summary message to trigger session completion
writeFileSync(testFile, createMessage('summary', {
  summary: 'Test session completed successfully'
}) + '\n', { flag: 'a' });

await new Promise(resolve => setTimeout(resolve, 5000));

console.log('\n5. Cleaning up...');

// Kill the watch process
try {
  process.kill(-watchProcess.pid!, 'SIGTERM');
} catch (e) {
  // Process might have already exited
}

// Clean up test directory
execSync(`rm -rf ${testDir}`, { stdio: 'inherit' });

console.log('\nTest completed!');
console.log('\nExpected behavior:');
console.log('- Task completion: NO sound (even though notification appears)');
console.log('- Session completion: SOUND plays with notification');

// Helper function to execute command
function exec(command: string, options: any) {
  const { spawn } = require('child_process');
  return spawn('sh', ['-c', command], options);
}