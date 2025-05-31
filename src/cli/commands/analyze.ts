import { glob } from 'glob';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import ora from 'ora';
import { JSONLParser } from '../../core/jsonl-parser.js';
import { CostCalculator } from '../../core/cost-calculator.js';
import { GroupAnalyzer, GroupedStats } from '../../analytics/group-analyzer.js';
import { ClaudeMessage } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import {
  formatCostColored,
  formatDuration,
  formatNumber,
  formatPercentage,
  createSeparator,
} from '../../utils/format.js';
import { ExportService } from '../../services/export-service.js';
import { CostPredictor } from '../../services/cost-predictor.js';
import { UsageInsightsAnalyzer } from '../../services/usage-insights.js';

interface AnalyzeOptions {
  path: string;
  from?: string;
  to?: string;
  session?: string;
  format: 'table' | 'json' | 'csv' | 'html';
  export?: string;
  groupBy?: 'session' | 'project' | 'date' | 'hour';
  showAll?: boolean;
  detailed?: boolean;
  top?: string;
  live?: boolean;
  parent?: any; // To access global options like model
}

export async function analyzeCommand(options: AnalyzeOptions) {
  const spinner = ora('Analyzing Claude usage...').start();

  try {
    // Get model from parent command options
    const model = options.parent?.opts?.()?.model || 'claude-opus-4-20250514';
    
    // Expand home directory
    const basePath = options.path.replace('~', homedir());
    const pattern = join(basePath, '**/*.jsonl');

    logger.debug(`Searching for JSONL files in: ${pattern}`);
    logger.debug(`Using model: ${model}`);

    // Find all JSONL files
    const files = glob.sync(pattern);

    if (files.length === 0) {
      spinner.fail('No JSONL files found');
      console.log(chalk.yellow(`\nMake sure Claude files exist in: ${basePath}`));
      return;
    }

    spinner.text = `Found ${files.length} file(s), parsing...`;

    // Parse all files
    const parser = new JSONLParser();
    const calculator = new CostCalculator(undefined, model);
    await calculator.ensureRatesLoaded();
    let allMessages: ClaudeMessage[] = [];

    for (const file of files) {
      const messages = await parser.parseFile(file);
      allMessages = allMessages.concat(messages);
    }

    spinner.text = `Parsed ${allMessages.length} messages, analyzing...`;

    // Apply filters
    if (options.from) {
      const fromDate = new Date(options.from);
      allMessages = allMessages.filter((msg) => new Date(msg.timestamp) >= fromDate);
    }

    if (options.to) {
      const toDate = new Date(options.to);
      toDate.setHours(23, 59, 59, 999);
      allMessages = allMessages.filter((msg) => new Date(msg.timestamp) <= toDate);
    }

    if (options.session) {
      allMessages = allMessages.filter((msg) => msg.sessionId === options.session);
    }

    // Live mode - display messages as they would appear in watch mode
    if (options.live) {
      spinner.succeed(`Found ${allMessages.length} messages`);
      
      if (allMessages.length === 0) {
        console.log(chalk.yellow('No messages found matching the criteria'));
        return;
      }
      
      console.log(chalk.bold.blue('\n🔴 Live Playback Mode'));
      console.log(chalk.gray('Showing messages as they would appear in watch mode\n'));
      
      // Sort messages by timestamp
      const sortedMessages = allMessages.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      let sessionCosts = new Map<string, number>();
      let sessionMessages = new Map<string, number>();
      let dailyTotal = 0;
      let currentDay = '';
      
      for (const message of sortedMessages) {
        if (message.type !== 'assistant' || !message.costUSD) continue;
        
        const messageDate = new Date(message.timestamp).toDateString();
        if (messageDate !== currentDay) {
          if (currentDay) {
            console.log(chalk.dim(`\n📅 Day total: ${formatCostColored(dailyTotal)}\n`));
          }
          currentDay = messageDate;
          dailyTotal = 0;
          console.log(chalk.bold.yellow(`\n=== ${messageDate} ===\n`));
        }
        
        // Parse message content for token info
        const content = parser.parseMessageContent(message);
        const tokens = content?.usage || {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        };
        
        const cacheEfficiency = calculator.calculateCacheEfficiency(tokens);
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        // Extract project name
        let projectName = 'Unknown Project';
        if (message.cwd) {
          const pathParts = message.cwd.split('/');
          projectName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || 'Unknown';
        }
        
        console.log(
          `[${chalk.gray(timestamp)}] ` +
          `Cost: ${formatCostColored(message.costUSD)} | ` +
          `Duration: ${chalk.cyan(formatDuration(message.durationMs || 0))} | ` +
          `Tokens: ${chalk.gray(formatNumber(tokens.input_tokens + tokens.output_tokens))} | ` +
          `Cache: ${chalk.green(cacheEfficiency.toFixed(0) + '%')} | ` +
          chalk.bold(projectName)
        );
        
        // Update session tracking
        const sessionId = message.sessionId || 'unknown';
        const currentSessionCost = sessionCosts.get(sessionId) || 0;
        const currentSessionMessages = sessionMessages.get(sessionId) || 0;
        sessionCosts.set(sessionId, currentSessionCost + message.costUSD);
        sessionMessages.set(sessionId, currentSessionMessages + 1);
        dailyTotal += message.costUSD;
        
        // Show session summary every 10 messages
        if ((currentSessionMessages + 1) % 10 === 0) {
          console.log(
            chalk.dim('  └─ Session summary: ') +
            `${currentSessionMessages + 1} messages | ` +
            `Total: ${formatCostColored(currentSessionCost + message.costUSD)} | ` +
            `Avg: ${formatCostColored((currentSessionCost + message.costUSD) / (currentSessionMessages + 1))}`
          );
        }
      }
      
      // Final summary
      if (currentDay) {
        console.log(chalk.dim(`\n📅 Day total: ${formatCostColored(dailyTotal)}`));
      }
      
      console.log(chalk.bold.blue('\n📊 Overall Summary:'));
      const totalCost = Array.from(sessionCosts.values()).reduce((sum, cost) => sum + cost, 0);
      console.log(`  Total sessions: ${sessionCosts.size}`);
      console.log(`  Total messages: ${Array.from(sessionMessages.values()).reduce((sum, count) => sum + count, 0)}`);
      console.log(`  Total cost: ${formatCostColored(totalCost)}`);
      
      return;
    }

    // Calculate statistics
    const stats = calculateStats(allMessages, parser, calculator, options);
    stats.model = model;

    spinner.succeed(`Analysis complete: ${stats.totalMessages} messages processed`);

    // Display results
    switch (options.format) {
      case 'json':
        console.log(JSON.stringify(stats, null, 2));
        break;
      case 'csv':
        displayCSV(stats);
        break;
      case 'table':
      default:
        displayTable(stats, options, calculator);
        break;
    }

    // Export if requested
    if (options.export) {
      await exportResults(stats, options.export, options.format, allMessages);
      console.log(chalk.green(`\nResults exported to: ${options.export}`));
    }
  } catch (error) {
    spinner.fail('Analysis failed');
    logger.error('Analysis error:', error);
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function calculateStats(
  messages: ClaudeMessage[],
  parser: JSONLParser,
  calculator: CostCalculator,
  options: AnalyzeOptions,
) {
  const assistantMessages = parser.filterByType(messages, 'assistant');
  const userMessages = parser.filterByType(messages, 'user');
  
  const groupAnalyzer = new GroupAnalyzer(parser, calculator);

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalDuration = 0;
  let messageCount = 0;
  let costBreakdown = {
    inputTokensCost: 0,
    outputTokensCost: 0,
    cacheCreationCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
  };

  // Process all assistant messages
  assistantMessages.forEach((msg) => {
    if (msg.costUSD) {
      totalCost += msg.costUSD;
    }

    if (msg.durationMs) {
      totalDuration += msg.durationMs;
    }

    const content = parser.parseMessageContent(msg);
    if (content?.usage) {
      totalInputTokens += content.usage.input_tokens || 0;
      totalOutputTokens += content.usage.output_tokens || 0;
      totalCacheTokens += content.usage.cache_read_input_tokens || 0;
      totalCacheCreationTokens += content.usage.cache_creation_input_tokens || 0;
      
      // Calculate detailed cost breakdown for this message
      const msgBreakdown = calculator.calculateBreakdown(content.usage);
      costBreakdown.inputTokensCost += msgBreakdown.inputTokensCost;
      costBreakdown.outputTokensCost += msgBreakdown.outputTokensCost;
      costBreakdown.cacheCreationCost += msgBreakdown.cacheCreationCost;
      costBreakdown.cacheReadCost += msgBreakdown.cacheReadCost;
    }

    messageCount++;
  });
  
  costBreakdown.totalCost = costBreakdown.inputTokensCost + 
    costBreakdown.outputTokensCost + 
    costBreakdown.cacheCreationCost + 
    costBreakdown.cacheReadCost;

  const overallCacheEfficiency = calculator.calculateCacheEfficiency({
    input_tokens: totalInputTokens,
    cache_read_input_tokens: totalCacheTokens,
    cache_creation_input_tokens: totalCacheCreationTokens,
  });

  const cacheSavings = calculator.calculateCacheSavings({
    cache_read_input_tokens: totalCacheTokens,
    cache_creation_input_tokens: totalCacheCreationTokens,
  });

  // Get grouped statistics
  const groupedStats: any = {};
  
  if (options.showAll) {
    groupedStats.bySession = groupAnalyzer.groupBySession(messages);
    groupedStats.byProject = groupAnalyzer.groupByProject(messages);
    groupedStats.byDate = groupAnalyzer.groupByDate(messages);
    groupedStats.byHour = groupAnalyzer.groupByHour(messages);
  } else {
    switch (options.groupBy) {
      case 'project':
        groupedStats.byProject = groupAnalyzer.groupByProject(messages);
        break;
      case 'date':
        groupedStats.byDate = groupAnalyzer.groupByDate(messages);
        break;
      case 'hour':
        groupedStats.byHour = groupAnalyzer.groupByHour(messages);
        break;
      case 'session':
      default:
        groupedStats.bySession = groupAnalyzer.groupBySession(messages);
        break;
    }
  }

  return {
    totalMessages: messages.length,
    userMessages: userMessages.length,
    assistantMessages: assistantMessages.length,
    totalSessions: parser.getUniqueSessions(messages).length,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalCacheTokens,
    totalCacheCreationTokens,
    totalDuration,
    averageCostPerMessage: messageCount > 0 ? totalCost / messageCount : 0,
    averageDurationPerMessage: messageCount > 0 ? totalDuration / messageCount : 0,
    cacheEfficiency: overallCacheEfficiency,
    cacheSavings,
    costBreakdown,
    ...groupedStats,
  };
}

function displayTable(stats: any, options: AnalyzeOptions, calculator: CostCalculator) {
  console.log('\n' + chalk.bold.blue('Claude Code Usage Analysis'));
  console.log(chalk.dim(`Model: ${stats.model || 'claude-opus-4-20250514'}`));
  console.log(createSeparator(50));

  // Overview
  console.log(chalk.bold('\nOverview:'));
  console.log(`  Total Messages: ${chalk.cyan(formatNumber(stats.totalMessages))}`);
  console.log(`  User Messages:  ${chalk.cyan(formatNumber(stats.userMessages))}`);
  console.log(`  AI Responses:   ${chalk.cyan(formatNumber(stats.assistantMessages))}`);
  console.log(`  Sessions:       ${chalk.cyan(stats.totalSessions)}`);

  // Costs
  console.log(chalk.bold('\nCosts Summary:'));
  console.log(`  Total Cost:     ${formatCostColored(stats.totalCost)}`);
  console.log(`  Avg per Msg:    ${formatCostColored(stats.averageCostPerMessage)}`);
  
  // Cache Savings with explanation
  const savingsDisplay = stats.cacheSavings >= 0 
    ? chalk.green(calculator.formatCost(stats.cacheSavings)) 
    : chalk.red(calculator.formatCost(Math.abs(stats.cacheSavings)));
  const savingsPercentage = stats.totalCost > 0 
    ? ((stats.cacheSavings / (stats.totalCost + stats.cacheSavings)) * 100).toFixed(1)
    : '0.0';
  
  console.log(`  ${chalk.bold('Cache Savings:')}  ${savingsDisplay} ${chalk.gray(`(${savingsPercentage}% saved)`)}`);
  
  // Add impact message
  if (stats.cacheSavings > 100) {
    const impactLevel = stats.cacheSavings > 1000 ? '🔥 Massive' : stats.cacheSavings > 500 ? '⚡ Huge' : '✨ Great';
    console.log(chalk.dim(`                  ${impactLevel} savings! Without cache, total would be ${chalk.yellow(calculator.formatCost(stats.totalCost + stats.cacheSavings))}`));
  }
  
  // Detailed Cost Breakdown
  console.log(chalk.bold('\nCost Breakdown:'));
  console.log(`  Input Tokens:    ${formatCostColored(stats.costBreakdown.inputTokensCost)} (${formatNumber(stats.totalInputTokens)} tokens)`);
  console.log(`  Output Tokens:   ${formatCostColored(stats.costBreakdown.outputTokensCost)} (${formatNumber(stats.totalOutputTokens)} tokens)`);
  console.log(`  Cache Creation:  ${formatCostColored(stats.costBreakdown.cacheCreationCost)} (${formatNumber(stats.totalCacheCreationTokens)} tokens)`);
  console.log(`  Cache Read:      ${formatCostColored(stats.costBreakdown.cacheReadCost)} (${formatNumber(stats.totalCacheTokens)} tokens)`);

  // Performance
  console.log(chalk.bold('\nPerformance:'));
  console.log(`  Total Duration: ${chalk.cyan(formatDuration(stats.totalDuration))}`);
  console.log(`  Avg per Msg:    ${chalk.cyan(formatDuration(stats.averageDurationPerMessage))}`);
  console.log(`  Cache Hit Rate: ${formatPercentage(stats.cacheEfficiency)} ${stats.cacheEfficiency > 50 ? chalk.green('✓') : stats.cacheEfficiency > 0 ? chalk.yellow('⚡') : chalk.gray('○')}`);
  
  // Cache explanation for high hit rates
  if (stats.cacheEfficiency > 90) {
    console.log(chalk.dim(`                  ${chalk.green('Excellent!')} Cache is working efficiently`));
  }

  // Token Usage Summary
  console.log(chalk.bold('\nToken Usage Summary:'));
  console.log(`  Total Input:     ${chalk.cyan(formatNumber(stats.totalInputTokens + stats.totalCacheTokens + stats.totalCacheCreationTokens))}`);
  console.log(`    Regular Input: ${chalk.cyan(formatNumber(stats.totalInputTokens))}`);
  console.log(`    Cache Write:   ${chalk.cyan(formatNumber(stats.totalCacheCreationTokens))}`);
  console.log(`    Cache Read:    ${chalk.cyan(formatNumber(stats.totalCacheTokens))}`);
  console.log(`  Total Output:    ${chalk.cyan(formatNumber(stats.totalOutputTokens))}`);

  // Parse top count
  const topCount = parseInt(options.top || '5', 10);
  
  // Display grouped statistics
  if (options.showAll) {
    // Show all groupings
    displayGroupedStats('Sessions', stats.bySession, 'session', options.detailed, topCount);
    displayGroupedStats('Projects', stats.byProject, 'project', options.detailed, topCount);
    displayGroupedStats('Daily', stats.byDate, 'date', options.detailed, topCount);
    displayGroupedStats('Hourly', stats.byHour, 'hour', options.detailed, topCount * 2); // Show more hours
  } else {
    // Show selected grouping
    if (stats.bySession) {
      displayGroupedStats('Sessions', stats.bySession, 'session', options.detailed, topCount);
    }
    if (stats.byProject) {
      displayGroupedStats('Projects', stats.byProject, 'project', options.detailed, topCount);
    }
    if (stats.byDate) {
      displayGroupedStats('Daily', stats.byDate, 'date', options.detailed, topCount);
    }
    if (stats.byHour) {
      displayGroupedStats('Hourly', stats.byHour, 'hour', options.detailed, topCount * 2);
    }
  }
}

function displayGroupedStats(title: string, groups: GroupedStats[], type: string, detailed: boolean = false, topCount: number = 5) {
  if (!groups || groups.length === 0) return;

  const displayCount = Math.min(topCount, groups.length);
  console.log(chalk.bold(`\nTop ${displayCount} ${title} by Cost${detailed ? ' (Detailed)' : ''}:`));
  
  if (detailed && groups[0]?.costBreakdown) {
    // Detailed table with cost breakdown
    const separatorLength = type === 'session' ? 180 : 120;
    console.log(createSeparator(separatorLength));
    
    // Header for detailed view
    let header = '';
    switch (type) {
      case 'project':
        header = 'Project                          Total Cost  Msgs   Input $    Output $   Cache W $  Cache R $  Duration  Hit%';
        break;
      case 'date':
        header = 'Date       Total Cost  Msgs   Input $    Output $   Cache W $  Cache R $  Duration  Hit%';
        break;
      case 'hour':
        header = 'Date Hour        Total Cost  Msgs   Input $    Output $   Cache W $  Cache R $  Duration  Hit%';
        break;
      case 'session':
      default:
        header = 'Session ID                          Project                     Date Range           Total Cost  Msgs   Input $    Output $   Cache W $  Cache R $  Duration  Hit%';
        break;
    }
    
    console.log(chalk.gray(header));
    console.log(createSeparator(separatorLength));
    
    const topGroups = groups.slice(0, displayCount);
    topGroups.forEach((group: GroupedStats) => {
      let name = group.groupName;
      
      // Format name based on type
      if (type === 'session' && name.length > 35) {
        name = name.substring(0, 32) + '...';
      } else if (type === 'project' && name.length > 32) {
        name = name.substring(0, 32);
      }
      
      const breakdown = group.costBreakdown!;
      let row: string[];
      
      if (type === 'session') {
        // Include project and date range for sessions
        const project = (group.projectName || 'unknown').padEnd(27);
        const dateRange = (group.dateRange || '').padEnd(20);
        row = [
          name.padEnd(35),
          project,
          dateRange,
          formatCostColored(group.totalCost).padEnd(11),
          group.messageCount.toString().padStart(5),
          formatCostColored(breakdown.inputCost).padEnd(10),
          formatCostColored(breakdown.outputCost).padEnd(10),
          formatCostColored(breakdown.cacheWriteCost).padEnd(10),
          formatCostColored(breakdown.cacheReadCost).padEnd(10),
          formatDuration(group.duration).padStart(9),
          formatPercentage(group.cacheEfficiency).padStart(5),
        ];
      } else {
        row = [
          name.padEnd(type === 'date' ? 10 : type === 'hour' ? 16 : 35),
          formatCostColored(group.totalCost).padEnd(11),
          group.messageCount.toString().padStart(5),
          formatCostColored(breakdown.inputCost).padEnd(10),
          formatCostColored(breakdown.outputCost).padEnd(10),
          formatCostColored(breakdown.cacheWriteCost).padEnd(10),
          formatCostColored(breakdown.cacheReadCost).padEnd(10),
          formatDuration(group.duration).padStart(9),
          formatPercentage(group.cacheEfficiency).padStart(5),
        ];
      }
      
      console.log(row.join('  '));
    });
  } else {
    // Simple table (existing logic)
    const separatorLength = type === 'session' ? 130 : 80;
    console.log(createSeparator(separatorLength));
    
    // Adjust header based on type
    let header = '';
    switch (type) {
      case 'project':
        header = 'Project                                  Cost      Messages  Duration     Cache Hit%';
        break;
      case 'date':
        header = 'Date       Cost      Messages  Duration     Cache Hit%  Avg/Msg';
        break;
      case 'hour':
        header = 'Date Hour        Cost      Messages  Duration     Cache Hit%';
        break;
      case 'session':
      default:
        header = 'Session ID                    Project                Date Range      Cost      Messages  Duration    Hit%';
        break;
    }
    
    console.log(chalk.gray(header));
    console.log(createSeparator(separatorLength));

    const topGroups = groups.slice(0, displayCount);
    topGroups.forEach((group: GroupedStats) => {
      let name = group.groupName;
      
      // Format name based on type
      if (type === 'session') {
        if (name.length > 28) {
          name = name.substring(0, 25) + '...';
        }
        
        // Include project and date range for sessions
        const project = group.projectName || 'unknown';
        const projectDisplay = project.length > 22 ? project.substring(0, 19) + '...' : project;
        const dateRange = group.dateRange || '';
        const dateDisplay = dateRange.length > 20 ? dateRange.substring(0, 20) : dateRange;
        
        const row = [
          name.padEnd(29),
          projectDisplay.padEnd(22),
          dateDisplay.padEnd(15),
          formatCostColored(group.totalCost).padEnd(10),
          group.messageCount.toString().padStart(8),
          formatDuration(group.duration).padStart(11),
          formatPercentage(group.cacheEfficiency).padStart(5),
        ];
        console.log(row.join('  '));
      } else {
        if (type === 'project' && name.length > 40) {
          name = name.substring(0, 40);
        }
        
        const row = [
          name.padEnd(type === 'date' ? 10 : type === 'hour' ? 16 : 40),
          formatCostColored(group.totalCost).padEnd(10),
          group.messageCount.toString().padStart(8),
          formatDuration(group.duration).padStart(11),
          formatPercentage(group.cacheEfficiency).padStart(7),
        ];
        
        if (type === 'date') {
          row.push(formatCostColored(group.avgCost).padStart(8));
        }
        
        console.log(row.join('  '));
      }
    });
  }
}

function displayCSV(stats: any) {
  console.log('metric,value');
  console.log(`total_messages,${stats.totalMessages}`);
  console.log(`user_messages,${stats.userMessages}`);
  console.log(`assistant_messages,${stats.assistantMessages}`);
  console.log(`total_sessions,${stats.totalSessions}`);
  console.log(`total_cost,${stats.totalCost}`);
  console.log(`average_cost_per_message,${stats.averageCostPerMessage}`);
  console.log(`cache_savings,${stats.cacheSavings}`);
  console.log(`total_duration_ms,${stats.totalDuration}`);
  console.log(`cache_hit_rate_percent,${stats.cacheEfficiency}`);
  console.log(`input_tokens,${stats.totalInputTokens}`);
  console.log(`output_tokens,${stats.totalOutputTokens}`);
  console.log(`cache_creation_tokens,${stats.totalCacheCreationTokens}`);
  console.log(`cache_read_tokens,${stats.totalCacheTokens}`);
  console.log(`input_tokens_cost,${stats.costBreakdown.inputTokensCost}`);
  console.log(`output_tokens_cost,${stats.costBreakdown.outputTokensCost}`);
  console.log(`cache_creation_cost,${stats.costBreakdown.cacheCreationCost}`);
  console.log(`cache_read_cost,${stats.costBreakdown.cacheReadCost}`);
}

async function exportResults(stats: any, filename: string, format: string, messages: ClaudeMessage[]) {
  const exportService = new ExportService();
  
  // Prepare export data
  const exportData: any = {
    messages: messages,
    sessions: stats.bySession,
    dailyCosts: new Map<string, number>(),
    budgetStatus: null,
    predictions: null,
    insights: null
  };

  // Add daily costs if available
  if (stats.byDate) {
    stats.byDate.forEach((group: any) => {
      exportData.dailyCosts.set(group.groupName, group.totalCost);
    });
  }


  // Try to add predictions (for advanced formats)
  if (format === 'html') {
    try {
      const predictor = new CostPredictor();
      await predictor.loadHistoricalData(filename.replace(filename.split('/').pop()!, ''), 30);
      exportData.predictions = predictor.predict();
    } catch (error) {
      // Predictions not available
    }

    // Try to add insights
    try {
      const insightsAnalyzer = new UsageInsightsAnalyzer();
      exportData.insights = await insightsAnalyzer.analyzeUsage(messages);
    } catch (error) {
      // Insights not available
    }
  }

  // Use new export service for advanced formats
  if (['html'].includes(format)) {
    await exportService.export(exportData, {
      format: format as any,
      outputPath: filename,
      title: 'Claude Cost Analysis Report',
      metadata: {
        generated: new Date().toISOString(),
        totalMessages: stats.totalMessages,
        totalCost: stats.totalCost,
        dateRange: `${stats.byDate?.[0]?.groupName || 'N/A'} to ${stats.byDate?.[stats.byDate.length - 1]?.groupName || 'N/A'}`
      }
    });
  } else {
    // Fallback to simple export for text/json/csv
    const { writeFile } = await import('fs/promises');
    
    let content: string;
    switch (format) {
      case 'json':
        content = JSON.stringify(stats, null, 2);
        break;
      case 'csv':
        content = generateCSVContent(stats);
        break;
      default:
        content = generateTextReport(stats);
    }

    await writeFile(filename, content, 'utf-8');
  }
}

function generateCSVContent(stats: any): string {
  let csv = 'metric,value\n';
  csv += `total_messages,${stats.totalMessages}\n`;
  csv += `total_cost,${stats.totalCost}\n`;
  csv += `cache_hit_rate,${stats.cacheEfficiency}\n`;
  csv += `cache_savings,${stats.cacheSavings}\n`;
  csv += `input_tokens,${stats.totalInputTokens}\n`;
  csv += `output_tokens,${stats.totalOutputTokens}\n`;
  csv += `cache_creation_tokens,${stats.totalCacheCreationTokens}\n`;
  csv += `cache_read_tokens,${stats.totalCacheTokens}\n`;
  csv += `input_tokens_cost,${stats.costBreakdown.inputTokensCost}\n`;
  csv += `output_tokens_cost,${stats.costBreakdown.outputTokensCost}\n`;
  csv += `cache_creation_cost,${stats.costBreakdown.cacheCreationCost}\n`;
  csv += `cache_read_cost,${stats.costBreakdown.cacheReadCost}\n`;
  
  // Add grouped data if available
  if (stats.bySession) {
    csv += '\n\nsession_id,cost,messages,duration,cache_hit_rate\n';
    stats.bySession.forEach((session: GroupedStats) => {
      csv += `${session.groupName},${session.totalCost},${session.messageCount},${session.duration},${session.cacheEfficiency}\n`;
    });
  }
  
  if (stats.byProject) {
    csv += '\n\nproject,cost,messages,duration,cache_hit_rate\n';
    stats.byProject.forEach((project: GroupedStats) => {
      csv += `${project.groupName},${project.totalCost},${project.messageCount},${project.duration},${project.cacheEfficiency}\n`;
    });
  }
  
  if (stats.byDate) {
    csv += '\n\ndate,cost,messages,duration,cache_hit_rate\n';
    stats.byDate.forEach((date: GroupedStats) => {
      csv += `${date.groupName},${date.totalCost},${date.messageCount},${date.duration},${date.cacheEfficiency}\n`;
    });
  }
  
  return csv;
}

function generateTextReport(stats: any): string {
  let report = 'Claude Code Usage Report\n';
  report += '========================\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  report += `Total Messages: ${stats.totalMessages}\n`;
  report += `Total Cost: $${stats.totalCost.toFixed(4)}\n`;
  report += `Cache Hit Rate: ${stats.cacheEfficiency.toFixed(1)}%\n`;
  report += `Net Cache Savings: $${stats.cacheSavings.toFixed(4)}\n\n`;
  
  report += 'Cost Breakdown:\n';
  report += `--------------\n`;
  report += `Input Tokens:    $${stats.costBreakdown.inputTokensCost.toFixed(4)} (${stats.totalInputTokens} tokens)\n`;
  report += `Output Tokens:   $${stats.costBreakdown.outputTokensCost.toFixed(4)} (${stats.totalOutputTokens} tokens)\n`;
  report += `Cache Creation:  $${stats.costBreakdown.cacheCreationCost.toFixed(4)} (${stats.totalCacheCreationTokens} tokens)\n`;
  report += `Cache Read:      $${stats.costBreakdown.cacheReadCost.toFixed(4)} (${stats.totalCacheTokens} tokens)\n`;
  
  return report;
}

// Global calculator instance removed - now passed as parameter