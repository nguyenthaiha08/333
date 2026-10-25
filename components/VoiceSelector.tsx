import React from 'react';
import { AVAILABLE_VOICES, VoiceName } from '../types';
import { Mic2 } from 'lucide-react';

interface VoiceSelectorProps {
  selectedVoice: VoiceName;
  onSelect: (voice: VoiceName) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({ selectedVoice, onSelect }) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
        <Mic2 className="w-4 h-4" />
        <span>Voice Persona</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {AVAILABLE_VOICES.map((voice) => {
          const isSelected = selectedVoice === voice.name;
          return (
            <button
              key={voice.name}
              onClick={() => onSelect(voice.name)}
              className={`
                relative flex flex-col items-center justify-center w-20 h-16 rounded-lg border transition-all duration-200
                ${isSelected 
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]' 
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-750'
                }
              `}
            >
              <span className={`text-sm font-bold ${isSelected ? 'text-indigo-300' : 'text-slate-200'}`}>
                {voice.name}
              </span>
              <span className={`text-[10px] uppercase tracking-wider mt-0.5 ${isSelected ? 'text-indigo-400/80' : 'text-slate-500'}`}>
                {voice.gender}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};