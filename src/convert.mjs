import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { escapeHtml, slugify, isChapterHeading, isCapsHeading } from './utils.mjs';
import { buildHtml } from './template.mjs';

const TEXT_DIR = join(process.cwd(), 'public', 'text');
const OUTPUT_DIR = join(process.cwd(), 'public', 'literature');

const FOOTNOTE_REF_PATTERN = /\[(\d+)\]/g;
const FOOTNOTE_DEF_PATTERN = /^\[(\d+)\]\s*(.+)$/;

/**
 * Escape text first, THEN inject inline HTML tags.
 * Injecting tags before escaping is what caused the double-escape bug.
 */
function processInlineFormatting(raw) {
  return escapeHtml(raw)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(FOOTNOTE_REF_PATTERN, (_, num) =>
      `<sup><a href="#fn-${num}" id="ref-${num}" aria-label="Footnote ${num}">[${num}]</a></sup>`
    );
}

/**
 * Extract footnote definitions from a batch of paragraph strings.
 * Returns definitions plus paragraphs with inline refs linked and escaped.
 */
function extractFootnotes(paragraphs) {
  const footnotes = [];
  const processed = [];

  for (const p of paragraphs) {
    const match = p.match(FOOTNOTE_DEF_PATTERN);
    if (match) {
      footnotes.push({
        id: `fn-${match[1]}`,
        num: match[1],
        text: processInlineFormatting(match[2]),
      });
    } else {
      processed.push(processInlineFormatting(p));
    }
  }

  return { paragraphs: processed, footnotes };
}

function parseTextFile(filePath) {
  return readFile(filePath, 'utf-8');
}

async function buildBookFromText(raw, filePath) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  const metadata = {};
  let contentStart = 0;

  const startMarkerIdx = lines.findIndex(l => /\*\*\*\s*START OF/i.test(l));

  if (startMarkerIdx !== -1) {
    for (let i = 0; i < startMarkerIdx; i++) {
      const m = lines[i].match(/^(Title|Author|Release Date|Language|Posting Date|Produced by):\s*(.+)$/i);
      if (m) {
        metadata[m[1].toLowerCase().replace(/\s+/g, '_')] = m[2].trim();
      }
    }
    contentStart = startMarkerIdx + 1;
  }

  const allLines = lines.slice(contentStart);
  const endMarkerIdx = allLines.findIndex(l => /\*\*\*\s*END OF/i.test(l));
  const contentLines = endMarkerIdx !== -1 ? allLines.slice(0, endMarkerIdx) : allLines;

  const title = metadata.title || slugify(basename(filePath)).replace(/-/g, ' ');
  const author = metadata.author || 'Unknown';
  const language = metadata.language || 'en';

  let datePublished = '';
  if (metadata.release_date) {
    const yearMatch = metadata.release_date.match(/\d{4}/);
    if (yearMatch) datePublished = yearMatch[0];
  }

  const chapters = [];
  let currentChapter = null;
  let currentParagraph = [];
  let paragraphCount = 0;

  function flushParagraph() {
    if (currentParagraph.length === 0) return;
    const paraText = currentParagraph.join(' ').trim();
    if (paraText) {
      if (!currentChapter) {
        currentChapter = {
          heading: 'Introduction',
          id: 'introduction',
          subsections: [],
        };
        chapters.push(currentChapter);
      }
      currentChapter.subsections.push({ type: 'paragraph', content: paraText });
      paragraphCount++;
    }
    currentParagraph = [];
  }

  function startChapter(heading) {
    flushParagraph();
    currentChapter = { heading, id: slugify(heading) || `section-${chapters.length + 1}`, subsections: [] };
    chapters.push(currentChapter);
  }

  for (const line of contentLines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (isChapterHeading(trimmed)) {
      startChapter(trimmed);
      continue;
    }

    if (isCapsHeading(trimmed) && currentParagraph.length === 0) {
      flushParagraph();
      if (currentChapter) {
        const id = slugify(trimmed) || `subsection-${chapters.length}-${currentChapter.subsections.length}`;
        currentChapter.subsections.push({ type: 'heading', id, content: trimmed });
      } else {
        startChapter(trimmed);
      }
      continue;
    }

    currentParagraph.push(trimmed);
  }
  flushParagraph();

  // Single pass: escape + link refs + collect footnote definitions.
  const footnotes = [];
  for (const ch of chapters) {
    ch.subsections = ch.subsections.flatMap(sub => {
      if (sub.type !== 'paragraph') return [sub];
      const { paragraphs, footnotes: fns } = extractFootnotes([sub.content]);
      footnotes.push(...fns);
      return paragraphs.length > 0
        ? [{ ...sub, content: paragraphs[0] }]
        : [];
    });
  }

  // Dedupe footnote definitions by number (refs may repeat; definitions shouldn't).
  const seen = new Set();
  const dedupedFootnotes = footnotes
    .filter(fn => {
      if (seen.has(fn.num)) return false;
      seen.add(fn.num);
      return true;
    })
    .sort((a, b) => Number(a.num) - Number(b.num));

  return {
    title,
    author,
    language,
    datePublished,
    description: `${title} by ${author}. Public domain literature.`,
    fileName: slugify(title),
    chapters,
    footnotes: dedupedFootnotes,
  };
}

async function convertFile(inputPath) {
  console.log(`Converting: ${inputPath}`);
  const raw = await parseTextFile(inputPath);
  const book = await buildBookFromText(raw, inputPath);

  const outputDir = join(OUTPUT_DIR, book.fileName);
  await mkdir(outputDir, { recursive: true });

  const siteUrl = process.env.SITE_URL || 'https://dev.antinazi.org';
  const outputFile = join(outputDir, 'index.html');
  await writeFile(outputFile, buildHtml(book, '/css/style.css', siteUrl), 'utf-8');
  console.log(`  → Written: ${outputFile}`);
}

async function getFilesToConvert() {
  const args = process.argv.slice(2);

  if (args.length > 0 && !args[0].startsWith('--')) {
    return [join(process.cwd(), args[0])];
  }

  if (args.includes('--all')) {
    return listTextFiles();
  }

  // CI: convert only newly added text files since the previous commit.
  for (const diffCmd of [
    'git diff --name-only --diff-filter=A HEAD~1 HEAD -- "public/text/*.txt"',
    'git diff --name-only HEAD -- "public/text/*.txt"',
  ]) {
    try {
      const diff = execSync(diffCmd, { encoding: 'utf-8', cwd: process.cwd() }).trim();
      if (diff) return diff.split('\n').map(f => join(process.cwd(), f));
    } catch { /* fall through */ }
  }

  return listTextFiles();
}

async function listTextFiles() {
  if (!existsSync(TEXT_DIR)) return [];
  const files = await readdir(TEXT_DIR);
  return files.filter(f => extname(f) === '.txt').map(f => join(TEXT_DIR, f));
}

(async () => {
  try {
    const files = await getFilesToConvert();

    if (files.length === 0) {
      console.log('No text files to convert.');
      process.exit(0);
    }

    for (const file of files) {
      await convertFile(file);
    }

    console.log(`✅ Converted ${files.length} file(s).`);
  } catch (err) {
    console.error('❌ Conversion failed:', err);
    process.exit(1);
  }
})();
