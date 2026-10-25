import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { 
  Upload, FileText, Play, Pause, RefreshCw, Trash2, 
  Download, Settings2, Sparkles, AlertCircle, 
  CheckCircle2, Loader2, Merge, Eye, EyeOff, Square, CheckSquare,
  Clock, Dices, Layers, Key, Edit3, Zap, Archive, Hourglass, Timer,
  PauseCircle, Ban, Coffee, Cpu, Bot, Info, Scissors,
  Plus, ChevronDown, ChevronRight, X
} from 'lucide-react';

import { TtsChunk, VoiceName, SAMPLE_RATE, AVAILABLE_MODELS } from './types';
import { splitTextIntoChunks } from './utils/textUtils';
import { decodeAudioData, audioBufferToWav, mergeWavBlobs, createZipBlob } from './utils/audioUtils';
import { ApiKeyModal } from './components/ApiKeyModal';
import { VoiceSelector } from './components/VoiceSelector';

function App() {
  // Store raw string for UI in modal
  const [rawApiKeyInput, setRawApiKeyInput] = useState<string>(() => localStorage.getItem('gemini_api_keys_raw') || '');
  // Store parsed keys array
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  // Current index (visual only for single generation)
  const [currentKeyIndex, setCurrentKeyIndex] = useState<number>(0);
  
  // Refs for access inside async loops/closures
  const apiKeysRef = useRef<string[]>([]);
  const currentKeyIndexRef = useRef<number>(0);
  
  // CRITICAL: Ref to track current chunks state instantly inside async loops
  const chunksRef = useRef<TtsChunk[]>([]);
  
  // CONTROL REF: To pause/stop the batch process instantly
  const isBatchActiveRef = useRef(false);

  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  
  const [chunks, setChunks] = useState<TtsChunk[]>([]);
  
  // --- PERSISTENT SETTINGS ---
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(() => {
    return (localStorage.getItem('tts_selected_voice') as VoiceName) || VoiceName.Kore;
  });

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('tts_selected_model') || 'gemini-2.5-pro-preview-tts';
  });
  
  const [globalPrompt, setGlobalPrompt] = useState<string>(() => {
    return localStorage.getItem('tts_global_prompt') || '';
  });
  
  const [seed, setSeed] = useState<number>(() => {
    const saved = localStorage.getItem('tts_seed');
    return saved ? parseInt(saved) : 42;
  });

  const [minDelay, setMinDelay] = useState<number>(() => {
    const saved = localStorage.getItem('tts_min_delay');
    return saved ? parseInt(saved) : 5000;
  });
  
  const [maxThreads, setMaxThreads] = useState<number>(() => {
    const saved = localStorage.getItem('tts_max_threads');
    return saved ? parseInt(saved) : 3;
  });

  // Chunk Size State
  const [chunkSize, setChunkSize] = useState<number>(() => {
    const saved = localStorage.getItem('tts_chunk_size');
    return saved ? parseInt(saved) : 2000;
  });

  const [projectName, setProjectName] = useState<string>('merged_audio');
  
  const minDelayRef = useRef(minDelay); 
  const maxThreadsRef = useRef(maxThreads);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'warning' | 'error' } | null>(null);
  const notificationTimerRef = useRef<number | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  
  // Batch processing states
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number, 
    total: number, 
    activeThreads: number,
    standbyKeys: number,
    cooldownKeys: number,
    deadKeys: number,
    status: string
  } | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize keys on load
  useEffect(() => {
    const savedRaw = localStorage.getItem('gemini_api_keys_raw');
    const oldSingleKey = localStorage.getItem('gemini_api_key');
    
    let initialRaw = '';
    if (savedRaw) {
      initialRaw = savedRaw;
    } else if (oldSingleKey) {
      initialRaw = oldSingleKey;
    }

    if (initialRaw) {
      setRawApiKeyInput(initialRaw);
      const parsed = parseKeys(initialRaw);
      setApiKeys(parsed);
      apiKeysRef.current = parsed;
    } else {
      setShowApiKeyModal(true);
    }
  }, []);

  // Save settings on change
  useEffect(() => localStorage.setItem('tts_selected_voice', selectedVoice), [selectedVoice]);
  useEffect(() => localStorage.setItem('tts_selected_model', selectedModel), [selectedModel]);
  useEffect(() => localStorage.setItem('tts_global_prompt', globalPrompt), [globalPrompt]);
  useEffect(() => localStorage.setItem('tts_seed', seed.toString()), [seed]);
  useEffect(() => localStorage.setItem('tts_min_delay', minDelay.toString()), [minDelay]);
  useEffect(() => localStorage.setItem('tts_max_threads', maxThreads.toString()), [maxThreads]);
  useEffect(() => localStorage.setItem('tts_chunk_size', chunkSize.toString()), [chunkSize]);

  // Sync chunks state to Ref
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  // Sync refs for workers
  useEffect(() => {
    minDelayRef.current = minDelay;
  }, [minDelay]);

  useEffect(() => {
    maxThreadsRef.current = maxThreads;
  }, [maxThreads]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const parseKeys = (input: string): string[] => {
    if (!input) return [];
    return input.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
  };

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
    }
    return audioCtxRef.current;
  };

  const handleApiKeySave = (rawInput: string) => {
    setRawApiKeyInput(rawInput);
    localStorage.setItem('gemini_api_keys_raw', rawInput);
    
    const parsed = parseKeys(rawInput);
    setApiKeys(parsed);
    apiKeysRef.current = parsed;
    
    // Reset index on new save
    setCurrentKeyIndex(0);
    currentKeyIndexRef.current = 0;
    
    setShowApiKeyModal(false);
  };

  const maskKey = (key?: string) => {
    if (!key || key.length < 12) return '...';
    return `${key.substring(0, 4)}...${key.substring(key.length - 6)}`;
  };

  const showNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    setNotification({ message, type });
    if (notificationTimerRef.current) {
      window.clearTimeout(notificationTimerRef.current);
    }
    notificationTimerRef.current = window.setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const incomingFiles = Array.from(fileList);
    if (incomingFiles.length === 0) return;

    const validFiles = incomingFiles.filter(
      (file) => file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')
    );

    const skippedCount = incomingFiles.length - validFiles.length;
    if (validFiles.length === 0) {
      showNotification('Vui lòng tải lên file văn bản hợp lệ (.txt).', 'error');
      return;
    }

    // Sort multiple files naturally (e.g. Chuong 1.txt, Chuong 2.txt, ..., Chuong 10.txt)
    const sortedFiles =
      validFiles.length > 1
        ? [...validFiles].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          )
        : validFiles;

    try {
      const loadedFiles = await Promise.all(
        sortedFiles.map(async (file) => ({
          nameWithoutExt: file.name.replace(/\.[^/.]+$/, ''),
          text: await file.text(),
        }))
      );

      const nonEmptyFiles = loadedFiles.filter((f) => f.text.trim().length > 0);
      if (nonEmptyFiles.length === 0) {
        showNotification('Các file tải lên đều trống.', 'warning');
        return;
      }

      setChunks((prev) => {
        const fileChunkCounts = new Map<string, number>();
        for (const existing of prev) {
          const currentMax = fileChunkCounts.get(existing.originFilename) || 0;
          if (existing.index > currentMax) {
            fileChunkCounts.set(existing.originFilename, existing.index);
          }
        }

        const createdChunks: TtsChunk[] = [];
        for (const fileData of nonEmptyFiles) {
          const textChunks = splitTextIntoChunks(fileData.text, chunkSize);
          const startIdx = fileChunkCounts.get(fileData.nameWithoutExt) || 0;

          textChunks.forEach((chunkText, idx) => {
            createdChunks.push({
              id: crypto.randomUUID(),
              index: startIdx + idx + 1,
              text: chunkText,
              status: 'pending',
              audioBlob: null,
              duration: 0,
              generationTime: 0,
              completedAt: undefined,
              selected: true,
              isTextVisible: false,
              originFilename: fileData.nameWithoutExt,
            });
          });

          fileChunkCounts.set(fileData.nameWithoutExt, startIdx + textChunks.length);
        }

        if (prev.length === 0) {
          setProjectName(
            nonEmptyFiles.length === 1 ? nonEmptyFiles[0].nameWithoutExt : 'merged_audio'
          );
        } else {
          const existingOrigins = new Set(prev.map((c) => c.originFilename));
          nonEmptyFiles.forEach((f) => existingOrigins.add(f.nameWithoutExt));
          if (existingOrigins.size > 1) {
            setProjectName('merged_audio');
          }
        }

        return [...prev, ...createdChunks];
      });

      if (skippedCount > 0) {
        showNotification(
          `Đã thêm ${nonEmptyFiles.length} file (.txt), bỏ qua ${skippedCount} file không hợp lệ.`,
          'warning'
        );
      } else if (nonEmptyFiles.length > 1) {
        showNotification(`Đã tải lên thành công ${nonEmptyFiles.length} file văn bản.`, 'info');
      }
    } catch (err) {
      console.error('Error reading uploaded files:', err);
      showNotification('Không thể đọc một hoặc nhiều file văn bản.', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const toggleSelection = (id: string) => {
    setChunks(prev => prev.map(c => {
      if (c.id !== id) return c;
      if (c.status === 'success') return c;
      return { ...c, selected: !c.selected };
    }));
  };

  const toggleTextVisibility = (id: string) => {
    setChunks(prev => prev.map(c => c.id === id ? { ...c, isTextVisible: !c.isTextVisible } : c));
  };

  const updateChunkText = (id: string, newText: string) => {
    setChunks(prev => prev.map(c => {
      if (c.id === id) {
        const isChanged = c.text !== newText;
        return {
            ...c,
            text: newText,
            status: isChanged && c.status === 'success' ? 'pending' : c.status,
            audioBlob: isChanged && c.status === 'success' ? null : c.audioBlob,
            duration: isChanged && c.status === 'success' ? 0 : c.duration,
            generationTime: isChanged ? 0 : c.generationTime,
            completedAt: isChanged && c.status === 'success' ? undefined : c.completedAt,
        };
      }
      return c;
    }));
  };

  const toggleSelectAll = () => {
    const pendingChunks = chunks.filter(c => c.status !== 'success');
    const allPendingSelected = pendingChunks.length > 0 && pendingChunks.every(c => c.selected);
    
    setChunks(prev => prev.map(c => {
      if (c.status === 'success') return { ...c, selected: false };
      return { ...c, selected: !allPendingSelected };
    }));
  };

  const generateAudio = async (chunkId: string, throwOnError = false, retryAttempt = 0, overrideKey?: string): Promise<boolean> => {
    if (apiKeysRef.current.length === 0) {
      setShowApiKeyModal(true);
      return false;
    }

    let activeKey: string;
    
    if (overrideKey) {
        activeKey = overrideKey;
    } else {
        let keyIndex = currentKeyIndexRef.current;
        if (keyIndex >= apiKeysRef.current.length) {
            keyIndex = 0;
            currentKeyIndexRef.current = 0;
            setCurrentKeyIndex(0);
        }
        activeKey = apiKeysRef.current[keyIndex];
    }

    const chunk = chunksRef.current.find(c => c.id === chunkId);
    if (!chunk) return false;

    setChunks(prev => prev.map(c => c.id === chunkId ? { 
      ...c, 
      status: 'generating', 
      errorMessage: retryAttempt > 0 ? `Retry (${retryAttempt}) with ${maskKey(activeKey)}` : undefined,
      usedApiKey: activeKey 
    } : c));

    // START TIMER
    const startTime = Date.now();

    try {
      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      let textToGen = chunk.text;
      if (retryAttempt > 0) {
        textToGen = textToGen + " ".repeat(retryAttempt); 
      }
        
      const finalPrompt = globalPrompt 
        ? `Style: ${globalPrompt}. Text: ${textToGen}` 
        : `Text: ${textToGen}`;

      const response = await ai.models.generateContent({
        model: selectedModel, // Use the selected model from state
        contents: [{
            parts: [{ text: finalPrompt }]
        }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice }
            }
          },
          seed: seed 
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!base64Audio) {
        throw new Error('No audio data received from Gemini.');
      }

      const ctx = getAudioContext();
      const audioBuffer = await decodeAudioData(base64Audio, ctx);
      const wavBlob = audioBufferToWav(audioBuffer);

      // END TIMER
      const endTime = Date.now();
      const generationTime = endTime - startTime;

      setChunks(prev => prev.map(c => c.id === chunkId ? {
        ...c,
        status: 'success',
        audioBlob: wavBlob,
        duration: audioBuffer.duration,
        generationTime: generationTime,
        completedAt: endTime,
        selected: false,
        usedApiKey: activeKey,
        errorMessage: undefined
      } : c));
      
      return true;

    } catch (error: any) {
      console.error("Gemini Error:", error);
      
      let errMsg = error.message || JSON.stringify(error);
      let isQuotaError = false;
      let isFatalKeyError = false; // NEW: Detect suspended/blocked keys

      try {
        const jsonMatch = errMsg.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonContent = jsonMatch[0];
            const parsed = JSON.parse(jsonContent);
            const errObj = parsed.error || parsed;
            
            if (errObj.code === 429 || errObj.status === 'RESOURCE_EXHAUSTED') {
                isQuotaError = true;
                errMsg = "Quota exceeded (429)";
            } else if (errObj.message) {
                errMsg = errObj.message; 
            }
        }
      } catch (e) { }

      const lowerMsg = errMsg.toLowerCase();
      
      // Intelligent Error Categorization
      if (!isQuotaError) {
          if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || lowerMsg.includes('quota') || lowerMsg.includes('exceeded')) {
            isQuotaError = true;
            errMsg = "Quota exceeded (429)";
          } else if (lowerMsg.includes('suspended') || lowerMsg.includes('blocked') || (lowerMsg.includes('permission_denied') && lowerMsg.includes('consumer'))) {
            // SPECIFIC FIX FOR USER ERROR: Catch suspended keys
            isFatalKeyError = true;
            errMsg = "API Key Suspended/Blocked";
          } else if (errMsg.includes('503') || lowerMsg.includes('overloaded')) {
            errMsg = "Server overloaded (503)";
          } else if (errMsg.includes('500') || errMsg.includes('INTERNAL')) {
            errMsg = "Internal Error (500)";
          } else if (errMsg.includes('API_KEY') || errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
            // Generic 403 usually means invalid key structure, also treat as fatal
            isFatalKeyError = true;
            errMsg = "Invalid API Key (403)";
          } else if (errMsg.includes('400') || errMsg.includes('INVALID_ARGUMENT')) {
            errMsg = "Bad Request (400)";
          } else if (errMsg.includes('SAFETY') || lowerMsg.includes('blocked')) {
            errMsg = "Safety filter triggered";
          }
      }
      
      setChunks(prev => prev.map(c => c.id === chunkId ? {
        ...c,
        status: 'error',
        errorMessage: errMsg,
        usedApiKey: activeKey 
      } : c));

      if (throwOnError) {
         const enrichedError = new Error(errMsg);
         (enrichedError as any).isQuota = isQuotaError;
         (enrichedError as any).isFatal = isFatalKeyError; // Pass fatal flag to scheduler
         throw enrichedError; 
      }
      return false;
    }
  };

  const playAudio = (chunk: TtsChunk) => {
    if (!chunk.audioBlob) return;

    if (playingId === chunk.id && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const url = URL.createObjectURL(chunk.audioBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    
    audio.onended = () => {
      setPlayingId(null);
      URL.revokeObjectURL(url);
    };
    
    audio.play();
    setPlayingId(chunk.id);
  };

  const downloadAudio = (chunk: TtsChunk) => {
    if (!chunk.audioBlob) return;
    const url = URL.createObjectURL(chunk.audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chunk.originFilename} - ${chunk.index}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteChunk = (id: string) => {
    if (playingId === id && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
    setChunks(prev => prev.filter(c => c.id !== id));
  };

  const deleteFileChunks = (originFilename: string) => {
    if (playingId && audioRef.current) {
      const playingChunk = chunks.find((c) => c.id === playingId);
      if (playingChunk?.originFilename === originFilename) {
        audioRef.current.pause();
        setPlayingId(null);
      }
    }
    setChunks((prev) => prev.filter((c) => c.originFilename !== originFilename));
    setCollapsedFiles((prev) => {
      const next = { ...prev };
      delete next[originFilename];
      return next;
    });
  };

  const toggleFileCollapse = (originFilename: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [originFilename]: !prev[originFilename],
    }));
  };

  const toggleFileSelection = (originFilename: string) => {
    const filePending = chunks.filter(
      (c) => c.originFilename === originFilename && c.status !== 'success'
    );
    if (filePending.length === 0) return;
    const allSelected = filePending.every((c) => c.selected);

    setChunks((prev) =>
      prev.map((c) => {
        if (c.originFilename !== originFilename) return c;
        if (c.status === 'success') return { ...c, selected: false };
        return { ...c, selected: !allSelected };
      })
    );
  };

  const clearAll = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
    setChunks([]);
    setCollapsedFiles({});
    setProjectName('merged_audio');
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const mergeFileChunks = async (originFilename: string) => {
    const readyChunks = chunks
      .filter((c) => c.originFilename === originFilename && c.status === 'success' && c.audioBlob)
      .sort((a, b) => a.index - b.index);
    if (readyChunks.length === 0) return;

    try {
      const blobs = readyChunks.map((c) => c.audioBlob).filter(Boolean) as Blob[];
      const mergedBlob = await mergeWavBlobs(blobs);
      triggerBlobDownload(mergedBlob, `${originFilename}.wav`);
    } catch (e) {
      console.error('Merge file failed', e);
      showNotification(`Không thể gộp audio cho file "${originFilename}".`, 'error');
    }
  };

  const downloadFileChunksZip = async (originFilename: string) => {
    const readyChunks = chunks
      .filter((c) => c.originFilename === originFilename && c.status === 'success' && c.audioBlob)
      .sort((a, b) => a.index - b.index);
    if (readyChunks.length === 0) return;

    if (readyChunks.length === 1 && readyChunks[0].audioBlob) {
      triggerBlobDownload(readyChunks[0].audioBlob, `${originFilename} - ${readyChunks[0].index}.wav`);
      return;
    }

    try {
      const zipBlob = await createZipBlob(
        readyChunks.map((c) => ({
          filename: `${c.originFilename} - ${c.index}.wav`,
          blob: c.audioBlob as Blob,
        }))
      );
      triggerBlobDownload(zipBlob, `${originFilename}_chunks.zip`);
    } catch (e) {
      console.error('Download file chunks failed', e);
      showNotification(`Không thể đóng gói các đoạn của file "${originFilename}".`, 'error');
    }
  };

  const downloadAllChunksZip = async () => {
    const readyChunks = chunks.filter((c) => c.status === 'success' && c.audioBlob);
    if (readyChunks.length === 0 || isDownloadingAll) return;

    setShowDownloadMenu(false);
    setIsDownloadingAll(true);
    try {
      if (readyChunks.length === 1 && readyChunks[0].audioBlob) {
        triggerBlobDownload(
          readyChunks[0].audioBlob,
          `${readyChunks[0].originFilename} - ${readyChunks[0].index}.wav`
        );
      } else {
        const zipBlob = await createZipBlob(
          readyChunks.map((c) => ({
            filename: `${c.originFilename} - ${c.index}.wav`,
            blob: c.audioBlob as Blob,
          }))
        );
        const zipName =
          projectName && projectName !== 'merged_audio'
            ? `${projectName}_all_files.zip`
            : `tts_all_files_${readyChunks.length}.zip`;
        triggerBlobDownload(zipBlob, zipName);
        showNotification(`Đã tải xuống ${readyChunks.length} file audio (.zip).`, 'info');
      }
    } catch (e) {
      console.error('Download all chunks ZIP failed', e);
      showNotification('Không thể đóng gói các file audio để tải xuống.', 'error');
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const downloadAllChunksIndividual = async () => {
    const readyChunks = chunks.filter((c) => c.status === 'success' && c.audioBlob);
    if (readyChunks.length === 0 || isDownloadingAll) return;

    setShowDownloadMenu(false);
    setIsDownloadingAll(true);
    try {
      for (let i = 0; i < readyChunks.length; i++) {
        const c = readyChunks[i];
        if (c.audioBlob) {
          triggerBlobDownload(c.audioBlob, `${c.originFilename} - ${c.index}.wav`);
          if (i < readyChunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }
      showNotification(`Đang tải lần lượt ${readyChunks.length} file .wav...`, 'info');
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const mergeEachFile = async () => {
    const origins = Array.from(new Set(chunks.map((c) => c.originFilename)));
    const readyOrigins = origins.filter((origin) =>
      chunks.some((c) => c.originFilename === origin && c.status === 'success' && c.audioBlob)
    );
    if (readyOrigins.length === 0 || isDownloadingAll) return;

    setShowDownloadMenu(false);
    setIsDownloadingAll(true);
    try {
      if (readyOrigins.length === 1) {
        await mergeFileChunks(readyOrigins[0]);
        return;
      }

      const mergedEntries = [];
      for (const origin of readyOrigins) {
        const fileChunks = chunks
          .filter((c) => c.originFilename === origin && c.status === 'success' && c.audioBlob)
          .sort((a, b) => a.index - b.index);
        const blobs = fileChunks.map((c) => c.audioBlob).filter(Boolean) as Blob[];
        if (blobs.length > 0) {
          const mergedBlob = await mergeWavBlobs(blobs);
          mergedEntries.push({
            filename: `${origin}.wav`,
            blob: mergedBlob,
          });
        }
      }

      if (mergedEntries.length > 0) {
        const zipBlob = await createZipBlob(mergedEntries);
        triggerBlobDownload(zipBlob, `merged_files_${mergedEntries.length}.zip`);
        showNotification(`Đã gộp và tải xuống ${mergedEntries.length} file hoàn chỉnh (.zip).`, 'info');
      }
    } catch (e) {
      console.error('Merge per file failed', e);
      showNotification('Không thể gộp và tải xuống các file audio.', 'error');
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const mergeAll = async () => {
    const readyChunks = chunks.filter(c => c.status === 'success' && c.audioBlob);
    if (readyChunks.length === 0) return;

    try {
      const blobs = readyChunks.map(c => c.audioBlob).filter(Boolean) as Blob[];
      
      // Use the new memory-efficient merge function
      const mergedBlob = await mergeWavBlobs(blobs);
      
      const url = URL.createObjectURL(mergedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Merge failed", e);
      showNotification('Không thể gộp các đoạn audio.', 'error');
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const stopBatch = () => {
    isBatchActiveRef.current = false;
    if (batchProgress) {
        setBatchProgress(prev => prev ? { ...prev, status: 'Stopping...' } : null);
    }
  };

  // --- SCHEDULER & RESOURCE POOL PATTERN ---
  const generateSelected = async () => {
    if (isBatchGenerating) return;
    
    // 1. Identify work (The Task Queue)
    const selectedChunks = chunks.filter(c => c.selected && c.status !== 'success');
    if (selectedChunks.length === 0) return;

    // 2. Identify Resources (The Key Pool)
    const allKeys = [...apiKeysRef.current];
    if (allKeys.length === 0) {
        setShowApiKeyModal(true);
        return;
    }

    setIsBatchGenerating(true);
    isBatchActiveRef.current = true;

    // Refs to manage state across async closures without stale data
    const queueRef = { current: selectedChunks.map(c => c.id) };
    const keyPoolRef = { current: allKeys };
    const cooldownKeysRef = { current: 0 };
    
    const stats = {
        total: selectedChunks.length,
        completed: 0,
        activeThreads: 0,
        deadKeys: 0
    };
    
    const chunkFailures = new Map<string, number>();

    const updateUI = () => {
        // Fix: Allow UI updates even if stopping, to show threads draining
        let statusText = stats.activeThreads > 0 ? 'Processing...' : 'Finishing...';
        if (!isBatchActiveRef.current) {
            statusText = `Stopping... (${stats.activeThreads} left)`;
        }

        setBatchProgress({ 
            current: stats.completed, 
            total: stats.total, 
            activeThreads: stats.activeThreads,
            standbyKeys: keyPoolRef.current.length,
            cooldownKeys: cooldownKeysRef.current,
            deadKeys: stats.deadKeys,
            status: statusText
        });
    };
    
    updateUI();

    // 3. The Scheduler (Pump)
    const scheduler = async () => {
        // CRITICAL FIX: Handle Stop Request by draining threads then cleaning up
        if (!isBatchActiveRef.current) {
            updateUI();
            if (stats.activeThreads === 0 && cooldownKeysRef.current === 0) {
                setIsBatchGenerating(false);
                setBatchProgress(null);
            }
            return;
        }

        // CRITICAL UPDATE: check activeThreads against maxThreadsRef
        while (
            queueRef.current.length > 0 && 
            keyPoolRef.current.length > 0 &&
            stats.activeThreads < maxThreadsRef.current // <--- CONCURRENCY LIMIT
        ) {
            
            if (!isBatchActiveRef.current) break;

            const chunkId = queueRef.current.shift();
            const apiKey = keyPoolRef.current.shift();
            
            if (!chunkId || !apiKey) break; 

            if (!chunksRef.current.find(c => c.id === chunkId)) {
                keyPoolRef.current.push(apiKey);
                continue;
            }

            stats.activeThreads++;
            updateUI();

            processTask(chunkId, apiKey).then(({ success, keyToRecycle, chunkToRetry }) => {
                if (keyToRecycle) {
                    cooldownKeysRef.current++;
                    updateUI();
                    
                    // Resting Period (User configured)
                    setTimeout(() => {
                        // Only add back to pool if we are still active, OR if we are stopping but need to cleanup refs
                        if (isBatchActiveRef.current) {
                            keyPoolRef.current.push(keyToRecycle);
                        }
                        cooldownKeysRef.current--;
                        // If we are stopping, we still call scheduler to trigger the drain check
                        scheduler(); 
                        updateUI();
                    }, minDelayRef.current); 
                } else {
                    // Key died (quota or suspended) - REMOVE FROM SESSION IMMEDIATELY
                    stats.deadKeys++;
                    
                    // Update Global State to remove this key permanently from the list
                    setApiKeys(prev => {
                        const next = prev.filter(k => k !== apiKey);
                        apiKeysRef.current = next; 
                        return next;
                    });
                }

                if (chunkToRetry) {
                    // Only push back to queue if we are still running
                    if (isBatchActiveRef.current) {
                        queueRef.current.push(chunkToRetry);
                    }
                } else if (success) {
                    stats.completed++;
                }
            }).finally(() => {
                stats.activeThreads--;
                updateUI();
                scheduler(); 
            });
        }
        
        // Completion Check (Normal Finish)
        if (isBatchActiveRef.current) {
            if (queueRef.current.length === 0 && stats.activeThreads === 0 && cooldownKeysRef.current === 0) {
                setIsBatchGenerating(false);
                setBatchProgress(null);
                return;
            }

            // Deadlock Check (All keys died)
            if (queueRef.current.length > 0 && 
                keyPoolRef.current.length === 0 && 
                stats.activeThreads === 0 && 
                cooldownKeysRef.current === 0) {
                
                setIsBatchGenerating(false);
                setBatchProgress(prev => prev ? { ...prev, status: 'Stopped: All keys exhausted' } : null);
                return;
            }
        }
    };

    // 4. The Worker Unit
    const processTask = async (chunkId: string, apiKey: string) => {
        try {
            const attempts = chunkFailures.get(chunkId) || 0;
            await generateAudio(chunkId, true, attempts, apiKey);
            return { success: true, keyToRecycle: apiKey, chunkToRetry: null };
        } catch (error: any) {
            const errMsg = error.message || '';
            // Treat Quota errors AND Fatal errors (suspended/blocked) the same: Kill the key
            const isKillableError = error.isQuota === true || error.isFatal === true;

            if (isKillableError) {
                const reason = error.isQuota ? "Quota" : "Suspended";
                console.warn(`Key ${maskKey(apiKey)} dead (${reason}). Removing from session.`);
                return { success: false, keyToRecycle: null, chunkToRetry: chunkId };
            } else {
                const failures = (chunkFailures.get(chunkId) || 0) + 1;
                chunkFailures.set(chunkId, failures);

                if (failures <= 3) {
                     await delay(1000); 
                     return { success: false, keyToRecycle: apiKey, chunkToRetry: chunkId };
                } else {
                    return { success: false, keyToRecycle: apiKey, chunkToRetry: null };
                }
            }
        }
    };

    scheduler();
  };

  const pendingChunks = chunks.filter(c => c.status !== 'success');
  const isAllPendingSelected = pendingChunks.length > 0 && pendingChunks.every(c => c.selected);
  const completedCount = chunks.filter(c => c.status === 'success').length;
  const uniqueOrigins = Array.from(new Set(chunks.map(c => c.originFilename)));

  // Get current model info
  const currentModelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel);

  return (
    <div 
      className="flex flex-col h-screen bg-slate-900 text-slate-200"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ApiKeyModal 
        isOpen={showApiKeyModal} 
        onSave={handleApiKeySave} 
        onClose={() => setShowApiKeyModal(false)}
        initialKey={rawApiKeyInput}
      />

      {/* Header */}
      <header className="flex-none bg-slate-850 border-b border-slate-800 p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">AudioSpark <span className="text-slate-500 font-normal">Studio</span></h1>
          </div>
          
          <button 
            onClick={() => setShowApiKeyModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:border-slate-600 transition-all text-xs font-medium text-slate-400 hover:text-white"
          >
            <div className={`w-2 h-2 rounded-full ${apiKeys.length > 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="hidden sm:inline">
              {apiKeys.length} Keys Loaded
            </span>
            <Settings2 className="w-3.5 h-3.5 ml-1" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col max-w-6xl mx-auto w-full p-4 lg:p-6 gap-6">
        
        {/* Controls */}
        <div className="flex-none grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-7 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-400 text-sm font-medium">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                <span>Global Settings</span>
              </div>
              
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                 {/* Model Selector */}
                <div className="flex items-center gap-2 shrink-0" title="Select AI Model">
                   <Bot className="w-4 h-4 text-slate-500" />
                   <select 
                      value={selectedModel} 
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white focus:border-indigo-500 outline-none cursor-pointer max-w-[150px] truncate"
                   >
                      {AVAILABLE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                   </select>
                </div>
                
                {/* Chunk Size Selector */}
                <div className="flex items-center gap-2 shrink-0" title="Character limit per audio chunk">
                  <Scissors className="w-4 h-4 text-slate-500" />
                  <label className="text-xs">Split:</label>
                  <select 
                    value={chunkSize} 
                    onChange={(e) => setChunkSize(parseInt(e.target.value))}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white focus:border-indigo-500 outline-none cursor-pointer"
                  >
                    <option value={1500}>1500 chars (Safe)</option>
                    <option value={2000}>2000 chars (Std)</option>
                    <option value={2500}>2500 chars (Long)</option>
                    <option value={3000}>3000 chars (Max)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 shrink-0" title="Fixed seed ensures consistent voice style across chunks">
                  <Dices className="w-4 h-4 text-slate-500" />
                  <label className="text-xs">Seed:</label>
                  <input 
                    type="number" 
                    value={seed}
                    onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-center text-white focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>
            
            {/* Model Info Badge */}
            {currentModelInfo && (
               <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs">
                 <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                 <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] uppercase tracking-wider ${
                    currentModelInfo.tag === 'Quality' ? 'bg-indigo-500/20 text-indigo-300' :
                    currentModelInfo.tag === 'Speed' ? 'bg-emerald-500/20 text-emerald-300' :
                    'bg-amber-500/20 text-amber-300'
                 }`}>
                    {currentModelInfo.tag}
                 </span>
                 <span className="text-slate-400">{currentModelInfo.desc}</span>
               </div>
            )}

            <input
              type="text"
              value={globalPrompt}
              onChange={(e) => setGlobalPrompt(e.target.value)}
              placeholder="Style/Prompt: E.g., A warm, emotionally expressive young female narrator..."
              className="w-full h-14 bg-[#111827] border border-slate-700 rounded-xl px-4 text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all"
            />
          </div>
          <div className="md:col-span-5">
            <VoiceSelector selectedVoice={selectedVoice} onSelect={setSelectedVoice} />
          </div>
        </div>

        {/* Files Toolbar */}
        <div className="flex-none flex flex-col gap-3">
            
            {notification && (
              <div
                className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                  notification.type === 'error'
                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                    : notification.type === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>{notification.message}</span>
                </div>
                <button
                  onClick={() => setNotification(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div className="flex items-center gap-4">
                 {chunks.length > 0 && (
                  <button 
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    {isAllPendingSelected ? <CheckSquare className="w-5 h-5 text-indigo-400" /> : <Square className="w-5 h-5" />}
                    <span>Select All Pending</span>
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  <h2 className="text-lg font-semibold text-white">Files</h2>
                  {uniqueOrigins.length > 0 && (
                    <span className="text-xs font-mono font-medium text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                      {uniqueOrigins.length} {uniqueOrigins.length === 1 ? 'File' : 'Files'}
                    </span>
                  )}
                  <span className="text-xs font-mono font-medium text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                    {completedCount} / {chunks.length} Done
                  </span>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2.5">
                {chunks.length > 0 && (
                  <>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-all"
                      title="Upload one or multiple .txt files"
                    >
                      <Plus className="w-4 h-4 text-indigo-400" />
                      <span>Add Files</span>
                    </button>

                    {/* Batch Status Indicator */}
                    {isBatchGenerating && batchProgress && (
                      <div className={`
                        flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium border shadow-lg select-none transition-colors
                        ${batchProgress.status.includes('Stopped') 
                          ? 'bg-amber-900/20 border-amber-500/30 text-amber-200' 
                          : 'bg-slate-800 border-slate-700 text-slate-300'}
                      `}>
                         {batchProgress.status.includes('Stopped') ? (
                            <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                         ) : batchProgress.status.includes('Finishing') ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                         ) : (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                         )}
                         <span className="flex items-center gap-3">
                            <span>{batchProgress.status}</span>
                            <span className="w-px h-3 bg-slate-600/50"></span>
                            <span>{batchProgress.current}/{batchProgress.total}</span>
                            
                            {batchProgress.activeThreads > 0 && (
                                <span className="text-emerald-400 flex items-center gap-1" title="Active Threads">
                                    <Zap className="w-3 h-3" fill="currentColor" /> {batchProgress.activeThreads}
                                </span>
                            )}
                            
                            {/* Cooldown */}
                            {batchProgress.cooldownKeys > 0 && (
                               <span className="text-amber-400 flex items-center gap-1" title="Keys Resting">
                                  <Coffee className="w-3 h-3" /> {batchProgress.cooldownKeys}
                              </span>
                            )}
                            
                            {/* Dead */}
                            {batchProgress.deadKeys > 0 && (
                                 <span className="text-red-400 flex items-center gap-1 pl-2 border-l border-slate-600/50" title="Keys Removed (Quota)">
                                    <Ban className="w-3 h-3" /> {batchProgress.deadKeys}
                                </span>
                            )}
                         </span>
                      </div>
                    )}

                     {isBatchGenerating ? (
                        <button 
                          onClick={stopBatch}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-600/10 text-amber-400 border border-amber-600/20 hover:bg-amber-600/20 rounded-lg text-sm font-medium transition-all"
                        >
                          <PauseCircle className="w-4 h-4 fill-amber-400/20" />
                          <span>Stop Batch</span>
                        </button>
                     ) : (
                        <button 
                          onClick={generateSelected}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600/10 text-emerald-400 border border-emerald-600/20 hover:bg-emerald-600/20 rounded-lg text-sm font-medium transition-all"
                        >
                          <Play className="w-4 h-4 fill-emerald-400" />
                          <span>{batchProgress && batchProgress.status.includes('Stopped') ? 'Resume Batch' : 'Run Batch'}</span>
                        </button>
                     )}

                    {/* Download All Split Button + Menu */}
                    <div className="relative flex items-center" ref={downloadMenuRef}>
                      <button
                        onClick={downloadAllChunksZip}
                        disabled={completedCount === 0 || isDownloadingAll}
                        className="flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-l-lg text-sm font-medium shadow-lg shadow-sky-500/20 transition-all"
                        title="Tải 1 lượt tất cả các file audio đã tạo (.zip)"
                      >
                        {isDownloadingAll ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span>Download All ({completedCount})</span>
                      </button>
                      <button
                        onClick={() => setShowDownloadMenu((prev) => !prev)}
                        disabled={completedCount === 0 || isDownloadingAll}
                        className="px-2 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-r-lg border-l border-sky-400/30 text-sm font-medium shadow-lg shadow-sky-500/20 transition-all"
                        title="Tùy chọn kiểu tải xuống hàng loạt"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>

                      {showDownloadMenu && (
                        <div className="absolute right-0 top-full mt-2 w-72 bg-slate-850 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-40">
                          <button
                            onClick={downloadAllChunksZip}
                            className="w-full px-3.5 py-2.5 text-left hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                          >
                            <Archive className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-semibold text-white">
                                Tải tất cả đoạn đã tạo (.zip)
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Đóng gói {completedCount} file .wav rời trong 1 lượt tải
                              </div>
                            </div>
                          </button>

                          <button
                            onClick={mergeEachFile}
                            className="w-full px-3.5 py-2.5 text-left hover:bg-slate-800 flex items-start gap-2.5 transition-colors border-t border-slate-800"
                          >
                            <Layers className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-semibold text-white">
                                Gộp theo từng file gốc & tải (.zip)
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Nối các đoạn của mỗi file .txt thành 1 file .wav hoàn chỉnh
                              </div>
                            </div>
                          </button>

                          <button
                            onClick={downloadAllChunksIndividual}
                            className="w-full px-3.5 py-2.5 text-left hover:bg-slate-800 flex items-start gap-2.5 transition-colors border-t border-slate-800"
                          >
                            <Download className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-semibold text-white">
                                Tải trực tiếp từng file rời (.wav)
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Tải lần lượt từng đoạn .wav không nén
                              </div>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {uniqueOrigins.length > 1 && (
                      <button
                        onClick={mergeEachFile}
                        disabled={completedCount === 0 || isDownloadingAll}
                        className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-300 border border-indigo-500/30 rounded-lg text-sm font-medium transition-all"
                        title="Gộp theo từng file văn bản và tải 1 lượt (.zip)"
                      >
                        <Archive className="w-4 h-4" />
                        <span>Merge per File</span>
                      </button>
                    )}

                    <button 
                      onClick={mergeAll}
                      disabled={completedCount === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-500/20 transition-all"
                    >
                      <Merge className="w-4 h-4" />
                      <span>Merge All</span>
                    </button>
                    <button 
                      onClick={clearAll}
                      className="text-slate-500 hover:text-red-400 text-sm font-medium transition-colors px-2"
                    >
                      Clear All
                    </button>
                  </>
                )}
              </div>
            </div>

             {/* Controls for Batch Settings */}
             {chunks.length > 0 && (
                <div className="flex items-center justify-end gap-6 text-xs text-slate-500 px-2">
                    
                    {/* Max Threads Control */}
                    <div className="flex items-center gap-2" title="Maximum concurrent connections (Parallel processing)">
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Max Threads:</span>
                        <input 
                            type="range" 
                            min="1" 
                            max="10" 
                            step="1" 
                            value={maxThreads} 
                            onChange={(e) => setMaxThreads(parseInt(e.target.value))}
                            className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="font-mono text-indigo-400 w-4 text-right">{maxThreads}</span>
                    </div>

                    {/* Delay Control */}
                    <div className="flex items-center gap-2" title="Time to wait before reusing an API key">
                        <Timer className="w-3.5 h-3.5" />
                        <span>Rest per Key:</span>
                        <input 
                            type="range" 
                            min="2000" 
                            max="30000" 
                            step="1000" 
                            value={minDelay} 
                            onChange={(e) => setMinDelay(parseInt(e.target.value))}
                            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="font-mono text-indigo-400 w-12 text-right">{(minDelay / 1000).toFixed(0)}s</span>
                    </div>
                </div>
            )}
        </div>

        {/* Drop Zone / List */}
        <div className={`
          flex-1 min-h-0 bg-[#0F1623] border rounded-2xl overflow-hidden flex flex-col relative transition-all
          ${isDragging ? 'border-indigo-500 bg-indigo-900/10 ring-2 ring-indigo-500/20' : 'border-slate-800'}
        `}>
          
          {chunks.length === 0 ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center justify-center m-4 cursor-pointer group"
            >
              <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-xl border border-slate-700 group-hover:border-indigo-500/50">
                <Upload className="w-10 h-10 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Drag & Drop text files here</h3>
              <p className="text-slate-500">or click to browse — select one or multiple .txt files at once</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {uniqueOrigins.map((originName) => {
                const fileChunks = chunks.filter((c) => c.originFilename === originName);
                const fileDoneCount = fileChunks.filter((c) => c.status === 'success').length;
                const filePending = fileChunks.filter((c) => c.status !== 'success');
                const isFileAllSelected = filePending.length > 0 && filePending.every((c) => c.selected);
                const isCollapsed = !!collapsedFiles[originName];
                const fileTotalDuration = fileChunks.reduce((sum, c) => sum + (c.duration || 0), 0);

                return (
                  <div key={originName} className="space-y-2.5">
                    {/* File Group Header */}
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/70">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleFileSelection(originName)}
                          disabled={filePending.length === 0}
                          className="flex-none disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                          title="Select/Deselect pending chunks in this file"
                        >
                          {isFileAllSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                          )}
                        </button>

                        <button
                          onClick={() => toggleFileCollapse(originName)}
                          className="flex items-center gap-2 min-w-0 text-left group"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-white shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-white shrink-0" />
                          )}
                          <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                          <span className="font-semibold text-sm text-white truncate">
                            {originName}.txt
                          </span>
                        </button>

                        <span className="text-xs font-mono text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/80 shrink-0">
                          {fileDoneCount}/{fileChunks.length} chunks
                        </span>

                        {fileTotalDuration > 0 && (
                          <span className="text-xs font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded shrink-0">
                            {formatTime(fileTotalDuration)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {fileDoneCount > 1 && (
                          <button
                            onClick={() => downloadFileChunksZip(originName)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors"
                            title={`Tải tất cả các đoạn của ${originName} (.zip)`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download ({fileDoneCount})</span>
                          </button>
                        )}
                        {fileDoneCount > 0 && (
                          <button
                            onClick={() => mergeFileChunks(originName)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-colors"
                            title={`Gộp và tải ${originName}.wav`}
                          >
                            <Merge className="w-3.5 h-3.5" />
                            <span>Merge File</span>
                          </button>
                        )}
                        <button
                          onClick={() => deleteFileChunks(originName)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                          title={`Remove all chunks from ${originName}.txt`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* File Chunks */}
                    {!isCollapsed && (
                      <div className="space-y-2.5 pl-2 sm:pl-4 border-l-2 border-slate-800/80">
                        {fileChunks.map((chunk) => (
                          <div 
                            key={chunk.id} 
                            className={`
                              flex flex-col rounded-xl border transition-all duration-200
                              ${chunk.status === 'generating' ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-[#1a2233] border-slate-800 hover:border-slate-700'}
                            `}
                          >
                            <div className="flex items-center gap-4 p-4">
                              {/* Checkbox */}
                              <button 
                                onClick={() => toggleSelection(chunk.id)} 
                                disabled={chunk.status === 'success'}
                                className="flex-none disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                              >
                                {chunk.selected 
                                  ? <CheckSquare className="w-5 h-5 text-indigo-500" /> 
                                  : <Square className="w-5 h-5 text-slate-600 hover:text-slate-400" />
                                }
                              </button>

                              {/* Status Icon */}
                              <div className="flex-none">
                                {chunk.status === 'success' ? (
                                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                                ) : chunk.status === 'generating' ? (
                                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                                ) : chunk.status === 'error' ? (
                                  <AlertCircle className="w-6 h-6 text-red-500" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full border-2 border-slate-600" />
                                )}
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
                                <span className="font-medium text-slate-200 truncate">
                                  {chunk.originFilename} - {chunk.index}
                                </span>
                                
                                <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 shrink-0">
                                  {chunk.text.length} chars
                                </span>

                                {chunk.duration > 0 && (
                                  <span className="text-xs text-indigo-400 font-mono bg-indigo-400/10 px-2 py-0.5 rounded shrink-0">
                                    {formatTime(chunk.duration)}
                                  </span>
                                )}

                                {/* Completed At Timestamp */}
                                {chunk.completedAt ? (
                                  <span 
                                    className="text-xs text-slate-500 flex items-center gap-1 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 shrink-0 cursor-help" 
                                    title={`Completed: ${new Date(chunk.completedAt).toLocaleString()}`}
                                  >
                                      <Clock className="w-3 h-3" />
                                      {new Date(chunk.completedAt).toLocaleTimeString()}
                                  </span>
                                ) : null}

                                {/* API Key Display */}
                                {chunk.usedApiKey && (
                                  <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/80 font-mono shrink-0" title={chunk.usedApiKey}>
                                    <Key className="w-3 h-3 text-slate-500" />
                                    <span>{maskKey(chunk.usedApiKey)}</span>
                                  </div>
                                )}

                                {/* Error Message - Expanded with truncate and tooltip */}
                                {chunk.errorMessage && (
                                  <div className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20 max-w-[200px] sm:max-w-[300px]" title={chunk.errorMessage}>
                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{chunk.errorMessage}</span>
                                  </div>
                                )}
                              </div>

                              {/* Controls */}
                              <div className="flex items-center gap-2 shrink-0">
                                 {/* Eye/Edit Toggle */}
                                <button 
                                  onClick={() => toggleTextVisibility(chunk.id)}
                                  className={`p-2 rounded-lg transition-colors ${chunk.isTextVisible ? 'text-indigo-400 bg-indigo-400/10' : 'text-slate-500 hover:text-slate-300'}`}
                                  title={chunk.isTextVisible ? "Hide Text" : "Edit/View Text"}
                                >
                                  {chunk.isTextVisible ? <Edit3 className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>

                                <div className="w-px h-6 bg-slate-700 mx-1" />

                                {chunk.status === 'success' ? (
                                  <>
                                    <button 
                                      onClick={() => playAudio(chunk)}
                                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                                      title="Play"
                                    >
                                      {playingId === chunk.id ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                                    </button>
                                    <button 
                                      onClick={() => downloadAudio(chunk)}
                                      className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-colors"
                                      title="Download"
                                    >
                                      <Download className="w-5 h-5" />
                                    </button>
                                    <button 
                                      onClick={() => generateAudio(chunk.id)}
                                      className="p-2 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"
                                      title="Regenerate (Overwrite)"
                                    >
                                      <RefreshCw className="w-5 h-5" />
                                    </button>
                                  </>
                                ) : (
                                  <button 
                                    onClick={() => generateAudio(chunk.id)}
                                    disabled={chunk.status === 'generating'}
                                    className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                                    title="Generate Single"
                                  >
                                    <RefreshCw className={`w-5 h-5 ${chunk.status === 'generating' ? 'animate-spin' : ''}`} />
                                  </button>
                                )}
                                
                                <button 
                                  onClick={() => deleteChunk(chunk.id)}
                                  className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                            
                            {/* Expanded Text View with Editor */}
                            {chunk.isTextVisible && (
                              <div className="px-14 pb-4 animate-in slide-in-from-top-2 duration-200">
                                <div className="relative">
                                  <textarea
                                    value={chunk.text}
                                    onChange={(e) => updateChunkText(chunk.id, e.target.value)}
                                    className="w-full bg-[#111827] rounded-lg p-3 text-sm text-slate-300 font-mono border border-slate-700/50 shadow-inner focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y min-h-[100px] transition-all"
                                    spellCheck={false}
                                    placeholder="Enter text to synthesize..."
                                  />
                                   <div className="absolute bottom-3 right-3 flex items-center gap-2 pointer-events-none">
                                      <span className="text-[10px] text-slate-600 bg-[#111827]/80 px-1 rounded backdrop-blur-sm">
                                        {chunk.text.length} chars
                                      </span>
                                  </div>
                                </div>
                                <div className="flex justify-between mt-2">
                                  <span className="text-[11px] text-slate-500 italic">
                                    {chunk.status === 'success' 
                                      ? "Editing will require regeneration." 
                                      : "Edit text before generating."}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              
               <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-800 rounded-xl p-4 flex items-center justify-center gap-3 cursor-pointer hover:bg-slate-800/50 hover:border-slate-700 transition-colors text-slate-500 hover:text-slate-300"
              >
                <Upload className="w-5 h-5" />
                <span className="text-sm font-medium">Add more text files (.txt)</span>
              </div>
            </div>
          )}

          {/* Hidden Input (supports multiple files) */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".txt,text/plain" 
            multiple
            className="hidden" 
          />
        </div>
      </main>
    </div>
  );
}

export default App;