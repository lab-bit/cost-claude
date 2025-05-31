import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import { CostPredictor } from '../../services/cost-predictor.js';
import { formatCurrency } from '../../utils/format.js';

export interface PredictOptions {
  path?: string;
  days?: string;
  format?: 'text' | 'json';
  detailed?: boolean;
}

export async function predictCommand(options: PredictOptions): Promise<void> {
  try {
    const projectPath = options.path?.replace('~', process.env.HOME || '') || 
                      `${process.env.HOME}/.claude/projects`;
    const days = parseInt(options.days || '30');
    
    if (isNaN(days) || days < 1) {
      console.error(chalk.red('Invalid days value. Must be a positive number.'));
      process.exit(1);
    }

    const predictor = new CostPredictor();
    
    console.log(chalk.blue(`Loading ${days} days of historical data...`));
    await predictor.loadHistoricalData(projectPath, days);

    const prediction = predictor.predict();
    
    if (!prediction) {
      console.log(chalk.yellow('⚠️  Insufficient data for prediction'));
      console.log(chalk.dim('Need at least 3 days of usage data for accurate predictions'));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(prediction, null, 2));
      return;
    }

    // Text format output
    console.log('\n' + predictor.formatPrediction(prediction));

    if (options.detailed) {
      console.log('\n' + chalk.bold('📊 Detailed Usage Pattern:'));
      console.log('=' .repeat(40));
      
      // Hourly pattern
      console.log('\n' + chalk.cyan('Hourly Average Cost:'));
      const maxHourCost = Math.max(...prediction.pattern.hourOfDay);
      prediction.pattern.hourOfDay.forEach((cost, hour) => {
        const barLength = Math.round((cost / maxHourCost) * 20) || 0;
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        const hourStr = `${hour.toString().padStart(2, '0')}:00`;
        console.log(`  ${hourStr} ${bar} ${formatCurrency(cost)}`);
      });

      // Daily pattern
      console.log('\n' + chalk.cyan('Daily Average Cost:'));
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const maxDayCost = Math.max(...prediction.pattern.dayOfWeek);
      prediction.pattern.dayOfWeek.forEach((cost, day) => {
        const barLength = Math.round((cost / maxDayCost) * 20) || 0;
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        console.log(`  ${days[day]} ${bar} ${formatCurrency(cost)}`);
      });

      // Token usage
      console.log('\n' + chalk.cyan('Average Tokens per Message:'));
      console.log(`  Input:  ${prediction.pattern.averageTokensPerMessage.input.toFixed(0)} tokens`);
      console.log(`  Output: ${prediction.pattern.averageTokensPerMessage.output.toFixed(0)} tokens`);
      console.log(`  Ratio:  1:${(prediction.pattern.averageTokensPerMessage.output / prediction.pattern.averageTokensPerMessage.input).toFixed(1)}`);
    }


  } catch (error: any) {
    logger.error('Predict command failed:', error);
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}