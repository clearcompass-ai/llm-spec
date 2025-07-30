import { customProvider } from 'ai';
import { LarsLanguageModel } from './lars-language-model';

/**
 * Defines the configuration for the LARS custom provider.
 * This allows for setting a global base URL for the API.
 */
export interface LarsProviderSettings {
  /**
   * The base URL of the LARS backend API.
   * If not provided, it will default to the `LARS_API_BASE_URL`
   * environment variable or 'http://127.0.0.1:8000' for local development.
   */
  baseURL?: string;
}

/**
 * Creates a new instance of the LARS provider.
 * This factory function allows for custom configuration, such as setting a
 * different base URL for the API, which is useful for different environments
 * (e.g., staging vs. production).
 *
 * @param settings - Optional configuration for the provider.
 * @returns A Vercel AI SDK-compliant custom provider for LARS models.
 */
export function createLars(settings: LarsProviderSettings = {}) {
  // This is the central registry for all LARS domain experts.
  // To add a new expert (e.g., "corporate_law"), simply add a new entry here.
  const languageModels = {
    /**
     * The "caselaw" model, which provides deep, multi-step analysis
     * of a single legal document via the LegalAnalysisAgent on the backend.
     */
    caselaw: new LarsLanguageModel({
      modelId: 'caselaw',
      baseURL: settings.baseURL,
    }),

    /**
     * Example of how a future "corporate_law" expert would be registered.
     *
     * 'corporate_law': new LarsLanguageModel({
     * modelId: 'corporate_law',
     * baseURL: settings.baseURL,
     * }),
     */
  };

  return customProvider({
    // The provider ID is used for namespacing if you were to use a provider registry.
    // E.g., `registry.languageModel('lars:caselaw')`
    providerId: 'lars',
    languageModels,
  });
}

/**
 * NOTE: The default, singleton instance has been removed to prevent
 * potential module initialization errors. The provider should be instantiated
 * within the application's entry point or test script.
 */
