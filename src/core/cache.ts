import type { DealView } from "./normalize.js";

export interface CachedMonth {
  deals: DealView[];
  /** 받은 시각 (epoch ms) */
  fetchedAt: number;
}

/** (서비스, 시군구, 계약년월) 단위 캐시. 디스크나 DB로 바꿔 끼울 수 있다 */
export interface CacheStore {
  get(key: string): CachedMonth | undefined;
  set(key: string, value: CachedMonth): void;
}

/** 프로세스 메모리 LRU. 크기는 JSON 길이로 어림한다 */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: CachedMonth; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  get(key: string): CachedMonth | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // 최근에 쓴 항목을 뒤로 보낸다
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: CachedMonth): void {
    const bytes = JSON.stringify(value).length;
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    for (const [k, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= entry.bytes;
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
