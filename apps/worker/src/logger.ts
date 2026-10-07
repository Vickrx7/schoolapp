/** Minimal structured logger (JSON lines) so logs are easy to ship anywhere. */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const write = (level: string, message: string, data?: Record<string, unknown>) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...data });
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}
