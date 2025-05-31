#!/usr/bin/env node
import { homedir } from 'os';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import * as chokidar from 'chokidar';
import { glob } from 'glob';

async function debugWatcher() {
  console.log(chalk.bold.blue('🐛 Claude Code Cost Watcher - Debug Mode\n'));

  // Test different path scenarios
  const testPaths = [
  '~/.claude/projects',
  `${homedir()}/.claude/projects`,
  `${homedir()}/.cost-claude/test`,
];

console.log(chalk.yellow('1. Checking directory existence:'));
for (const path of testPaths) {
  const expandedPath = path.replace('~', homedir());
  const exists = existsSync(expandedPath);
  console.log(`  ${exists ? '✓' : '✗'} ${path} ${exists ? chalk.green('exists') : chalk.red('not found')}`);
  
  if (exists) {
    try {
      const files = readdirSync(expandedPath);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      console.log(chalk.gray(`     Contains ${files.length} files (${jsonlFiles.length} JSONL files)`));
    } catch (error) {
      console.log(chalk.red(`     Error reading directory: ${error}`));
    }
  }
}

console.log(chalk.yellow('\n2. Testing glob patterns:'));
const patterns = [
  '~/.claude/projects/**/*.jsonl',
  `${homedir()}/.claude/projects/**/*.jsonl`,
  `${homedir()}/.cost-claude/test/**/*.jsonl`,
];

for (const pattern of patterns) {
  const expandedPattern = pattern.replace('~', homedir());
  try {
    const matches = await glob(expandedPattern);
    console.log(`  Pattern: ${pattern}`);
    console.log(chalk.gray(`  Matches: ${matches.length} files`));
    if (matches.length > 0) {
      console.log(chalk.dim(`  First 3: ${matches.slice(0, 3).join(', ')}`));
    }
  } catch (error) {
    console.log(chalk.red(`  Error: ${error}`));
  }
}

console.log(chalk.yellow('\n3. Testing chokidar watcher:'));
const testPattern = `${homedir()}/.claude/projects/**/*.jsonl`;
console.log(`  Watching: ${testPattern}`);

const watcher = chokidar.watch(testPattern, {
  persistent: true,
  ignoreInitial: false,
  usePolling: true,
  interval: 100,
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 100,
  },
});

let eventCount = 0;
const events: string[] = [];

watcher
  .on('add', path => {
    eventCount++;
    events.push(`ADD: ${path}`);
    console.log(chalk.green(`  + File added: ${path}`));
  })
  .on('change', path => {
    eventCount++;
    events.push(`CHANGE: ${path}`);
    console.log(chalk.blue(`  ~ File changed: ${path}`));
  })
  .on('error', error => {
    console.error(chalk.red(`  ! Error: ${error}`));
  })
  .on('ready', () => {
    console.log(chalk.green('  ✓ Watcher is ready'));
    
    const watched = watcher.getWatched();
    const totalDirs = Object.keys(watched).length;
    const totalFiles = Object.values(watched).flat().length;
    
    console.log(chalk.gray(`  Watching ${totalDirs} directories, ${totalFiles} files`));
    
    // Show some watched paths
    if (totalDirs > 0) {
      console.log(chalk.dim('\n  Sample watched paths:'));
      let count = 0;
      for (const [dir, files] of Object.entries(watched)) {
        if (count >= 3) break;
        console.log(chalk.dim(`    ${dir}/`));
        for (const file of files.slice(0, 2)) {
          if (file.endsWith('.jsonl')) {
            console.log(chalk.dim(`      - ${file}`));
          }
        }
        count++;
      }
    }
    
    console.log(chalk.yellow('\n4. Monitoring for 10 seconds...'));
    console.log(chalk.gray('  Try creating or modifying a .jsonl file in the watched directory'));
  });

// Monitor for 10 seconds then close
setTimeout(async () => {
  await watcher.close();
  
  console.log(chalk.yellow('\n5. Summary:'));
  console.log(`  Total events captured: ${eventCount}`);
  if (events.length > 0) {
    console.log(chalk.dim('  Events:'));
    events.slice(0, 10).forEach(e => console.log(chalk.dim(`    ${e}`)));
  }
  
  console.log(chalk.green('\n✓ Debug session complete'));
  process.exit(0);
}, 10000);

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nStopping debug session...'));
    await watcher.close();
    process.exit(0);
  });
}

// Run the debug script
debugWatcher().catch(error => {
  console.error(chalk.red('Debug script failed:'), error);
  process.exit(1);
});