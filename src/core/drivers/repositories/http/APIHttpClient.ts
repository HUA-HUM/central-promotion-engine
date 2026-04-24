import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { loggerError } from '@core/drivers/logger/Logger';

export interface APIHttpClientConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  service: string;
}

export abstract class APIHttpClient {
  protected constructor(private readonly config: APIHttpClientConfig) {}

  protected async get<T>(path: string, requestConfig?: AxiosRequestConfig): Promise<T> {
    const url = this.buildUrl(path);

    try {
      const response = await this.config.axios.get<T>(url, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      return response.data;
    } catch (error) {
      loggerError(error, null, url, this.config.service);
      throw error;
    }
  }

  protected async post<T>(
    path: string,
    body: unknown,
    requestConfig?: AxiosRequestConfig,
  ): Promise<T> {
    const url = this.buildUrl(path);

    try {
      const response = await this.config.axios.post<T>(url, body, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, this.config.service);
      throw error;
    }
  }

  protected async delete<T>(path: string, requestConfig?: AxiosRequestConfig): Promise<T> {
    const url = this.buildUrl(path);

    try {
      const response = await this.config.axios.delete<T>(url, {
        timeout: this.config.timeout,
        ...requestConfig,
      });
      return response.data;
    } catch (error) {
      loggerError(error, requestConfig?.data ?? null, url, this.config.service);
      throw error;
    }
  }

  private buildUrl(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }
}
