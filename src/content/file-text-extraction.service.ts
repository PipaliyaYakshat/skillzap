import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import { extname } from 'path';
import textract from 'textract';

type ExtractTextOptions = {
  filePath: string;
  contentType?: string | null;
};

type PdfParserOptions = {
  data: Buffer;
};

type PdfParserGetTextOptions = Record<string, unknown>;

type PdfParserCtor = new (options: PdfParserOptions) => {
  getText(options?: PdfParserGetTextOptions): Promise<{ text?: string }>;
};

@Injectable()
export class FileTextExtractionService {
  private pdfParserCtor: PdfParserCtor | null = null;

  async extractText(options: ExtractTextOptions): Promise<string> {
    const { filePath, contentType } = options;
    if (!filePath) {
      throw new NotFoundException('Uploaded file path is missing');
    }

    await this.assertFileExists(filePath);

    const typeHint = (
      contentType || extname(filePath).replace('.', '')
    ).toLowerCase();

    let rawText = '';
    try {
      rawText =
        typeHint === 'pdf'
          ? await this.extractFromPdf(filePath)
          : await this.extractWithTextract(filePath);
    } catch (error) {
      console.error('❌ Failed to extract text from file:', filePath, error);
      throw new InternalServerErrorException(
        'Unable to read text from uploaded file',
      );
    }

    const normalized = this.normalizeText(rawText);
    if (!normalized) {
      throw new InternalServerErrorException(
        'Uploaded file does not contain readable textual content',
      );
    }

    return normalized;
  }

  private async assertFileExists(filePath: string) {
    try {
      await fsPromises.access(filePath);
    } catch {
      throw new NotFoundException(
        'Uploaded file is no longer available on disk',
      );
    }
  }

  private async extractFromPdf(filePath: string) {
    const buffer = await fsPromises.readFile(filePath);
    const ParserCtor = await this.resolvePdfParserCtor();
    const parser = new ParserCtor({ data: buffer });
    const parsed = await parser.getText();
    return parsed?.text ?? '';
  }

  private async extractWithTextract(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      textract.fromFileWithPath(
        filePath,
        (error: Error | null, text?: string) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(text ?? '');
        },
      );
    });
  }

  private normalizeText(text: string) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  private async resolvePdfParserCtor(): Promise<PdfParserCtor> {
    if (this.pdfParserCtor) {
      return this.pdfParserCtor;
    }

    const mod = await import('pdf-parse');
    const maybeCtor =
      typeof mod === 'function'
        ? (mod as unknown as PdfParserCtor)
        : ((mod as { default?: PdfParserCtor; PDFParse?: PdfParserCtor })
            .PDFParse ??
          (mod as { default?: PdfParserCtor }).default ??
          null);

    if (typeof maybeCtor !== 'function') {
      throw new InternalServerErrorException('PDF parser is not available');
    }

    this.pdfParserCtor = maybeCtor;
    return this.pdfParserCtor;
  }
}
