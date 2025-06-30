import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Mic, MicOff, Video, VideoOff, Loader, AlertTriangle, Minimize2, Maximize2, Volume2, VolumeX, Settings, RefreshCw, BookOpen } from 'lucide-react';
import { Book as BookType } from '../types/Book';
import { TavusService, TavusConversation } from '../services/TavusService';

// Declare Daily types for TypeScript
declare global {
  interface Window {
    Daily: any;
  }
}

interface LibraryAIAssistantProps {
  books: BookType[];
  onFilterChange: (filters: {
    searchTerm?: string;
    selectedSubject?: string;
    selectedDifficulty?: string;
    ageRange?: { min: number; max: number };
  }) => void;
  onBookRecommendation: (books: BookType[]) => void;
}

const LibraryAIAssistant: React.FC<LibraryAIAssistantProps> = ({ 
  books, 
  onFilterChange, 
  onBookRecommendation 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [conversation, setConversation] = useState<TavusConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVolumeOn, setIsVolumeOn] = useState(true);
  const [replicaConnected, setReplicaConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('Ready to start');
  const [lastToolCall, setLastToolCall] = useState<string>('');
  const [toolCallHistory, setToolCallHistory] = useState<string[]>([]);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [personaCreated, setPersonaCreated] = useState(false);
  const [naturalResponseCount, setNaturalResponseCount] = useState(0);
  const [restrictedResponseCount, setRestrictedResponseCount] = useState(0);
  const [shouldPulse, setShouldPulse] = useState(true);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<any>(null);
  const conversationIdRef = useRef<string | null>(null);

  // Load Daily.co script
  useEffect(() => {
    const loadDailyScript = () => {
      return new Promise((resolve, reject) => {
        if (window.Daily) {
          resolve(window.Daily);
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@daily-co/daily-js';
        script.async = true;
        script.onload = () => resolve(window.Daily);
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    loadDailyScript().catch(console.error);

    return () => {
      // Cleanup is handled in the main cleanup function
    };
  }, []);

  // Stop pulsing after 10 seconds or when user interacts
  useEffect(() => {
    const timer = setTimeout(() => {
      setShouldPulse(false);
    }, 10000); // Stop pulsing after 10 seconds

    return () => clearTimeout(timer);
  }, []);

  // Clean up conversation when component unmounts
  useEffect(() => {
    return () => {
      cleanupConversation();
    };
  }, []);

  const cleanupConversation = async () => {
    try {
      // First, leave the call gracefully
      if (callObjectRef.current) {
        await callObjectRef.current.leave();
        callObjectRef.current.destroy();
        callObjectRef.current = null;
      }

      // Then terminate the conversation if we have the ID
      if (conversationIdRef.current) {
        await TavusService.endConversation(conversationIdRef.current);
      }

      // Reset all state
      setConversation(null);
      setIsConnected(false);
      setReplicaConnected(false);
      setConnectionStatus('Ready to start');
      conversationIdRef.current = null;
      
      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  };

  // No longer needed as we use existing persona from env
  const checkLibraryPersona = () => {
    const personaId = TavusService.getPersonaId();
    // const defaultPersonaId = TavusService.getPersonaId();
    
    if (!personaId ) {
      throw new Error('No persona ID configured. Please set either VITE_TAVUS_LIBRARY_PERSONA_ID or VITE_TAVUS_PERSONA_ID in your .env');
    }
    return true;
  };

  const initializeAIAssistant = async () => {
    if (!TavusService.isConfigured()) {
      setError('Tavus not configured. Please check your environment variables.');
      return;
    }

    // Set up conversation timers
    const CONVERSATION_DURATION = 60000; // 1 minute
    const WRAP_UP_TIME = 45000; // 45 seconds - earlier warning
    const FINAL_WARNING_TIME = 55000; // 55 seconds - final warning

    setIsConnecting(true);
    setError(null);
    setConnectionStatus('Initializing AI assistant...');

    try {
      // Step 1: Verify library persona exists
      checkLibraryPersona();

      // Step 2: Create conversation with actual book catalog
      setConnectionStatus('Creating conversation with book catalog...');
      console.log('🎬 Creating Tavus conversation with actual books:', books.length);
      console.log('📚 Available books:', books.map(b => `${b.title} (${b.subject})`));
      
      const newConversation = await TavusService.createLibraryConversation(books);
      console.log('✅ conversation created:', newConversation);
      
      setConversation(newConversation);
      conversationIdRef.current = newConversation.conversation_id;
      
      setConnectionStatus('Conversation created with book restrictions! Joining...');
      
      // Step 3: Join the conversation
      await joinConversation(newConversation.conversation_url);

      // First wrap-up attempt at 45 seconds
      setTimeout(() => {
        if (callObjectRef.current && conversationIdRef.current) {
          console.log('🕐 Attempting to send first wrap-up instruction...');
          console.log('📞 Call object exists:', !!callObjectRef.current);
          console.log('🆔 Conversation ID:', conversationIdRef.current);
          
          const wrapUpInstruction = {
            message_type: "conversation",
            event_type: "conversation.respond",
            conversation_id: conversationIdRef.current,
            properties: {
              text: "We have about 15 seconds left. Please start wrapping up your response."
            }
          };
          
          try {
            const result = callObjectRef.current.sendAppMessage(wrapUpInstruction, '*');
            console.log('✅ First wrap-up instruction sent successfully:', result);
            // setConnectionStatus('⏰ 15 seconds remaining - wrapping up...');
          } catch (error) {
            console.error('❌ Failed to send first wrap-up instruction:', error);
          }
        } else {
          console.log('❌ Cannot send wrap-up - missing call object or conversation ID');
        }
      }, WRAP_UP_TIME);

      // Final warning at 55 seconds
      setTimeout(() => {
        if (callObjectRef.current && conversationIdRef.current) {
          console.log('🕐 Attempting to send final warning...');
          
          const finalWarning = {
            message_type: "conversation",
            event_type: "conversation.respond",
            conversation_id: conversationIdRef.current,
            properties: {
              text: "URGENT: You have 5 seconds left. Please end your response immediately with a polite goodbye."
            }
          };
          
          try {
            const result = callObjectRef.current.sendAppMessage(finalWarning, '*');
            console.log('✅ Final warning sent successfully:', result);
            // setConnectionStatus('⏰ 5 seconds - ending conversation...');
          } catch (error) {
            console.error('❌ Failed to send final warning:', error);
          }
        }
      },
      //  FINAL_WARNING_TIME
      );

      // Hard termination at 60 seconds
      setTimeout(() => {
        if (conversationIdRef.current) {
          console.log('⏰ Time limit reached - terminating conversation');
          cleanupConversation();
          setConnectionStatus('Conversation ended due to time limit');
        }
      }, CONVERSATION_DURATION);

    } catch (err: any) {
      setError(err.message || 'Failed to create conversation');
      setConnectionStatus('Failed to create conversation');
      console.error('❌ Error creating conversation:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const joinConversation = async (conversationUrl: string) => {
    if (!window.Daily) {
      throw new Error('Daily.co library not loaded');
    }

    try {
      setConnectionStatus('Joining conversation...');

      // Create Daily call object
      callObjectRef.current = window.Daily.createCallObject();

      // Set up event listeners BEFORE joining
      setupEventListeners();

      // Join with user camera OFF and audio ON
      await callObjectRef.current.join({
        url: conversationUrl,
        userName: 'User',
        videoSource: false,  // Turn off user camera
        audioSource: true    // Keep audio for conversation
      });

      // Ensure user video stays off
      await callObjectRef.current.setLocalVideo(false);
      
      setIsConnected(true);
      setConnectionStatus('Connected - waiting for Library  assistant...');

    } catch (error) {
      console.error('Failed to join conversation:', error);
      setError(`Failed to join: ${error}`);
      setConnectionStatus('Failed to join conversation');
      throw error;
    }
  };

  const setupEventListeners = () => {
    if (!callObjectRef.current) return;

    console.log('🎧 Setting up RESTRICTED event listeners for Tavus...');

    // Standard Daily.co events
    callObjectRef.current.on('participant-joined', (event: any) => {
      console.log('Participant joined:', event);
      updateReplicaVideo();
    });

    callObjectRef.current.on('participant-updated', (event: any) => {
      console.log('Participant updated:', event);
      updateReplicaVideo();
    });

    callObjectRef.current.on('joined-meeting', (event: any) => {
      console.log('Successfully joined restricted conversation');
      setConnectionStatus('Connected - waiting for restricted assistant...');
    });

    callObjectRef.current.on('participant-left', (event: any) => {
      console.log('Participant left:', event);
      if (event.participant.user_name !== 'User') {
        setConnectionStatus('Assistant disconnected');
        setReplicaConnected(false);
      }
    });

    callObjectRef.current.on('error', (event: any) => {
      console.error('Conversation error:', event);
      setError('Connection error occurred');
      setConnectionStatus('Connection error');
    });

    callObjectRef.current.on('left-meeting', () => {
      console.log('Left the meeting');
      setConnectionStatus('Left conversation');
      setIsConnected(false);
      setReplicaConnected(false);
    });

    // Enhanced tool call event listeners with restriction tracking
    
    // Primary event listener for app messages (tool calls)
    callObjectRef.current.on('app-message', (event: any) => {
      console.log('📨 App message received:', event);
      handleTavusEvent(event);
    });

    // Listen for track-started events which might contain metadata
    callObjectRef.current.on('track-started', (event: any) => {
      console.log('🎬 Track started:', event);
      if (event.track && event.track.kind === 'video') {
        updateReplicaVideo();
      }
    });

    // Listen for conversation utterances to track restricted responses
    callObjectRef.current.on('receive-data', (event: any) => {
      console.log('📡 Data channel message:', event);
      handleTavusEvent(event);
    });

    // Enhanced wildcard listener for debugging
    callObjectRef.current.on('*', (eventName: string, event: any) => {
      // Log all events to see what we're getting
      if (showDebugInfo) {
        console.log(`🔍 Event: ${eventName}`, event);
      }
      
      // Check for tool-related events
      if (eventName.includes('tool') || 
          eventName.includes('function') || 
          eventName.includes('call') ||
          eventName.includes('llm') ||
          eventName.includes('ai')) {
        console.log(`🔧 Potential tool call event (${eventName}):`, event);
        handleTavusEvent(event);
      }
    });
  };

  const handleTavusEvent = (event: any) => {
    console.log('🔍 Processing Tavus event:', JSON.stringify(event, null, 2));
    
    // Check for wrap-up related events
    if (event.data && event.data.event_type === 'conversation.respond') {
      console.log('📝 AI received wrap-up instruction');
    }
    
    // Track restricted conversation responses
    if (event.data && event.data.event_type === 'conversation.utterance' && 
        event.data.properties && event.data.properties.role === 'replica') {
      const replicaResponse = event.data.properties.speech;
      console.log('🤖 AI Response:', replicaResponse);
      
      // Check if the response mentions books not in our catalog
      const mentionsExternalBooks = replicaResponse.includes('Peter Rabbit') || 
                                   replicaResponse.includes('Runaway Bunny') ||
                                   replicaResponse.includes('Tale of') ||
                                   replicaResponse.includes('classic story') ||
                                   replicaResponse.includes('famous book');
      
      // Check if the response is natural (doesn't contain function names)
      const isNatural = !replicaResponse.includes('filter_books_by_') && 
                       !replicaResponse.includes('search_books') && 
                       !replicaResponse.includes('recommend_books') &&
                       !replicaResponse.includes('{') && 
                       !replicaResponse.includes('}');
      
      if (isNatural && !mentionsExternalBooks) {
        setNaturalResponseCount(prev => prev + 1);
        setRestrictedResponseCount(prev => prev + 1);
        // setConnectionStatus(`✅ Only our books mentioned (${restrictedResponseCount + 1})`);
      } else if (mentionsExternalBooks) {
        console.log('⚠️ AI mentioned books not in our catalog - this should not happen');
        setConnectionStatus('⚠️ AI mentioned external books - needs restriction improvement');
      } else if (!isNatural) {
        console.log('⚠️ AI spoke function name - this should not happen with natural persona');
        setConnectionStatus('⚠️ AI mentioned function names - needs improvement');
      }
    }
    
    // Try multiple ways to extract tool call data from the event
    let toolCallData = null;
    
    try {
      // Method 1: Direct event data
      if (event.data) {
        toolCallData = extractToolCallFromData(event.data);
      }
      
      // Method 2: Event itself might be the tool call
      if (!toolCallData) {
        toolCallData = extractToolCallFromData(event);
      }
      
      // Method 3: Check for nested structures
      if (!toolCallData && event.payload) {
        toolCallData = extractToolCallFromData(event.payload);
      }
      
      // Method 4: Check for message content
      if (!toolCallData && event.message) {
        toolCallData = extractToolCallFromData(event.message);
      }

      // Method 5: Check for conversation events with tool calls
      if (!toolCallData && event.data && event.data.event_type) {
        if (event.data.event_type.includes('tool') || 
            event.data.event_type.includes('function') ||
            event.data.event_type === 'conversation.llm.function_call') {
          toolCallData = extractToolCallFromData(event.data);
        }
      }

      if (toolCallData) {
        console.log('✅ Tool call extracted:', toolCallData);
        executeToolCall(toolCallData);
      } else {
        console.log('❌ No tool call data found in event');
        
        // Special handling for conversation utterances - try to trigger manual tool calls
        if (event.data && event.data.event_type === 'conversation.utterance' && 
            event.data.properties && event.data.properties.role === 'user') {
          const userSpeech = event.data.properties.speech;
          console.log('👤 User said:', userSpeech);
          
          // Try to manually trigger tool calls based on user speech
          tryManualToolCall(userSpeech);
        }
      }
    } catch (error) {
      console.error('Error processing Tavus event:', error);
    }
  };

  const tryManualToolCall = (userSpeech: string) => {
    const speech = userSpeech.toLowerCase();
    console.log('🔧 Attempting manual tool call for:', speech);
    
    // Manual tool call triggers based on speech patterns
    if (speech.includes('story') || speech.includes('stories')) {
      console.log('📚 Manual trigger: filter by STORY');
      executeToolCall({ function_name: 'filter_books_by_subject', arguments: { subject: 'STORY' } });
    } else if (speech.includes('science')) {
      console.log('🔬 Manual trigger: filter by SCIENCE');
      executeToolCall({ function_name: 'filter_books_by_subject', arguments: { subject: 'SCIENCE' } });
    } else if (speech.includes('math')) {
      console.log('🔢 Manual trigger: filter by MATHS');
      executeToolCall({ function_name: 'filter_books_by_subject', arguments: { subject: 'MATHS' } });
    } else if (speech.includes('animal') || speech.includes('rabbit')) {
      console.log('🐰 Manual trigger: search for animals');
      executeToolCall({ function_name: 'search_books', arguments: { searchTerm: 'animals' } });
    } else if (speech.includes('easy') || speech.includes('beginner')) {
      console.log('📖 Manual trigger: filter by beginner');
      executeToolCall({ function_name: 'filter_books_by_difficulty', arguments: { difficulty: 'beginner' } });
    }
  };

  const extractToolCallFromData = (data: any): any => {
    if (!data) return null;

    // Check for direct function call structure
    if (data.function_name && data.arguments) {
      return {
        function_name: data.function_name,
        arguments: data.arguments
      };
    }

    // Check for properties nested structure
    if (data.properties && data.properties.function_name) {
      return {
        function_name: data.properties.function_name,
        arguments: data.properties.arguments
      };
    }

    // Check for OpenAI-style tool_calls array
    if (data.tool_calls && Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
      const toolCall = data.tool_calls[0];
      if (toolCall.function) {
        return {
          function_name: toolCall.function.name,
          arguments: typeof toolCall.function.arguments === 'string' 
            ? JSON.parse(toolCall.function.arguments) 
            : toolCall.function.arguments
        };
      }
    }

    // Check for conversation event structure
    if (data.event_type === 'conversation.toolcall' || 
        data.event_type === 'conversation.llm.function_call' ||
        data.message_type === 'conversation') {
      if (data.properties) {
        return extractToolCallFromData(data.properties);
      }
    }

    // Check for function call in choices (GPT-style response)
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice.message && choice.message.tool_calls) {
        return extractToolCallFromData({ tool_calls: choice.message.tool_calls });
      }
    }

    // Check for direct function structure
    if (data.function && data.function.name) {
      return {
        function_name: data.function.name,
        arguments: typeof data.function.arguments === 'string' 
          ? JSON.parse(data.function.arguments) 
          : data.function.arguments
      };
    }

    return null;
  };

  const executeToolCall = (toolCallData: any) => {
    const { function_name, arguments: args } = toolCallData;
    console.log('🚀 Executing RESTRICTED tool call:', function_name, 'with args:', args);
    console.log('📚 Available books for filtering:', books.length);
    
    const toolCallString = `${function_name}(${JSON.stringify(args)})`;
    setLastToolCall(toolCallString);
    setToolCallHistory(prev => [...prev.slice(-4), toolCallString]); // Keep last 5 calls

    try {
      switch (function_name) {
        case 'filter_books_by_subject':
          console.log('📚 Filtering by subject:', args.subject, 'from', books.length, 'books');
          const subjectBooks = books.filter(book => 
            args.subject === 'ALL' || book.subject === args.subject
          );
          console.log('📚 Found', subjectBooks.length, 'books for subject', args.subject);
          onFilterChange({ selectedSubject: args.subject });
          setConnectionStatus(`✅ Showing ${subjectBooks.length} ${args.subject} books from our catalog`);
          break;
          
        case 'filter_books_by_difficulty':
          console.log('📊 Filtering by difficulty:', args.difficulty, 'from', books.length, 'books');
          const difficultyBooks = books.filter(book => 
            args.difficulty === 'ALL' || book.difficulty_level === args.difficulty
          );
          console.log('📊 Found', difficultyBooks.length, 'books for difficulty', args.difficulty);
          onFilterChange({ selectedDifficulty: args.difficulty });
          setConnectionStatus(`✅ Showing ${difficultyBooks.length} ${args.difficulty} books`);
          break;
          
        case 'search_books':
          console.log('🔍 Searching books for:', args.searchTerm, 'in', books.length, 'books');
          const searchResults = books.filter(book =>
            book.title.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
            book.description?.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
            book.author.toLowerCase().includes(args.searchTerm.toLowerCase())
          );
          console.log('🔍 Found', searchResults.length, 'books matching', args.searchTerm);
          onFilterChange({ searchTerm: args.searchTerm });
          setConnectionStatus(`✅ Found ${searchResults.length} "${args.searchTerm}" books`);
          break;
          
        case 'filter_books_by_age':
          console.log('👶 Filtering by age:', args.minAge, '-', args.maxAge, 'from', books.length, 'books');
          const ageBooks = books.filter(book =>
            book.target_age_min <= args.maxAge && book.target_age_max >= args.minAge
          );
          console.log('👶 Found', ageBooks.length, 'books for ages', args.minAge, '-', args.maxAge);
          onFilterChange({ 
            ageRange: { min: args.minAge, max: args.maxAge } 
          });
          setConnectionStatus(`✅ Showing ${ageBooks.length} books for ages ${args.minAge}-${args.maxAge} `);
          break;
          
        case 'recommend_books':
          console.log('💡 Recommending books for:', args.preferences, 'from', books.length, 'books');
          const recommendedBooks = getRecommendedBooks(args.preferences);
          console.log('💡 Found', recommendedBooks.length, 'recommendations for', args.preferences);
          onBookRecommendation(recommendedBooks);
          setConnectionStatus(`✅ Found ${recommendedBooks.length} recommendations`);
          break;
          
        default:
          console.log('❓ Unknown tool call:', function_name);
          setConnectionStatus(`❓ Unknown action: ${function_name}`);
      }
    } catch (error) {
      console.error('Error executing tool call:', error);
      setConnectionStatus('❌ Error executing action');
    }
  };

  const updateReplicaVideo = () => {
    if (!callObjectRef.current) return;

    const participants = callObjectRef.current.participants();
    let hasWorkingAudioVideo = false;
    
    // Find replica participant (not local user)
    Object.entries(participants).forEach(([id, participant]: [string, any]) => {
      if (id !== 'local') {
        // Check if both video and audio are playable
        const videoPlayable = participant.tracks.video?.state === 'playable';
        const audioPlayable = participant.tracks.audio?.state === 'playable';
        
        if (videoPlayable && audioPlayable) {
          hasWorkingAudioVideo = true;
          setReplicaConnected(true);
          setConnectionStatus(`🔒 Library assistant ready! we have ${books.length} books in our catalog`);
          setIsConnecting(false);
        }

        // Handle video track
        if (videoPlayable) {
          const videoTrack = participant.tracks.video.persistentTrack;
          if (videoTrack) {
            displayReplicaVideo(videoTrack);
          }
        }
        
        // Handle audio track
        if (audioPlayable) {
          const audioTrack = participant.tracks.audio.persistentTrack;
          if (audioTrack) {
            handleReplicaAudio(audioTrack);
          }
        }
      }
    });

    if (!hasWorkingAudioVideo) {
      setReplicaConnected(false);
      setConnectionStatus('Connected - waiting for assistant media...');
    }
  };

  const displayReplicaVideo = (videoTrack: MediaStreamTrack) => {
    if (videoRef.current) {
      const stream = new MediaStream([videoTrack]);
      videoRef.current.srcObject = stream;
      videoRef.current.muted = !isVolumeOn;
      
      // Ensure video plays
      videoRef.current.play().catch(e => {
        console.log('Video playback prevented:', e);
      });
    }
  };

  const handleReplicaAudio = (audioTrack: MediaStreamTrack) => {
    if (videoRef.current && videoRef.current.srcObject) {
      const currentStream = videoRef.current.srcObject as MediaStream;
      const newStream = new MediaStream();
      
      // Add video tracks
      currentStream.getVideoTracks().forEach(track => {
        newStream.addTrack(track);
      });
      
      // Add audio track
      newStream.addTrack(audioTrack);
      
      videoRef.current.srcObject = newStream;
      videoRef.current.muted = !isVolumeOn;
      
      // Force play
      videoRef.current.play().catch(e => {
        console.log('Audio play prevented:', e);
      });
    }
  };

  const getRecommendedBooks = (preferences: string): BookType[] => {
    const lowerPrefs = preferences.toLowerCase();
    
    const filtered = books.filter(book => {
      return book.title.toLowerCase().includes(lowerPrefs) ||
             book.description?.toLowerCase().includes(lowerPrefs) ||
             book.subject.toLowerCase().includes(lowerPrefs) ||
             book.author.toLowerCase().includes(lowerPrefs);
    }).slice(0, 6);

    console.log('💡 Filtered recommendations from actual catalog:', filtered.length, 'books');
    return filtered;
  };

  const toggleMute = async () => {
    if (callObjectRef.current && isConnected) {
      try {
        const newMutedState = !isMuted;
        await callObjectRef.current.setLocalAudio(!newMutedState);
        setIsMuted(newMutedState);
      } catch (error) {
        console.error('Error toggling mute:', error);
        setError('Error toggling mute');
      }
    }
  };

  const toggleVolume = () => {
    const newVolumeState = !isVolumeOn;
    setIsVolumeOn(newVolumeState);
    if (videoRef.current) {
      videoRef.current.muted = !newVolumeState;
    }
  };

  const leaveConversation = async () => {
    await cleanupConversation();
    setIsOpen(false);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setShouldPulse(false); // Stop pulsing when user opens
    if (!conversation && !isConnecting && !isConnected) {
      initializeAIAssistant();
    }
  };

  const restartConversation = async () => {
    await cleanupConversation();
    setPersonaCreated(false); // Force persona recreation with restrictions
    setNaturalResponseCount(0);
    setRestrictedResponseCount(0);
    setTimeout(() => {
      initializeAIAssistant();
    }, 1000);
  };

  if (!TavusService.isConfigured()) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-orange-100 border border-orange-300 rounded-lg p-3 max-w-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-600" />
            <div>
              <p className="text-orange-700 text-xs font-medium">AI Assistant not configured</p>
              <p className="text-orange-600 text-xs">Add VITE_TAVUS_API_KEY and VITE_TAVUS_REPLICA_ID to .env</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* AI Assistant Toggle Button */}
      <div className="fixed bottom-6 right-6 z-50">
        {!isOpen ? (
          <button
            onClick={handleOpen}
            disabled={isConnecting}
            className={`bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white p-4 rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 disabled:opacity-50 group ${
              shouldPulse ? 'animate-pulse' : ''
            }`}
            aria-label="Open Library Assistant"
          >
            <div className="relative">
              {isConnecting ? (
                <Loader size={24} className="animate-spin" />
              ) : (
                <Video size={24} />
              )}
              <div className={`absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full ${
                shouldPulse ? 'animate-bounce' : 'animate-pulse'
              }`}></div>
            </div>
            
            {/* Attention-grabbing ring animation */}
            {shouldPulse && (
              <div className="absolute inset-0 rounded-full border-4 border-yellow-400 animate-ping opacity-75"></div>
            )}
          </button>
        ) : (
          <div className={`bg-white rounded-xl shadow-2xl border-4 border-purple-300 transition-all duration-300 ${
            isMinimized ? 'w-16 h-16' : 'w-96 h-80'
          }`}>
            {isMinimized ? (
              <button
                onClick={() => setIsMinimized(false)}
                className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all duration-300 transform hover:scale-105"
              >
                <Video size={16} />
              </button>
            ) : (
              <div className="relative w-full h-full">
                {/* Header */}
                <div className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} />
                    <span className="text-sm font-bold">Library Assistant</span>
                    {isConnected && (
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${replicaConnected ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                        <span className="text-xs">{replicaConnected ? 'Live' : 'Connecting'}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setShowDebugInfo(!showDebugInfo)} 
                      className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" 
                      title="Toggle debug info"
                    >
                      <Settings size={14} />
                    </button>
                    <button 
                      onClick={restartConversation} 
                      className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" 
                      title="Restart with catalog restrictions"
                    >
                      <RefreshCw size={14} />
                    </button>
                    {isConnected && (
                      <>
                        <button onClick={toggleMute} className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" title={isMuted ? 'Unmute' : 'Mute'}>
                          {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                        </button>
                        <button onClick={toggleVolume} className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" title={isVolumeOn ? 'Mute Volume' : 'Unmute Volume'}>
                          {isVolumeOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                        </button>
                      </>
                    )}
                    <button onClick={() => setIsMinimized(true)} className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" title="Minimize">
                      <Minimize2 size={14} />
                    </button>
                    <button onClick={() => setIsOpen(false)} className="text-white hover:text-gray-200 transition-colors p-1 rounded-full" title="Close">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                
                {/* Video Content */}
                <div className="h-60 bg-gray-600 rounded-b-xl overflow-hidden relative">
                  {error ? (
                    <div className="flex items-center justify-center h-full p-4">
                      <div className="text-center">
                        <AlertTriangle size={24} className="text-red-500 mx-auto mb-2" />
                        <p className="text-red-600 text-sm mb-3">{error}</p>
                        <button
                          onClick={() => {
                            setError(null);
                            initializeAIAssistant();
                          }}
                          className="px-3 py-1 bg-purple-500 text-white text-xs rounded hover:bg-purple-600 transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    </div>
                  ) : isConnecting ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-white">
                        <Loader size={32} className="animate-spin mx-auto mb-3 text-purple-400" />
                        <p className="text-sm">{connectionStatus}</p>
                        <p className="text-xs text-gray-300 mt-1">Restricting to {books.length} available books</p>
                      </div>
                    </div>
                  ) : isConnected ? (
                    <>
                      <video 
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        autoPlay
                        playsInline
                        controls={false}
                        style={{ backgroundColor: '#1a1a1a' }}
                      />
                      
                      {/* Connection status overlay */}
                      {!replicaConnected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <div className="text-center text-white">
                            <Loader size={32} className="animate-spin mx-auto mb-3 text-purple-400" />
                            <p className="text-sm">{connectionStatus}</p>
                          </div>
                        </div>
                      )}

                      {/* response feedback */}
                      {/* {restrictedResponseCount > 0 && (
                        <div className="absolute top-2 left-2 bg-green-600/90 text-white text-xs px-2 py-1 rounded">
                          🔒 {restrictedResponseCount} catalog-only responses
                        </div>
                      )} */}

                      {/* Tool call feedback */}
                      {/* {lastToolCall && (
                        <div className="absolute bottom-2 left-2 bg-blue-600/90 text-white text-xs px-2 py-1 rounded max-w-xs">
                          🔧 {lastToolCall}
                        </div>
                      )} */}

                      {/* Book count indicator */}
                      {/* <div className="absolute top-2 right-2 bg-purple-600/90 text-white text-xs px-2 py-1 rounded">
                        📚 {books.length} books available
                      </div> */}
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full p-4">
                      <div className="text-center text-white">
                        <BookOpen size={32} className="text-purple-400 mx-auto mb-3" />
                        <p className="text-sm mb-2">Start conversation with interactive Library Assistant</p>
                        {/* <p className="text-xs text-gray-300 mb-3">AI will only suggest books from our {books.length} book catalog</p> */}
                        
                        <button
                          onClick={initializeAIAssistant}
                          className="px-4 py-2 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors"
                        >
                          Start  Assistant
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Status indicator */}
                <div className="absolute top-12 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                  {connectionStatus}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enhanced Instructions Panel */}
      
    </>
  );
};

export default LibraryAIAssistant;