import { RateConfig } from '../types/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import fetch from 'node-fetch';

export interface ModelPricing {
  modelId: string;
  modelName: string;
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
  perTokens: number;
  currency: string;
  lastUpdated: string;
  source: 'remote' | 'local' | 'default';
}

export interface PricingCache {
  models: Record<string, ModelPricing>;
  lastFetch: string;
  expiresAt: string;
}

// Default Claude model pricing (per million tokens)
const DEFAULT_CLAUDE_PRICING: Record<string, Omit<ModelPricing, 'lastUpdated' | 'source'>> = {
  'claude-opus-4-20250514': {
    modelId: 'claude-opus-4-20250514',
    modelName: 'Claude Opus 4',
    input: 15.00,
    output: 60.00,
    cacheCreation: 15.00,
    cacheRead: 1.50,
    perTokens: 1_000_000,
    currency: 'USD',
  },
  'claude-3-opus-20240229': {
    modelId: 'claude-3-opus-20240229',
    modelName: 'Claude 3 Opus',
    input: 15.00,
    output: 75.00,
    cacheCreation: 18.75,
    cacheRead: 1.875,
    perTokens: 1_000_000,
    currency: 'USD',
  },
  'claude-3-5-sonnet-20241022': {
    modelId: 'claude-3-5-sonnet-20241022',
    modelName: 'Claude 3.5 Sonnet',
    input: 3.00,
    output: 15.00,
    cacheCreation: 3.75,
    cacheRead: 0.30,
    perTokens: 1_000_000,
    currency: 'USD',
  },
  'claude-3-5-haiku-20241022': {
    modelId: 'claude-3-5-haiku-20241022',
    modelName: 'Claude 3.5 Haiku',
    input: 1.00,
    output: 5.00,
    cacheCreation: 1.25,
    cacheRead: 0.10,
    perTokens: 1_000_000,
    currency: 'USD',
  },
};

export class PricingService {
  private static instance: PricingService;
  private cachePath: string;
  private cacheDir: string;
  private currentModel: string;
  private cache: PricingCache | null = null;
  private readonly CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 1 month
  private readonly PRICING_URLS = [
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    // Add more URLs as fallbacks
  ];

  private constructor(model: string = 'claude-opus-4-20250514') {
    this.currentModel = model;
    this.cacheDir = join(homedir(), '.cost-claude', 'cache');
    this.cachePath = join(this.cacheDir, 'pricing-cache.json');
    this.ensureCacheDirectory();
    this.loadCache();
  }

  static getInstance(model?: string): PricingService {
    if (!PricingService.instance) {
      PricingService.instance = new PricingService(model);
    } else if (model && model !== PricingService.instance.currentModel) {
      PricingService.instance.setModel(model);
    }
    return PricingService.instance;
  }

  private ensureCacheDirectory(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadCache(): void {
    if (existsSync(this.cachePath)) {
      try {
        const cacheData = JSON.parse(readFileSync(this.cachePath, 'utf-8'));
        const expiresAt = new Date(cacheData.expiresAt);
        
        if (expiresAt > new Date()) {
          this.cache = cacheData;
        } else {
          console.info('Pricing cache expired, will refresh');
        }
      } catch (error) {
        console.warn('Failed to load pricing cache:', error);
      }
    }
  }

  private saveCache(): void {
    if (this.cache) {
      try {
        writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
      } catch (error) {
        console.error('Failed to save pricing cache:', error);
      }
    }
  }

  private async fetchRemotePricing(): Promise<Record<string, ModelPricing> | null> {
    for (const url of this.PRICING_URLS) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;

        // const data = await response.json();
        // TODO: Parse the pricing data when a proper Claude pricing source is available
        // For now, we'll use our default pricing
        
        return null; // For now, since the URL doesn't have Claude models
      } catch (error) {
        console.warn(`Failed to fetch pricing from ${url}:`, error);
      }
    }
    return null;
  }

  private getDefaultPricing(): Record<string, ModelPricing> {
    const models: Record<string, ModelPricing> = {};
    const now = new Date().toISOString();

    for (const [modelId, pricing] of Object.entries(DEFAULT_CLAUDE_PRICING)) {
      models[modelId] = {
        ...pricing,
        lastUpdated: now,
        source: 'default',
      };
    }

    return models;
  }

  async refreshPricing(): Promise<void> {
    // Try to fetch remote pricing
    const remotePricing = await this.fetchRemotePricing();
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.CACHE_DURATION_MS);

    if (remotePricing && Object.keys(remotePricing).length > 0) {
      this.cache = {
        models: remotePricing,
        lastFetch: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    } else {
      // Fall back to default pricing
      this.cache = {
        models: this.getDefaultPricing(),
        lastFetch: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    }

    this.saveCache();
  }

  async ensurePricing(): Promise<void> {
    if (!this.cache || new Date(this.cache.expiresAt) <= new Date()) {
      await this.refreshPricing();
    }
  }

  async getPricing(modelId?: string): Promise<ModelPricing | null> {
    await this.ensurePricing();
    
    const targetModel = modelId || this.currentModel;
    
    if (!this.cache) {
      const defaults = this.getDefaultPricing();
      return defaults[targetModel] || null;
    }

    return this.cache.models[targetModel] || null;
  }

  async getRateConfig(modelId?: string): Promise<RateConfig | null> {
    const pricing = await this.getPricing(modelId);
    
    if (!pricing) {
      return null;
    }

    return {
      input: pricing.input,
      output: pricing.output,
      cacheCreation: pricing.cacheCreation || pricing.input,
      cacheRead: pricing.cacheRead || pricing.input * 0.1,
      perTokens: pricing.perTokens,
      currency: pricing.currency,
      lastUpdated: pricing.lastUpdated,
    };
  }

  async getAllModels(): Promise<ModelPricing[]> {
    await this.ensurePricing();
    
    if (!this.cache) {
      return Object.values(this.getDefaultPricing());
    }

    return Object.values(this.cache.models);
  }

  setModel(modelId: string): void {
    this.currentModel = modelId;
  }

  getModel(): string {
    return this.currentModel;
  }

  async addCustomPricing(pricing: ModelPricing): Promise<void> {
    await this.ensurePricing();
    
    if (!this.cache) {
      this.cache = {
        models: {},
        lastFetch: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.CACHE_DURATION_MS).toISOString(),
      };
    }

    this.cache.models[pricing.modelId] = {
      ...pricing,
      source: 'local',
      lastUpdated: new Date().toISOString(),
    };

    this.saveCache();
  }

  clearCache(): void {
    this.cache = null;
    if (existsSync(this.cachePath)) {
      try {
        // Don't delete, just invalidate by setting expiry to past
        const invalidCache: PricingCache = {
          models: {},
          lastFetch: new Date().toISOString(),
          expiresAt: new Date(0).toISOString(),
        };
        writeFileSync(this.cachePath, JSON.stringify(invalidCache, null, 2));
      } catch (error) {
        console.error('Failed to clear cache:', error);
      }
    }
  }
}