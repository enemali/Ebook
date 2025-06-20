export interface TavusConversation {
  conversation_id: string;
  conversation_name: string;
  status: 'active' | 'ended';
  conversation_url: string;
  replica_id: string;
  persona_id?: string;
  created_at: string;
}

export interface CreateConversationRequest {
  replica_id: string;
  persona_id?: string;
  callback_url?: string;
  conversation_name: string;
  conversational_context?: string;
  custom_greeting?: string;
  properties?: {
    max_call_duration?: number;
    participant_left_timeout?: number;
    participant_absent_timeout?: number;
    enable_recording?: boolean;
    enable_closed_captions?: boolean;
    apply_greenscreen?: boolean;
    language?: string;
    recording_s3_bucket_name?: string;
    recording_s3_bucket_region?: string;
    aws_assume_role_arn?: string;
  };
}

export interface CreatePersonaRequest {
  persona_name: string;
  system_prompt: string;
  context: string;
  layers: {
    llm: {
      model: string;
      tools: Array<{
        type: string;
        function: {
          name: string;
          description: string;
          parameters: {
            type: string;
            properties: Record<string, any>;
            required: string[];
          };
        };
      }>;
    };
  };
}

export class TavusService {
  private static readonly BASE_URL = 'https://tavusapi.com/v2';

  static getApiKey(): string {
    return import.meta.env.VITE_TAVUS_API_KEY || '';
  }

  static getReplicaId(): string {
    return import.meta.env.VITE_TAVUS_REPLICA_ID || '';
  }

  static getPersonaId(): string {
    return import.meta.env.VITE_TAVUS_PERSONA_ID || '';
  }

  // static getLibraryPersonaId(): string {
  //   return import.meta.env.VITE_TAVUS_LIBRARY_PERSONA_ID || '';
  // }

  static isConfigured(): boolean {
    return !!(this.getApiKey() && this.getReplicaId());
  }

  // Persona creation is now handled externally and persona ID is stored in env

  static async createConversation(request: CreateConversationRequest): Promise<TavusConversation> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Tavus API key not configured');
    }

    try {
      const response = await fetch(`${this.BASE_URL}/conversations`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Tavus API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error creating Tavus conversation:', error);
      throw error;
    }
  }

  static createLibraryConversationContext(availableBooks: any[]): string {
    const bookList = availableBooks.map(book =>
      `- "${book.title}" by ${book.author} (${book.subject}, ${book.difficulty_level}, ages ${book.target_age_min}-${book.target_age_max})`
    ).join('\n');

    const subjectCounts = availableBooks.reduce((acc, book) => {
      acc[book.subject] = (acc[book.subject] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const subjectSummary = Object.entries(subjectCounts)
      .map(([subject, count]) => `${subject}: ${count} books`)
      .join(', ');

    return `You are a warm, friendly library assistant helping users find books from our catalog of ${availableBooks.length} books.

TIME AWARENESS:
This conversation will last exactly 1 minute. You must:
- At 45 seconds: Begin naturally transitioning toward closure while still being helpful
- At 50 seconds: Start your final recommendation or summary
- At 55 seconds: Give a warm, natural closing like "I hope you find something wonderful to read! Feel free to come back anytime for more book recommendations."

CRITICAL RULES:
1. NEVER abruptly cut off mid-sentence
2. Always complete your current thought before transitioning to closure
3. Make the ending feel natural, not forced , mention you need to attend to another call
4. If asked a question near the end, give a brief but complete answer before closing



AVAILABLE BOOKS IN OUR LIBRARY:
${bookList}

LIBRARY SUMMARY:
- Total books: ${availableBooks.length}
- Subjects available: ${subjectSummary}

CRITICAL RULES:
1. ONLY mention books from the above list
2. NEVER suggest books not in this catalog
3. If a user asks for something we don't have, say "We don't have that specific book, but here's what we do have..." and suggest from the available list
4. Use tools to filter the ACTUAL available books
5. Always respond naturally without mentioning function names
6. When asked to wrap up, finish your current response quickly and politely

Example conversations:
User: "I want animal books"
You: "Let me check what animal books we have..." [use search_books, then mention only actual results]

User: "Do you have Peter Rabbit?"
You: "I don't see that specific book in our collection, but I found some other wonderful animal stories..." [mention actual books]

Always be helpful and suggest alternatives from what we actually have!`;
  }

  static async createLibraryConversation(availableBooks: any[] = []): Promise<TavusConversation> {
    const conversationRequest: CreateConversationRequest = {
      replica_id: this.getReplicaId(),
      persona_id: this.getPersonaId(),
      conversation_name: "Library Assistant Chat",
      conversational_context: this.createLibraryConversationContext(availableBooks),

      custom_greeting: `Hello! I'm your interactive library assistant. I can help you find books from our collection of ${availableBooks.length} books. What kind of books are you interested in today?`,

      properties: {
        max_call_duration: 120, // 2 minutes
        participant_left_timeout: 10,
        participant_absent_timeout: 10,
        enable_recording: false,
        enable_closed_captions: true,
        apply_greenscreen: false,
        language: 'english'
      }
    };

    return this.createConversation(conversationRequest);
  }

  static async getConversation(conversationId: string): Promise<TavusConversation> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Tavus API key not configured');
    }

    try {
      const response = await fetch(`${this.BASE_URL}/conversations/${conversationId}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Tavus API error: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting Tavus conversation:', error);
      throw error;
    }
  }

  static async endConversation(conversationId: string): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Tavus API key not configured');
    }

    try {
      const response = await fetch(`${this.BASE_URL}/conversations/${conversationId}/end`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Tavus API error: ${errorData.message || response.statusText}`);
      }
    } catch (error) {
      console.error('Error ending Tavus conversation:', error);
      throw error;
    }
  }

  static async deleteConversation(conversationId: string): Promise<void> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Tavus API key not configured');
    }

    try {
      const response = await fetch(`${this.BASE_URL}/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Tavus API error: ${errorData.message || response.statusText}`);
      }
    } catch (error) {
      console.error('Error deleting Tavus conversation:', error);
      throw error;
    }
  }

  static createStoryContext(pageContent: any, currentPage: number, totalPages: number): string {
    return `You are a friendly storyteller helping a child read an interactive story. 
    
Current Story Context:
- Page ${currentPage + 1} of ${totalPages}
- Title: "${pageContent.title}"
- Story Text: "${pageContent.text}"

Your Role:
- speak very slowly
- Help explain the story in simple, child-friendly language
- Answer questions about characters, events, and vocabulary
- Encourage reading and comprehension
- Make the story engaging and fun
- Use a warm, patient, and encouraging tone

Be interactive and ask the child questions about what they think will happen next or what they learned from this part of the story.`;
  }

  static createCustomGreeting(pageContent: any, currentPage: number): string {
    const character = pageContent.title?.includes('Luna') ? 'Luna' :
      pageContent.title?.includes('Flower') ? 'Flower' : 'Garden';

    return `Hello, I'm your teacher and I'm here to tell you a story, We're on page ${currentPage + 1} reading about ${character}. Are you ready?`;
  }
}