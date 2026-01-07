import { SEER_DECK_PREFIX } from './config';

// SAFETY: Whitelist of allowed read actions
const SAFE_READ_ACTIONS = [
  'version',
  'requestPermission',
  'deckNames',
  'modelNames',
  'modelFieldNames',
  'findCards',
  'cardsInfo',
  'cardsModTime',  // Card modification timestamps for vocab growth charts
  'notesInfo',
  'findNotes',
] as const;

// SAFETY: Write actions ONLY for Seer's own deck
const SAFE_WRITE_ACTIONS = [
  'addNote',
  'addNotes',
  'createDeck',
  'createModel',
] as const;

// SAFETY: NEVER allow these actions
const FORBIDDEN_ACTIONS = [
  'deleteNotes',
  'deleteDecks',
  'updateNoteFields',
  'changeDeck',
  'suspend',
  'unsuspend',
  'forgetCards',
  'relearnCards',
] as const;

type SafeReadAction = typeof SAFE_READ_ACTIONS[number];
type SafeWriteAction = typeof SAFE_WRITE_ACTIONS[number];
type ForbiddenAction = typeof FORBIDDEN_ACTIONS[number];

export class AnkiConnectError extends Error {
  constructor(message: string, public action: string) {
    super(`AnkiConnect error (${action}): ${message}`);
    this.name = 'AnkiConnectError';
  }
}

export class AnkiClient {
  constructor(
    private url: string,
    private apiKey?: string,
    private allowedWriteDecks?: string[]  // The configured decks that Seer can write to (ignored + known)
  ) {}

