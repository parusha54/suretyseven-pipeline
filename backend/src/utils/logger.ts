export const logger = {
  info: (message: string, meta: Record<string, any> = {}) => {
    const payload = { level: 'INFO', timestamp: new Date().toISOString(), message, ...meta };
    console.log(`[INFO] ${message}`, JSON.stringify(payload));
  },
  error: (message: string, meta: Record<string, any> = {}) => {
    const payload = { level: 'ERROR', timestamp: new Date().toISOString(), message, ...meta };
    console.error(`[ERROR] ${message}`, JSON.stringify(payload));
  },
  warn: (message: string, meta: Record<string, any> = {}) => {
    const payload = { level: 'WARN', timestamp: new Date().toISOString(), message, ...meta };
    console.warn(`[WARN] ${message}`, JSON.stringify(payload));
  }
};
