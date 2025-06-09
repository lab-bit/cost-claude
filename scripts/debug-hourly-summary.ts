#!/usr/bin/env tsx

// Simple script to debug the hourly summary issue

console.log('Monitoring hourly summary behavior...\n');

let messageCount = 0;
let lastHourlyTime = Date.now();

// Simulate hourly summary
setInterval(() => {
  console.log('\n📊 Hourly Summary:');
  console.log(`  Total messages seen: ${messageCount}`);
  console.log(`  Time since last: ${Math.round((Date.now() - lastHourlyTime) / 1000)}s`);
  console.log('');
  lastHourlyTime = Date.now();
}, 5000); // Every 5 seconds for testing

// Simulate incoming messages
setInterval(() => {
  messageCount++;
  const now = new Date();
  console.log(`[${now.toLocaleTimeString()}] New message ${messageCount}`);
}, 1000);

// Keep running
process.stdin.resume();