  async request<T>(
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    // SAFETY: Block forbidden actions
    if ((FORBIDDEN_ACTIONS as readonly string[]).includes(action)) {
      throw new Error(`FORBIDDEN: Action "${action}" is not allowed by Seer`);
    }

    // SAFETY: Validate write operations target only Seer's deck
    if ((SAFE_WRITE_ACTIONS as readonly string[]).includes(action)) {
      this.validateWriteTarget(action, params);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          version: 6,
          params,
          ...(this.apiKey ? { key: this.apiKey } : {})
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new AnkiConnectError(
          `HTTP ${response.status}: ${response.statusText}`,
          action
        );
      }

      const data = await response.json();

      if (data.error) {
        throw new AnkiConnectError(data.error, action);
      }

      return data.result;
    } catch (e) {
      clearTimeout(timeout);

      if (e instanceof AnkiConnectError) throw e;

      if (e instanceof Error) {
        if (e.name === 'AbortError') {
          throw new AnkiConnectError('Connection timeout', action);
        }
        throw new AnkiConnectError(e.message, action);
      }

      throw new AnkiConnectError(String(e), action);
    }
  }

  private validateWriteTarget(action: string, params: Record<string, unknown>) {
    // Only allow writes to the configured decks (ignored + known)
    const isAllowedDeck = (deckName?: string) =>
      this.allowedWriteDecks && deckName && this.allowedWriteDecks.includes(deckName);

    if (action === 'addNote') {
      const note = params.note as { deckName?: string } | undefined;
      if (!isAllowedDeck(note?.deckName)) {
        throw new Error(
          `SAFETY: Seer can only add notes to configured decks [${this.allowedWriteDecks?.join(', ')}]. ` +
          `Attempted: "${note?.deckName}"`
        );
      }
    }

    if (action === 'addNotes') {
      const notes = params.notes as Array<{ deckName?: string }> | undefined;
      for (const note of notes || []) {
        if (!isAllowedDeck(note.deckName)) {
          throw new Error(
            `SAFETY: Seer can only add notes to configured decks [${this.allowedWriteDecks?.join(', ')}]. ` +
            `Attempted: "${note.deckName}"`
          );
        }
      }
    }

    if (action === 'createDeck') {
      const deck = params.deck as string | undefined;
      if (!isAllowedDeck(deck)) {
        throw new Error(
          `SAFETY: Seer can only create configured decks [${this.allowedWriteDecks?.join(', ')}]. ` +
          `Attempted: "${deck}"`
        );
      }
    }

    if (action === 'createModel') {
      const modelName = params.modelName as string | undefined;
      if (!modelName?.startsWith('Seer ')) {
        throw new Error(
          `SAFETY: Seer can only create "Seer *" models. ` +
          `Attempted: "${modelName}"`
        );
      }
    }
  }

  // Convenience methods
  async checkConnection(): Promise<{ connected: boolean; version?: number; error?: string }> {
    try {
      const version = await this.request<number>('version');
      return { connected: true, version };
    } catch (e) {
      return {
        connected: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  }

  async getDeckNames(): Promise<string[]> {
    return this.request<string[]>('deckNames');
  }

  async getModelNames(): Promise<string[]> {
    return this.request<string[]>('modelNames');
  }

  async getModelFieldNames(modelName: string): Promise<string[]> {
    return this.request<string[]>('modelFieldNames', { modelName });
  }

  async getFieldsForDeck(deckName: string): Promise<string[]> {
    // Find cards in deck, get model name, then get fields
    const cardIds = await this.findCards(`deck:"${deckName}" -is:suspended`);
    if (cardIds.length === 0) {
      // Try without suspended filter
      const allCards = await this.findCards(`deck:"${deckName}"`);
      if (allCards.length === 0) return [];
      const cardInfo = await this.getCardsInfo([allCards[0]]);
      if (cardInfo.length === 0) return [];
      return this.getModelFieldNames(cardInfo[0].modelName);
    }
    const cardInfo = await this.getCardsInfo([cardIds[0]]);
    if (cardInfo.length === 0) return [];
    return this.getModelFieldNames(cardInfo[0].modelName);
  }

  /**
   * Create a deck if it doesn't exist
   * Returns the deck ID (creates or returns existing)
   */
  async ensureDeckExists(deckName: string): Promise<number> {
    // createDeck returns the deck ID, creating it if it doesn't exist
    return this.request<number>('createDeck', { deck: deckName });
  }

  /**
   * Create the Seer Ignored Word model if it doesn't exist
   */
  async ensureIgnoredWordModelExists(modelName: string): Promise<void> {
    const models = await this.getModelNames();
    if (models.includes(modelName)) {
      return; // Model already exists
    }

    // Create a simple model with just a Word field
    await this.request<number>('createModel', {
      modelName,
      inOrderFields: ['Word'],
      isCloze: false,
      cardTemplates: [
        {
          Name: 'Card 1',
          Front: '{{Word}}',
          Back: '{{Word}}'
        }
      ]
    });
  }

  /**
   * Add a word to the ignored deck
   * Ensures the deck and model exist before adding
   */
  async addIgnoredWord(deckName: string, modelName: string, word: string): Promise<number | null> {
    // Ensure deck exists
    await this.ensureDeckExists(deckName);

    // Ensure model exists
    await this.ensureIgnoredWordModelExists(modelName);

    // Add the note
    return this.request<number | null>('addNote', {
      note: {
        deckName,
        modelName,
        fields: { Word: word },
        options: { allowDuplicate: false }
      }
    });
  }

  /**
   * Create the Seer Known Word model if it doesn't exist
   */
  async ensureKnownWordModelExists(modelName: string): Promise<void> {
    const models = await this.getModelNames();
    if (models.includes(modelName)) {
      return; // Model already exists
    }

    // Create a simple model with just a Word field
    await this.request<number>('createModel', {
      modelName,
      inOrderFields: ['Word'],
      isCloze: false,
      cardTemplates: [
        {
          Name: 'Card 1',
          Front: '{{Word}}',
          Back: '{{Word}}'
        }
      ]
    });
  }

  /**
   * Add a word to the known deck
   * Ensures the deck and model exist before adding
   */
  async addKnownWord(deckName: string, modelName: string, word: string): Promise<number | null> {
    // Ensure deck exists
    await this.ensureDeckExists(deckName);

    // Ensure model exists
    await this.ensureKnownWordModelExists(modelName);

    // Add the note
    return this.request<number | null>('addNote', {
      note: {
        deckName,
        modelName,
        fields: { Word: word },
        options: { allowDuplicate: false }
      }
    });
  }

  async findCards(query: string): Promise<number[]> {
    return this.request<number[]>('findCards', { query });
  }

  /**
   * Find cards that were answered "Again" (failed) within the last N days
   * Uses Anki's rated: query syntax
   * @param days Number of days to look back (1 = today, 2 = today + yesterday, etc.)
   * @param deckNames Optional array of deck names to search in
   */
  async getCardsFailedRecently(days: number = 1, deckNames?: string[]): Promise<number[]> {
    // rated:N:1 means cards rated "Again" (answer 1) within the last N days
    let query = `rated:${days}:1`;

    // Add deck filter if specified
    if (deckNames && deckNames.length > 0) {
      const deckQueries = deckNames.map(d => `deck:"${d}"`).join(' OR ');
      query = `(${deckQueries}) ${query}`;
    }

    return this.findCards(query);
  }

  async getCardsInfo(cards: number[]): Promise<Array<{
    cardId: number;
    fields: Record<string, { value: string; order: number }>;
    deckName: string;
    modelName: string;
    interval: number;  // Days until next review (or negative for learning cards in seconds)
    reps: number;      // Total number of reviews
    lapses: number;    // Number of times forgotten
    type: number;      // 0=new, 1=learning, 2=review, 3=relearning
    queue: number;     // Queue status
  }>> {
    return this.request('cardsInfo', { cards });
  }

  /**
   * Get modification timestamps for cards (15x faster than cardsInfo)
   * Returns the earliest mod time as the card's "creation date"
   */
  async getCardsModTime(cards: number[]): Promise<Array<{ cardId: number; mod: number }>> {
    return this.request('cardsModTime', { cards });
  }
}
