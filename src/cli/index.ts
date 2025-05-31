#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { analyzeCommand } from './commands/analyze.js';
import { watchCommand } from './commands/watch.js';
import { statsCommand } from './commands/stats.js';
import { predictCommand } from './commands/predict.js';
import { insightsCommand } from './commands/insights.js';
import { syncCommand } from './commands/sync.js';
import { dashboardCommand } from './commands/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('cost-claude')
  .description('Real-time cost monitoring and analytics for Claude Code usage')
  .version(packageJson.version)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--log-level <level>', 'Set log level (error, warn, info, debug)', 'info')
  .option('-m, --model <model>', 'Claude model ID (default: claude-opus-4-20250514)')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.verbose) {
      logger.level = 'debug';
    } else if (options.logLevel) {
      logger.level = options.logLevel;
    }
  });

// Analyze command
program
  .command('analyze')
  .description('Analyze Claude usage and costs from JSONL files')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('-f, --from <date>', 'Start date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'End date (YYYY-MM-DD)')
  .option('-s, --session <id>', 'Analyze specific session')
  .option('--format <type>', 'Output format (table, json, csv, html)', 'table')
  .option('--export <file>', 'Export results to file')
  .option('-g, --group-by <type>', 'Group results by (session, project, date, hour)', 'session')
  .option('--show-all', 'Show all grouping types', false)
  .option('-d, --detailed', 'Show detailed cost breakdown in tables', false)
  .option('--top <n>', 'Number of top results to show (default: 5, hour: 10)', '5')
  .option('--live', 'Show all messages as they would appear in watch mode', false)
  .action(analyzeCommand);

// Watch command
program
  .command('watch')
  .description('Watch Claude files for real-time cost notifications')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('-n, --notify', 'Enable desktop notifications', true)
  .option('--min-cost <amount>', 'Minimum cost to trigger notification', '0.01')
  .option('--sound', 'Enable notification sound', true)
  .option('--notify-task', 'Enable task completion notifications (when Claude finishes responding)', true)
  .option('--notify-session', 'Enable session completion notifications (when session ends)', true)
  .option('--notify-cost', 'Enable cost update notifications (for each message)', false)
  .option('--include-existing', 'Process all existing messages on startup', false)
  .option('--recent <n>', 'Show only the N most recent messages on startup', '5')
  .option('--test', 'Enable test mode with sample data generation', false)
  .option('--verbose', 'Enable verbose logging for debugging', false)
  .action(watchCommand);

// Stats command
program
  .command('stats')
  .description('Show detailed statistics and analytics')
  .option('-p, --period <period>', 'Time period (today, yesterday, week, month)', 'today')
  .option('-g, --group-by <type>', 'Group by (session, hour, day)', 'session')
  .option('--top <n>', 'Show top N results', '10')
  .option('--format <type>', 'Output format (table, json, chart)', 'table')
  .action(statsCommand);

// Config command
program
  .command('config')
  .description('Manage configuration settings')
  .argument('[action]', 'Action to perform (show, set, reset)')
  .argument('[key]', 'Configuration key')
  .argument('[value]', 'Configuration value')
  .action(() => {
    console.log(chalk.yellow('Config command not yet implemented'));
  });

// Pricing command
program
  .command('pricing')
  .description('Manage pricing data and view model costs')
  .option('-l, --list', 'List all available models and their pricing')
  .option('-r, --refresh', 'Force refresh pricing data from remote sources')
  .option('-c, --clear-cache', 'Clear local pricing cache')
  .option('-a, --add <json>', 'Add custom model pricing (JSON format)')
  .action(async (options) => {
    const { PricingService } = await import('../services/pricing-service.js');
    const pricingService = PricingService.getInstance();

    try {
      if (options.refresh) {
        console.log(chalk.blue('Refreshing pricing data...'));
        await pricingService.refreshPricing();
        console.log(chalk.green('Pricing data refreshed successfully'));
      }

      if (options.clearCache) {
        pricingService.clearCache();
        console.log(chalk.green('Pricing cache cleared'));
      }

      if (options.add) {
        try {
          const customPricing = JSON.parse(options.add);
          await pricingService.addCustomPricing(customPricing);
          console.log(chalk.green('Custom pricing added successfully'));
        } catch (error) {
          console.error(chalk.red('Invalid JSON format for custom pricing'));
        }
      }

      if (options.list || (!options.refresh && !options.clearCache && !options.add)) {
        const models = await pricingService.getAllModels();
        console.log(chalk.bold('\nAvailable Models and Pricing:'));
        console.log(chalk.dim('(All prices per million tokens)\n'));

        for (const model of models) {
          console.log(chalk.cyan(`${model.modelName} (${model.modelId}):`));
          console.log(`  Input: $${model.input.toFixed(2)}`);
          console.log(`  Output: $${model.output.toFixed(2)}`);
          if (model.cacheCreation) {
            console.log(`  Cache Creation: $${model.cacheCreation.toFixed(2)}`);
          }
          if (model.cacheRead) {
            console.log(`  Cache Read: $${model.cacheRead.toFixed(2)}`);
          }
          console.log(`  Source: ${model.source}`);
          console.log(`  Last Updated: ${new Date(model.lastUpdated).toLocaleDateString()}\n`);
        }
      }
    } catch (error: any) {
      console.error(chalk.red('Error managing pricing:'), error.message);
      process.exit(1);
    }
  });


// Predict command
program
  .command('predict')
  .description('Predict future costs based on usage patterns')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('-d, --days <days>', 'Days of historical data to analyze', '30')
  .option('--format <type>', 'Output format (text, json)', 'text')
  .option('--detailed', 'Show detailed usage patterns')
  .action(predictCommand);

// Insights command
program
  .command('insights')
  .description('Get AI-powered insights about your usage patterns')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('-d, --days <days>', 'Days of data to analyze', '30')
  .option('--format <type>', 'Output format (text, json)', 'text')
  .option('--export <file>', 'Export insights to file')
  .action(insightsCommand);

// Sync command
program
  .command('sync')
  .description('Sync usage data across multiple machines')
  .option('--export', 'Export data for sync')
  .option('--import <files...>', 'Import and merge sync files')
  .option('--compare <path>', 'Compare with remote data')
  .option('--list', 'List available sync files')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('-o, --output <file>', 'Output file for export')
  .option('--strategy <type>', 'Merge strategy (newest, oldest, cost, manual)', 'newest')
  .option('--dry-run', 'Preview changes without applying')
  .option('--no-backup', 'Skip backup when importing')
  .action(syncCommand);

// Dashboard command
program
  .command('dashboard')
  .description('Launch web dashboard for visualizing usage')
  .option('-p, --path <path>', 'Path to Claude projects directory', '~/.claude/projects')
  .option('--port <port>', 'Server port', '3000')
  .option('--no-open', 'Don\'t open browser automatically')
  .action(dashboardCommand);

// Error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error: any) {
  if (error.code === 'commander.unknownCommand') {
    console.error(chalk.red(`Unknown command: ${error.message}`));
    program.outputHelp();
  } else if (error.code === 'commander.help' || error.code === 'commander.helpDisplayed') {
    // Help was displayed, exit gracefully
    process.exit(0);
  } else {
    logger.error('Command failed:', error);
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

// Show help if no command provided
if (process.argv.length === 2) {
  program.outputHelp();
}