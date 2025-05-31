#!/usr/bin/env node
import { NotificationService } from '../src/services/notification.js';
import chalk from 'chalk';

console.log(chalk.bold.blue('Testing Mac Notification System'));
console.log(chalk.gray('This script tests different notification configurations for macOS\n'));

const notificationService = new NotificationService({
  soundEnabled: true,
  // customSound: 'Glass', // You can try different sounds: Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink
});

async function testNotifications() {
  console.log('1. Testing basic notification...');
  
  try {
    await notificationService.sendCustom(
      'Test Notification',
      'This is a basic test notification. If you see this, the notification system is working!',
      {
        sound: true
      }
    );
    console.log(chalk.green('   ✓ Basic notification sent'));
  } catch (error) {
    console.log(chalk.red('   ✗ Basic notification failed:'), error);
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('\n2. Testing task completion style notification...');
  
  try {
    await notificationService.sendCustom(
      '💬 claude-code-cost-checker - Task Complete',
      '⏱️ 5s • 💬 2 responses\n💰 $0.0299',
      {
        sound: true
      }
    );
    console.log(chalk.green('   ✓ Task completion notification sent'));
  } catch (error) {
    console.log(chalk.red('   ✗ Task completion notification failed:'), error);
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('\n3. Testing session completion style notification...');
  
  try {
    await notificationService.sendCustom(
      '✅ claude-code-cost-checker - Session Complete',
      '📝 Code improvements completed\n⏱️ 12 min • 💬 8 messages\n💰 Total: $0.1245',
      {
        sound: true
      }
    );
    console.log(chalk.green('   ✓ Session completion notification sent'));
  } catch (error) {
    console.log(chalk.red('   ✗ Session completion notification failed:'), error);
  }
  
  console.log(chalk.bold.yellow('\n📋 Troubleshooting Tips:'));
  console.log(chalk.gray('If notifications are not appearing:'));
  console.log(chalk.gray('1. Check System Preferences > Notifications & Focus > Terminal'));
  console.log(chalk.gray('2. Ensure "Allow Notifications" is enabled'));
  console.log(chalk.gray('3. Set notification style to "Alerts" or "Banners"'));
  console.log(chalk.gray('4. Turn off "Do Not Disturb" / Focus modes'));
  console.log(chalk.gray('5. Try running: sudo killall NotificationCenter'));
  
  console.log(chalk.bold.cyan('\n🔧 Quick Fix Commands:'));
  console.log(chalk.dim('# Reset notification system:'));
  console.log(chalk.white('sudo killall NotificationCenter'));
  console.log(chalk.dim('# Check notification permissions:'));
  console.log(chalk.white('sqlite3 ~/Library/Application\\ Support/com.apple.TCC/TCC.db "SELECT * FROM access WHERE service=\'kTCCServiceNotifications\';"'));
  
  console.log(chalk.bold.green('\n✅ Test completed. Check if any notifications appeared on your screen.'));
}

testNotifications().catch(error => {
  console.error(chalk.red('Test failed:'), error);
  process.exit(1);
});