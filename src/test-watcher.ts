#!/usr/bin/env node
import { homedir } from 'os';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import chalk from 'chalk';
import { ClaudeFileWatcher } from './services/file-watcher.js';
import { ClaudeMessage } from './types/index.js';

async function ensureDirectory(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function createTestMessage(type: 'user' | 'assistant' = 'assistant'): Promise<ClaudeMessage> {
  const message: ClaudeMessage = {
    uuid: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    type,
    costUSD: type === 'assistant' ? Math.random() * 0.1 : 0,
    durationMs: type === 'assistant' ? Math.floor(Math.random() * 5000) + 1000 : 0,
    sessionId: 'test-session-001',
    message: type === 'assistant' 
      ? JSON.stringify({
          role: 'assistant',
          content: 'Test assistant response',
          model: 'claude-opus-4-20250514',
          usage: {
            input_tokens: Math.floor(Math.random() * 1000) + 100,
            output_tokens: Math.floor(Math.random() * 500) + 50,
            cache_read_input_tokens: Math.floor(Math.random() * 300),
            cache_creation_input_tokens: Math.floor(Math.random() * 100),
          }
        })
      : JSON.stringify({
          role: 'user',
          content: 'Test user message'
        })
  };
  return message;
}

async function testFileWatcher() {
  console.log(chalk.bold.blue('🧪 Claude Code Cost Watcher - Test Mode\n'));

  // Test file path
  const testDir = join(homedir(), '.cost-claude', 'test');
  const testFile = join(testDir, 'test-messages.jsonl');
  
  await ensureDirectory(testFile);
  console.log(chalk.gray(`Test file: ${testFile}`));

  // Create a new watcher instance
  const watcher = new ClaudeFileWatcher({
    paths: [`${testDir}/**/*.jsonl`],
    ignoreInitial: false,
    pollInterval: 100,
    debounceDelay: 300,
  });

  // Set up event handlers
  watcher.on('started', () => {
    console.log(chalk.green('✓ Watcher started successfully'));
  });

  watcher.on('file-added', (path) => {
    console.log(chalk.cyan(`📁 File detected: ${path}`));
  });

  watcher.on('new-message', (message: ClaudeMessage) => {
    console.log(chalk.green(`\n📨 New message detected:`));
    console.log(chalk.gray(`  ID: ${message.uuid}`));
    console.log(chalk.gray(`  Type: ${message.type}`));
    console.log(chalk.gray(`  Cost: $${message.costUSD?.toFixed(4) || '0.0000'}`));
    console.log(chalk.gray(`  Duration: ${message.durationMs || 0}ms`));
  });

  watcher.on('error', (error) => {
    console.error(chalk.red('❌ Error:'), error.message);
  });

  watcher.on('parse-error', ({ filePath, line, error }) => {
    console.error(chalk.yellow('⚠️  Parse error:'), {
      file: filePath,
      line: line.substring(0, 50) + '...',
      error: error.message
    });
  });

  // Start the watcher
  await watcher.start();

  // Test scenarios
  console.log(chalk.bold('\n🚀 Running test scenarios:\n'));

  // Test 1: Create a new file with initial messages
  console.log(chalk.yellow('Test 1: Creating new file with initial messages...'));
  const initialMessages = [
    await createTestMessage('user'),
    await createTestMessage('assistant'),
  ];
  
  const initialContent = initialMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
  await writeFile(testFile, initialContent);
  console.log(chalk.gray(`  Wrote ${initialMessages.length} messages`));

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: Append new messages
  console.log(chalk.yellow('\nTest 2: Appending new messages...'));
  const newMessage = await createTestMessage('assistant');
  await appendFile(testFile, JSON.stringify(newMessage) + '\n');
  console.log(chalk.gray('  Appended 1 message'));

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Rapid additions
  console.log(chalk.yellow('\nTest 3: Rapid message additions...'));
  for (let i = 0; i < 5; i++) {
    const msg = await createTestMessage(i % 2 === 0 ? 'user' : 'assistant');
    await appendFile(testFile, JSON.stringify(msg) + '\n');
    console.log(chalk.gray(`  Added message ${i + 1}/5`));
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Wait for all processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 4: Invalid JSON
  console.log(chalk.yellow('\nTest 4: Testing error handling with invalid JSON...'));
  await appendFile(testFile, 'This is not valid JSON\n');
  await appendFile(testFile, '{ "broken": json }\n');
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 5: Empty lines
  console.log(chalk.yellow('\nTest 5: Testing empty lines...'));
  await appendFile(testFile, '\n\n\n');
  const finalMessage = await createTestMessage('assistant');
  await appendFile(testFile, JSON.stringify(finalMessage) + '\n');

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Show statistics
  const stats = watcher.getStats();
  console.log(chalk.bold.blue('\n📊 Watcher Statistics:'));
  console.log(chalk.gray(`  Watched files: ${stats.watchedFiles}`));
  console.log(chalk.gray(`  Total bytes read: ${stats.totalBytesRead}`));

  // Test manual mode
  console.log(chalk.bold.yellow('\n🔧 Manual Test Mode:'));
  console.log(chalk.gray('You can now manually edit the test file to see real-time updates.'));
  console.log(chalk.gray(`File: ${testFile}`));
  console.log(chalk.gray('Press Ctrl+C to stop the test.\n'));

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nStopping test...'));
    await watcher.stop();
    console.log(chalk.green('Test completed! 👍'));
    process.exit(0);
  });

  // Keep running
  await new Promise(() => {});
}

// Run the test
testFileWatcher().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});