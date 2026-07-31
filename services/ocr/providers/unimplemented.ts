import type { OcrProvider } from "../provider";

// Stubs proving the provider interface is genuinely provider-agnostic —
// swapping OCR_PROVIDER to one of these requires only filling in `extract`,
// no changes anywhere else in the app (route handler, service, UI).
function unimplemented(name: string): OcrProvider {
  return {
    name,
    async extract() {
      throw new Error(`OCR provider "${name}" is not implemented yet. Set OCR_PROVIDER=tesseract, or implement this provider.`);
    },
  };
}

export const azureProvider = unimplemented("azure");
export const googleVisionProvider = unimplemented("google-vision");
export const textractProvider = unimplemented("aws-textract");
