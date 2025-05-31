import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { ClaudeMessage } from '../types/index.js';
import { JSONLParser } from '../core/jsonl-parser.js';

export interface SyncMetadata {
  machineId: string;
  machineName: string;
  lastSync: string;
  messagesCount: number;
  totalCost: number;
  checksum: string;
}

export interface SyncReport {
  totalMessages: number;
  newMessages: number;
  duplicates: number;
  conflicts: number;
  totalCost: number;
  machines: SyncMetadata[];
}

export interface MergeOptions {
  strategy: 'newest' | 'oldest' | 'cost' | 'manual';
  backup: boolean;
  dryRun: boolean;
}

export class SyncManager {
  private syncDir: string;
  private machineId: string;
  private machineName: string;
  private parser: JSONLParser;

  constructor() {
    this.syncDir = join(homedir(), '.cost-claude', 'sync');
    this.machineId = this.generateMachineId();
    this.machineName = this.getMachineName();
    this.parser = new JSONLParser();

    if (!existsSync(this.syncDir)) {
      mkdirSync(this.syncDir, { recursive: true });
    }
  }

  private generateMachineId(): string {
    // Generate a unique machine ID based on hostname and platform
    const hostname = require('os').hostname();
    const platform = process.platform;
    const hash = createHash('sha256').update(`${hostname}-${platform}`).digest('hex');
    return hash.substring(0, 8);
  }

  private getMachineName(): string {
    return require('os').hostname();
  }

  async exportForSync(projectPath: string, outputPath?: string): Promise<string> {
    try {
      const messages = await this.parser.parseDirectory(projectPath);
      
      // Calculate metadata
      const totalCost = messages.reduce((sum: number, msg: ClaudeMessage) => sum + (msg.costUSD || 0), 0);
      const checksum = this.calculateChecksum(messages);
      
      const metadata: SyncMetadata = {
        machineId: this.machineId,
        machineName: this.machineName,
        lastSync: new Date().toISOString(),
        messagesCount: messages.length,
        totalCost,
        checksum
      };

      // Prepare export data
      const exportData = {
        metadata,
        messages: messages.map((msg: ClaudeMessage) => ({
          ...msg,
          _syncMachineId: this.machineId,
          _syncTimestamp: new Date().toISOString()
        }))
      };

      // Determine output path
      const filename = `claude-sync-${this.machineId}-${Date.now()}.json`;
      const finalPath = outputPath || join(this.syncDir, filename);

      // Write to file
      writeFileSync(finalPath, JSON.stringify(exportData, null, 2));
      
      logger.info(`Exported ${messages.length} messages to ${finalPath}`);
      return finalPath;
    } catch (error) {
      logger.error('Error exporting for sync:', error);
      throw error;
    }
  }

  async importAndMerge(
    importPaths: string[], 
    targetPath: string,
    options: MergeOptions = { strategy: 'newest', backup: true, dryRun: false }
  ): Promise<SyncReport> {
    try {
      // Load existing messages
      const existingMessages = await this.parser.parseDirectory(targetPath);
      const existingMap = new Map<string, ClaudeMessage>();
      
      existingMessages.forEach((msg: ClaudeMessage) => {
        if (msg.uuid) {
          existingMap.set(msg.uuid, msg);
        }
      });

      // Load and merge all import files
      const importedData: Array<{ metadata: SyncMetadata; messages: ClaudeMessage[] }> = [];
      let totalNewMessages = 0;
      let totalDuplicates = 0;
      let totalConflicts = 0;

      for (const importPath of importPaths) {
        if (!existsSync(importPath)) {
          logger.warn(`Import file not found: ${importPath}`);
          continue;
        }

        const data = JSON.parse(readFileSync(importPath, 'utf-8'));
        importedData.push(data);

        // Process messages
        for (const msg of data.messages) {
          if (!msg.uuid) continue;

          if (!existingMap.has(msg.uuid)) {
            // New message
            existingMap.set(msg.uuid, msg);
            totalNewMessages++;
          } else {
            // Potential conflict
            const existing = existingMap.get(msg.uuid)!;
            
            if (this.messagesEqual(existing, msg)) {
              totalDuplicates++;
            } else {
              totalConflicts++;
              
              // Resolve conflict based on strategy
              const winner = this.resolveConflict(existing, msg, options.strategy);
              existingMap.set(msg.uuid, winner);
            }
          }
        }
      }

      // Calculate final statistics
      const mergedMessages = Array.from(existingMap.values());
      const totalCost = mergedMessages.reduce((sum: number, msg: ClaudeMessage) => sum + (msg.costUSD || 0), 0);

      const report: SyncReport = {
        totalMessages: mergedMessages.length,
        newMessages: totalNewMessages,
        duplicates: totalDuplicates,
        conflicts: totalConflicts,
        totalCost,
        machines: importedData.map(d => d.metadata)
      };

      if (!options.dryRun) {
        // Backup existing data if requested
        if (options.backup && existingMessages.length > 0) {
          const backupPath = join(targetPath, '..', `backup-${Date.now()}.jsonl`);
          await this.createBackup(targetPath, backupPath);
        }

        // Write merged data
        await this.writeMergedData(mergedMessages, targetPath);
      }

      return report;
    } catch (error) {
      logger.error('Error importing and merging:', error);
      throw error;
    }
  }

