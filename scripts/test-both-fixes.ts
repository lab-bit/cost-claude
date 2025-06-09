#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// Create test directory
const testDir = join(homedir(), '.claude/projects/test-fixes');
mkdirSync(testDir, { recursive: true });

const testFile = join(testDir, 'test-session.jsonl');

console.log('Testing both fixes:');
console.log('1. Session cost calculation when costUSD is null');
console.log('2. Old messages appearing after hourly summary\n');

// Create messages with various timestamps and cost scenarios
const now = Date.now();
const messages = [
  // Current messages (should appear)
  {
    uuid: 'current-1',
    type: 'user',
    timestamp: new Date(now - 10000).toISOString(), // 10 seconds ago
    sessionId: 'current-session',
    cwd: testDir,
    message: JSON.stringify({ role: 'user', content: 'Current user message' })
  },
  {
    uuid: 'current-2',
    type: 'assistant',
    timestamp: new Date(now - 5000).toISOString(), // 5 seconds ago
    sessionId: 'current-session',
    cwd: testDir,
    costUSD: null, // Null cost - should be calculated
    durationMs: 3000,
    message: JSON.stringify({
      role: 'assistant',
      model: 'claude-opus-4-20250514',
      content: 'Current response',
      usage: {
        input_tokens: 500,
        output_tokens: 1000,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100
      }
    })
  },
  // Old messages (should be filtered out)
  {
    uuid: 'old-1',
    type: 'assistant',
    timestamp: new Date(now - 3600000).toISOString(), // 1 hour ago
    sessionId: 'old-session',
    cwd: testDir,
    costUSD: 0.25,
    durationMs: 0, // Duration 0ms is suspicious for old messages
    message: JSON.stringify({
      role: 'assistant',
      model: 'claude-opus-4-20250514',
      content: 'Old response that should not appear',
      usage: {
        input_tokens: 1000,
        output_tokens: 2000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 200
      }
    })
  },
  // Very old message
  {
    uuid: 'very-old-1',
    type: 'assistant',
    timestamp: new Date(now - 7200000).toISOString(), // 2 hours ago
    sessionId: 'very-old-session',
    cwd: testDir,
    costUSD: null, // Also test null cost on old message
    durationMs: 0,
    message: JSON.stringify({
      role: 'assistant',
      model: 'claude-opus-4-20250514',
      content: 'Very old response',
      usage: {
        input_tokens: 300,
        output_tokens: 600,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50
      }
    })
  }
];

// Write initial messages
writeFileSync(testFile, messages.map(m => JSON.stringify(m)).join('\n') + '\n');

console.log('Created test file:', testFile);
console.log('Messages written:');
messages.forEach(m => {
  const age = Math.round((now - new Date(m.timestamp).getTime()) / 1000);
  console.log(`- ${m.uuid}: ${m.type}, ${age}s old, costUSD: ${m.costUSD}`);
});

console.log('\nStarting watch command...');
console.log('Expected behavior:');
console.log('- Only current messages (< 5 min old) should appear');
console.log('- Null costUSD should be calculated from tokens');
console.log('- Session completion should show correct total cost\n');

// Start watch command in background
const watchProcess = execSync(
  `node dist/cli/index.js watch --path ${testDir} --notify --verbose --max-age 5`,
  {
    stdio: 'inherit',
    timeout: 10000
  }
);