import React, { useState, useEffect } from 'react';
import { Key, Layers, Trash2, Plus, X, Eye, EyeOff, AlertCircle, Copy, Check } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onSave: (keys: string) => void;
  onClose: () => void;
  initialKey: string;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onSave, onClose, initialKey }) => {
  // Store the list of valid keys
  const [keyList, setKeyList] = useState<string[]>([]);
  // Store the temporary input for adding new keys
  const [inputValue, setInputValue] = useState('');
  const [showValues, setShowValues] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Initialize from prop
  useEffect(() => {
    if (initialKey) {
      const parsed = initialKey.split('\n').map(k => k.trim()).filter(k => k.length > 0);
      setKeyList(parsed);
    } else {
      setKeyList([]);
    }
  }, [initialKey, isOpen]);

  const handleAddKeys = () => {
    if (!inputValue.trim()) return;

    const newKeys = inputValue
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0 && !keyList.includes(k)); // Avoid exact duplicates

    if (newKeys.length > 0) {
      setKeyList(prev => [...prev, ...newKeys]);
      setInputValue('');
    }
  };

  const handleRemoveKey = (index: number) => {
    setKeyList(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    if (keyList.length === 0) return;
    // Removed confirmation dialog as requested
    setKeyList([]);
  };

  const handleCopyAll = async () => {
    if (keyList.length === 0) return;
    try {
      await navigator.clipboard.writeText(keyList.join('\n'));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy keys', err);
    }
  };

  const handleSave = () => {
    // Join with newlines to maintain compatibility with App.tsx parsing
    onSave(keyList.join('\n'));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleAddKeys();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex-none p-6 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3 text-indigo-400">
            <Layers className="w-6 h-6" />
            <h2 className="text-xl font-semibold text-white">API Key Manager</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* LEFT: Add Keys Section */}
          <div className="flex-1 p-6 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col bg-slate-850/50">
            <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add New Keys
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Paste keys here (one per line). Duplicates will be ignored.
            </p>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="AIzaSy...&#10;AIzaSy..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-xs font-mono text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder-slate-700 resize-none min-h-[120px]"
              spellCheck={false}
            />
            <button
              onClick={handleAddKeys}
              disabled={!inputValue.trim()}
              className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-all border border-slate-600"
            >
              Add to List
            </button>
          </div>

          {/* RIGHT: Manage Keys Section */}
          <div className="flex-1 p-6 flex flex-col min-h-[300px]">
             {/* Header with Counters and Toggle */}
             <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                  <Key className="w-4 h-4" /> Active Keys ({keyList.length})
                </h3>
                <button 
                  onClick={() => setShowValues(!showValues)}
                  className="text-xs text-slate-500 hover:text-indigo-400 flex items-center gap-1"
                >
                  {showValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showValues ? 'Hide' : 'Show'}
                </button>
             </div>

             {/* Bulk Actions Toolbar */}
             <div className="flex gap-2 mb-3 pb-3 border-b border-slate-800">
                <button
                  onClick={handleCopyAll}
                  disabled={keyList.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-all border border-slate-700 disabled:opacity-50"
                  title="Copy all keys to clipboard"
                >
                  {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {isCopied ? 'Copied' : 'Copy All'}
                </button>
                <button
                  onClick={handleClearAll}
                  disabled={keyList.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 rounded text-xs transition-all border border-red-900/30 disabled:opacity-50"
                  title="Delete all keys"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
             </div>

             <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                {keyList.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-lg">
                    <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">No keys added yet.</p>
                  </div>
                ) : (
                  keyList.map((k, idx) => (
                    <div key={idx} className="group flex items-center justify-between p-2 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-md transition-all">
                      <code className="text-xs text-slate-300 font-mono truncate max-w-[180px]">
                        {showValues ? k : `${k.substring(0, 8)}...${k.substring(k.length - 4)}`}
                      </code>
                      <button 
                        onClick={() => handleRemoveKey(idx)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove Key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
             </div>
             
             {keyList.length > 0 && (
               <div className="mt-3 pt-3 border-t border-slate-800">
                  <p className="text-[10px] text-slate-500 text-center">
                    System will automatically rotate through these keys if Quota limits are reached.
                  </p>
               </div>
             )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-none p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900 rounded-b-xl">
           <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center text-xs text-indigo-400 hover:text-indigo-300 mr-auto transition-colors"
            >
              Get more keys &rarr;
            </a>
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-500/20 transition-all"
            >
              Save Configuration
            </button>
        </div>

      </div>
    </div>
  );
};