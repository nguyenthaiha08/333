import { SAMPLE_RATE } from '../types';

// Convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper: Trim trailing silence from AudioBuffer
function trimTrailingSilence(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const data = buffer.getChannelData(0);
  let lastNonSilence = data.length - 1;
  
  // Threshold: 0.005 (~0.5%) handles distinct silence vs background noise well
  // Scan backwards to find where actual audio ends
  while (lastNonSilence >= 0 && Math.abs(data[lastNonSilence]) < 0.005) {
    lastNonSilence--;
  }

  // If the whole file is silence or we are at the end, return original
  if (lastNonSilence === data.length - 1) return buffer;

  // Add a small padding (0.1s) to prevent sound from feeling "chopped" abruptly
  const paddingSamples = Math.floor(buffer.sampleRate * 0.1); 
  const newLength = Math.min(data.length, lastNonSilence + 1 + paddingSamples);

  const newBuffer = ctx.createBuffer(1, newLength, buffer.sampleRate);
  newBuffer.copyToChannel(data.slice(0, newLength), 0);
  
  return newBuffer;
}

// Convert raw PCM data (Float32) to AudioBuffer with Normalization and Trimming
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const rawBytes = base64ToUint8Array(base64Data);
  
  // Assuming 16-bit little-endian PCM from the model.
  const int16Data = new Int16Array(rawBytes.buffer);
  const float32Data = new Float32Array(int16Data.length);
  
  let maxPeak = 0;

  // Pass 1: Convert to Float and find Peak volume
  for (let i = 0; i < int16Data.length; i++) {
    const sample = int16Data[i] / 32768.0;
    float32Data[i] = sample;
    
    const abs = Math.abs(sample);
    if (abs > maxPeak) {
      maxPeak = abs;
    }
  }

  // Pass 2: Normalize if needed (prevent clipping/crackling)
  if (maxPeak > 0.95) {
    const scaleFactor = 0.95 / maxPeak;
    for (let i = 0; i < float32Data.length; i++) {
      float32Data[i] *= scaleFactor;
    }
  }

  const tempBuffer = ctx.createBuffer(1, float32Data.length, SAMPLE_RATE);
  tempBuffer.copyToChannel(float32Data, 0);
  
  // Apply Silence Trimming
  return trimTrailingSilence(tempBuffer, ctx);
}

// Write WAV header for an AudioBuffer
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAV container
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  // write format chunk
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this encoder)

  // write data chunk
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (let i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      // Hard clamp just in case, though normalization above should handle it
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      // scale to 16-bit signed int
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

/**
 * Merges multiple WAV Blobs directly by concatenating their binary data
 * and rewriting the WAV header. 
 * This is vastly more memory efficient than decoding/re-encoding AudioBuffers.
 */
export async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) return new Blob([], { type: 'audio/wav' });

  // Get all buffers
  const buffers = await Promise.all(blobs.map(b => b.arrayBuffer()));

  // WAV Header is 44 bytes
  const headerLength = 44;
  
  // 1. Calculate total data length (sum of all files minus their headers)
  // We assume all blobs are valid WAVs created by our own audioBufferToWav function
  const totalDataLength = buffers.reduce((acc, buf) => {
    // Safety check: ignore files smaller than header
    return acc + Math.max(0, buf.byteLength - headerLength);
  }, 0);
  
  const totalFileLength = totalDataLength + headerLength;

  // 2. Create output buffer
  const resultBuffer = new Uint8Array(totalFileLength);

  // 3. Copy Header from first file
  const firstHeader = new Uint8Array(buffers[0].slice(0, headerLength));
  resultBuffer.set(firstHeader, 0);

  // 4. Update Header Sizes (WAV format spec)
  const view = new DataView(resultBuffer.buffer);
  
  // ChunkSize (Offset 4): 36 + SubChunk2Size (Data Size)
  // This is the size of the rest of the chunk following this number
  view.setUint32(4, 36 + totalDataLength, true);
  
  // SubChunk2Size (Offset 40): data size
  view.setUint32(40, totalDataLength, true);

  // 5. Copy Data Bodies
  let offset = headerLength;
  for (const buf of buffers) {
    if (buf.byteLength > headerLength) {
      const data = new Uint8Array(buf.slice(headerLength));
      resultBuffer.set(data, offset);
      offset += data.length;
    }
  }

  return new Blob([resultBuffer], { type: 'audio/wav' });
}

export interface ZipEntry {
  filename: string;
  blob: Blob;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeZipFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'audio.wav';
}

/**
 * Packs multiple Blobs into a standard uncompressed (STORE) UTF-8 .zip Blob
 * without duplicating audio data in memory.
 */
export async function createZipBlob(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const usedNames = new Set<string>();
  const blobParts: BlobPart[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let currentOffset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    let safeName = sanitizeZipFilename(entry.filename);
    if (usedNames.has(safeName)) {
      const dotIdx = safeName.lastIndexOf('.');
      const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName;
      const ext = dotIdx > 0 ? safeName.slice(dotIdx) : '';
      let counter = 2;
      while (usedNames.has(`${base} (${counter})${ext}`)) {
        counter++;
      }
      safeName = `${base} (${counter})${ext}`;
    }
    usedNames.add(safeName);

    const nameBytes = encoder.encode(safeName);
    const arrayBuf = await entry.blob.arrayBuffer();
    const crc = computeCrc32(new Uint8Array(arrayBuf));
    const size = arrayBuf.byteLength;

    // Local File Header (30 + nameBytes.length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed to extract (2.0)
    localView.setUint16(6, 0x0800, true); // General purpose bit flag (Bit 11 = UTF-8)
    localView.setUint16(8, 0, true); // Compression method (0 = STORE)
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    // Central Directory Header (46 + nameBytes.length)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true); // Central file header signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed to extract
    centralView.setUint16(8, 0x0800, true); // UTF-8 flag
    centralView.setUint16(10, 0, true); // STORE
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // Extra field length
    centralView.setUint16(32, 0, true); // File comment length
    centralView.setUint16(34, 0, true); // Disk number start
    centralView.setUint16(36, 0, true); // Internal file attributes
    centralView.setUint32(38, 0, true); // External file attributes
    centralView.setUint32(42, currentOffset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    blobParts.push(localHeader, entry.blob);
    centralDirectoryParts.push(centralHeader);

    currentOffset += localHeader.byteLength + size;
    centralDirectorySize += centralHeader.byteLength;
  }

  const centralDirectoryOffset = currentOffset;
  for (const cdPart of centralDirectoryParts) {
    blobParts.push(cdPart);
  }

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralDirectorySize, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, 0, true); // Comment length

  blobParts.push(eocd);

  return new Blob(blobParts, { type: 'application/zip' });
}