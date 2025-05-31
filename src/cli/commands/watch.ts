import chalk from 'chalk';
import ora from 'ora';
import { homedir } from 'os';
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { ClaudeFileWatcher } from '../../services/file-watcher.js';
import { NotificationService } from '../../services/notification.js';
import { CostCalculator } from '../../core/cost-calculator.js';
import { JSONLParser } from '../../core/jsonl-parser.js';
import { logger } from '../../utils/logger.js';
import { formatCostColored, formatCost, formatDuration, formatNumber, shortenProjectName } from '../../utils/format.js';
import { ClaudeMessage } from '../../types/index.js';
import { SessionDetector, SessionCompletionData, TaskCompletionData } from '../../services/session-detector.js';
import { ProjectParser } from '../../core/project-parser.js';

interface WatchOptions {
  path: string;
  notify: boolean;
  minCost: string;
  sound: boolean;
  includeExisting: boolean;
  recent?: string;
  test?: boolean;
  verbose?: boolean;
  notifyTask: boolean;
  notifySession: boolean;
  notifyCost: boolean;
  parent?: any; // To access global options like model
}

async function getRecentMessages(basePath: string, count: number): Promise<ClaudeMessage[]> {
  const pattern = `${basePath}/**/*.jsonl`;
  const files = await glob(pattern);
  
  const allMessages: ClaudeMessage[] = [];
  
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as ClaudeMessage;
          if (message.type === 'assistant' && message.costUSD) {
            allMessages.push(message);
          }
        } catch {
          // Skip invalid lines
        }
      }
    } catch (error) {
      logger.warn(`Failed to read file ${file}:`, error);
    }
  }
  
  // Sort by timestamp and get the most recent ones
  return allMessages
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, count);
}

