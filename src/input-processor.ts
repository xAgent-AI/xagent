import clipboardy from 'clipboardy';
import { InputType } from './types.js';

export class InputProcessor {
  private maxTextLength: number = 800;
  private maxDisplayLength: number = 5000;

  async processInput(input: string): Promise<InputType[]> {
    const inputs: InputType[] = [];
    let remaining = input;

    if (this.isImagePaste(input)) {
      const imageInputs = await this.processImageInput(input);
      inputs.push(...imageInputs);
      remaining = '';
    }

    if (this.isLargeText(remaining)) {
      const textInputs = this.processLargeText(remaining);
      inputs.push(...textInputs);
      remaining = '';
    }

    if (remaining.trim()) {
      inputs.push({
        type: 'text',
        content: remaining.trim()
      });
    }

    return inputs;
  }

  private isImagePaste(input: string): boolean {
    return input.includes('[Pasted image') || 
           input.includes('<image') ||
           input.includes('data:image');
  }

  private async hasImageClipboard(): Promise<boolean> {
    try {
      const clipboardContent = await clipboardy.read();
      return clipboardContent.startsWith('data:image') || 
             clipboardContent.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i) !== null;
    } catch {
      return false;
    }
  }

  private async processImageInput(input: string): Promise<InputType[]> {
    const imageInputs: InputType[] = [];
    const imageRegex = /\[Pasted image #(\d+)\]/g;
    let match;

    while ((match = imageRegex.exec(input)) !== null) {
      const imageId = match[1];
      
      try {
        const imageData = await this.getImageFromClipboard(imageId);
        
        imageInputs.push({
          type: 'image',
          content: imageData,
          metadata: {
            id: imageId,
            timestamp: Date.now()
          }
        });
      } catch (error) {
        console.warn(`[input-processor] Failed to process image #${imageId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return imageInputs;
  }

  private async getImageFromClipboard(_imageId: string): Promise<string> {
    try {
      const clipboardContent = await clipboardy.read();
      
      if (clipboardContent.startsWith('data:image')) {
        return clipboardContent;
      }

      const imageData = await this.readImageFile(clipboardContent);
      return imageData;
    } catch {
      throw new Error('Failed to read image from clipboard');
    }
  }

  private async readImageFile(filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const absolutePath = path.resolve(filePath);
      const buffer = await fs.readFile(absolutePath);
      const base64 = buffer.toString('base64');
      const mimeType = this.getMimeType(filePath);
      
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read image file ${filePath}: ${errorMsg}`);
    }
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };

    return mimeTypes[ext || ''] || 'image/png';
  }

  private isLargeText(text: string): boolean {
    return text.length > this.maxTextLength;
  }

  private processLargeText(text: string): InputType[] {
    const inputs: InputType[] = [];
    const lines = text.split('\n');
    const lineCount = lines.length;

    if (lineCount > 10) {
      const placeholder = this.createTextPlaceholder(lineCount);
      
      inputs.push({
        type: 'text',
        content: placeholder,
        metadata: {
          originalText: text,
          lineCount,
          charCount: text.length
        }
      });
    } else {
      inputs.push({
        type: 'text',
        content: text
      });
    }

    return inputs;
  }

  private createTextPlaceholder(lineCount: number): string {
    return `[Pasted text #${Date.now()} +${lineCount} lines]`;
  }

  getOriginalText(placeholder: string): string | null {
    const match = placeholder.match(/\[Pasted text #\d+ \+(\d+) lines\]/);
    
    if (match) {
      return match[1];
    }

    return null;
  }

  formatForDisplay(text: string): string {
    if (text.length <= this.maxDisplayLength) {
      return text;
    }

    const prefix = text.substring(0, 2000);
    const suffix = text.substring(text.length - 2000);
    const omitted = text.length - 4000;

    return `${prefix}\n\n[... ${omitted} characters omitted ...]\n\n${suffix}`;
  }

  async detectAndProcessClipboard(): Promise<InputType[]> {
    try {
      const clipboardContent = await clipboardy.read();
      
      if (!clipboardContent || clipboardContent.trim().length === 0) {
        return [];
      }

      if (clipboardContent.startsWith('data:image')) {
        return [{
          type: 'image',
          content: clipboardContent,
          metadata: {
            timestamp: Date.now()
          }
        }];
      }

      if (this.isLargeText(clipboardContent)) {
        return this.processLargeText(clipboardContent);
      }

      return [{
        type: 'text',
        content: clipboardContent
      }];
    } catch (error) {
      console.warn(`[input-processor] Failed to read clipboard: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  validateImageFormat(imageData: string): boolean {
    const supportedFormats = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'bmp'];
    
    if (imageData.startsWith('data:image')) {
      const format = imageData.match(/data:image\/(\w+);/);
      
      if (format) {
        const mimeType = format[1].toLowerCase();
        return supportedFormats.includes(mimeType);
      }
    }

    return false;
  }

  extractImageMetadata(imageData: string): { width?: number; height?: number; format?: string } | null {
    if (!imageData.startsWith('data:image')) {
      return null;
    }

    const formatMatch = imageData.match(/data:image\/(\w+);/);
    
    if (!formatMatch) {
      return null;
    }

    return {
      format: formatMatch[1]
    };
  }

  async convertImageToBase64(filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const absolutePath = path.resolve(filePath);
      const buffer = await fs.readFile(absolutePath);
      const base64 = buffer.toString('base64');
      const mimeType = this.getMimeType(filePath);
      
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to convert image to base64 ${filePath}: ${errorMsg}`);
    }
  }

  getMaxTextLength(): number {
    return this.maxTextLength;
  }

  setMaxTextLength(length: number): void {
    this.maxTextLength = length;
  }

  getMaxDisplayLength(): number {
    return this.maxDisplayLength;
  }

  setMaxDisplayLength(length: number): void {
    this.maxDisplayLength = length;
  }
}

let inputProcessorInstance: InputProcessor | null = null;

export function getInputProcessor(): InputProcessor {
  if (!inputProcessorInstance) {
    inputProcessorInstance = new InputProcessor();
  }
  return inputProcessorInstance;
}
