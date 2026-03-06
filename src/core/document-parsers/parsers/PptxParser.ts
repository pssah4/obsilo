/**
 * PPTX Parser — extracts text and image metadata from PowerPoint presentations.
 *
 * PPTX is a ZIP archive containing:
 *   ppt/slides/slide1.xml, slide2.xml, ...  (slide content)
 *   ppt/notesSlides/notesSlide1.xml, ...    (speaker notes)
 *   ppt/media/image1.png, ...               (embedded images)
 */

import type { ParseResult, ImageMetadata } from '../types';
import { openZipSafe, getXmlDoc, getElementsByLocalName } from './ooxmlHelpers';

export async function parsePptx(data: ArrayBuffer): Promise<ParseResult> {
    const zip = await openZipSafe(data);
    const sizeTracker = { total: 0 };

    // Find slide files (sorted by number)
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
            return numA - numB;
        });

    const parts: string[] = [];
    const images: ImageMetadata[] = [];
    let imageCount = 0;

    for (let i = 0; i < slideFiles.length; i++) {
        const slideNum = i + 1;
        const doc = await getXmlDoc(zip, slideFiles[i], sizeTracker);
        if (!doc) continue;

        // Extract text from all text body elements (a:t tags contain the actual text)
        const slideTexts: string[] = [];

        // Try to find the title (usually the first sp with type="title" or "ctrTitle")
        let title = '';
        const spElements = getElementsByLocalName(doc.documentElement, 'sp');
        for (const sp of spElements) {
            const nvSpPr = getElementsByLocalName(sp, 'nvSpPr')[0];
            if (nvSpPr) {
                const ph = getElementsByLocalName(nvSpPr, 'ph')[0];
                if (ph) {
                    const phType = ph.getAttribute('type');
                    if (phType === 'title' || phType === 'ctrTitle') {
                        const titleTexts = getElementsByLocalName(sp, 't');
                        title = titleTexts.map(t => t.textContent?.trim() ?? '').filter(Boolean).join(' ');
                    }
                }
            }
        }

        // All text runs (a:t elements)
        const textElements = getElementsByLocalName(doc.documentElement, 't');
        for (const el of textElements) {
            const text = el.textContent?.trim();
            if (text) slideTexts.push(text);
        }

        // Speaker notes
        let notes = '';
        const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
        const notesDoc = await getXmlDoc(zip, notesPath, sizeTracker);
        if (notesDoc) {
            const noteTexts = getElementsByLocalName(notesDoc.documentElement, 't');
            const noteContent = noteTexts
                .map(el => el.textContent?.trim() ?? '')
                .filter(Boolean)
                // Filter out slide number placeholders
                .filter(t => !/^\d+$/.test(t))
                .join(' ');
            if (noteContent) notes = noteContent;
        }

        // Build slide section
        const heading = title ? `## Slide ${slideNum}: ${title}` : `## Slide ${slideNum}`;
        let slideText = heading + '\n\n';

        const bodyText = slideTexts.filter(t => t !== title).join('\n');
        if (bodyText) slideText += bodyText + '\n';
        if (notes) slideText += `\n*Notes:* ${notes}\n`;

        parts.push(slideText);
    }

    // Collect image metadata from ppt/media/
    const mediaFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/media\//.test(name) && !zip.files[name].dir);
    for (const mediaPath of mediaFiles) {
        imageCount++;
        const filename = mediaPath.split('/').pop() ?? mediaPath;
        images.push({
            id: `img${imageCount}`,
            filename,
            location: 'Presentation',
        });
    }

    // Add image summary if images exist
    if (images.length > 0) {
        const imgLine = `\n---\n*${images.length} embedded image(s) detected. Use extract_document_images to view them.*`;
        parts.push(imgLine);
    }

    const text = parts.length > 0
        ? parts.join('\n')
        : '(Empty presentation)';

    return {
        text,
        images,
        metadata: {
            format: 'pptx',
            pageCount: slideFiles.length,
        },
    };
}
