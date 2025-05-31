#!/usr/bin/env node
import { SessionDetector } from '../src/services/session-detector.js';
import { ClaudeMessage } from '../src/types/index.js';
import chalk from 'chalk';

console.log(chalk.bold.blue('Testing Session & Task Detector'));
console.log(chalk.gray('This script simulates different session and task completion scenarios\n'));

// Create session detector with short timeouts for testing
const detector = new SessionDetector({
  inactivityTimeout: 10000, // 10 seconds for testing
  summaryMessageTimeout: 2000, // 2 seconds after summary
  taskCompletionTimeout: 2000 // 2 seconds after last assistant message
});

// Set up handlers
detector.on('task-completed', (data) => {
  console.log(chalk.bold.cyan('\n💬 Task Completed!'));
  console.log(chalk.gray('   Session ID:'), data.sessionId);
  console.log(chalk.gray('   Project:'), data.projectName);
  console.log(chalk.gray('   Cost:'), `$${data.taskCost.toFixed(4)}`);
  console.log(chalk.gray('   Assistant Messages:'), data.assistantMessageCount);
  console.log(chalk.gray('   Duration:'), `${Math.round(data.taskDuration / 1000)}s`);
});

detector.on('session-completed', (data) => {
  console.log(chalk.bold.green('\n✅ Session Completed!'));
  console.log(chalk.gray('   Session ID:'), data.sessionId);
  console.log(chalk.gray('   Project:'), data.projectName);
  console.log(chalk.gray('   Summary:'), data.summary);
  console.log(chalk.gray('   Cost:'), `$${data.totalCost.toFixed(4)}`);
  console.log(chalk.gray('   Messages:'), data.messageCount);
  console.log(chalk.gray('   Duration:'), `${Math.round(data.duration / 1000)}s`);
});

// Test scenarios
async function runTests() {
  console.log(chalk.yellow('\n📝 Test 1: Task with Multiple Assistant Messages'));
  console.log(chalk.dim('Simulating a task with multiple assistant responses...'));
  
  const session1 = 'test-session-1';
  const timestamp1 = new Date();
  
  // User message
  detector.processMessage({
    uuid: 'msg-1',
    type: 'user',
    sessionId: session1,
    timestamp: timestamp1.toISOString(),
    cwd: '/Users/test/project/github.com/example/repo',
    message: JSON.stringify({ role: 'user', content: 'Help me with this code' })
  });
  
  // Assistant response 1
  setTimeout(() => {
    console.log(chalk.dim('  → Assistant response 1...'));
    detector.processMessage({
      uuid: 'msg-2',
      type: 'assistant',
      sessionId: session1,
      timestamp: new Date(timestamp1.getTime() + 1000).toISOString(),
      costUSD: 0.0134,
      durationMs: 800,
      cwd: '/Users/test/project/github.com/example/repo',
      message: JSON.stringify({
        role: 'assistant',
        content: 'Let me analyze your code...',
        usage: { input_tokens: 50, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 25 }
      })
    });
  }, 500);
  
  // Assistant response 2
  setTimeout(() => {
    console.log(chalk.dim('  → Assistant response 2...'));
    detector.processMessage({
      uuid: 'msg-3',
      type: 'assistant',
      sessionId: session1,
      timestamp: new Date(timestamp1.getTime() + 2000).toISOString(),
      costUSD: 0.0234,
      durationMs: 1200,
      cwd: '/Users/test/project/github.com/example/repo',
      message: JSON.stringify({
        role: 'assistant',
        content: 'Here is the solution...',
        usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 }
      })
    });
  }, 1000);
  
  console.log(chalk.dim('  → Waiting for task completion (2 seconds after last assistant message)...'));
  
  // Wait for task completion
  await new Promise(resolve => setTimeout(resolve, 4000));
  
  console.log(chalk.yellow('\n📝 Test 2: Session with Inactivity Timeout'));
  console.log(chalk.dim('Simulating a session that times out due to inactivity...'));
  
  const session2 = 'test-session-2';
  const timestamp2 = new Date();
  
  // User message
  detector.processMessage({
    uuid: 'msg-4',
    type: 'user',
    sessionId: session2,
    timestamp: timestamp2.toISOString(),
    cwd: '/Users/test/projects/my-app',
    message: JSON.stringify({ role: 'user', content: 'What is the weather?' })
  });
  
  // Assistant response
  setTimeout(() => {
    detector.processMessage({
      uuid: 'msg-5',
      type: 'assistant',
      sessionId: session2,
      timestamp: new Date(timestamp2.getTime() + 1000).toISOString(),
      costUSD: 0.0156,
      durationMs: 800,
      cwd: '/Users/test/projects/my-app',
      message: JSON.stringify({
        role: 'assistant',
        content: 'I cannot check the weather...',
        usage: { input_tokens: 50, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 25 }
      })
    });
  }, 500);
  
  console.log(chalk.dim('  → Waiting for inactivity timeout (10 seconds)...'));
  
  // Wait for inactivity timeout
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  console.log(chalk.yellow('\n📝 Test 3: Multiple Active Sessions'));
  console.log(chalk.dim('Simulating multiple concurrent sessions...'));
  
  const session3a = 'test-session-3a';
  const session3b = 'test-session-3b';
  const timestamp3 = new Date();
  
  // Session 3a messages
  detector.processMessage({
    uuid: 'msg-6',
    type: 'user',
    sessionId: session3a,
    timestamp: timestamp3.toISOString(),
    cwd: '/Users/test/work/project-a',
    message: JSON.stringify({ role: 'user', content: 'Debug this error' })
  });
  
  // Session 3b messages
  detector.processMessage({
    uuid: 'msg-7',
    type: 'user',
    sessionId: session3b,
    timestamp: new Date(timestamp3.getTime() + 500).toISOString(),
    cwd: '/Users/test/work/project-b',
    message: JSON.stringify({ role: 'user', content: 'Optimize this function' })
  });
  
  // Active sessions check
  console.log(chalk.dim(`  → Active sessions: ${detector.getActiveSessions().join(', ')}`));
  
  // Complete all sessions
  setTimeout(() => {
    console.log(chalk.dim('  → Manually completing all active sessions...'));
    detector.completeAllSessions();
  }, 2000);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log(chalk.bold.green('\n✨ All tests completed!'));
  process.exit(0);
}

// Run tests
runTests().catch(error => {
  console.error(chalk.red('Test error:'), error);
  process.exit(1);
});