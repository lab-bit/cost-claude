import { RateConfig } from '../types/index.js';
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

dotenv.config();

export const DEFAULT_RATES: RateConfig = {
  input: 15.00,
  output: 60.00,
  cacheCreation: 15.00,
  cacheRead: 1.50,
  perTokens: 1_000_000,
  currency: 'USD',
  lastUpdated: '2025-05-29',
};

export class Config {
  private static instance: Config;
  private rates: RateConfig;
  private configPath: string;

  private constructor() {
    this.configPath = join(homedir(), '.cost-claude', 'config.json');
    this.rates = this.loadRates();
  }

  static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private loadRates(): RateConfig {
    // Try to load from config file
    if (existsSync(this.configPath)) {
      try {
        const configData = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        return { ...DEFAULT_RATES, ...configData.rates };
      } catch (error) {
        console.warn('Failed to load config file, using defaults');
      }
    }

    // Try to load from environment variables
    const envRates: Partial<RateConfig> = {};
    if (process.env.CLAUDE_RATE_INPUT) {
      envRates.input = parseFloat(process.env.CLAUDE_RATE_INPUT);
    }
    if (process.env.CLAUDE_RATE_OUTPUT) {
      envRates.output = parseFloat(process.env.CLAUDE_RATE_OUTPUT);
    }
    if (process.env.CLAUDE_RATE_CACHE_CREATION) {
      envRates.cacheCreation = parseFloat(process.env.CLAUDE_RATE_CACHE_CREATION);
    }
    if (process.env.CLAUDE_RATE_CACHE_READ) {
      envRates.cacheRead = parseFloat(process.env.CLAUDE_RATE_CACHE_READ);
    }

    return { ...DEFAULT_RATES, ...envRates };
  }

  getRates(): RateConfig {
    return this.rates;
  }

  updateRates(newRates: Partial<RateConfig>): void {
    this.rates = { ...this.rates, ...newRates, lastUpdated: new Date().toISOString() };
  }

  getClaudeProjectsPath(): string {
    return process.env.CLAUDE_PROJECTS_PATH || join(homedir(), '.claude', 'projects');
  }

  getNotificationSettings() {
    return {
      enabled: process.env.NOTIFICATIONS_ENABLED !== 'false',
      soundEnabled: process.env.NOTIFICATIONS_SOUND !== 'false',
      minimumCost: parseFloat(process.env.NOTIFICATIONS_MIN_COST || '0.01'),
      groupBySession: process.env.NOTIFICATIONS_GROUP_BY_SESSION !== 'false',
    };
  }

  getWatcherSettings() {
    return {
      pollInterval: parseInt(process.env.WATCHER_POLL_INTERVAL || '100', 10),
      debounceDelay: parseInt(process.env.WATCHER_DEBOUNCE_DELAY || '500', 10),
      ignoreInitial: process.env.WATCHER_IGNORE_INITIAL !== 'false',
    };
  }
}