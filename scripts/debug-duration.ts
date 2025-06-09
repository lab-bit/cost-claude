#!/usr/bin/env tsx

import { homedir } from 'os';
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import chalk from 'chalk';

async function debugDuration() {
  console.log(chalk.bold.blue('Duration Debug Script'));
  console.log(chalk.gray('Checking for duration issues in JSONL files...\n'));

  const basePath = `${homedir()}/.claude/projects`;
  const pattern = `${basePath}/**/*.jsonl`;
  
  console.log(chalk.gray(`Searching in: ${basePath}`));
  
  const files = await glob(pattern);
  console.log(chalk.gray(`Found ${files.length} JSONL files\n`));

  if (files.length === 0) {
    console.log(chalk.yellow('No JSONL files found!'));
    return;
  }

  // Get the most recent files
  const sortedFiles = files.sort((a, b) => b.localeCompare(a));
  const recentFiles = sortedFiles.slice(0, 10); // Check top 10 files
  
  console.log(chalk.cyan(`Checking ${recentFiles.length} recent files...`));
  
  // Analyze assistant messages across multiple files
  let totalMessages = 0;
  let assistantCount = 0;
  let withDurationMs = 0;
  let withTtftMs = 0;
  let zeroDuration = 0;
  let nullDuration = 0;
  let exampleMessages: any[] = [];

  for (const file of recentFiles) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    totalMessages += lines.length;
    
    for (const line of lines) {
    try {
      const message = JSON.parse(line);
      
      if (message.type === 'assistant') {
        assistantCount++;
        
        // Check durationMs
        if (message.durationMs !== undefined && message.durationMs !== null) {
          withDurationMs++;
          if (message.durationMs === 0) {
            zeroDuration++;
          }
        } else if (message.durationMs === null) {
          nullDuration++;
        }
        
        // Check ttftMs in message content
        if (message.message) {
          let messageContent;
          if (typeof message.message === 'string') {
            try {
              messageContent = JSON.parse(message.message);
            } catch {
              // Skip if not valid JSON
            }
          } else {
            messageContent = message.message;
          }
          
          if (messageContent?.ttftMs) {
            withTtftMs++;
          }
        }
        
        // Save sample of recent assistant message
        if (exampleMessages.length < 3) {
          exampleMessages.push({
            file: file.split('/').pop(),
            timestamp: message.timestamp,
            durationMs: message.durationMs,
            costUSD: message.costUSD,
            message: message.message
          });
        }
      }
    } catch (error) {
      // Skip parse errors
    }
    }
  }

  console.log(chalk.bold.green('\n📊 Summary:'));
  console.log(chalk.gray(`  Total messages checked: ${totalMessages}`));
  console.log(chalk.gray(`  Total assistant messages: ${assistantCount}`));
  console.log(chalk.gray(`  With durationMs field: ${withDurationMs}`));
  console.log(chalk.gray(`  With durationMs = 0: ${zeroDuration}`));
  console.log(chalk.gray(`  With durationMs = null: ${nullDuration}`));
  console.log(chalk.gray(`  With ttftMs in content: ${withTtftMs}`));
  
  if (zeroDuration > 0 || nullDuration > 0) {
    console.log(chalk.yellow(`\n⚠️  Found ${zeroDuration + nullDuration} messages with missing/zero duration!`));
  }

  // Show example messages
  if (exampleMessages.length > 0) {
    console.log(chalk.bold.cyan('\n📝 Example Assistant Messages:'));
    for (let i = 0; i < exampleMessages.length; i++) {
      const example = exampleMessages[i];
      console.log(chalk.bold(`\nExample #${i + 1} (${example.file}):`));
      console.log(chalk.gray(`  Timestamp: ${example.timestamp}`));
      console.log(chalk.gray(`  Duration Ms: ${example.durationMs}`));
      console.log(chalk.gray(`  Cost USD: ${example.costUSD}`));
      
      // Try to extract ttftMs
      if (example.message) {
        let messageContent;
        if (typeof example.message === 'string') {
          try {
            messageContent = JSON.parse(example.message);
          } catch {
            messageContent = null;
          }
        } else {
          messageContent = example.message;
        }
        
        if (messageContent) {
          console.log(chalk.gray(`  ttftMs: ${messageContent.ttftMs || 'not found'}`));
          console.log(chalk.gray(`  Model: ${messageContent.model || 'not found'}`));
          
          if (messageContent.usage) {
            console.log(chalk.gray(`  Tokens: ${JSON.stringify(messageContent.usage)}`));
          }
        }
      }
    }
  }
}

debugDuration().catch(console.error);