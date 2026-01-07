/**
 * File Parsers - Extract text from various file formats for offline analysis
 * Supported formats: epub, srt, ass, txt, html, mokuro
 */

export interface ParsedContent {
  title?: string;
  chapters?: Array<{ title: string; content: string }>;
  fullText: string;
  metadata?: Record<string, string>;
}

export type SupportedFormat = 'epub' | 'srt' | 'ass' | 'txt' | 'html' | 'mokuro';

/**
 * Detect file format from filename extension
 */
export function detectFormat(filename: string): SupportedFormat | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const formats: Record<string, SupportedFormat> = {
    'epub': 'epub',
    'srt': 'srt',
    'ass': 'ass',
    'ssa': 'ass',
    'txt': 'txt',
    'html': 'html',
    'htm': 'html',
    'mokuro': 'mokuro',
    'json': 'mokuro'  // Mokuro files are JSON
  };
  return formats[ext || ''] || null;
}

/**
 * Parse plain text file
 */
export function parseTxt(content: string): ParsedContent {
  return {
    fullText: content.trim()
  };
}

/**
 * Parse SRT subtitle file
 * Format: index, timestamp, text, blank line
 */
export function parseSrt(content: string): ParsedContent {
  const blocks = content.split(/\n\n+/);
  const lines: string[] = [];

  for (const block of blocks) {
    const blockLines = block.split('\n');
    // Skip index (first line) and timestamp (second line)
    for (let i = 2; i < blockLines.length; i++) {
      // Remove HTML tags (some SRT files have them)
      const line = blockLines[i].replace(/<[^>]+>/g, '').trim();
      if (line) lines.push(line);
    }
  }

  return {
    fullText: lines.join('\n')
  };
}

/**
 * Parse ASS/SSA subtitle file
 * Extracts dialogue lines and removes formatting tags
 */
export function parseAss(content: string): ParsedContent {
  const lines: string[] = [];
  // Match dialogue lines: Dialogue: layer,start,end,style,name,marginL,marginR,marginV,effect,text
  const dialogueRegex = /^Dialogue:\s*[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/;

  for (const line of content.split('\n')) {
    const match = line.match(dialogueRegex);
    if (match) {
      // Remove ASS formatting tags like {\pos(x,y)}, {\an8}, {\fad(100,200)}, etc.
      let text = match[1].replace(/\{[^}]*\}/g, '');
      // Replace \N with actual newline
      text = text.replace(/\\N/gi, '\n');
      // Remove \n (soft break)
      text = text.replace(/\\n/gi, ' ');
      if (text.trim()) lines.push(text.trim());
    }
  }

  return {
    fullText: lines.join('\n')
  };
}

/**
 * Parse HTML file
 * Extracts text content, removing scripts and styles
 */
export function parseHtml(content: string): ParsedContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');

  // Remove script, style, and other non-content elements
  doc.querySelectorAll('script, style, noscript, svg, canvas, iframe').forEach(el => el.remove());

  const title = doc.querySelector('title')?.textContent?.trim() || undefined;
  const bodyText = doc.body?.textContent || '';

  return {
    title,
    fullText: bodyText.trim()
  };
}

/**
 * Parse Mokuro JSON file (OCR manga format)
 * Mokuro outputs JSON with pages containing text blocks
 */
export function parseMokuro(content: string): ParsedContent {
  try {
    const data = JSON.parse(content);
    const texts: string[] = [];

    // Mokuro format: { pages: [ { blocks: [ { lines: [...] } ] } ] }
    if (Array.isArray(data.pages)) {
      for (const page of data.pages) {
        if (Array.isArray(page.blocks)) {
          for (const block of page.blocks) {
            if (Array.isArray(block.lines)) {
              for (const line of block.lines) {
                if (typeof line === 'string' && line.trim()) {
                  texts.push(line.trim());
                }
              }
            }
          }
        }
      }
    }

    return {
      fullText: texts.join('\n'),
      title: data.title || data.volume_uuid
    };
  } catch (e) {
    throw new Error(`Failed to parse Mokuro JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Parse EPUB file
 * EPUB is a ZIP file containing HTML/XHTML files
 * Uses JSZip for extraction
 */
export async function parseEpub(file: File): Promise<ParsedContent> {
  // Dynamic import JSZip to avoid bundling if not needed
  const JSZip = (await import('jszip')).default;

  const zip = await JSZip.loadAsync(file);

  // Find container.xml to get the rootfile path
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }

  // Parse container.xml to find the OPF file
  const containerDoc = new DOMParser().parseFromString(containerXml, 'text/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) {
    throw new Error('Invalid EPUB: missing rootfile in container.xml');
  }

  // Parse the OPF file to get the reading order (spine)
  const opfContent = await zip.file(rootfilePath)?.async('string');
  if (!opfContent) {
    throw new Error(`Invalid EPUB: missing OPF file at ${rootfilePath}`);
  }

  const opfDoc = new DOMParser().parseFromString(opfContent, 'text/xml');
  const opfDir = rootfilePath.split('/').slice(0, -1).join('/');

  // Build manifest map: id -> href
  const manifest = new Map<string, string>();
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });

  // Get spine order
  const spineItems: string[] = [];
  opfDoc.querySelectorAll('spine > itemref').forEach(ref => {
    const idref = ref.getAttribute('idref');
    if (idref) {
      const href = manifest.get(idref);
      if (href) spineItems.push(href);
    }
  });

  // Extract text from each spine item in order
  const chapters: Array<{ title: string; content: string }> = [];
  const allTexts: string[] = [];

  for (const href of spineItems) {
    const fullPath = opfDir ? `${opfDir}/${href}` : href;
    const htmlContent = await zip.file(fullPath)?.async('string');
    if (!htmlContent) continue;

    const parsed = parseHtml(htmlContent);
    if (parsed.fullText.trim()) {
      chapters.push({
        title: parsed.title || `Chapter ${chapters.length + 1}`,
        content: parsed.fullText
      });
      allTexts.push(parsed.fullText);
    }
  }

  // Get title from OPF metadata
  const title = opfDoc.querySelector('metadata > *|title, metadata > title')?.textContent?.trim() || undefined;

  return {
    title,
    chapters,
    fullText: allTexts.join('\n\n')
  };
}

/**
 * Main entry point - parse any supported file format
 */
export async function parseFile(file: File): Promise<ParsedContent> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(`Unsupported file format: ${file.name}. Supported: epub, srt, ass, txt, html, mokuro`);
  }

  if (format === 'epub') {
    return parseEpub(file);
  }

  // All other formats are text-based
  const content = await file.text();

  switch (format) {
    case 'srt':
      return parseSrt(content);
    case 'ass':
      return parseAss(content);
    case 'txt':
      return parseTxt(content);
    case 'html':
      return parseHtml(content);
    case 'mokuro':
      return parseMokuro(content);
    default:
      throw new Error(`Parser not implemented for: ${format}`);
  }
}
