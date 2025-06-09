#!/usr/bin/env tsx

import { NotificationService } from '../src/services/notification.js';

console.log('Testing notification sounds on macOS...\n');

const sounds = [
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 
  'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 
  'Submarine', 'Tink'
];

async function testSound(soundName: string, type: string) {
  console.log(`Testing ${type} with sound: ${soundName}`);
  
  const service = new NotificationService({
    soundEnabled: true,
    taskCompleteSound: type === 'task' ? soundName : undefined,
    sessionCompleteSound: type === 'session' ? soundName : undefined,
  });
  
  await service.sendCustom(
    `Test ${type} - ${soundName}`,
    'This is a test notification',
    {
      soundType: type as 'task' | 'session'
    }
  );
  
  // Wait a bit between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function testDefaultSounds() {
  console.log('\n=== Testing Default Sounds ===\n');
  
  const service = new NotificationService({ soundEnabled: true });
  
  // Test task completion (default: Pop)
  console.log('Task completion with default sound (Pop)');
  await service.sendCustom(
    '🎯 Task Complete',
    'Default task sound',
    { soundType: 'task' }
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test session completion (default: Glass)
  console.log('Session completion with default sound (Glass)');
  await service.sendCustom(
    '✅ Session Complete',
    'Default session sound',
    { soundType: 'session' }
  );
}

async function main() {
  // First test the defaults
  await testDefaultSounds();
  
  console.log('\n=== Available Sounds ===');
  console.log('You can use these with --task-sound and --session-sound options:\n');
  
  // Show all available sounds
  for (const sound of sounds) {
    console.log(`  ${sound}`);
  }
  
  console.log('\n=== Recommended Combinations ===');
  console.log('Task completion: Pop (quick), Ping (subtle), Tink (gentle)');
  console.log('Session completion: Glass (satisfying), Hero (triumphant), Submarine (deep)');
  
  console.log('\n=== Example Usage ===');
  console.log('npm run dev -- watch --sound --task-sound Pop --session-sound Glass');
  console.log('npm run dev -- watch --sound --task-sound Tink --session-sound Hero');
  
  // Optional: Test specific sounds
  const testSpecific = process.argv[2] === '--test-all';
  if (testSpecific) {
    console.log('\n=== Testing All Sounds ===\n');
    for (const sound of ['Pop', 'Glass', 'Ping', 'Tink', 'Hero']) {
      await testSound(sound, 'task');
    }
  }
}

main().catch(console.error);