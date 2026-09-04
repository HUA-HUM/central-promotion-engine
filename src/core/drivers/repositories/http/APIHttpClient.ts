import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';

export interface APIHttpClientConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  service: string;
  metricsLoggingEnabled: boolean;
}

export abstract class APIHttpClient {
  protected constructor(private readonly config: APIHttpClientConfig) {}

  protected async get<T>(path: string, requestConfig?: AxiosRequestConfig): Promise<T> {
    const url = this.buildUrl(path);
    const startedAt = Date.now();

    try {
      const response = await this.config.axios.get<T>(url, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      this.logSuccess('GET', url, response.status, Date.now() - startedAt);
      return response.data;
    } catch (error) {
      loggerError(error, null, url, this.config.service, Date.now() - startedAt);
      throw error;
    }
  }

  protected async post<T>(
    path: string,
    body: unknown,
    requestConfig?: AxiosRequestConfig,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const startedAt = Date.now();

    try {
      const response = await this.config.axios.post<T>(url, body, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      this.logSuccess('POST', url, response.status, Date.now() - startedAt);
      return response.data;
    } catch (error) {
      loggerError(error, body, url, this.config.service, Date.now() - startedAt);
      throw error;
    }
  }

  protected async patch<T>(
    path: string,
    body: unknown,
    requestConfig?: AxiosRequestConfig,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const startedAt = Date.now();

    try {
      const response = await this.config.axios.patch<T>(url, body, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      this.logSuccess('PATCH', url, response.status, Date.now() - startedAt);
      return response.data;
    } catch (error) {
      loggerError(error, body, url, this.config.service, Date.now() - startedAt);
      throw error;
    }
  }

  protected async delete<T>(path: string, requestConfig?: AxiosRequestConfig): Promise<T> {
    const url = this.buildUrl(path);
    const startedAt = Date.now();

    try {
      const response = await this.config.axios.delete<T>(url, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      this.logSuccess('DELETE', url, response.status, Date.now() - startedAt);
      return response.data;
    } catch (error) {
      loggerError(error, requestConfig?.data ?? null, url, this.config.service, Date.now() - startedAt);
      throw error;
    }
  }

  private logSuccess(method: string, url: string, status: number, durationMs: number): void {
    if (!this.config.metricsLoggingEnabled) {
      return;
    }

    loggerInfo({
      config: {
        method,
        url,
        message: 'External API call succeeded',
        services: this.config.service,
        status,
        durationMs,
      },
    });
  }

  private buildUrl(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }
}
