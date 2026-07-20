import type { DigiKeyEnrichmentMatch } from "@/lib/digikey/types";
import type { NormalizationResult, RawDocument, ReviewPatch } from "./types";

const DATABASE_NAME = "ezplm-bom-history";
const STORE_NAME = "tasks";
const DATABASE_VERSION = 1;

export interface StoredBomTask {
  taskId: string;
  createdAt: string;
  updatedAt: string;
  sourceFile: Blob;
  rawDocument: RawDocument;
  result: NormalizationResult;
  patches: ReviewPatch[];
  enrichments: Array<[string, DigiKeyEnrichmentMatch[]]>;
  enrichmentKeys: Array<[string, string]>;
  reviewedLineIds: string[];
  resolvedReviewIds: string[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "taskId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listStoredBomTasks(): Promise<StoredBomTask[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      database.close();
      resolve((request.result as StoredBomTask[]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    };
  });
}

export async function saveStoredBomTask(task: StoredBomTask): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(task);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      database.close();
      resolve();
    };
  });
}
