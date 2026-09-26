import React, { useState, useEffect, useRef } from 'react';

export const VoiceInputDemo: React.FC = () => {
  const [text, setText] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);

  // Use refs to keep persistent, mutable references that don't trigger re-renders
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 1. Initialize the Web Speech API securely
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("Web Speech API is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    // 2. Configure specifically to bypass the Android Chromium engine lock
    if (isMobile) {
      recognition.continuous = false; // CRITICAL: Must be false on Android to force onresult to fire
      recognition.interimResults = true;
    } else {
      recognition.continuous = true;  // Keep true for stable desktop laptop streaming
      recognition.interimResults = true;
    }

    // 3. Handle incoming speech strings
    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptText = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcriptText;
        } else {
          interimTranscript += transcriptText;
        }
      }

      // Sync directly to the native DOM element first to stay ahead of React's render cycles
      const currentSpeech = finalTranscript || interimTranscript;
      if (textareaRef.current) {
        textareaRef.current.value = currentSpeech;
      }

      // Update the reactive state variable for the rest of your app tree
      setText(currentSpeech);
    };

    // 4. Implement the seamless Mobile Auto-Restart Bridge
    recognition.onend = () => {
      // If the user hasn't explicitly tapped "Stop", instantly reboot the engine 
      if (isMobile && shouldListenRef.current) {
        try {
          recognition.start();
        } catch (error) {
          console.log("Speech engine auto-restarting...", error);
        }
      } else if (!shouldListenRef.current) {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error error:", event.error);
      if (event.error === 'not-allowed') {
        shouldListenRef.current = false;
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    // Clean up when the component unmounts
    return () => {
      shouldListenRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // 5. Toggle Controls
  const handleToggleListen = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      // Stop action
      shouldListenRef.current = false;
      setIsListening(false);
      recognitionRef.current.stop();
    } else {
      // Start action
      shouldListenRef.current = true;
      setIsListening(true);

      // Focus the text field defensively to prevent mobile viewport shifting from dropping the stream.
      // On mobile, use a short 50ms delay to allow keyboard tap audio click feedback to clear before microphone acquisition.
      if (textareaRef.current) {
        const isMobileDevice = /Android|iPhone|iPad/i.test(navigator.userAgent);
        if (isMobileDevice) {
          setTimeout(() => {
            textareaRef.current?.focus();
          }, 50);
        } else {
          textareaRef.current.focus();
        }
      }

      recognitionRef.current.start();
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      <h2>Web Speech API React Demo</h2>

      <textarea
        ref={textareaRef}
        defaultValue={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your spoken text will type out automatically here..."
        rows={6}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          borderRadius: '8px',
          border: '1px solid #ccc',
          marginBottom: '15px',
          boxSizing: 'border-box'
        }}
      />

      <button
        onClick={handleToggleListen}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          fontWeight: 'bold',
          color: '#fff',
          backgroundColor: isListening ? '#d9534f' : '#0275d8',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
      >
        {isListening ? '🛑 Stop Listening' : '🎙️ Start Speaking'}
      </button>

      {isListening && (
        <p style={{ textAlign: 'center', color: '#5cb85c', fontWeight: 'bold' }}>
          Listening to microphone... Speak now!
        </p>
      )}
    </div>
  );
};
