const extractResponseError = (log: Record<string, unknown>, error: any) => {
  return {
    ...log,
    status: error.response?.status,
    data: error.response?.data ?? null,
  };
};

const extractConfigError = (log: Record<string, unknown>, error: any) => {
  return {
    ...log,
    path: error.config?.url ?? log.path,
    status: error.code || 'NETWORK_ERROR',
    data: error.config?.data ?? null,
  };
};

const formatErrorLog = (
  error: any,
  request: unknown,
  path: string,
  services: string,
): Record<string, unknown> => {
  const log: Record<string, unknown> = {
    message: error?.message || 'Unknown error',
    path,
    services,
    request,
    status: 'UNKNOWN',
    data: null,
  };

  if (error?.response) {
    return extractResponseError(log, error);
  }

  if (error?.config) {
    return extractConfigError(log, error);
  }

  return log;
};

export const loggerInfo = ({
  config,
}: {
  config?: {
    method?: string;
    url?: string;
    headers?: Record<string, unknown>;
    data?: unknown;
    message?: string;
    services?: string;
    status?: number | string;
    response?: unknown;
  };
}) => {
  Logger.info(
    JSON.stringify({
      method: config?.method,
      url: config?.url,
      headers: config?.headers,
      body: config?.data ?? null,
      message: config?.message ?? null,
      services: config?.services ?? null,
      status: config?.status ?? null,
      response: config?.response ?? null,
    }),
  );
};

export const loggerError = (error: any, request: unknown, path: string, services: string) => {
  const log = formatErrorLog(error, request, path, services);
  Logger.error(JSON.stringify(log));
};

export class Logger {
  private static formatMessage(level: string, message: string): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      service: process.env.SERVICE_NAME || 'central-promos-enginee',
    });
  }

  public static info(message: string): void {
    process.stdout.write(`${this.formatMessage('info', message)}\n`);
  }

  public static warn(message: string): void {
    process.stdout.write(`${this.formatMessage('warn', message)}\n`);
  }

  public static error(message: string): void {
    process.stderr.write(`${this.formatMessage('error', message)}\n`);
  }

  public static debug(message: string): void {
    process.stdout.write(`${this.formatMessage('debug', message)}\n`);
  }
}
