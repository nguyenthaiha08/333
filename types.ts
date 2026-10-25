
export interface TtsChunk {
  id: string;
  index: number;
  text: string;
  status: 'pending' | 'generating' | 'success' | 'error';
  audioBlob: Blob | null;
  duration: number; // in seconds (audio length)
  generationTime?: number; // in milliseconds (processing time)
  completedAt?: number; // Timestamp when processing finished
  errorMessage?: string;
  selected: boolean; // For batch operations
  isTextVisible: boolean; // Toggle text view
  usedApiKey?: string; // The API key used for this specific chunk
  originFilename: string; // The name of the uploaded file without extension
}

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

export interface VoiceConfig {
  name: VoiceName;
  gender: 'Male' | 'Female';
}

export const AVAILABLE_VOICES: VoiceConfig[] = [
  { name: VoiceName.Puck, gender: 'Male' },
  { name: VoiceName.Charon, gender: 'Male' },
  { name: VoiceName.Kore, gender: 'Female' },
  { name: VoiceName.Fenrir, gender: 'Male' },
  { name: VoiceName.Zephyr, gender: 'Female' },
];

export interface ModelConfig {
  id: string;
  name: string;
  desc: string;
  tag: 'Quality' | 'Speed' | 'Experimental';
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  { 
    id: 'gemini-2.5-pro-preview-tts', 
    name: 'Gemini 2.5 Pro TTS', 
    desc: 'Best for Storytelling/Audiobooks. Highest quality prosody & emotion.',
    tag: 'Quality'
  },
  { 
    id: 'gemini-2.5-flash-preview-tts', 
    name: 'Gemini 2.5 Flash TTS', 
    desc: 'Best for News/Articles. Ultra-fast generation & low latency.',
    tag: 'Speed'
  },
  { 
    id: 'gemini-2.0-pro-exp-02-05', 
    name: 'Gemini 2.0 Pro Exp', 
    desc: 'Experimental Pro model. Strong logic, good for complex scripts.',
    tag: 'Experimental'
  },
  { 
    id: 'gemini-2.0-flash-exp', 
    name: 'Gemini 2.0 Flash Exp', 
    desc: 'Experimental Flash model. Fast but may be less stable.',
    tag: 'Experimental'
  },
];

export const MAX_CHARS_PER_CHUNK = 1500;
export const SAMPLE_RATE = 24000;
