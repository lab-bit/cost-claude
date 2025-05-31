import { TokenUsage, RateConfig, CostBreakdown } from '../types/index.js';
import { Config } from '../config/index.js';
import { PricingService } from '../services/pricing-service.js';

export class CostCalculator {
  private rates: RateConfig;
  private pricingService: PricingService;
  private model: string;

  constructor(customRates?: Partial<RateConfig>, model?: string) {
    const config = Config.getInstance();
    this.model = model || 'claude-opus-4-20250514';
    this.pricingService = PricingService.getInstance(this.model);
    this.rates = customRates ? { ...config.getRates(), ...customRates } : config.getRates();
    this.initializeRates();
  }

  private async initializeRates(): Promise<void> {
    try {
      const pricingConfig = await this.pricingService.getRateConfig(this.model);
      if (pricingConfig) {
        this.rates = pricingConfig;
      }
    } catch (error) {
      console.warn('Failed to load pricing from service, using defaults:', error);
    }
  }

  /**
   * Calculate the cost based on token usage
   */
  calculate(usage: Partial<TokenUsage>): number {
    const cost =
      (usage.input_tokens || 0) * this.getRate('input') +
      (usage.output_tokens || 0) * this.getRate('output') +
      (usage.cache_creation_input_tokens || 0) * this.getRate('cacheCreation') +
      (usage.cache_read_input_tokens || 0) * this.getRate('cacheRead');

    return cost;
  }

  /**
   * Calculate detailed cost breakdown
   */
  calculateBreakdown(usage: Partial<TokenUsage>): CostBreakdown {
    const inputTokensCost = (usage.input_tokens || 0) * this.getRate('input');
    const outputTokensCost = (usage.output_tokens || 0) * this.getRate('output');
    const cacheCreationCost = (usage.cache_creation_input_tokens || 0) * this.getRate('cacheCreation');
    const cacheReadCost = (usage.cache_read_input_tokens || 0) * this.getRate('cacheRead');

    return {
      inputTokensCost,
      outputTokensCost,
      cacheCreationCost,
      cacheReadCost,
      totalCost: inputTokensCost + outputTokensCost + cacheCreationCost + cacheReadCost,
    };
  }

  /**
   * Calculate cache efficiency percentage
   * Cache efficiency is the percentage of input tokens that were served from cache
   * versus the total tokens that could have been cached (cache_creation + cache_read)
   */
  calculateCacheEfficiency(usage: Partial<TokenUsage>): number {
    const cacheableTokens = 
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    if (cacheableTokens === 0) return 0;

    const cacheHits = usage.cache_read_input_tokens || 0;
    return (cacheHits / cacheableTokens) * 100;
  }

  /**
   * Calculate cost savings from cache usage
   * This includes both the savings from cache reads and the overhead from cache creation
   */
  calculateCacheSavings(usage: Partial<TokenUsage>): number {
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
    
    // Savings: difference between normal input cost and cache read cost
    const normalReadCost = cacheReadTokens * this.getRate('input');
    const cacheReadCost = cacheReadTokens * this.getRate('cacheRead');
    const readSavings = normalReadCost - cacheReadCost;
    
    // Overhead: difference between cache creation cost and normal input cost
    const normalCreationCost = cacheCreationTokens * this.getRate('input');
    const cacheCreationCost = cacheCreationTokens * this.getRate('cacheCreation');
    const creationOverhead = cacheCreationCost - normalCreationCost;
    
    // Net savings = read savings - creation overhead
    return readSavings - creationOverhead;
  }

  /**
   * Format cost as currency string
   */
  formatCost(cost: number): string {
    return `$${cost.toFixed(4)}`;
  }

  /**
   * Format cost with appropriate precision based on amount
   */
  formatCostAdaptive(cost: number): string {
    if (cost >= 10) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 1) {
      return `$${cost.toFixed(3)}`;
    } else {
      return `$${cost.toFixed(4)}`;
    }
  }

  /**
   * Get rate per token (not per million)
   */
  private getRate(type: keyof Omit<RateConfig, 'perTokens' | 'currency' | 'lastUpdated'>): number {
    return this.rates[type] / this.rates.perTokens;
  }

  /**
   * Update rates
   */
  updateRates(newRates: Partial<RateConfig>): void {
    this.rates = { ...this.rates, ...newRates };
  }

  /**
   * Get current rates configuration
   */
  getRates(): RateConfig {
    return { ...this.rates };
  }

  /**
   * Estimate cost for a given text (rough approximation)
   * Assumes ~4 characters per token on average
   */
  estimateCostFromText(inputText: string, outputText: string): number {
    const inputTokens = Math.ceil(inputText.length / 4);
    const outputTokens = Math.ceil(outputText.length / 4);

    return this.calculate({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  }

  /**
   * Ensure rates are loaded from pricing service
   */
  async ensureRatesLoaded(): Promise<void> {
    await this.initializeRates();
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelId: string): Promise<void> {
    this.model = modelId;
    this.pricingService.setModel(modelId);
    await this.initializeRates();
  }

  /**
   * Get current model ID
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Refresh pricing from remote source
   */
  async refreshPricing(): Promise<void> {
    await this.pricingService.refreshPricing();
    await this.initializeRates();
  }
}