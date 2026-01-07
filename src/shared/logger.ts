/**
 * Structured logging utility for Seer extension
 *
 * Provides consistent log formatting and level-based filtering.
 * Debug logs are only shown when debugMode is enabled in config.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LoggerConfig {
  debugMode: boolean;
  prefix: string;
}

// Default config - can be updated via setConfig
let config: LoggerConfig = {
  debugMode: false,
  prefix: '[Seer]',
};

/**
 * Update logger configuration
 */
export function setLoggerConfig(newConfig: Partial<LoggerConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return config.debugMode;
}

/**
 * Format a log message with consistent styling
 */
function formatMessage(level: LogLevel, module: string, message: string): string {
  const levelLabels: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '🔍',
    [LogLevel.INFO]: 'ℹ️',
    [LogLevel.WARN]: '⚠️',
    [LogLevel.ERROR]: '❌',
  };

  const levelLabel = levelLabels[level];
  const modulePrefix = module ? `[${module}]` : '';
  return `${config.prefix} ${levelLabel} ${modulePrefix} ${message}`;
}

/**
 * Core logging function
 */
function log(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
  // Skip debug logs unless debug mode is enabled
  if (level === LogLevel.DEBUG && !config.debugMode) {
    return;
  }

  const formattedMessage = formatMessage(level, module, message);

  switch (level) {
    case LogLevel.DEBUG:
    case LogLevel.INFO:
      console.log(formattedMessage, ...args);
      break;
    case LogLevel.WARN:
      console.warn(formattedMessage, ...args);
      break;
    case LogLevel.ERROR:
      console.error(formattedMessage, ...args);
      break;
  }
}

/**
 * Create a logger instance for a specific module
 */
export function createLogger(moduleName: string) {
  return {
    debug: (message: string, ...args: unknown[]) => log(LogLevel.DEBUG, moduleName, message, ...args),
    info: (message: string, ...args: unknown[]) => log(LogLevel.INFO, moduleName, message, ...args),
    warn: (message: string, ...args: unknown[]) => log(LogLevel.WARN, moduleName, message, ...args),
    error: (message: string, ...args: unknown[]) => log(LogLevel.ERROR, moduleName, message, ...args),
  };
}

// Pre-created loggers for common modules
export const logger = {
  // Content script modules
  content: createLogger('Content'),
  highlight: createLogger('Highlight'),
  layer: createLogger('Layer'),
  wordActions: createLogger('WordActions'),
  encounter: createLogger('Encounter'),
  review: createLogger('Review'),
  microReview: createLogger('MicroReview'),
  session: createLogger('Session'),

  // Background script modules
  background: createLogger('Background'),
  sync: createLogger('Sync'),
  anki: createLogger('Anki'),
  stats: createLogger('Stats'),

  // UI modules
  popup: createLogger('Popup'),
  options: createLogger('Options'),

  // General
  general: createLogger(''),
};

/**
 * Log a performance measurement
 */
export function logPerformance(module: string, operation: string, startTime: number): void {
  if (!config.debugMode) return;

  const duration = Date.now() - startTime;
  const logger = createLogger(module);
  logger.debug(`${operation} took ${duration}ms`);
}

/**
 * Create a performance timer that logs when stopped
 */
export function createTimer(module: string, operation: string): () => void {
  const startTime = Date.now();
  return () => logPerformance(module, operation, startTime);
}

// Export default logger for simple use cases
export default logger;
