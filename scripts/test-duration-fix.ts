#!/usr/bin/env tsx

import { homedir } from 'os';
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import chalk from 'chalk';
import { JSONLParser } from '../src/core/jsonl-parser.js';
import { CostCalculator } from '../src/core/cost-calculator.js';
import { formatDuration, formatCostColored, formatNumber } from '../src/utils/format.js';

function getMessageCost(message: any, parser: JSONLParser, calculator: CostCalculator): number {
  // First try to use the pre-calculated costUSD if available and not null
  if (message.costUSD !== null && message.costUSD !== undefined) {
    return message.costUSD;
  }
  
  // Fallback: calculate cost from token usage
  const content = parser.parseMessageContent(message);
  if (content?.usage) {
    return calculator.calculate(content.usage);
  }
  
  return 0;
}

async function testDurationFix() {
  console.log(chalk.bold.blue('Testing Duration Fix'));
  console.log(chalk.gray('Verifying duration calculation with new format...\n'));

  const basePath = `${homedir()}/.claude/projects`;
  const pattern = `${basePath}/**/*.jsonl`;
  
  const files = await glob(pattern);
  if (files.length === 0) {
    console.log(chalk.yellow('No JSONL files found!'));
    return;
  }

  // Get the most recent file
  const { statSync } = await import('fs');
  const filesWithTime = files.map(file => ({
    file,
    mtime: statSync(file).mtime.getTime()
  }));
  
  filesWithTime.sort((a, b) => b.mtime - a.mtime);
  const recentFile = filesWithTime[0].file;
  
  console.log(chalk.cyan(`Testing with: ${recentFile.split('/').pop()}`));
  
  const content = await readFile(recentFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  const parser = new JSONLParser();
  const calculator = new CostCalculator(undefined, 'claude-opus-4-20250514');
  await calculator.ensureRatesLoaded();
  
  console.log(chalk.bold('\nProcessing recent assistant messages:\n'));
  
  let processedCount = 0;
  
  for (const line of lines.reverse()) {
    try {
      const message = JSON.parse(line);
      
      if (message.type === 'assistant' && processedCount < 5) {
        processedCount++;
        
        const messageCost = getMessageCost(message, parser, calculator);
        if (messageCost === 0) continue; // Skip messages with no cost
        
        // Parse message content for token info
        const content = parser.parseMessageContent(message);
        const tokens = content?.usage || {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        };

        const cacheEfficiency = calculator.calculateCacheEfficiency(tokens);

        // Apply the same duration logic as in watch.ts
        let duration = message.durationMs || 0;
        let durationEstimated = false;
        
        if (!duration && content?.ttftMs) {
          // Estimate total duration: ttftMs + time to generate output tokens
          const outputTime = (tokens.output_tokens || 0) * 10; // 10ms per token
          duration = content.ttftMs + outputTime;
          durationEstimated = true;
        } else if (!duration && tokens.output_tokens > 0) {
          // New format doesn't have ttftMs, estimate based on token count
          duration = Math.max(1000, tokens.output_tokens * 20); // 20ms per token, minimum 1s
          durationEstimated = true;
        }
        
        // Format duration display with estimation indicator
        const durationDisplay = durationEstimated 
          ? `${formatDuration(duration)}~` 
          : formatDuration(duration);
        
        const msgDateTime = new Date(message.timestamp);
        const timeStr = msgDateTime.toLocaleTimeString();
        
        console.log(
          `[${chalk.gray(timeStr)}] ` +
          `Cost: ${formatCostColored(messageCost)} | ` +
          `Duration: ${chalk.cyan(durationDisplay)} | ` +
          `Tokens: ${chalk.gray(formatNumber(tokens.input_tokens + tokens.output_tokens))} | ` +
          `Cache: ${chalk.green(cacheEfficiency.toFixed(0) + '%')}`
        );
        
        // Show debug info
        console.log(chalk.dim(
          `  Debug: durationMs=${message.durationMs}, ttftMs=${content?.ttftMs}, ` +
          `estimated=${durationEstimated}, outputTokens=${tokens.output_tokens}`
        ));
        console.log();
      }
    } catch (error) {
      // Skip parse errors
    }
  }
  
  if (processedCount === 0) {
    console.log(chalk.yellow('No assistant messages with costs found!'));
  } else {
    console.log(chalk.green(`✓ Successfully processed ${processedCount} messages`));
    console.log(chalk.gray('Duration values are now estimated based on token count when not available.'));
    console.log(chalk.gray('Estimated durations are marked with "~" suffix.'));
  }
}

testDurationFix().catch(console.error);