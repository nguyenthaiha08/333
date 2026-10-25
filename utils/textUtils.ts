import { MAX_CHARS_PER_CHUNK } from "../types";

export function splitTextIntoChunks(text: string, maxLength: number = MAX_CHARS_PER_CHUNK): string[] {
  // Strategy: "Token Bin Packing"
  // Instead of slicing indices (which can skip text if calculated wrong),
  // we break text into atomic units and fill chunks one by one.
  
  const chunks: string[] = [];
  let currentBuffer = "";

  // 1. Split into paragraphs first (Preserve logical flow)
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split('\n');

  const commitBuffer = () => {
    if (currentBuffer.trim().length > 0) {
      chunks.push(currentBuffer.trim());
    }
    currentBuffer = "";
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    
    // Skip empty lines (just noise usually)
    if (para.trim().length === 0) {
       continue; 
    }

    // 2. Check if paragraph fits in current buffer
    // +1 accounts for the newline/space we add between paragraphs
    if (currentBuffer.length + para.length + 1 <= maxLength) {
       currentBuffer += (currentBuffer.length > 0 ? "\n" : "") + para;
    } else {
       // Paragraph doesn't fit.
       
       // Case A: Does it fit in a NEW empty chunk?
       // If so, commit current and start new with this paragraph.
       if (para.length <= maxLength) {
          commitBuffer();
          currentBuffer = para;
       } 
       // Case B: Paragraph is MASSIVE (larger than chunk limit).
       // We must tokenize it by words to fit it in.
       else {
          // 1. Commit whatever we have so far to clear space
          commitBuffer();
          
          // 2. Split paragraph into tokens (words and whitespace)
          // The regex /(\s+)/ captures the whitespace delimiters so we reconstruct exact spacing
          const tokens = para.split(/(\s+)/);
          
          for (const token of tokens) {
             if (currentBuffer.length + token.length <= maxLength) {
                currentBuffer += token;
             } else {
                // Token makes buffer overflow
                commitBuffer();
                
                // Edge Case: A single token is larger than maxLength (e.g. huge Base64 string)
                if (token.length > maxLength) {
                   // Force hard split by character
                   let remaining = token;
                   while(remaining.length > 0) {
                       const slice = remaining.slice(0, maxLength);
                       chunks.push(slice);
                       remaining = remaining.slice(maxLength);
                   }
                } else {
                   // Normal case: Start new buffer with this word
                   currentBuffer = token;
                }
             }
          }
       }
    }
  }

  // Commit any remaining text
  commitBuffer();
  
  return chunks;
}