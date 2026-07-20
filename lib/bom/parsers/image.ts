import type { ParseProgress, RawTable } from "../types";
import { SOURCE_LIMITS } from "../security";
import { parseImageWithOcr } from "./ocr";

export async function parseImage(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<RawTable[]> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > SOURCE_LIMITS.maxImagePixels) {
      throw new Error("SOURCE_FILE_TOO_LARGE");
    }
  } finally {
    bitmap.close();
  }
  return [await parseImageWithOcr(file, "image", file.name, onProgress)];
}
