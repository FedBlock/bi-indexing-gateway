// 타입 정의 (TypeScript 지원용)

/**
 * BI-Indexing API 응답 타입
 */
export interface SearchResult {
  success: boolean;
  data: {
    method: string;
    network: string;
    purpose?: string;
    totalCount?: number;
    processingTime?: string;
    transactions?: Transaction[];
    requests?: Request[];
  };
  error?: string;
}

export interface Transaction {
  txId: string;
  purpose: string;
  organizationName: string;
  resourceOwner: string;
  blockNumber: number;
  status: string;
  date: string;
}

export interface Request {
  requestId: number;
  purpose: string;
  organizationName: string;
  requester: string;
  resourceOwner: string;
  status: string;
}

/**
 * Hook 설정 타입
 */
export interface BiIndexingConfig {
  baseURL?: string;
  defaultNetwork?: string;
  timeout?: number;
}

/**
 * 검색 옵션 타입
 */
export interface SearchOptions {
  network?: string;
  contractAddress?: string;
  pageSize?: number;
}