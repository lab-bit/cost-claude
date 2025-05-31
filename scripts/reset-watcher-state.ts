#!/usr/bin/env node
import { homedir } from 'os';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

console.log(chalk.bold.blue('🔧 Claude Code Cost Watcher - State Management\n'));

const stateFile = join(homedir(), '.cost-claude', 'watcher-state.json');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'show';

  switch (command) {
    case 'show':
      showState();
      break;
    case 'reset':
      resetState();
      break;
    case 'clear':
      clearSpecificFile(args[1]);
      break;
    case 'help':
    default:
      showHelp();
  }
}

function showHelp() {
  console.log(chalk.yellow('Usage:'));
  console.log('  reset-watcher-state show        Show current state');
  console.log('  reset-watcher-state reset       Reset all file positions');
  console.log('  reset-watcher-state clear <file> Clear position for specific file');
  console.log('  reset-watcher-state help        Show this help');
}

function showState() {
  if (!existsSync(stateFile)) {
    console.log(chalk.yellow('No state file found'));
    return;
  }

  try {
    const content = readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(content);
    const filePositions = new Map(state);

    console.log(chalk.bold(`State file: ${stateFile}`));
    console.log(chalk.gray(`Total files tracked: ${filePositions.size}\n`));

    if (filePositions.size > 0) {
      console.log(chalk.yellow('File positions:'));
      for (const [file, position] of filePositions) {
        const shortFile = file.replace(homedir(), '~');
        console.log(`  ${shortFile}`);
        console.log(chalk.gray(`    Position: ${position} bytes`));
        
        // Check if file exists and show its actual size
        if (existsSync(file)) {
          const stats = require('fs').statSync(file);
          const percentage = (position / stats.size * 100).toFixed(1);
          console.log(chalk.gray(`    File size: ${stats.size} bytes (${percentage}% read)`));
          
          if (position > stats.size) {
            console.log(chalk.red(`    ⚠️  Position exceeds file size!`));
          }
        } else {
          console.log(chalk.red(`    ⚠️  File no longer exists`));
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('Error reading state file:'), error);
  }
}

function resetState() {
  const spinner = ora('Resetting watcher state...').start();
  
  if (!existsSync(stateFile)) {
    spinner.info('No state file to reset');
    return;
  }

  try {
    // Backup current state
    const backupFile = stateFile + '.backup';
    const content = readFileSync(stateFile, 'utf-8');
    writeFileSync(backupFile, content);
    
    // Reset state
    unlinkSync(stateFile);
    spinner.succeed('Watcher state reset successfully');
    console.log(chalk.gray(`Backup saved to: ${backupFile}`));
    console.log(chalk.green('\nThe watcher will now process all files from the beginning'));
  } catch (error) {
    spinner.fail('Failed to reset state');
    console.error(chalk.red('Error:'), error);
  }
}

function clearSpecificFile(filePath?: string) {
  if (!filePath) {
    console.error(chalk.red('Please provide a file path'));
    showHelp();
    return;
  }

  if (!existsSync(stateFile)) {
    console.log(chalk.yellow('No state file found'));
    return;
  }

  const spinner = ora(`Clearing position for ${filePath}...`).start();

  try {
    const content = readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(content);
    const filePositions = new Map(state);
    
    // Expand ~ in the provided path
    const expandedPath = filePath.replace('~', homedir());
    
    let found = false;
    for (const [file, _] of filePositions) {
      if (file === expandedPath || file.endsWith(filePath)) {
        filePositions.delete(file);
        found = true;
        break;
      }
    }

    if (found) {
      writeFileSync(stateFile, JSON.stringify([...filePositions]));
      spinner.succeed(`Cleared position for ${filePath}`);
      console.log(chalk.green('The file will be processed from the beginning on next watch'));
    } else {
      spinner.fail('File not found in state');
      console.log(chalk.gray('Available files:'));
      for (const [file, _] of filePositions) {
        console.log(chalk.gray(`  ${file.replace(homedir(), '~')}`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to clear file position');
    console.error(chalk.red('Error:'), error);
  }
}

main().catch(error => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});