#!/usr/bin/env tsx

import { SessionDetector } from '../src/services/session-detector.js';
import { ClaudeMessage } from '../src/types/index.js';
import { CostCalculator } from '../src/core/cost-calculator.js';

// Create a session detector
const detector = new SessionDetector();

// Create test messages - some with costUSD, some without
const testMessages: ClaudeMessage[] = [
  {
    uuid: 'msg-1',
    type: 'user',
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    cwd: '/Users/test/project/test-repo',
    message: JSON.stringify({
      role: 'user',
      content: 'Test user message'
    })
  },
  {
    uuid: 'msg-2', 
    type: 'assistant',
    timestamp: new Date(Date.now() + 1000).toISOString(),
    sessionId: 'test-session',
    cwd: '/Users/test/project/test-repo',
    costUSD: 0.05, // This one has costUSD
    message: JSON.stringify({
      role: 'assistant',
      model: 'claude-opus-4-20250514',
      content: 'Test response 1',
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 0
      }
    })
  },
  {
    uuid: 'msg-3',
    type: 'assistant',
    timestamp: new Date(Date.now() + 2000).toISOString(),
    sessionId: 'test-session',
    cwd: '/Users/test/project/test-repo',
    costUSD: null, // This one has null costUSD
    message: JSON.stringify({
      role: 'assistant',
      model: 'claude-opus-4-20250514',
      content: 'Test response 2',
      usage: {
        input_tokens: 200,
        output_tokens: 300,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50
      }
    })
  },
  {
    uuid: 'msg-4',
    type: 'assistant',
    timestamp: new Date(Date.now() + 3000).toISOString(),
    sessionId: 'test-session',
    cwd: '/Users/test/project/test-repo',
    // No costUSD field at all
    message: JSON.stringify({
      role: 'assistant', 
      model: 'claude-opus-4-20250514',
      content: 'Test response 3',
      usage: {
        input_tokens: 150,
        output_tokens: 250,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20
      }
    })
  }
];

// Listen for session completion
detector.on('session-completed', (data) => {
  console.log('\n✅ Session Completed:');
  console.log(`   Session ID: ${data.sessionId}`);
  console.log(`   Project: ${data.projectName}`);
  console.log(`   Total Cost: $${data.totalCost.toFixed(4)}`);
  console.log(`   Messages: ${data.messageCount}`);
  console.log(`   Summary: ${data.summary}`);
  console.log(`   Duration: ${Math.round(data.duration / 1000)}s`);
});

// Process test messages
console.log('Processing test messages...\n');

// Calculate expected cost manually for comparison
const calculator = new CostCalculator();
await calculator.ensureRatesLoaded();

testMessages.forEach((msg, index) => {
  console.log(`Processing message ${index + 1}: ${msg.type}`);
  if (msg.type === 'assistant') {
    const hasExplicitCost = msg.costUSD !== null && msg.costUSD !== undefined;
    console.log(`  Has explicit cost: ${hasExplicitCost} (${msg.costUSD})`);
    
    if (!hasExplicitCost && msg.message) {
      try {
        const content = JSON.parse(msg.message);
        if (content.usage) {
          const calculatedCost = calculator.calculate(content.usage);
          console.log(`  Calculated cost from tokens: $${calculatedCost.toFixed(4)}`);
        }
      } catch (e) {
        console.log('  Failed to parse message content');
      }
    }
  }
  
  detector.processMessage(msg);
});

// Wait a bit then manually complete the session to see results
setTimeout(() => {
  console.log('\nManually completing session...');
  detector.completeAllSessions();
}, 1000);

// Keep process alive for a bit
setTimeout(() => {
  process.exit(0);
}, 2000);