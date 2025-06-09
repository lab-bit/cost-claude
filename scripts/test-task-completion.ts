import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

/**
 * Test script for task completion features
 * This simulates various Claude conversation patterns to test:
 * - Immediate task completion (quick responses)
 * - Delayed task completion (longer conversations)
 * - Progress notifications during long tasks
 */

const testDir = join(homedir(), '.cost-claude', 'test-tasks');
const sessionId = `test-${Date.now()}`;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createMessage(type: 'user' | 'assistant' | 'summary', content: string, cost?: number) {
  const timestamp = new Date().toISOString();
  const uuid = `${sessionId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  const message: any = {
    uuid,
    type,
    timestamp,
    sessionId,
  };
  
  if (type === 'assistant' && cost) {
    message.costUSD = cost;
    message.durationMs = Math.random() * 3000 + 1000; // 1-4 seconds
    message.message = JSON.stringify({
      role: 'assistant',
      content,
      model: 'claude-opus-4-20250514',
      usage: {
        input_tokens: Math.floor(cost * 5000),
        output_tokens: Math.floor(cost * 2000),
        cache_read_input_tokens: Math.floor(cost * 1000),
        cache_creation_input_tokens: 0
      }
    });
  } else if (type === 'user') {
    message.message = JSON.stringify({
      role: 'user',
      content
    });
  } else if (type === 'summary') {
    message.summary = content;
  }
  
  return message;
}

async function appendToFile(filename: string, message: any) {
  const filePath = join(testDir, filename);
  const content = JSON.stringify(message) + '\n';
  await writeFile(filePath, content, { flag: 'a' });
}

async function simulateQuickTask() {
  console.log(chalk.blue('\n🚀 Simulating Quick Task (should trigger immediate completion)'));
  const filename = `quick-task-${Date.now()}.jsonl`;
  
  // User asks a simple question
  await appendToFile(filename, await createMessage('user', 'What is 2+2?'));
  await delay(1000);
  
  // Assistant responds quickly
  await appendToFile(filename, await createMessage('assistant', 'The answer is 4.', 0.015));
  
  console.log(chalk.gray('  → Wait 5 seconds for immediate completion...'));
  await delay(5000);
}

async function simulateLongTask() {
  console.log(chalk.blue('\n🏃 Simulating Long Task (should trigger progress notifications)'));
  const filename = `long-task-${Date.now()}.jsonl`;
  
  // User asks for something complex
  await appendToFile(filename, await createMessage('user', 'Please write a comprehensive guide about TypeScript.'));
  await delay(2000);
  
  // Assistant starts responding
  console.log(chalk.gray('  → Starting multi-part response...'));
  
  // First response
  await appendToFile(filename, await createMessage('assistant', 'I\'ll create a comprehensive TypeScript guide. Let me start with the basics...', 0.025));
  await delay(8000); // Wait 8 seconds
  
  // Second response (should trigger first progress notification around here)
  console.log(chalk.gray('  → Adding more content (10s elapsed)...'));
  await appendToFile(filename, await createMessage('assistant', 'Now let\'s cover advanced types and generics...', 0.030));
  await delay(12000); // Wait 12 seconds
  
  // Third response (should trigger second progress notification)
  console.log(chalk.gray('  → Adding final section (22s elapsed)...'));
  await appendToFile(filename, await createMessage('assistant', 'Finally, here are best practices and common patterns...', 0.028));
  
  console.log(chalk.gray('  → Wait 35 seconds for delayed completion...'));
  await delay(35000);
}

async function simulateInterruptedTask() {
  console.log(chalk.blue('\n🔄 Simulating Interrupted Task (new user message before completion)'));
  const filename = `interrupted-task-${Date.now()}.jsonl`;
  
  // User asks something
  await appendToFile(filename, await createMessage('user', 'Explain quantum computing'));
  await delay(1000);
  
  // Assistant responds
  await appendToFile(filename, await createMessage('assistant', 'Quantum computing is a fascinating field...', 0.020));
  await delay(2000);
  
  // User interrupts with new question
  console.log(chalk.gray('  → User interrupts with new question...'));
  await appendToFile(filename, await createMessage('user', 'Actually, can you explain machine learning instead?'));
  await delay(1000);
  
  // Assistant responds to new question
  await appendToFile(filename, await createMessage('assistant', 'Of course! Machine learning is...', 0.018));
  
  console.log(chalk.gray('  → Wait for completion of second task...'));
  await delay(35000);
}

async function simulateSessionWithSummary() {
  console.log(chalk.blue('\n📝 Simulating Session with Summary (immediate session completion)'));
  const filename = `session-summary-${Date.now()}.jsonl`;
  
  // Multiple exchanges
  await appendToFile(filename, await createMessage('user', 'Help me debug my code'));
  await delay(1000);
  await appendToFile(filename, await createMessage('assistant', 'I\'ll help you debug. What seems to be the issue?', 0.012));
  await delay(2000);
  
  await appendToFile(filename, await createMessage('user', 'Getting null pointer exception'));
  await delay(1000);
  await appendToFile(filename, await createMessage('assistant', 'Let me analyze the null pointer exception...', 0.025));
  await delay(3000);
  
  // Summary message
  console.log(chalk.gray('  → Adding summary message...'));
  await appendToFile(filename, await createMessage('summary', 'Debugged null pointer exception in user code'));
  
  console.log(chalk.gray('  → Session should complete within 5 seconds...'));
  await delay(7000);
}

async function main() {
  console.log(chalk.bold.green('Task Completion Test Script'));
  console.log(chalk.gray('This will simulate various task patterns to test completion detection\n'));
  
  // Create test directory
  await mkdir(testDir, { recursive: true });
  console.log(chalk.gray(`Test directory: ${testDir}`));
  
  console.log(chalk.yellow('\n⚡ Make sure to run the watcher in another terminal:'));
  console.log(chalk.cyan(`   npm run dev -- watch --path ${testDir} --verbose --test\n`));
  
  console.log(chalk.gray('Press Ctrl+C to stop at any time\n'));
  
  // Wait for user to start watcher
  await delay(5000);
  
  // Run test scenarios
  await simulateQuickTask();
  await simulateLongTask();
  await simulateInterruptedTask();
  await simulateSessionWithSummary();
  
  console.log(chalk.bold.green('\n✅ All test scenarios completed!'));
  console.log(chalk.gray('Check the watcher output to verify task completions and progress notifications'));
}

main().catch(console.error);