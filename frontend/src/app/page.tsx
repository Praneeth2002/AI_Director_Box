'use client';

import { useEffect, useState, useRef } from 'react';

type StoryEvent = {
  type: 'status' | 'commentary' | 'visual' | 'video_clip';
  data: string;
  metadata?: any;
};

export default function Home() {
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [status, setStatus] = useState('Connecting to Director...');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [persona, setPersona] = useState('excited_narrator');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ws = useRef<WebSocket | null>(null);

  // Maps each tone tag to distinct TTS voice properties so the voice
  // actually sounds excited/calm/etc. rather than flat for every line.
  const speakCommentary = (rawText: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const toneMatch = rawText.match(/<tone:([^>]+)>/i);
    const tone = toneMatch ? toneMatch[1].toLowerCase() : 'calm';
    const cleanText = rawText.replace(/<tone:[^>]+>/gi, '').trim();

    // Cancel any ongoing speech so new lines don't pile up silently
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Each tone gets genuinely different voice parameters
    switch (tone) {
      case 'excited':
        utterance.rate = 1.45;  // Fast, breathless
        utterance.pitch = 1.6;   // High energy
        utterance.volume = 1.0;
        break;
      case 'anticipation':
        utterance.rate = 0.95;  // Slightly slower, building tension
        utterance.pitch = 1.2;
        utterance.volume = 0.95;
        break;
      case 'calm':
        utterance.rate = 0.9;   // Measured, composed
        utterance.pitch = 0.95;
        utterance.volume = 0.85;
        break;
      case 'analytical':
        utterance.rate = 0.85;  // Deliberate, considered
        utterance.pitch = 0.85;
        utterance.volume = 0.8;
        break;
      case 'disappointed':
        utterance.rate = 0.8;   // Slow, deflated
        utterance.pitch = 0.75;
        utterance.volume = 0.75;
        break;
      case 'funny':
        utterance.rate = 1.2;   // Upbeat and playful
        utterance.pitch = 1.4;
        utterance.volume = 1.0;
        break;
      default:
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.9;
    }

    window.speechSynthesis.speak(utterance);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setStatus(`Uploading ${file.name}...`);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const response = await fetch('http://localhost:9090/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const result = await response.json();
      setUploadedFileName(result.filename);
      setStatus(`Ready to process: ${file.name}`);
      console.log('Upload success:', result);

    } catch (error) {
      console.error('Error uploading video:', error);
      setStatus('Upload failed. Check backend.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    ws.current = new WebSocket('ws://localhost:9090');

    ws.current.onopen = () => {
      setStatus('Connected to AI Director');
    };

    ws.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'status') {
          setStatus(payload.data);
        } else {
          setEvents(prev => [...prev, payload]);
          if (payload.type === 'commentary') {
            speakCommentary(payload.data);
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    ws.current.onclose = () => {
      setStatus('Disconnected from Director');
    };

    return () => {
      ws.current?.close();
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-indigo-500/10 bg-neutral-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" /><rect x="3" y="6" width="12" height="12" rx="2" ry="2" /></svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">The AI Director&apos;s Box</h1>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className={`h-2 w-2 rounded-full animate-pulse ${status.includes('Connected') || status.includes('Ready') ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
          <span className={status.includes('Connected') || status.includes('Ready') ? 'text-emerald-400' : 'text-amber-400'}>
            {status}
          </span>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Playback Area (Left 2 columns) */}
        <section className="lg:col-span-2 space-y-6">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black ring-1 ring-white/10 shadow-2xl flex items-center justify-center group">
            {/* Main Video Player */}
            {uploadedFileName ? (
              <video
                ref={videoRef}
                src={`http://localhost:9090/uploads/${uploadedFileName}`}
                controls
                className="absolute inset-0 w-full h-full object-contain z-10 bg-black"
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10"></div>
                <p className="z-20 text-neutral-500 font-mono text-sm uppercase tracking-widest flex flex-col items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  Waiting for Video Feed...
                </p>
              </>
            )}

            {/* Dynamic Overlays Container */}
            <div className="absolute inset-0 z-30 pointer-events-none p-6 flex flex-col justify-end">
              {/* Overlay components will render here based on AI tags */}
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-neutral-900/50 ring-1 ring-white/5 backdrop-blur-sm">
            <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-4">Director Controls</h2>
            <div className="flex gap-4">
              {/* Hidden file input */}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 transition-colors rounded-lg font-medium shadow-lg shadow-black/20 text-sm flex items-center gap-2 border border-white/5 disabled:opacity-50"
              >
                {isUploading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white rounded-full"></span>
                    Uploading...
                  </span>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Upload Video
                  </>
                )}
              </button>

              {/* Persona Dropdown */}
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-sm font-medium text-neutral-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="excited_narrator">🗣️ Excited Commentator</option>
                <option value="dry_british_pundit">🧐 Dry British Pundit</option>
                <option value="tactical_nerd">🤓 Tactical Analyst (Serious)</option>
                <option value="comedian_fan">🤪 Die-hard Fan (Jokes)</option>
                <option value="brazilian_narrator">🇧🇷 Brazilian Narrator</option>
              </select>

              <button
                onClick={() => {
                  if (ws.current && ws.current.readyState === WebSocket.OPEN && uploadedFileName) {
                    ws.current.send(JSON.stringify({ type: 'start_pipeline', filename: uploadedFileName, persona: persona }));
                    setEvents([]);
                    if (videoRef.current) {
                      videoRef.current.currentTime = 0;
                      videoRef.current.volume = 0.2; // Lower volume to 20%
                      videoRef.current.play().catch(e => console.error("Playback failed: ", e));
                    }
                  }
                }}
                disabled={!uploadedFileName}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-lg font-medium shadow-lg shadow-indigo-600/20 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Start Agent Pipeline
              </button>
            </div>
          </div>
        </section>

        {/* Story Feed (Right Column) */}
        <section className="relative h-[800px] flex flex-col rounded-2xl bg-neutral-900/40 ring-1 ring-white/5 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 bg-neutral-900/80 backdrop-blur-md z-10">
            <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              Live Story Feed
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth pb-32">
            {events.length === 0 ? (
              <div className="text-center text-neutral-500 text-sm mt-20 flex flex-col items-center gap-4 animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                Awaiting first insight from Gemini...
              </div>
            ) : (
              events.map((ev, i) => (
                <div key={i} className="animate-in slide-in-from-bottom-4 fade-in duration-500">
                  {ev.type === 'commentary' && (
                    <p className="text-lg leading-relaxed text-neutral-200 border-l-2 border-indigo-500 pl-4">
                      {ev.data}
                    </p>
                  )}
                  {/* Handle other types like visual blocks here */}
                </div>
              ))
            )}
          </div>
          {/* Gradient overlay at bottom of feed */}
          <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-neutral-900/90 to-transparent pointer-events-none"></div>
        </section>
      </div>
    </main>
  );
}
