import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import { SyncManager } from '../../services/sync-manager.js';
import { homedir } from 'os';
import { join } from 'path';

export interface SyncOptions {
  export?: boolean;
  import?: string[];
  compare?: string;
  list?: boolean;
  path?: string;
  output?: string;
  strategy?: 'newest' | 'oldest' | 'cost' | 'manual';
  dryRun?: boolean;
  noBackup?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  try {
    const syncManager = new SyncManager();
    const projectPath = options.path?.replace('~', homedir()) || join(homedir(), '.claude/projects');

    // List available sync files
    if (options.list) {
      const syncFiles = syncManager.listAvailableSyncs();
      
      if (syncFiles.length === 0) {
        console.log(chalk.yellow('No sync files found'));
        console.log(chalk.dim('Export data first with: cost-claude sync --export'));
        return;
      }

      console.log(chalk.bold('\n📁 Available Sync Files:'));
      console.log('=' .repeat(50));
      
      syncFiles.forEach(file => {
        console.log(`  ${file}`);
      });
      
      console.log(chalk.dim(`\nLocation: ${join(homedir(), '.cost-claude/sync')}`));
      return;
    }

    // Export for sync
    if (options.export) {
      console.log(chalk.blue('Exporting data for sync...'));
      const exportPath = await syncManager.exportForSync(projectPath, options.output);
      console.log(chalk.green(`✅ Data exported to: ${exportPath}`));
      console.log(chalk.dim('Share this file with other machines for syncing'));
      return;
    }

    // Import and merge
    if (options.import && options.import.length > 0) {
      console.log(chalk.blue('Importing and merging data...'));
      
      const mergeOptions = {
        strategy: options.strategy || 'newest' as const,
        backup: !options.noBackup,
        dryRun: options.dryRun || false
      };

      if (options.dryRun) {
        console.log(chalk.yellow('🔍 Running in dry-run mode (no changes will be made)'));
      }

      const report = await syncManager.importAndMerge(
        options.import,
        projectPath,
        mergeOptions
      );

      console.log('\n' + syncManager.formatSyncReport(report));

      if (options.dryRun) {
        console.log(chalk.yellow('\n⚠️  This was a dry run. Use without --dry-run to apply changes.'));
      }

      return;
    }

    // Compare with remote
    if (options.compare) {
      console.log(chalk.blue('Comparing local and remote data...'));
      await syncManager.compareWithRemote(projectPath, options.compare);
      return;
    }

    // Show help if no action specified
    console.log(chalk.bold('\n🔄 Claude Cost Checker - Sync Tool'));
    console.log('=' .repeat(50));
    console.log('\nUsage:');
    console.log('  Export data:    cost-claude sync --export');
    console.log('  Import data:    cost-claude sync --import <file1> [file2...]');
    console.log('  Compare:        cost-claude sync --compare <remote-path>');
    console.log('  List syncs:     cost-claude sync --list');
    console.log('\nOptions:');
    console.log('  --strategy      Conflict resolution: newest, oldest, cost, manual');
    console.log('  --dry-run       Preview changes without applying them');
    console.log('  --no-backup     Skip backup when importing');
    console.log('\nExample workflow:');
    console.log('  1. On machine A: cost-claude sync --export');
    console.log('  2. Copy the export file to machine B');
    console.log('  3. On machine B: cost-claude sync --import <export-file>');

  } catch (error: any) {
    logger.error('Sync command failed:', error);
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}