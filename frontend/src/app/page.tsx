'use client';

import { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';

type StoryEvent = {
  type: 'status' | 'commentary' | 'visual' | 'video_clip' | 'play_video';
  data: string;
  clipUrl?: string;
  mermaid?: string; // Added mermaid property to StoryEvent
  replayCommentary?: {
    climax?: { text: string; audioUrl: string | null; delay: number };
    reaction?: { text: string; audioUrl: string | null; delay: number };
  };
};

type StorybookAsset = {
  title: string;
  narrative: string;
  imageUrl?: string;
};

type AppPhase = 'idle' | 'uploading' | 'analysing' | 'ready' | 'broadcasting' | 'storybook';
type ReplayPhase = 'intro' | 'prompt' | 'playing' | 'outro' | null;

// Map clip title keywords → emoji label shown on the intro card
function eventLabel(title: string): { emoji: string; label: string } {
  const t = title.toLowerCase();
  if (t.includes('goal') || t.includes('penalty')) return { emoji: '⚽', label: 'GOAL!' };
  if (t.includes('save') || t.includes('block')) return { emoji: '🧤', label: 'SAVE!' };
  if (t.includes('corner')) return { emoji: '🏳️', label: 'CORNER!' };
  if (t.includes('foul') || t.includes('tackle')) return { emoji: '🟨', label: 'FOUL!' };
  if (t.includes('shot') || t.includes('strike')) return { emoji: '💥', label: 'SHOT!' };
  if (t.includes('highlight')) return { emoji: '⭐', label: 'HIGHLIGHT' };
  return { emoji: '📺', label: 'REPLAY' };
}

// --- Mermaid React Component ---
function MermaidRenderer({ diagram }: { diagram: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgStr, setSvgStr] = useState<string>('');
  
  useEffect(() => {
    if (!diagram || !containerRef.current) return;
    const render = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        // mermaid.render returns { svg, bindFunctions } in modern versions
        const { svg } = await mermaid.render(id, diagram);
        setSvgStr(svg);
      } catch (err) {
        console.error('Mermaid rendering failed', err);
      }
    };
    render();
  }, [diagram]);

  return (
    <div className="absolute top-4 right-4 z-40 bg-black/80 p-4 rounded-xl border border-white/20 shadow-2xl backdrop-blur-md animate-in slide-in-from-right-8 duration-500 max-w-[40%]">
      <div className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        AI Tactical Analysis
      </div>
      <div 
        ref={containerRef} 
        className="mermaid-wrapper [&>svg]:max-w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svgStr }} 
      />
    </div>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [status, setStatus] = useState('Connecting to Director...');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [persona, setPersona] = useState('excited_narrator');
  const [analysedEventCount, setAnalysedEventCount] = useState<number | null>(null);

  // Replay state — 3 phases: intro → playing → outro
  const [replayEnabled, setReplayEnabled] = useState(true);
  const [replayPhase, setReplayPhase] = useState<ReplayPhase>(null);
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [replayTitle, setReplayTitle] = useState<string>('');
  const [replayPromptInfo, setReplayPromptInfo] = useState<{ clipUrl: string, title: string, commentary?: any } | null>(null);
  const [storybook, setStorybook] = useState<StorybookAsset | null>(null);
  const [pendingStorybook, setPendingStorybook] = useState<StorybookAsset | null>(null);
  const savedVideoTimeRef = useRef<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const replayVideoRef = useRef<HTMLVideoElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const [activeMermaid, setActiveMermaid] = useState<string | null>(null);

  // Initialize Mermaid configuration
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
    });
  }, []);

  // Audio Queue State
  const ttsQueue = useRef<{ text: string, audioUrl: string | null, mermaid?: string }[]>([]);
  const isSpeaking = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Refs that mirror state — needed so stale WS closure always sees the latest value
  const replayPhaseRef = useRef<ReplayPhase>(null);
  const replayEnabledRef = useRef(true);
  // Timestamp queue — items fire when video.currentTime crosses their targetTime
  const timestampQueue = useRef<Array<{ text: string; audioUrl: string | null; targetTime: number; originalEvent?: StoryEvent }>>([]);
  // Removed selectedVoiceRef

  // Removed useEffect for loading voices

  // ─── Audio File Playback Queue ─────────────────────────────────────────────
  // Plays the Google Cloud TTS MP3 files sequentially
  const processQueue = () => {
    if (isSpeaking.current) return;
    const next = ttsQueue.current.shift();
    if (!next) return;

    isSpeaking.current = true;

    if (!next.audioUrl) {
      // Fallback to browser SpeechSynthesis if no MP3 available (for filler/system lines)
      const utterance = new SpeechSynthesisUtterance(next.text);
      utterance.onend = () => {
        isSpeaking.current = false;
        processQueue();
      };
      utterance.onerror = () => {
        isSpeaking.current = false;
        processQueue();
      };
      window.speechSynthesis.speak(utterance);
      return;
    }

    const audio = new Audio(`http://localhost:9090${next.audioUrl}`);
    currentAudioRef.current = audio;

    audio.onended = () => {
      isSpeaking.current = false;
      currentAudioRef.current = null;
      processQueue();
    };

    audio.onerror = () => {
      console.error('Audio playback failed for', next.audioUrl);
      isSpeaking.current = false;
      currentAudioRef.current = null;
      processQueue();
    };

    audio.play().catch(e => {
      console.error('Audio play blocked:', e);
      isSpeaking.current = false;
      currentAudioRef.current = null;
      processQueue();
    });
  };

  const speakCommentary = (rawText: string, audioUrl?: string | null, videoTimestamp?: number, originalEvent?: StoryEvent) => {
    const text = rawText.replace(/<tone:[^>]+>/gi, '').trim();

    if (videoTimestamp !== undefined) {
      // Schedule for when the video crosses this timestamp
      timestampQueue.current.push({ text, audioUrl: audioUrl || null, targetTime: videoTimestamp, originalEvent });
      timestampQueue.current.sort((a, b) => a.targetTime - b.targetTime);
    } else {
      // No timestamp — queue immediately
      setEvents(prev => {
        const updated = [...prev, originalEvent || { type: 'commentary', data: text }];
        setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }), 50);
        return updated;
      });
      ttsQueue.current.push({ text, audioUrl: audioUrl || null });
      processQueue();
    }
  };

  // ─── Video time update — fires Audio when video crosses an event's timestamp ──
  const handleVideoTimeUpdate = () => {
    if (!mainVideoRef.current || timestampQueue.current.length === 0) return;
    const now = mainVideoRef.current.currentTime;
    const due = timestampQueue.current.filter(item => item.targetTime <= now);
    if (due.length === 0) return;
    timestampQueue.current = timestampQueue.current.filter(item => item.targetTime > now);

    // Batch UI updates for all events due at this timestamp
    const newEvents = due.map(item => item.originalEvent || { type: 'commentary', data: item.text }).filter(ev => ev.data !== '' && !ev.data.startsWith('__'));
    if (newEvents.length > 0) {
      setEvents(prev => [...prev, ...newEvents as StoryEvent[]]);
      setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }

    for (const item of due) {
      if (item.text.startsWith('__REPLAY__')) {
        // Dispatch replay: extract clipUrl and title from the sentinel
        const payload = item.text.replace('__REPLAY__', '');
        const sepIndex = payload.indexOf('||');
        const clipUrl = payload.substring(0, sepIndex);
        const rest = payload.substring(sepIndex + 2);
        const sep2Index = rest.indexOf('||');
        let title = rest;
        let commentaryStr = '';
        if (sep2Index !== -1) {
            title = rest.substring(0, sep2Index);
            commentaryStr = rest.substring(sep2Index + 2);
        }

        let commentaryObj: any = undefined;
        try {
            if (commentaryStr) commentaryObj = JSON.parse(commentaryStr);
        } catch (e) {
            console.error("Failed to parse replay commentary", e);
        }

        if (replayEnabledRef.current && replayPhaseRef.current === null) {
          // Instead of starting replay immediately, show the prompt
          if (mainVideoRef.current) {
            savedVideoTimeRef.current = mainVideoRef.current.currentTime;
            mainVideoRef.current.pause();
          }
          replayPhaseRef.current = 'prompt';
          setReplayPhase('prompt');
          setReplayPromptInfo({
            clipUrl,
            title,
            commentary: commentaryObj
          });
        }
      } else if (item.text.startsWith('__MERMAID__')) {
        const payload = item.text.replace('__MERMAID__', '');
        setActiveMermaid(payload);
        // Auto-hide the diagram after 7 seconds
        setTimeout(() => setActiveMermaid(null), 7000);
      } else {
        // Here `audioUrl` is directly available from the item
        ttsQueue.current.push({ text: item.text, audioUrl: item.audioUrl || null });
      }
    }
    processQueue();
  };

  const displayText = (raw: string) => raw.replace(/<tone:[^>]+>/gi, '').trim();

  // ─── 4-phase Replay handlers ──────────────────────────────────────────────
  const startReplay = (clipUrl: string, title: string, commentary?: any) => {
    // If we're coming from prompt, video is already paused, but just in case:
    if (mainVideoRef.current && !mainVideoRef.current.paused) {
      savedVideoTimeRef.current = mainVideoRef.current.currentTime;
      mainVideoRef.current.pause();
    }
    setReplayPromptInfo(null);
    replayPhaseRef.current = 'intro'; // keep ref in sync BEFORE setting state
    setReplayTitle(title);
    setReplayUrl(`http://localhost:9090${clipUrl}`);
    setReplayPhase('intro');
    
    setTimeout(() => {
      replayPhaseRef.current = 'playing';
      setReplayPhase('playing');
      
      // Schedule replay commentary if provided
      if (commentary) {
         if (commentary.climax) {
             setTimeout(() => {
                 speakCommentary(commentary.climax.text, commentary.climax.audioUrl);
             }, commentary.climax.delay * 1000);
         }
         if (commentary.reaction) {
             setTimeout(() => {
                 speakCommentary(commentary.reaction.text, commentary.reaction.audioUrl);
             }, commentary.reaction.delay * 1000);
         }
      }

    }, 2500);
  };

  const skipReplayPrompt = () => {
      const commentary = replayPromptInfo?.commentary;
      setReplayPromptInfo(null);
      replayPhaseRef.current = null;
      setReplayPhase(null);
      if (mainVideoRef.current) {
         // Resume live feed
         mainVideoRef.current.play().catch(() => {});
         
         // If we had a reaction line (Line 2 in original design), play it now since we skipped replay
         if (commentary?.reaction) {
             speakCommentary(commentary.reaction.text, commentary.reaction.audioUrl);
         }
      }
  };

  const handleReplayEnded = () => {
    replayPhaseRef.current = 'outro';
    setReplayPhase('outro');
    setTimeout(() => {
      replayPhaseRef.current = null;
      setReplayPhase(null);
      setReplayUrl(null);
      if (mainVideoRef.current) {
        mainVideoRef.current.currentTime = savedVideoTimeRef.current;
        mainVideoRef.current.play().catch(() => { });
        
        // Add a small "back to live" commentary to fill the gap after replay
        setTimeout(() => {
           const transitionLines = [
             "Let's get back to the live action.",
             "Action resumes here at the stadium.",
             "The whistle blows and we continue.",
             "Back to the broadcast now."
           ];
           const randomLine = transitionLines[Math.floor(Math.random() * transitionLines.length)];
           speakCommentary(randomLine, null);
        }, 1000);
      }
    }, 2000);
  };

  // Set slow-motion whenever the replay video starts playing
  const handleReplayPlay = () => {
    if (replayVideoRef.current) replayVideoRef.current.playbackRate = 0.5;
  };

  // ─── WebSocket ────────────────────────────────────────────────────────────
  useEffect(() => {
    ws.current = new WebSocket('ws://localhost:9090');
    ws.current.onopen = () => setStatus('Connected to AI Director');
    ws.current.onclose = () => setStatus('Disconnected from Director');

    ws.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as StoryEvent & { 
          filename?: string; 
          eventCount?: number; 
          videoTimestamp?: number;
          audioUrl?: string; 
        };

        if (payload.type === 'status') {
          setStatus(payload.data);
          setEvents(prev => {
            const updated = [...prev, payload];
            setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }), 50);
            return updated;
          });
          return;
        }

        if ((payload as any).type === 'analysis_complete') {
          setAnalysedEventCount((payload as any).eventCount);
          setPhase('ready');
          setStatus(`✅ Analysis done — ${(payload as any).eventCount} tactical event(s). Choose your commentator!`);
          return;
        }

        if ((payload as any).type === 'storybook') {
          // Delay storybook phase until the video actually finishes
          const book = (payload as any).data;
          setPendingStorybook(book);
          
          // If video is already done or near the end, show it now
          if (mainVideoRef.current && (mainVideoRef.current.ended || mainVideoRef.current.currentTime >= mainVideoRef.current.duration - 1)) {
            setStorybook(book);
            setPhase('storybook');
            setPendingStorybook(null);
          }
          return;
        }

        if (payload.type === 'play_video') {
          if (mainVideoRef.current?.paused) {
            mainVideoRef.current.currentTime = 0;
            mainVideoRef.current.volume = 0.2;
            mainVideoRef.current.play().catch(() => { });
          }
          return;
        }

        if (payload.type === 'commentary') {
          speakCommentary(payload.data, payload.audioUrl, payload.videoTimestamp, payload);
          return;
        }

        if (payload.type === 'visual') {
           if (payload.mermaid) {
             timestampQueue.current.push({ text: `__MERMAID__${payload.mermaid}`, audioUrl: null, targetTime: payload.videoTimestamp || 0, originalEvent: payload });
           } else {
             // Queue visuals just like commentary
             timestampQueue.current.push({ text: '', audioUrl: null, targetTime: payload.videoTimestamp || 0, originalEvent: payload });
           }
           timestampQueue.current.sort((a, b) => a.targetTime - b.targetTime);
           return;
        }

        if (payload.type === 'video_clip') {
          if (replayEnabledRef.current && replayPhaseRef.current === null && payload.clipUrl) {
            const fireAt: number | undefined = payload.videoTimestamp;
            const commentaryStr = payload.replayCommentary ? `||${JSON.stringify(payload.replayCommentary)}` : '';
            if (fireAt !== undefined) {
              // Schedule replay via timestamp queue AND buffer for UI
              timestampQueue.current.push({
                text: `__REPLAY__${payload.clipUrl}||${payload.data}${commentaryStr}`,
                audioUrl: null, // Replays don't have audioUrl here
                targetTime: fireAt,
                originalEvent: payload
              });
              timestampQueue.current.sort((a, b) => a.targetTime - b.targetTime);
            } else {
              setEvents(prev => {
                const updated = [...prev, payload];
                setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }), 50);
                return updated;
              });
              
              if (mainVideoRef.current) {
                 savedVideoTimeRef.current = mainVideoRef.current.currentTime;
                 mainVideoRef.current.pause();
              }
              replayPhaseRef.current = 'prompt';
              setReplayPhase('prompt');
              setReplayPromptInfo({
                 clipUrl: payload.clipUrl,
                 title: payload.data,
                 commentary: payload.replayCommentary
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    return () => ws.current?.close();
  }, []);

  // ─── Upload → immediately Ready (no upfront analysis) ─────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase('uploading');
    setStatus(`Uploading ${file.name}...`);
    setEvents([]);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const res = await fetch('http://localhost:9090/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const result = await res.json();
      setUploadedFileName(result.filename);
      // Skip analysis phase — go straight to ready for live chunking
      setPhase('ready');
      setStatus('Video ready. Select a persona and Generate!');
    } catch (error) {
      console.error('Error uploading video:', error);
      setStatus('Upload failed. Check backend.');
      setPhase('idle');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateCommentary = () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !uploadedFileName) return;
    ws.current.send(JSON.stringify({ type: 'start_pipeline', filename: uploadedFileName, persona }));
    setEvents([]);
    setPhase('broadcasting');

    // Video will auto-start (from t=0) exactly when the first piece of commentary arrives over WebSocket
  };

  const handleStopPipeline = () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ type: 'stop_pipeline' }));
    
    // Stop all video
    if (mainVideoRef.current) mainVideoRef.current.pause();
    if (replayVideoRef.current) replayVideoRef.current.pause();
    
    // Clear audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
    
    // Reset state flags
    isSpeaking.current = false;
    ttsQueue.current = [];
    timestampQueue.current = [];
    replayPhaseRef.current = null;
    
    // Reset visual state
    setReplayPhase(null);
    setPhase('ready');
    setPendingStorybook(null);
    setActiveMermaid(null);
    setReplayPromptInfo(null);
  };

  const isConnected = status.includes('Connected') || status.includes('done') || status.includes('✅');

  // --- Share Replay Function ---
  const shareReplay = async (clipUrl: string, title: string) => {
     const fullUrl = `http://localhost:9090${clipUrl}`;
     const shareText = `Check out this highlight: ${title} 🔥 Powered by AI Director's Box!`;
     
     if (navigator.share) {
       try {
         await navigator.share({
           title: 'AI Director Highlight',
           text: shareText,
           url: fullUrl
         });
       } catch (error) {
         console.log('Error sharing', error);
       }
     } else {
       // Fallback to Twitter intent
       const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(fullUrl)}`;
       window.open(twitterUrl, '_blank');
     }
  };

  // --- Download Story Function ---
  const downloadStory = async (asset: StorybookAsset) => {
    // Construct a standalone HTML file with styles
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${asset.title} - AI Director's Box</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
              body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #e5e5e5; }
              .glass { background: rgba(23, 23, 23, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); }
          </style>
      </head>
      <body class="min-h-screen flex items-center justify-center p-6 md:p-12">
          <div class="max-w-5xl w-full glass rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
              <div class="md:w-5/12 relative aspect-video md:aspect-auto bg-black shrink-0">
                  ${asset.imageUrl ? `<img src="${asset.imageUrl}" class="absolute inset-0 w-full h-full object-cover">` : ''}
                  <div class="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-l from-[#0a0a0a] to-transparent"></div>
              </div>
              <div class="p-8 md:p-16 flex flex-col justify-center">
                  <div class="mb-6 flex gap-3">
                      <span class="px-3 py-1 bg-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-widest ring-1 ring-indigo-500/30">Post-Match Recap</span>
                  </div>
                  <h1 class="text-3xl md:text-5xl font-black text-white leading-tight mb-8 tracking-tight">${asset.title}</h1>
                  <div class="prose prose-invert prose-indigo prose-p:text-neutral-300 prose-p:leading-relaxed text-lg">
                      ${asset.narrative}
                  </div>
                  <div class="mt-12 pt-8 border-t border-white/10 text-neutral-500 text-xs font-mono">
                      Generated by AI Director's Box • ${new Date().toLocaleDateString()}
                  </div>
              </div>
          </div>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Match_Story_${asset.title.replace(/\s+/g, '_')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
          <div className={`h-2 w-2 rounded-full animate-pulse ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
          <span className={isConnected ? 'text-emerald-400' : 'text-amber-400'}>{status}</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Playback Area */}
        <section className="lg:col-span-2 space-y-6">

          {/* Video Player — main + replay overlay stacked */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black ring-1 ring-white/10 shadow-2xl">

            {/* Main video (always mounted so we can pause/resume) */}
            {uploadedFileName ? (
              <video
                ref={mainVideoRef}
                src={`http://localhost:9090/uploads/${uploadedFileName}`}
                controls
                className="absolute inset-0 w-full h-full object-contain z-10 bg-black"
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={() => {
                  if (pendingStorybook) {
                    setStorybook(pendingStorybook);
                    setPhase('storybook');
                    setPendingStorybook(null);
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <p className="text-neutral-500 font-mono text-sm uppercase tracking-widest flex flex-col items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  Waiting for Video Feed...
                </p>
              </div>
            )}

            {/* ── INSTANT REPLAY overlay — 4 phases ── */}
            {replayPhase && (
              <div className="absolute inset-0 z-30 flex flex-col bg-black/80 backdrop-blur-sm">

                {/* ── Phase 0: PROMPT card ── */}
                {replayPhase === 'prompt' && replayPromptInfo && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-6
                                  bg-black/90 animate-in fade-in duration-300">
                      <div className="text-4xl">😲</div>
                      <div className="text-3xl font-black uppercase tracking-widest text-white text-center">
                        Great Play!<br/>
                        <span className="text-indigo-400">Watch Replay?</span>
                      </div>
                      
                      <div className="flex gap-4 mt-4">
                          <button 
                             onClick={() => startReplay(replayPromptInfo.clipUrl, replayPromptInfo.title, replayPromptInfo.commentary)}
                             className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold uppercase tracking-wider transition-colors shadow-lg shadow-red-600/20 flex items-center gap-2"
                          >
                             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
                             Yes, Show Me
                          </button>
                          <button 
                             onClick={skipReplayPrompt}
                             className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold uppercase tracking-wider transition-colors border border-white/10"
                          >
                             No, Continue Live
                          </button>
                      </div>
                      
                      {/* Auto-skip progress bar indicator could go here */}
                  </div>
                )}

                {/* ── Phase 1: INTRO card ── */}
                {replayPhase === 'intro' && (() => {
                  const { emoji, label } = eventLabel(replayTitle);
                  return (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6
                                    bg-gradient-to-b from-neutral-900 to-black animate-in fade-in duration-500">
                      {/* Pulsing badge */}
                      <div className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg animate-pulse">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
                        📺 Instant Replay
                      </div>
                      {/* Big event emoji */}
                      <div className="text-8xl animate-in zoom-in duration-700">{emoji}</div>
                      {/* Event label */}
                      <div className="text-5xl font-black uppercase tracking-widest text-white
                                      animate-in slide-in-from-bottom-6 duration-700">
                        {label}
                      </div>
                      {/* Clip subtitle */}
                      <div className="text-neutral-400 text-sm font-mono uppercase tracking-widest">
                        {replayTitle}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Phase 2: PLAYING (slow-motion) ── */}
                {replayPhase === 'playing' && replayUrl && (
                  <>
                    {/* 📺 badge stays visible */}
                    <div className="absolute top-4 left-4 z-40 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
                      📺 Instant Replay
                    </div>
                    {/* Slow-mo badge */}
                    <div className="absolute top-4 left-40 z-40 bg-amber-500/90 text-black px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">
                      0.5× Slow Mo
                    </div>
                    {/* Skip button */}
                    <button
                      onClick={handleReplayEnded}
                      className="absolute top-4 right-4 z-40 px-3 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-white text-xs rounded-full border border-white/10 backdrop-blur transition-colors"
                    >
                      Skip ▶▶
                    </button>
                    <video
                      ref={replayVideoRef}
                      src={replayUrl}
                      autoPlay
                      className="w-full h-full object-contain animate-in fade-in duration-300"
                      onPlay={handleReplayPlay}
                      onEnded={handleReplayEnded}
                    />
                  </>
                )}

                {/* ── Phase 3: OUTRO — fade to live ── */}
                {replayPhase === 'outro' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4
                                  bg-black/90 animate-in fade-in duration-500">
                    <div className="text-neutral-400 text-xs font-mono uppercase tracking-widest animate-pulse">
                      Returning to Live
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" style={{ animationDelay: '0ms' }}></div>
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" style={{ animationDelay: '200ms' }}></div>
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" style={{ animationDelay: '400ms' }}></div>
                    </div>
                    <div className="text-white text-lg font-semibold tracking-tight">▶ Live Match</div>
                  </div>
                )}
              </div>
            )}
          {/* ── LIVE TACTICAL MERMAID OVERLAY ── */}
          {activeMermaid && !replayPhase && (
             <MermaidRenderer diagram={activeMermaid} />
          )}
          </div>

          {/* Director Controls */}
          <div className="p-6 rounded-2xl bg-neutral-900/50 ring-1 ring-white/5 backdrop-blur-sm space-y-4">
            <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest">Director Controls</h2>

            <div className="flex flex-wrap items-center gap-3">

              {/* 1 — Upload */}
              <input type="file" accept="video/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={phase === 'uploading' || phase === 'analysing'}
                className="h-10 px-4 bg-neutral-800 hover:bg-neutral-700 transition-colors rounded-lg font-medium text-sm flex items-center gap-2 border border-white/5 disabled:opacity-50 whitespace-nowrap"
              >
                {phase === 'uploading' ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white rounded-full" />Uploading...</>
                ) : phase === 'analysing' ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full" />Analysing...</>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Upload Video
                  </>
                )}
              </button>

              {(phase === 'ready' || phase === 'broadcasting') && (<>

                {/* 2 — Persona */}
                <select
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  disabled={phase === 'broadcasting'}
                  className="h-10 px-3 bg-neutral-900 border border-white/10 rounded-lg text-sm font-medium text-neutral-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                >
                  <option value="excited_narrator">🗣️ Excited Commentator</option>
                  <option value="dry_british_pundit">🧐 Dry British Pundit</option>
                  <option value="tactical_nerd">🤓 Tactical Analyst</option>
                  <option value="comedian_fan">🤪 Die-hard Fan</option>
                  <option value="brazilian_narrator">🇧🇷 Brazilian Narrator</option>
                </select>
                <button
                  onClick={handleGenerateCommentary}
                  disabled={phase === 'broadcasting'}
                  className="h-10 px-4 bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-lg font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  {phase === 'broadcasting' ? 'Broadcasting...' : 'Generate Commentary'}
                </button>

                {phase === 'broadcasting' && (
                  <button
                    onClick={handleStopPipeline}
                    className="h-10 px-4 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30 transition-colors rounded-lg font-medium text-sm flex items-center gap-2 whitespace-nowrap"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                    Stop Process
                  </button>
                )}

                {/* 5 — Replay toggle */}
                <button
                  onClick={() => { const next = !replayEnabled; replayEnabledRef.current = next; setReplayEnabled(next); }}
                  title={replayEnabled ? 'Replay ON — click to disable' : 'Replay OFF — click to enable'}
                  className={`h-10 px-4 flex items-center gap-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap
                    ${replayEnabled
                      ? 'bg-red-600/20 border-red-500/40 text-red-400 hover:bg-red-600/30'
                      : 'bg-neutral-800 border-white/10 text-neutral-500 hover:bg-neutral-700'
                    }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" /><rect x="3" y="6" width="12" height="12" rx="2" ry="2" /></svg>
                  {replayEnabled ? '📺 Replay ON' : '📺 Replay OFF'}
                </button>
              </>)}
            </div>
          </div>

        </section>

        {/* Story Feed */}
        <section className="relative h-[800px] flex flex-col rounded-2xl bg-neutral-900/40 ring-1 ring-white/5 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 bg-neutral-900/80 backdrop-blur-md z-10">
            <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              Live Story Feed
            </h2>
          </div>

          <div ref={feedRef} className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth pb-32 no-scrollbar">
            {pendingStorybook && (
              <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
                <button 
                  onClick={() => { setStorybook(pendingStorybook); setPhase('storybook'); }}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold uppercase tracking-widest shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 border border-white/10"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
                  View Full Match Story
                </button>
              </div>
            )}
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
                      {displayText(ev.data)}
                    </p>
                  )}
                  {ev.type === 'visual' && (
                    <div className="flex items-center gap-2 text-sm text-cyan-400 bg-cyan-400/5 border border-cyan-400/20 rounded-lg px-3 py-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                      {ev.data}
                    </div>
                  )}
                  {ev.type === 'video_clip' && (
                    <div className="flex items-center justify-between text-sm text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" /><rect x="3" y="6" width="12" height="12" rx="2" ry="2" /></svg>
                        {ev.data}
                      </div>
                      <div className="flex items-center gap-2">
                          {ev.clipUrl && (
                            <button
                              onClick={() => shareReplay(ev.clipUrl!, ev.data)}
                              className="text-xs px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded transition-colors flex items-center gap-1"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                              Share
                            </button>
                          )}
                          {ev.clipUrl && (
                            <button
                              onClick={() => startReplay(ev.clipUrl!, ev.data)}
                              className="text-xs px-2 py-1 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 rounded transition-colors"
                            >
                              📺 Replay
                            </button>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-neutral-900/90 to-transparent pointer-events-none"></div>
        </section>
      </div>

      {/* ── AI Storybook Overlay ── */}
      {phase === 'storybook' && storybook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-12 animate-in fade-in zoom-in-95 duration-700">
          <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-xl" />
          <div className="relative w-full max-w-5xl max-h-[95vh] md:max-h-[90vh] overflow-y-auto bg-neutral-900 ring-1 ring-white/10 rounded-3xl shadow-2xl flex flex-col md:flex-row no-scrollbar select-none">
            
            {/* Storybook Header - Mobile ONLY (Shows above image) */}
            <div className="md:hidden p-6 pb-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="px-3 py-1 bg-indigo-500/20 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-widest ring-1 ring-indigo-500/30 whitespace-nowrap">
                  Post-Match Recap
                </div>
                <div className="text-[10px] font-mono text-neutral-500 bg-neutral-800 px-2 py-1 rounded whitespace-nowrap">
                  Gemini 2.5 Flash
                </div>
              </div>
              <h1 className="text-[clamp(1.5rem,8vw,3.5rem)] font-black text-white leading-[1.1] mb-2 tracking-tight break-words">
                {storybook.title}
              </h1>
            </div>

            {/* Storybook Image */}
            <div className="md:w-5/12 relative aspect-video md:aspect-auto bg-black shrink-0 md:rounded-l-3xl overflow-hidden">
              {storybook.imageUrl ? (
                <img src={storybook.imageUrl} alt="AI Generated Illustration" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900 border-r border-white/5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-700 mb-4 md:mb-6"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <p className="text-neutral-500 font-mono text-[10px] text-center px-8">Illustration processing...</p>
                </div>
              )}
              {/* Gradient fade to text */}
              <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-l from-neutral-900 via-transparent to-transparent pointer-events-none" />
            </div>

            {/* Storybook Text */}
            <div className="relative flex-1 p-6 sm:p-8 md:p-12 lg:p-16 flex flex-col">
              {/* Header - Desktop ONLY */}
              <div className="hidden md:block">
                <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 md:mb-6">
                  <div className="px-3 py-1 bg-indigo-500/20 text-indigo-400 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest ring-1 ring-indigo-500/30 whitespace-nowrap">
                    Post-Match Recap
                  </div>
                  <div className="text-[10px] md:text-xs font-mono text-neutral-500 bg-neutral-800 px-2 py-1 rounded whitespace-nowrap">
                    Generated by Gemini 2.5 Flash
                  </div>
                </div>
                
                <h1 className="text-[clamp(1.5rem,8vw,3.5rem)] font-black text-white leading-[1.1] mb-6 md:mb-8 tracking-tight break-words">
                  {storybook.title}
                </h1>
              </div>
              
              <div 
                className="prose prose-invert prose-indigo prose-p:text-neutral-300 prose-p:leading-relaxed max-w-none text-base md:text-lg"
                dangerouslySetInnerHTML={{ __html: storybook.narrative }}
              />

              <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-white/10 flex gap-4">
                <button onClick={() => setPhase('idle')} className="h-10 md:h-12 px-5 md:px-6 bg-white text-black text-sm md:text-base font-semibold rounded-xl hover:bg-neutral-200 transition-colors">
                  Analyze Another Match
                </button>
                <button 
                  onClick={() => downloadStory(storybook)} 
                  className="h-10 md:h-12 px-5 md:px-6 bg-indigo-600 text-white text-sm md:text-base font-semibold rounded-xl hover:bg-indigo-500 transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Download Story
                </button>
              </div>
            </div>
            
          </div>
        </div>
      )}

    </main>
  );
}
