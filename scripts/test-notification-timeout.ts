#!/usr/bin/env tsx

import { NotificationService } from '../src/services/notification.js';

async function testTimeouts() {
  console.log('Testing notification timeouts...\n');
  
  const service = new NotificationService({
    soundEnabled: true,
    taskCompleteSound: 'Pop',
    sessionCompleteSound: 'Glass'
  });
  
  // Send task notification with 20 second timeout
  console.log('1. Sending TASK notification (will disappear in 20 seconds)...');
  await service.sendCustom(
    '🎯 Task Complete - 20s timeout',
    'This notification will disappear in 20 seconds',
    {
      soundType: 'task',
      timeout: 20
    }
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Send session notification without timeout (stays visible)
  console.log('2. Sending SESSION notification (will stay visible)...');
  await service.sendCustom(
    '✅ Session Complete - No timeout',
    'This notification will stay visible until dismissed',
    {
      soundType: 'session'
      // No timeout specified - uses default (24 hours)
    }
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Send progress notification with 10 second timeout
  console.log('3. Sending PROGRESS notification (will disappear in 10 seconds)...');
  await service.sendCustom(
    '⏳ Task in Progress - 10s timeout',
    'This notification will disappear in 10 seconds',
    {
      sound: false,
      timeout: 10
    }
  );
  
  console.log('\nNotifications sent!');
  console.log('- Task notification: disappears in 20 seconds');
  console.log('- Session notification: stays visible');
  console.log('- Progress notification: disappears in 10 seconds');
  console.log('\nWatch the notifications to see the timeouts in action.');
}

testTimeouts().catch(console.error);