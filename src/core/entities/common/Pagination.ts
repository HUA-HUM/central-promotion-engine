export interface PaginationParams {
  limit: number;
  offset: number;
}

export class PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  count: number;
  hasNext: boolean;
  nextOffset: number | null;

  constructor(params: {
    items: T[];
    total: number;
    limit: number;
    offset: number;
  }) {
    this.items = params.items;
    this.total = params.total;
    this.limit = params.limit;
    this.offset = params.offset;
    this.count = params.items.length;
    this.hasNext = params.offset + params.items.length < params.total;
    this.nextOffset = this.hasNext ? params.offset + params.limit : null;
  }
}