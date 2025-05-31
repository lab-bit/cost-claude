#!/usr/bin/env node
import { NotificationService } from '../src/services/notification.js';

async function testNotification() {
  const notificationService = new NotificationService({
    soundEnabled: true,
  });

  console.log('Testing notifications...\n');
  
  // Test 1: Cost update notification
  console.log('1. Sending cost update notification...');
  await notificationService.notifyCostUpdate({
    sessionId: 'test-session',
    messageId: 'test-message',
    cost: 0.1304,
    duration: 5300,
    tokens: {
      input: 89,
      output: 22,
      cacheHit: 50,
    },
    sessionTotal: 0.2508,
    dailyTotal: 1.486,
    projectName: 'lab-bit/claude-code-cost-checker',
  });
  console.log('   ✓ Cost update notification sent!');
  
  // Wait a bit between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 2: Session completion notification
  console.log('\n2. Sending session completion notification...');
  const message = [
    '📝 Task completed successfully',
    '⏱️ 45 min • 💬 23 messages',
    '💰 Total: $0.2508'
  ].join('\n');
  
  await notificationService.sendCustom(
    '✅ claude-code-cost-checker - Task Complete',
    message,
    {
      sound: true
    }
  );
  console.log('   ✓ Session completion notification sent!');
  
  // Test 3: Error notification
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('\n3. Sending error notification...');
  await notificationService.sendError('This is a test error message');
  console.log('   ✓ Error notification sent!');
  
  // Test 4: Warning notification
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('\n4. Sending warning notification...');
  await notificationService.sendWarning('This is a test warning message');
  console.log('   ✓ Warning notification sent!');
  
  // Test 5: Success notification
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('\n5. Sending success notification...');
  await notificationService.sendSuccess('This is a test success message');
  console.log('   ✓ Success notification sent!');
  
  console.log('\n✅ All notifications sent! Check your system notifications.');
  console.log('ℹ️  Note: Notifications should remain visible until you dismiss them manually.');
  console.log('📝 If notifications still disappear, check your system notification settings.');
  
  // Keep process alive for a while to ensure notifications are displayed
  console.log('\nKeeping process alive for 10 seconds...');
  setTimeout(() => {
    console.log('Done!');
    process.exit(0);
  }, 10000);
}

testNotification().catch(console.error);