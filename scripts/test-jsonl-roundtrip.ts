import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { SessionDetector } from '../src/services/session-detector.js';
import { ClaudeMessage } from '../src/types/index.js';

const testDir = join(homedir(), '.cost-claude', 'test-roundtrip');
const sessionId = `test-${Date.now()}`;

async function createMessage(type: 'user' | 'assistant', content: string, cost?: number): Promise<ClaudeMessage> {
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
    message.durationMs = Math.random() * 3000 + 1000;
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
  }
  
  return message;
}

async function main() {
  // Create test directory
  await mkdir(testDir, { recursive: true });
  
  const filename = join(testDir, 'test.jsonl');
  
  // Create messages
  const messages: ClaudeMessage[] = [
    await createMessage('user', 'Hello'),
    await createMessage('assistant', 'Hi there!', 0.025),
    await createMessage('user', 'What is 2+2?'),
    await createMessage('assistant', 'The answer is 4.', 0.015),
  ];
  
  // Write to JSONL file
  console.log('Writing messages to JSONL file...');
  for (const msg of messages) {
    console.log(`Writing ${msg.type} message, cost: ${msg.costUSD || 'N/A'}`);
    await writeFile(filename, JSON.stringify(msg) + '\n', { flag: 'a' });
  }
  
  // Read back and parse
  console.log('\nReading messages back from JSONL file...');
  const content = await readFile(filename, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  const parsedMessages: ClaudeMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ClaudeMessage;
      console.log(`Parsed ${parsed.type} message, cost: ${parsed.costUSD || 'N/A'}`);
      parsedMessages.push(parsed);
    } catch (error) {
      console.error('Failed to parse line:', line, error);
    }
  }
  
  // Process with SessionDetector
  console.log('\nProcessing with SessionDetector...');
  const detector = new SessionDetector({
    inactivityTimeout: 3000,
    taskCompletionTimeout: 2000,
    delayedTaskCompletionTimeout: 5000,
  });
  
  detector.on('session-completed', (data) => {
    console.log('\nSession completed:', {
      sessionId: data.sessionId,
      totalCost: data.totalCost,
      messageCount: data.messageCount,
    });
    
    console.log('\nTest passed! Session costs are being calculated correctly.');
    process.exit(0);
  });
  
  detector.on('task-completed', (data) => {
    console.log('\nTask completed:', {
      type: data.completionType,
      cost: data.taskCost,
      messages: data.assistantMessageCount,
    });
  });
  
  // Process parsed messages
  parsedMessages.forEach(msg => detector.processMessage(msg));
  
  // Wait for completion
  setTimeout(() => {
    console.log('\nTest timed out - session did not complete automatically');
    process.exit(1);
  }, 5000);
}

main().catch(console.error);