  private calculateChecksum(messages: ClaudeMessage[]): string {
    const sortedMessages = [...messages].sort((a, b) => 
      (a.timestamp || '').localeCompare(b.timestamp || '')
    );
    
    const data = sortedMessages.map(msg => 
      `${msg.uuid}:${msg.timestamp}:${msg.costUSD || 0}`
    ).join('|');
    
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  private messagesEqual(msg1: ClaudeMessage, msg2: ClaudeMessage): boolean {
    // Compare key fields
    return (
      msg1.uuid === msg2.uuid &&
      msg1.timestamp === msg2.timestamp &&
      msg1.costUSD === msg2.costUSD &&
      msg1.type === msg2.type
    );
  }

  private resolveConflict(
    existing: ClaudeMessage, 
    incoming: ClaudeMessage, 
    strategy: MergeOptions['strategy']
  ): ClaudeMessage {
    switch (strategy) {
      case 'newest':
        return new Date(existing.timestamp || 0) > new Date(incoming.timestamp || 0) 
          ? existing : incoming;
      
      case 'oldest':
        return new Date(existing.timestamp || 0) < new Date(incoming.timestamp || 0) 
          ? existing : incoming;
      
      case 'cost':
        // Keep the one with cost information
        if (existing.costUSD && !incoming.costUSD) return existing;
        if (!existing.costUSD && incoming.costUSD) return incoming;
        // If both have cost, keep the one with more detail
        return (existing.message && typeof existing.message === 'object') ? existing : incoming;
      
      case 'manual':
        // In a real implementation, this would prompt the user
        logger.warn(`Conflict for message ${existing.uuid}, using existing version`);
        return existing;
      
      default:
        return existing;
    }
  }

  private async createBackup(sourcePath: string, backupPath: string): Promise<void> {
    try {
      const messages = await this.parser.parseDirectory(sourcePath);
      const jsonlContent = messages.map((msg: ClaudeMessage) => JSON.stringify(msg)).join('\n');
      writeFileSync(backupPath, jsonlContent);
      logger.info(`Backup created at ${backupPath}`);
    } catch (error) {
      logger.error('Error creating backup:', error);
      throw error;
    }
  }

  private async writeMergedData(messages: ClaudeMessage[], targetPath: string): Promise<void> {
    try {
      // Group messages by original file structure
      const fileGroups = new Map<string, ClaudeMessage[]>();
      
      messages.forEach(msg => {
        // Try to preserve original file grouping based on sessionId or timestamp
        const date = msg.timestamp ? new Date(msg.timestamp).toISOString().split('T')[0] : 'unknown';
        const key = `claude-${date}.jsonl`;
        
        if (!fileGroups.has(key)) {
          fileGroups.set(key, []);
        }
        fileGroups.get(key)!.push(msg);
      });

      // Write to files
      fileGroups.forEach((msgs, filename) => {
        const filePath = join(targetPath, filename);
        const content = msgs.map(msg => JSON.stringify(msg)).join('\n');
        writeFileSync(filePath, content);
      });

      logger.info(`Merged data written to ${targetPath}`);
    } catch (error) {
      logger.error('Error writing merged data:', error);
      throw error;
    }
  }

  async compareWithRemote(localPath: string, remotePath: string): Promise<void> {
    try {
      const localMessages = await this.parser.parseDirectory(localPath);
      const remoteMessages = await this.parser.parseDirectory(remotePath);

      const localMap = new Map(localMessages.map((msg: ClaudeMessage) => [msg.uuid, msg]));
      const remoteMap = new Map(remoteMessages.map((msg: ClaudeMessage) => [msg.uuid, msg]));

      const localOnly = localMessages.filter((msg: ClaudeMessage) => !remoteMap.has(msg.uuid));
      const remoteOnly = remoteMessages.filter((msg: ClaudeMessage) => !localMap.has(msg.uuid));
      const conflicts: ClaudeMessage[] = [];

      localMessages.forEach((msg: ClaudeMessage) => {
        if (remoteMap.has(msg.uuid) && !this.messagesEqual(msg, remoteMap.get(msg.uuid) as ClaudeMessage)) {
          conflicts.push(msg);
        }
      });

      console.log(chalk.bold('\n📊 Sync Comparison Report'));
      console.log('='.repeat(50));
      console.log(`Local messages: ${localMessages.length}`);
      console.log(`Remote messages: ${remoteMessages.length}`);
      console.log(`Local only: ${localOnly.length}`);
      console.log(`Remote only: ${remoteOnly.length}`);
      console.log(`Conflicts: ${conflicts.length}`);

      if (localOnly.length > 0) {
        console.log(chalk.yellow('\n📤 Messages only in local:'));
        localOnly.slice(0, 5).forEach(msg => {
          console.log(`  - ${msg.timestamp} (${msg.costUSD ? `$${msg.costUSD.toFixed(2)}` : 'no cost'})`);
        });
        if (localOnly.length > 5) {
          console.log(`  ... and ${localOnly.length - 5} more`);
        }
      }

      if (remoteOnly.length > 0) {
        console.log(chalk.blue('\n📥 Messages only in remote:'));
        remoteOnly.slice(0, 5).forEach(msg => {
          console.log(`  - ${msg.timestamp} (${msg.costUSD ? `$${msg.costUSD.toFixed(2)}` : 'no cost'})`);
        });
        if (remoteOnly.length > 5) {
          console.log(`  ... and ${remoteOnly.length - 5} more`);
        }
      }

      if (conflicts.length > 0) {
        console.log(chalk.red('\n⚠️  Conflicting messages:'));
        conflicts.slice(0, 5).forEach(msg => {
          console.log(`  - ${msg.uuid} at ${msg.timestamp}`);
        });
        if (conflicts.length > 5) {
          console.log(`  ... and ${conflicts.length - 5} more`);
        }
      }
    } catch (error) {
      logger.error('Error comparing with remote:', error);
      throw error;
    }
  }

  formatSyncReport(report: SyncReport): string {
    const lines: string[] = [
      chalk.bold('🔄 Sync Report'),
      '='.repeat(50),
      '',
      chalk.green(`✅ Total messages after sync: ${report.totalMessages}`),
      chalk.blue(`📥 New messages imported: ${report.newMessages}`),
      chalk.yellow(`🔁 Duplicate messages skipped: ${report.duplicates}`),
    ];

    if (report.conflicts > 0) {
      lines.push(chalk.red(`⚠️  Conflicts resolved: ${report.conflicts}`));
    }

    lines.push(chalk.cyan(`💰 Total cost: $${report.totalCost.toFixed(2)}`));
    lines.push('');
    lines.push(chalk.bold('📱 Synced Machines:'));

    report.machines.forEach(machine => {
      lines.push(`  ${machine.machineName} (${machine.machineId})`);
      lines.push(`    Last sync: ${new Date(machine.lastSync).toLocaleString()}`);
      lines.push(`    Messages: ${machine.messagesCount}`);
      lines.push(`    Cost: $${machine.totalCost.toFixed(2)}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  listAvailableSyncs(): string[] {
    try {
      const files = readdirSync(this.syncDir);
      return files.filter(f => f.startsWith('claude-sync-') && f.endsWith('.json'));
    } catch (error) {
      logger.error('Error listing sync files:', error);
      return [];
    }
  }
}