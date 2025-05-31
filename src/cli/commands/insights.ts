import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import { UsageInsightsAnalyzer } from '../../services/usage-insights.js';
import { JSONLParser } from '../../core/jsonl-parser.js';

export interface InsightsOptions {
  path?: string;
  days?: string;
  format?: 'text' | 'json';
  export?: string;
}

export async function insightsCommand(options: InsightsOptions): Promise<void> {
  try {
    const projectPath = options.path?.replace('~', process.env.HOME || '') || 
                      `${process.env.HOME}/.claude/projects`;
    const days = parseInt(options.days || '30');
    
    if (isNaN(days) || days < 1) {
      console.error(chalk.red('Invalid days value. Must be a positive number.'));
      process.exit(1);
    }

    const parser = new JSONLParser();
    const analyzer = new UsageInsightsAnalyzer();
    
    console.log(chalk.blue(`Analyzing ${days} days of usage data...`));
    
    // Load messages
    const allMessages = await parser.parseDirectory(projectPath);
    
    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const messages = allMessages.filter((msg: any) => 
      msg.timestamp && new Date(msg.timestamp) >= cutoffDate
    );

    if (messages.length === 0) {
      console.log(chalk.yellow('⚠️  No messages found in the specified time range'));
      return;
    }

    console.log(chalk.dim(`Found ${messages.length} messages to analyze`));

    // Analyze usage
    const insights = await analyzer.analyzeUsage(messages);

    if (options.format === 'json') {
      console.log(JSON.stringify(insights, null, 2));
      return;
    }

    // Text format output
    console.log('\n' + analyzer.formatInsights(insights));

    // Export if requested
    if (options.export) {
      const { writeFileSync } = await import('fs');
      const exportData = {
        generated: new Date().toISOString(),
        period: `${days} days`,
        messagesAnalyzed: messages.length,
        insights
      };
      
      writeFileSync(options.export, JSON.stringify(exportData, null, 2));
      console.log(chalk.green(`\n✅ Insights exported to ${options.export}`));
    }

    // Show actionable summary
    const criticalCount = insights.filter(i => i.severity === 'critical').length;
    const warningCount = insights.filter(i => i.severity === 'warning').length;
    const potentialSavings = insights
      .filter(i => i.impact !== undefined)
      .reduce((sum, i) => sum + (i.impact || 0), 0);

    if (criticalCount > 0 || warningCount > 0 || potentialSavings > 0) {
      console.log('\n' + chalk.bold('🎯 Action Items:'));
      console.log('=' .repeat(40));
      
      if (criticalCount > 0) {
        console.log(chalk.red(`1. Address ${criticalCount} critical issues immediately`));
      }
      
      if (warningCount > 0) {
        console.log(chalk.yellow(`2. Review ${warningCount} optimization opportunities`));
      }
      
      if (potentialSavings > 0.01) {
        console.log(chalk.green(`3. Save up to $${potentialSavings.toFixed(2)} by implementing recommendations`));
      }

      console.log('\n' + chalk.dim('Run with --export <file> to save full report'));
    }

  } catch (error: any) {
    logger.error('Insights command failed:', error);
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}