export async function watchCommand(options: WatchOptions) {
  // Set log level based on verbose flag
  if (options.verbose) {
    logger.level = 'debug';
    // Also set on all transports
    logger.transports.forEach((transport: any) => {
      transport.level = 'debug';
    });
  }
  
  // Get model from parent command options
  const model = options.parent?.opts?.()?.model || 'claude-opus-4-20250514';
  
  // Handle notification options with defaults
  const notifyTask = options.notify && options.notifyTask;
  const notifySession = options.notify && options.notifySession;
  const notifyCost = options.notify && options.notifyCost;
  
  console.log(chalk.bold.blue('Claude Code Cost Watcher'));
  console.log(chalk.gray('Real-time monitoring for Claude usage'));
  console.log(chalk.dim(`Model: ${model}`));
  
  if (options.test) {
    console.log(chalk.yellow('🧪 TEST MODE ENABLED'));
  }
  
  if (options.verbose) {
    console.log(chalk.gray('Verbose logging enabled'));
  }
  
  // Show notification settings
  if (options.notify) {
    const notificationTypes = [];
    if (notifyTask) notificationTypes.push('Task');
    if (notifySession) notificationTypes.push('Session');
    if (notifyCost) notificationTypes.push('Cost');
    console.log(chalk.gray(`Notifications: ${notificationTypes.join(', ') || 'None'}`));
  }
  
  const recentCount = parseInt(options.recent || '5');
  if (options.includeExisting) {
    console.log(chalk.gray('Processing all existing messages'));
  } else if (recentCount > 0) {
    console.log(chalk.gray(`Showing last ${recentCount} messages before monitoring`));
  } else {
    console.log(chalk.gray('Monitoring new messages only'));
  }
  console.log();

  const spinner = ora('Initializing watcher...').start();

  try {
    // Expand home directory
    const basePath = options.path.replace('~', homedir());
    
    // In test mode, create test directory
    if (options.test) {
      const testPath = `${homedir()}/.cost-claude/test`;
      const { mkdir } = await import('fs/promises');
      await mkdir(testPath, { recursive: true });
      console.log(chalk.gray(`Test directory created: ${testPath}`));
    }
    const minCost = parseFloat(options.minCost);
    const recentCount = parseInt(options.recent || '5');

    // Initialize services
    const watcher = new ClaudeFileWatcher({
      paths: [`${basePath}/**/*.jsonl`],
      ignoreInitial: !options.includeExisting,
      pollInterval: 100,
      debounceDelay: 300,
    });

    const notificationService = new NotificationService({
      soundEnabled: options.sound,
    });

    const calculator = new CostCalculator(undefined, model);
    await calculator.ensureRatesLoaded();
    const parser = new JSONLParser();
    
    // Initialize session detector
    const sessionDetector = new SessionDetector({
      inactivityTimeout: 300000, // 5 minutes
      summaryMessageTimeout: 5000 // 5 seconds after summary
    });

    // Track session costs
    const sessionCosts = new Map<string, number>();
    const sessionMessages = new Map<string, number>();
    let dailyTotal = 0;
    const today = new Date().toDateString();

    spinner.succeed('Watcher initialized');
    console.log(chalk.gray(`Watching: ${basePath}`));
    console.log(chalk.gray(`Min cost for notification: $${minCost.toFixed(4)}`));
    console.log(chalk.gray('Press Ctrl+C to stop'));
    
    if (options.test) {
      console.log(chalk.yellow('\n📝 Test Mode Instructions:'));
      console.log(chalk.gray('  1. Create or modify .jsonl files in the watched directory'));
      console.log(chalk.gray('  2. Add messages in JSONL format (one JSON object per line)'));
      console.log(chalk.gray('  3. Watch for real-time cost updates'));
      console.log(chalk.gray(`\nExample message format:`));
      console.log(chalk.dim(`  {"uuid":"msg-123","type":"assistant","costUSD":0.05,"timestamp":"${new Date().toISOString()}"}}`));
    }
    console.log();

    // Set up task completion handler
    sessionDetector.on('task-completed', async (data: TaskCompletionData) => {
      const durationSec = Math.round(data.taskDuration / 1000);
      
      // Console output
      console.log(chalk.bold.cyan(`\n💬 Task Completed`));
      console.log(chalk.gray(`   Project: ${data.projectName}`));
      console.log(chalk.gray(`   Duration: ${durationSec} seconds`));
      console.log(chalk.gray(`   Cost: ${formatCostColored(data.taskCost)}`));
      console.log(chalk.gray(`   Messages: ${data.assistantMessageCount}\n`));
      
      // Send notification if enabled
      if (notifyTask) {
        const message = [
          `⏱️ ${durationSec}s • 💬 ${data.assistantMessageCount} ${data.assistantMessageCount === 1 ? 'response' : 'responses'}`,
          `💰 ${formatCost(data.taskCost)}`
        ].join('\n');
        
        await notificationService.sendCustom(
          `💬 ${shortenProjectName(data.projectName)} - Task Complete`,
          message,
          {
            sound: options.sound
          }
        );
      }
    });

    // Set up session completion handler
    sessionDetector.on('session-completed', async (data: SessionCompletionData) => {
      const durationMin = Math.round(data.duration / 60000);
      const avgCostPerMessage = data.messageCount > 0 ? data.totalCost / data.messageCount : 0;
      
      // Console output
      console.log(chalk.bold.green(`\n✅ Session Completed: ${data.projectName}`));
      console.log(chalk.gray(`   Summary: ${data.summary}`));
      console.log(chalk.gray(`   Duration: ${durationMin} minutes`));
      console.log(chalk.gray(`   Total Cost: ${formatCostColored(data.totalCost)}`));
      console.log(chalk.gray(`   Messages: ${data.messageCount}`));
      console.log(chalk.gray(`   Avg Cost/Message: ${formatCostColored(avgCostPerMessage)}\n`));
      
      // Send notification if enabled
      if (notifySession) {
        const message = [
          `📝 ${data.summary}`,
          `⏱️ ${durationMin} min • 💬 ${data.messageCount} messages`,
          `💰 Total: ${formatCost(data.totalCost)}`
        ].join('\n');
        
        await notificationService.sendCustom(
          `✅ ${shortenProjectName(data.projectName)} - Session Complete`,
          message,
          {
            sound: options.sound
          }
        );
      }
    });


    // Handle new messages
    watcher.on('new-message', async (message: ClaudeMessage) => {
      // Process all messages through session detector
      sessionDetector.processMessage(message);
      
      // Reset daily total if it's a new day
      const messageDate = new Date(message.timestamp).toDateString();
      if (messageDate !== today) {
        dailyTotal = 0;
      }

      // Only process assistant messages with costs for display
      if (message.type === 'assistant' && message.costUSD) {
        const sessionId = message.sessionId || 'unknown';
        const currentSessionCost = sessionCosts.get(sessionId) || 0;
        const currentSessionMessages = sessionMessages.get(sessionId) || 0;
        
        const newSessionCost = currentSessionCost + message.costUSD;
        const newSessionMessages = currentSessionMessages + 1;
        
        sessionCosts.set(sessionId, newSessionCost);
        sessionMessages.set(sessionId, newSessionMessages);
        dailyTotal += message.costUSD;


        // Parse message content for token info
        const content = parser.parseMessageContent(message);
        const tokens = content?.usage || {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        };

        const cacheEfficiency = calculator.calculateCacheEfficiency(tokens);

        // Extract project name using ProjectParser
        const projectName = ProjectParser.getProjectFromMessage(message) || 'Unknown Project';

        // Display in console
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        console.log(
          `[${chalk.gray(timestamp)}] ` +
          `Cost: ${formatCostColored(message.costUSD)} | ` +
          `Duration: ${chalk.cyan(formatDuration(message.durationMs || 0))} | ` +
          `Tokens: ${chalk.gray(formatNumber(tokens.input_tokens + tokens.output_tokens))} | ` +
          `Cache: ${chalk.green(cacheEfficiency.toFixed(0) + '%')} | ` +
          chalk.bold(projectName)
        );

        // Send notification if enabled and above threshold
        if (notifyCost && message.costUSD >= minCost) {
          await notificationService.notifyCostUpdate({
            sessionId,
            messageId: message.uuid,
            cost: message.costUSD,
            duration: message.durationMs || 0,
            tokens: {
              input: tokens.input_tokens || 0,
              output: tokens.output_tokens || 0,
              cacheHit: tokens.cache_read_input_tokens || 0,
            },
            sessionTotal: newSessionCost,
            dailyTotal,
            projectName, // Add project name
          });
        }

        // Show session summary every 10 messages
        if (newSessionMessages % 10 === 0) {
          console.log(
            chalk.dim('  └─ Session summary: ') +
            `${newSessionMessages} messages | ` +
            `Total: ${formatCostColored(newSessionCost)} | ` +
            `Avg: ${formatCostColored(newSessionCost / newSessionMessages)}`
          );
        }
      }
    });

    // Handle errors
    watcher.on('error', (error) => {
      logger.error('Watcher error:', error);
      console.error(chalk.red('Error:'), error.message);
    });

    // Handle file events
    watcher.on('file-added', (filePath) => {
      if (options.verbose) {
        console.log(chalk.dim(`📁 New file detected: ${filePath}`));
      }
    });
    
    // In verbose mode, show more events
    if (options.verbose) {
      watcher.on('parse-error', ({ filePath, line, error }) => {
        console.error(chalk.yellow('⚠️  Parse error:'), {
          file: filePath,
          line: line.substring(0, 50) + '...',
          error: error instanceof Error ? error.message : error
        });
      });
    }

    // Process recent messages if requested
    if (recentCount > 0 && !options.includeExisting) {
      const recentSpinner = ora('Loading recent messages...').start();
      try {
        const recentMessages = await getRecentMessages(basePath, recentCount);
        recentSpinner.succeed(`Found ${recentMessages.length} recent messages`);
        
        if (recentMessages.length > 0) {
          console.log(chalk.bold.cyan('\n📜 Recent Messages:'));
          
          // Process each recent message
          for (const message of recentMessages.reverse()) {
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
            
            // Extract project name using ProjectParser
            const projectName = ProjectParser.getProjectFromMessage(message) || 'Unknown Project';
            
            console.log(
              `[${chalk.gray(timestamp)}] ` +
              `Cost: ${formatCostColored(message.costUSD || 0)} | ` +
              `Duration: ${chalk.cyan(formatDuration(message.durationMs || 0))} | ` +
              `Tokens: ${chalk.gray(formatNumber(tokens.input_tokens + tokens.output_tokens))} | ` +
              `Cache: ${chalk.green(cacheEfficiency.toFixed(0) + '%')} | ` +
              chalk.bold(projectName)
            );
            
            // Update session tracking
            const sessionId = message.sessionId || 'unknown';
            const currentSessionCost = sessionCosts.get(sessionId) || 0;
            const currentSessionMessages = sessionMessages.get(sessionId) || 0;
            sessionCosts.set(sessionId, currentSessionCost + (message.costUSD || 0));
            sessionMessages.set(sessionId, currentSessionMessages + 1);
            
            // Update daily total
            const messageDate = new Date(message.timestamp).toDateString();
            if (messageDate === today) {
              dailyTotal += message.costUSD || 0;
            }
          }
          
          console.log(chalk.dim('─'.repeat(60)) + '\n');
        }
      } catch (error) {
        recentSpinner.fail('Failed to load recent messages');
        logger.error('Error loading recent messages:', error);
      }
    }

    // Start watching
    await watcher.start();
    
    // In test mode, generate sample data periodically
    if (options.test) {
      const generateTestData = async () => {
        const testFile = `${homedir()}/.cost-claude/test/test-session-${Date.now()}.jsonl`;
        const { writeFile } = await import('fs/promises');
        
        console.log(chalk.blue('\n🎲 Generating test data...'));
        
        // Create a test session
        const sessionId = `test-${Date.now()}`;
        const messages = [];
        
        // User message
        messages.push({
          uuid: `${sessionId}-1`,
          type: 'user',
          timestamp: new Date().toISOString(),
          sessionId,
          message: JSON.stringify({
            role: 'user',
            content: 'Test question about coding'
          })
        });
        
        // Assistant response
        messages.push({
          uuid: `${sessionId}-2`,
          type: 'assistant',
          timestamp: new Date().toISOString(),
          sessionId,
          costUSD: 0.0234,
          durationMs: 2345,
          message: JSON.stringify({
            role: 'assistant',
            content: 'Test response content',
            model: model,
            usage: {
              input_tokens: 523,
              output_tokens: 234,
              cache_read_input_tokens: 100,
              cache_creation_input_tokens: 50
            }
          })
        });
        
        // Write messages
        await writeFile(testFile, messages.map(m => JSON.stringify(m)).join('\n') + '\n');
        console.log(chalk.green(`✓ Created test file: ${testFile}`));
        console.log(chalk.gray(`  Added ${messages.length} messages`));
      };
      
      // Generate initial test data
      setTimeout(generateTestData, 2000);
      
      // Generate more data every 30 seconds
      setInterval(generateTestData, 30000);
    }

    // Show daily summary every hour
    const summaryInterval = setInterval(() => {
      if (dailyTotal > 0) {
        console.log(
          chalk.bold.yellow('\n📊 Hourly Summary:') +
          `\n  Today's total: ${formatCostColored(dailyTotal)}` +
          `\n  Active sessions: ${sessionCosts.size}` +
          `\n  Total messages: ${Array.from(sessionMessages.values()).reduce((a, b) => a + b, 0)}\n`
        );
      }
    }, 3600000); // 1 hour

    // Handle graceful shutdown
    let isShuttingDown = false;
    process.on('SIGINT', async () => {
      if (isShuttingDown) return; // Prevent multiple SIGINT handling
      isShuttingDown = true;
      
      console.log(chalk.yellow('\n\nShutting down...'));
      
      clearInterval(summaryInterval);
      
      // Complete any active sessions before shutdown
      const activeSessions = sessionDetector.getActiveSessions();
      if (activeSessions.length > 0) {
        console.log(chalk.gray(`Completing ${activeSessions.length} active sessions...`));
        sessionDetector.completeAllSessions();
        // Give time for notifications to send
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      try {
        await watcher.stop();
      } catch (error) {
        logger.debug('Error stopping watcher:', error);
      }

      // Show final summary
      if (sessionCosts.size > 0) {
        console.log(chalk.bold.blue('\n📈 Final Summary:'));
        console.log(`  Total sessions: ${sessionCosts.size}`);
        console.log(`  Total cost: ${formatCostColored(dailyTotal)}`);
        
        // Show top 3 sessions
        const topSessions = Array.from(sessionCosts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);

        if (topSessions.length > 0) {
          console.log(chalk.bold('\n  Top Sessions:'));
          topSessions.forEach(([sessionId, cost], index) => {
            const messages = sessionMessages.get(sessionId) || 0;
            console.log(
              `  ${index + 1}. ${sessionId.substring(0, 8)}... - ` +
              `${formatCostColored(cost)} (${messages} messages)`
            );
          });
        }
      }

      console.log(chalk.green('\nGoodbye! 👋'));
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    spinner.fail('Failed to start watcher');
    logger.error('Watch command error:', error);
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}