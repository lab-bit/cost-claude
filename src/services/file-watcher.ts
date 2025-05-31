import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname } from 'path';
import { ClaudeMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface WatcherConfig {
  paths: string[];
  pollInterval?: number;
  debounceDelay?: number;
  ignoreInitial?: boolean;
}

export interface FileChange {
  path: string;
  type: 'add' | 'change';
  timestamp: Date;
}

export class ClaudeFileWatcher extends EventEmitter {
  private watcher?: chokidar.FSWatcher;
  private filePositions: Map<string, number> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stateFile: string;

  constructor(private config: WatcherConfig) {
    super();
    // Store state file in home directory
    this.stateFile = `${homedir()}/.cost-claude/watcher-state.json`;
    this.loadFilePositions();
  }

  async start(): Promise<void> {
    const expandedPaths = this.expandPaths(this.config.paths);
    logger.debug('Starting file watcher', { paths: expandedPaths });

    // When including existing files, we need to process them differently
    const ignoreInitial = this.config.ignoreInitial ?? true;
    
    // Log the glob patterns being watched
    logger.debug('Watch patterns:', expandedPaths);
    
    // Check if any files exist that match the pattern (for debugging)
    try {
      const glob = await import('glob');
      for (const pattern of expandedPaths) {
        const matches = await glob.glob(pattern);
        logger.debug(`Pattern "${pattern}" matches ${matches.length} files:`, matches.slice(0, 5));
      }
    } catch (error) {
      logger.debug('Could not check pattern matches:', error);
    }
    
    // Extract base directories from the glob patterns
    const watchPaths = expandedPaths.map(pattern => {
      // For patterns like "/path/**/*.jsonl", extract "/path"
      const baseDir = pattern.split('/**')[0] || pattern.split('/*')[0] || pattern;
      return baseDir;
    });
    
    logger.debug('Watching base directories:', watchPaths);
    
    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: ignoreInitial,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: this.config.pollInterval ?? 100,
      },
      // Add more options for better detection
      usePolling: true,
      interval: 100,
      atomic: true,  // Handle atomic writes
      alwaysStat: true,  // Always pass stats
      // Add depth for recursive watching
      depth: 99,
      // Follow symlinks
      followSymlinks: true,
      // Only watch .jsonl files
      ignored: (path: string) => {
        // Ignore non-JSONL files
        return !path.endsWith('.jsonl') && !this.isDirectory(path);
      }
    });

    this.watcher
      .on('add', (path) => {
        logger.debug(`File added event: ${path}`);
        this.handleFileAdd(path);
      })
      .on('change', (path) => {
        logger.debug(`File change event: ${path}`);
        this.handleFileChange(path);
      })
      .on('error', (error) => {
        logger.error('Watcher error:', error);
        this.emit('error', error);
      })
      .on('ready', async () => {
        logger.debug('Watcher is ready and watching for changes');
        
        // Log all watched paths
        const watched = this.watcher?.getWatched();
        if (watched) {
          const totalFiles = Object.values(watched).flat().length;
          logger.debug(`Watching ${totalFiles} files across ${Object.keys(watched).length} directories`);
        }
        
        // If not ignoring initial files, process existing files
        if (!ignoreInitial && watched) {
          logger.debug('Processing existing files...');
          for (const [dir, files] of Object.entries(watched)) {
            for (const file of files) {
              if (file.endsWith('.jsonl')) {
                const fullPath = `${dir}/${file}`;
                logger.debug(`Processing existing file: ${fullPath}`);
                await this.handleFileAdd(fullPath);
              }
            }
          }
        }
      });

    this.emit('started');
    logger.debug('File watcher started successfully');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      await this.saveFilePositions();
      this.emit('stopped');
      logger.debug('File watcher stopped');
    }
  }

  private expandPaths(paths: string[]): string[] {
    return paths.map((p) => p.replace('~', homedir()));
  }

  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    // Ensure it's a JSONL file
    if (!filePath.endsWith('.jsonl')) {
      logger.debug(`Ignoring non-JSONL file: ${filePath}`);
      return;
    }
    
    logger.debug(`New file detected: ${filePath}`);
    this.emit('file-added', filePath);

    this.debounce(filePath, async () => {
      try {
        // For new files, check if we should start from beginning or saved position
        const lastPosition = this.config.ignoreInitial ? this.filePositions.get(filePath) || 0 : 0;
        logger.debug(`Reading file from position ${lastPosition}: ${filePath}`);
        const messages = await this.readNewMessages(filePath, lastPosition);
        
        if (messages.length > 0) {
          logger.debug(`Processing ${messages.length} messages from new file: ${filePath}`);
          messages.forEach((msg) => this.emit('new-message', msg));
        } else {
          logger.debug(`No new messages in file: ${filePath}`);
        }
      } catch (error) {
        logger.error(`Error processing new file ${filePath}:`, error);
        this.emit('error', error);
      }
    });
  }

  private async handleFileChange(filePath: string): Promise<void> {
    // Ensure it's a JSONL file
    if (!filePath.endsWith('.jsonl')) {
      logger.debug(`Ignoring change in non-JSONL file: ${filePath}`);
      return;
    }
    
    logger.debug('File changed:', filePath);

    this.debounce(filePath, async () => {
      try {
        const lastPosition = this.filePositions.get(filePath) || 0;
        logger.debug(`Checking for new messages from position ${lastPosition} in ${filePath}`);
        const messages = await this.readNewMessages(filePath, lastPosition);
        
        if (messages.length > 0) {
          logger.debug(`Found ${messages.length} new messages in ${filePath}`);
          messages.forEach((msg) => this.emit('new-message', msg));
        } else {
          logger.debug(`No new messages found in ${filePath} from position ${lastPosition}`);
        }
      } catch (error) {
        logger.error(`Error processing file change ${filePath}:`, error);
        this.emit('error', error);
      }
    });
  }

  private debounce(key: string, fn: () => Promise<void>): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      try {
        await fn();
      } catch (error) {
        logger.error('Debounced function error:', error);
        this.emit('error', error);
      }
      this.debounceTimers.delete(key);
    }, this.config.debounceDelay ?? 500);

    this.debounceTimers.set(key, timer);
  }

  private async readNewMessages(filePath: string, fromPosition: number): Promise<ClaudeMessage[]> {
    try {
      // Check if file exists
      if (!existsSync(filePath)) {
        logger.warn(`File does not exist: ${filePath}`);
        return [];
      }
      
      const content = await readFile(filePath, 'utf-8');
      const fileSize = Buffer.byteLength(content);
      
      logger.debug(`Reading file ${filePath}:`, {
        fileSize,
        fromPosition,
        contentLength: content.length
      });
      
      // If position is beyond file size, we've already read everything
      if (fromPosition >= fileSize) {
        logger.debug(`Position ${fromPosition} is at or beyond file size ${fileSize}, nothing new to read`);
        return [];
      }
      
      const lines = content.split('\n');
      
      const messages: ClaudeMessage[] = [];
      let currentPosition = 0;
      let lineNumber = 0;

      for (const line of lines) {
        lineNumber++;
        
        // Skip empty lines
        if (!line.trim()) {
          // Still need to update position for empty lines
          currentPosition += Buffer.byteLength(line) + (lineNumber < lines.length ? 1 : 0);
          continue;
        }

        // Calculate start position of this line
        const lineStartPosition = currentPosition;
        const lineBytes = Buffer.byteLength(line);
        const newlineBytes = lineNumber < lines.length ? 1 : 0;
        currentPosition += lineBytes + newlineBytes;

        // Skip if this line was already processed
        if (lineStartPosition < fromPosition) {
          continue;
        }

        try {
          const parsed = JSON.parse(line) as ClaudeMessage;
          messages.push(parsed);
          logger.debug(`Parsed message from line ${lineNumber}`, { 
            uuid: parsed.uuid,
            type: parsed.type,
            position: currentPosition 
          });
        } catch (error) {
          logger.warn('Failed to parse line', {
            file: filePath,
            lineNumber,
            position: currentPosition,
            error: error instanceof Error ? error.message : error,
          });
          this.emit('parse-error', { filePath, line, error });
        }
      }

      // Save the final position
      const finalPosition = Buffer.byteLength(content);
      this.filePositions.set(filePath, finalPosition);
      
      // Save positions immediately after reading
      await this.saveFilePositions();
      
      logger.debug(`Read ${messages.length} new messages from ${filePath} (from: ${fromPosition}, to: ${finalPosition}, lines: ${lines.length})`);

      return messages;
    } catch (error) {
      logger.error('Error reading file:', { filePath, error });
      throw error;
    }
  }

  private async loadFilePositions(): Promise<void> {
    try {
      if (existsSync(this.stateFile)) {
        const data = await readFile(this.stateFile, 'utf-8');
        this.filePositions = new Map(JSON.parse(data));
        logger.debug('Loaded file positions', { count: this.filePositions.size });
      }
    } catch (error) {
      logger.warn('Failed to load file positions:', error);
      // Continue with empty state
    }
  }

  private async saveFilePositions(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.stateFile);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      
      const data = JSON.stringify([...this.filePositions]);
      await writeFile(this.stateFile, data);
      logger.debug('Saved file positions', { count: this.filePositions.size });
    } catch (error) {
      logger.error('Failed to save file positions:', error);
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      watchedFiles: this.filePositions.size,
      totalBytesRead: Array.from(this.filePositions.values()).reduce((sum, pos) => sum + pos, 0),
    };
  }

  /**
   * Reset file positions (useful for reprocessing)
   */
  async resetPositions(): Promise<void> {
    this.filePositions.clear();
    await this.saveFilePositions();
    logger.debug('Reset all file positions');
  }
}