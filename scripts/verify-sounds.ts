#!/usr/bin/env tsx

import { NotificationService } from '../src/services/notification.js';

// Test that getSound method is working correctly
const service = new NotificationService({
  soundEnabled: true,
  taskCompleteSound: 'Tink',
  sessionCompleteSound: 'Hero'
});

// Access private method via any type
const getSound = (service as any).getSound.bind(service);

console.log('Sound Configuration Test:');
console.log('========================');
console.log('Platform:', process.platform);
console.log('');
console.log('Task sound:', getSound('task'));
console.log('Session sound:', getSound('session'));
console.log('Default sound:', getSound('default'));
console.log('');

// Test actual notifications
async function sendTestNotifications() {
  console.log('Sending test notifications...');
  
  // Direct notification with specific sound
  await service.notify({
    title: 'Direct Glass Sound Test',
    message: 'This should play Glass sound',
    sound: 'Glass'
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Direct notification with specific sound
  await service.notify({
    title: 'Direct Pop Sound Test',
    message: 'This should play Pop sound',
    sound: 'Pop'
  });
  
  console.log('\nNotifications sent. Check if you heard different sounds.');
}

sendTestNotifications().catch(console.error);