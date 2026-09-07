const extractResponseError = (log: Record<string, unknown>, error: any) => {
  return {
    ...log,
    httpStatus: error.response?.status,
    data: error.response?.data ?? null,
  };
};

const extractConfigError = (log: Record<string, unknown>, error: any) => {
  return {
    ...log,
    path: error.config?.url ?? log.path,
    httpStatus: error.code || 'NETWORK_ERROR',
    data: error.config?.data ?? null,
  };
};

const formatErrorLog = (
  error: any,
  request: unknown,
  path: string,
  services: string,
  durationMs?: number,
): Record<string, unknown> => {
  const log: Record<string, unknown> = {
    message: error?.message || 'Unknown error',
    path,
    services,
    request,
    httpStatus: 'UNKNOWN',
    data: null,
    durationMs: durationMs ?? null,
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
    durationMs?: number;
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
      httpStatus: config?.status ?? null,
      response: config?.response ?? null,
      durationMs: config?.durationMs ?? null,
    }),
  );
};

export const loggerError = (
  error: any,
  request: unknown,
  path: string,
  services: string,
  durationMs?: number,
) => {
  const log = formatErrorLog(error, request, path, services, durationMs);
  Logger.error(JSON.stringify(log));
};

const LEVEL_WEIGHT: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Sin esto `debug` iba igual a stdout y de ahi a Datadog, asi que no servia
// para bajar volumen. Default 'info': el comportamiento de info/warn/error no
// cambia, solo se puede silenciar debug (o subir el piso) via LOG_LEVEL.
const MIN_LEVEL_WEIGHT =
  LEVEL_WEIGHT[(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? LEVEL_WEIGHT.info;

export class Logger {
  private static isEnabled(level: string): boolean {
    return (LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info) >= MIN_LEVEL_WEIGHT;
  }

  private static formatMessage(level: string, message: string): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      service: process.env.SERVICE_NAME || 'central-promos-enginee',
    });
  }

  public static info(message: string): void {
    if (!this.isEnabled('info')) return;
    process.stdout.write(`${this.formatMessage('info', message)}\n`);
  }

  public static warn(message: string): void {
    if (!this.isEnabled('warn')) return;
    process.stdout.write(`${this.formatMessage('warn', message)}\n`);
  }

  public static error(message: string): void {
    if (!this.isEnabled('error')) return;
    process.stderr.write(`${this.formatMessage('error', message)}\n`);
  }

  public static debug(message: string): void {
    if (!this.isEnabled('debug')) return;
    process.stdout.write(`${this.formatMessage('debug', message)}\n`);
  }
}
