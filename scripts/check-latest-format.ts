#!/usr/bin/env tsx

import { homedir } from 'os';
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import chalk from 'chalk';

async function checkLatestFormat() {
  console.log(chalk.bold.blue('Checking Latest Message Format'));
  console.log(chalk.gray('Finding the most recent messages...\n'));

  const basePath = `${homedir()}/.claude/projects`;
  const pattern = `${basePath}/**/*.jsonl`;
  
  const files = await glob(pattern);
  if (files.length === 0) {
    console.log(chalk.yellow('No JSONL files found!'));
    return;
  }

  // Get the most recent file based on modification time
  const { statSync } = await import('fs');
  const filesWithTime = files.map(file => ({
    file,
    mtime: statSync(file).mtime.getTime()
  }));
  
  filesWithTime.sort((a, b) => b.mtime - a.mtime);
  const recentFile = filesWithTime[0].file;
  
  console.log(chalk.cyan(`Most recent file: ${recentFile.split('/').pop()}`));
  console.log(chalk.gray(`Modified: ${new Date(filesWithTime[0].mtime).toLocaleString()}\n`));
  
  const content = await readFile(recentFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  // Get the last few messages
  const lastMessages = lines.slice(-5);
  
  console.log(chalk.bold('Last 5 messages in the file:\n'));
  
  for (let i = 0; i < lastMessages.length; i++) {
    try {
      const message = JSON.parse(lastMessages[i]);
      console.log(chalk.yellow(`Message ${i + 1}:`));
      console.log(chalk.gray('  Type:'), message.type);
      console.log(chalk.gray('  Timestamp:'), message.timestamp);
      console.log(chalk.gray('  UUID:'), message.uuid);
      console.log(chalk.gray('  Duration Ms:'), message.durationMs);
      console.log(chalk.gray('  Cost USD:'), message.costUSD);
      
      // Check message structure
      if (message.message) {
        console.log(chalk.gray('  Message type:'), typeof message.message);
        
        let messageContent;
        if (typeof message.message === 'string') {
          try {
            messageContent = JSON.parse(message.message);
          } catch {
            console.log(chalk.gray('  Message (string):'), message.message.substring(0, 100) + '...');
          }
        } else {
          messageContent = message.message;
        }
        
        if (messageContent) {
          console.log(chalk.gray('  Message.role:'), messageContent.role);
          console.log(chalk.gray('  Message.model:'), messageContent.model);
          console.log(chalk.gray('  Message.ttftMs:'), messageContent.ttftMs);
          if (messageContent.usage) {
            console.log(chalk.gray('  Message.usage:'), JSON.stringify(messageContent.usage));
          }
        }
      }
      
      // Show all fields
      console.log(chalk.dim('  All fields:'), Object.keys(message).join(', '));
      console.log();
    } catch (error) {
      console.error(chalk.red(`Error parsing message ${i + 1}:`), error);
    }
  }
  
  // Check a specific assistant message structure
  console.log(chalk.bold.cyan('\nFull Assistant Message Example:'));
  for (const line of lines.reverse()) {
    try {
      const message = JSON.parse(line);
      if (message.type === 'assistant') {
        console.log(JSON.stringify(message, null, 2));
        break;
      }
    } catch {
      // Skip
    }
  }
}

checkLatestFormat().catch(console.error);