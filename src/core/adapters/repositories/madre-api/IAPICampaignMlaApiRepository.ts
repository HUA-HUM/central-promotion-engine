export interface CampaignMlaExistsItem {
  mla: string;
  exists: boolean;
}

export interface CampaignMlaExistsBulkResponse {
  items: CampaignMlaExistsItem[];
  total: number;
}

export interface CampaignMlaSaveBulkResponse {
  status: string;
  totalReceived: number;
  affectedRows: number;
}

export interface IAPICampaignMlaApiRepository {
  existsBulk(mlas: string[]): Promise<CampaignMlaExistsBulkResponse>;
  saveBulk(mlas: string[]): Promise<CampaignMlaSaveBulkResponse>;
}
