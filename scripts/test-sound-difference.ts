#!/usr/bin/env tsx

import { NotificationService } from '../src/services/notification.js';

async function testSounds() {
  console.log('Testing different sounds for task and session completion...\n');
  
  // Test with specific sounds
  const service = new NotificationService({
    soundEnabled: true,
    taskCompleteSound: 'Pop',
    sessionCompleteSound: 'Glass'
  });
  
  console.log('1. Task completion with Pop sound...');
  await service.sendCustom(
    '🎯 Task Complete',
    'This should play a Pop sound',
    { soundType: 'task' }
  );
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('2. Session completion with Glass sound...');
  await service.sendCustom(
    '✅ Session Complete', 
    'This should play a Glass sound',
    { soundType: 'session' }
  );
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Test with custom sounds
  const service2 = new NotificationService({
    soundEnabled: true,
    taskCompleteSound: 'Tink',
    sessionCompleteSound: 'Hero'
  });
  
  console.log('\n3. Task completion with Tink sound...');
  await service2.sendCustom(
    '🎯 Task Complete (Tink)',
    'This should play a Tink sound',
    { soundType: 'task' }
  );
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('4. Session completion with Hero sound...');
  await service2.sendCustom(
    '✅ Session Complete (Hero)',
    'This should play a Hero sound', 
    { soundType: 'session' }
  );
  
  console.log('\nDone! Did you hear different sounds?');
}

testSounds().catch(console.error);