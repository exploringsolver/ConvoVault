// Background Script - Service Worker for ChatSync Extension
import { ChatStorage } from './storage.js';

class ChatSyncBackground {
  constructor() {
    this.storage = new ChatStorage();
    this.authToken = null;
    this.backendUrl = 'http://localhost:8000'; 
    this.syncInProgress = false;
    this.scrapeInProgress = false;
    this.lastScrapeTime = new Map(); // Track per-tab scraping
    this.scrapeThrottle = 5000; // 5 seconds between scrapes per tab
  }

  async init() {
    await this.storage.init();
    this.authToken = await this.storage.getSetting('authToken');
    
    const savedBackendUrl = await this.storage.getSetting('backendUrl');
    if (savedBackendUrl) {
      this.backendUrl = savedBackendUrl;
    }

    console.log('ChatSync background script initialized');
    
    // Only fetch chats if logged in, but don't auto-scrape
    if (this.authToken) {
      await this.fetchAndMergeBackendChats();
    }
  }

  // Handle messages from content scripts and popup
  handleMessage(request, sender, sendResponse) {
    console.log('Background received message:', request.type);

    switch (request.type) {
      case 'CHATS_EXTRACTED':
        this.handleExtractedChats(request);
        sendResponse({ success: true });
        break;

      case 'AUTO_SCRAPE':
        this.handleAutoScrape(request, sendResponse);
        return true;

      case 'SYNC_NOW':
        this.handleSyncNow(sendResponse);
        return true;

      case 'LOGIN':
        this.handleLogin(request, sendResponse);
        return true;

      case 'REGISTER':
        this.handleRegister(request, sendResponse);
        return true;

      case 'LOGOUT':
        this.handleLogout(sendResponse);
        return true;

      case 'GET_CHATS':
        this.handleGetChats(request, sendResponse);
        return true;

      case 'UPDATE_CHAT':
        this.handleUpdateChat(request, sendResponse);
        return true;

      case 'DELETE_CHAT':
        this.handleDeleteChat(request, sendResponse);
        return true;

      case 'SEARCH_CHATS':
        this.handleSearchChats(request, sendResponse);
        return true;

      case 'GET_STATS':
        this.handleGetStats(sendResponse);
        return true;

      case 'ADD_MANUAL_CHAT':
        this.handleAddManualChat(request, sendResponse);
        return true;

      case 'GET_SETTING':
        this.handleGetSetting(request, sendResponse);
        return true;

      case 'SET_SETTING':
        this.handleSetSetting(request, sendResponse);
        return true;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  // Handle extracted chats from content scripts - PREVENT RECURSIVE CALLS
  async handleExtractedChats(request) {
    try {
      const { chats, provider, url } = request;
      console.log(`[HandleExtracted] Received ${chats.length} chats from ${provider}`);
      
      // Save chats without triggering additional scraping
      const savedChats = await this.storage.saveChats(chats);
      console.log(`[HandleExtracted] Saved ${savedChats.length} chats to local storage`);

      // DO NOT trigger background sync here to prevent loops
      // Let user manually sync when needed

    } catch (error) {
      console.error('[HandleExtracted] Error handling extracted chats:', error);
    }
  }

  // Handle auto scrape request from popup - WITH THROTTLING
  async handleAutoScrape(request, sendResponse) {
    try {
      const { provider, tabId } = request;
      
      // Check throttling per tab
      const now = Date.now();
      const lastScrape = this.lastScrapeTime.get(tabId) || 0;
      
      if (now - lastScrape < this.scrapeThrottle) {
        console.log(`[AutoScrape] Throttled for tab ${tabId}`);
        sendResponse({ 
          error: 'Scraping throttled - please wait a few seconds',
          chats: [] 
        });
        return;
      }

      if (this.scrapeInProgress) {
        console.log('[AutoScrape] Scrape already in progress');
        sendResponse({ 
          error: 'Scrape already in progress',
          chats: [] 
        });
        return;
      }

      this.scrapeInProgress = true;
      this.lastScrapeTime.set(tabId, now);
      
      console.log(`[AutoScrape] Auto-scraping ${provider} from tab ${tabId}`);

      // Try to inject content script if needed
      try {
        await this.ensureContentScriptLoaded(tabId, provider);
      } catch (injectionError) {
        console.warn('[AutoScrape] Content script injection failed:', injectionError);
      }

      // Wait for content script to initialize
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'MANUAL_SCRAPE',
          provider: provider
        }, (response) => {
          this.scrapeInProgress = false;
          
          if (chrome.runtime.lastError) {
            console.error('[AutoScrape] Content script communication failed:', chrome.runtime.lastError.message);
            this.fallbackDirectScraping(tabId, provider, sendResponse);
          } else if (response && response.chats) {
            console.log(`[AutoScrape] Retrieved ${response.chats.length} chats from content script`);
            sendResponse({ 
              chats: response.chats,
              message: `Successfully scraped ${response.chats.length} chats` 
            });
          } else {
            console.log('[AutoScrape] No chats returned from content script');
            sendResponse({ 
              chats: [],
              message: 'No chats found on current page'
            });
          }
        });
      }, 1000);

    } catch (error) {
      this.scrapeInProgress = false;
      console.error('[AutoScrape] Error:', error);
      sendResponse({ error: error.message, chats: [] });
    }
  }

  // Ensure content script is loaded for the provider
  async ensureContentScriptLoaded(tabId, provider) {
    const scriptFiles = {
      'chatgpt': 'content-chatgpt.js',
      'claude': 'content-claude.js',
      'perplexity': 'content-perplexity.js'
    };

    const scriptFile = scriptFiles[provider];
    if (!scriptFile) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    console.log(`[AutoScrape] Injecting content script: ${scriptFile}`);
    
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [scriptFile]
    });
  }

  // Fallback direct scraping using chrome.scripting
  async fallbackDirectScraping(tabId, provider, sendResponse) {
    console.log('[AutoScrape] Attempting fallback direct scraping...');
    
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: this.getDirectScrapingFunction(provider)
      });

      if (results && results[0] && results[0].result) {
        const chats = results[0].result;
        console.log(`[AutoScrape] Fallback scraping found ${chats.length} chats`);
        
        // Store the chats
        if (chats.length > 0) {
          await this.storage.saveChats(chats);
        }
        
        sendResponse({ 
          chats: chats,
          message: `Fallback scraping found ${chats.length} chats`
        });
      } else {
        sendResponse({ 
          chats: [],
          message: 'Fallback scraping found no chats'
        });
      }
    } catch (fallbackError) {
      console.error('[AutoScrape] Fallback scraping failed:', fallbackError);
      sendResponse({ 
        error: 'Both content script and fallback scraping failed. Try refreshing the page.',
        chats: []
      });
    }
  }

  // Get the appropriate scraping function for direct injection
  getDirectScrapingFunction(provider) {
    const scrapingFunctions = {
      'chatgpt': () => {
        const chats = [];
        const PROVIDER = 'chatgpt';
        
        function createChatEntry(title, link) {
          return {
            provider: PROVIDER,
            title: title || '',
            link: link || '',
            timestamp: new Date().toISOString(),
            synced: false
          };
        }
        
        try {
          document.querySelectorAll("nav a[href^='/c/']").forEach((el) => {
            const title = el.innerText.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          if (chats.length === 0) {
            document.querySelectorAll('#history a').forEach((el) => {
              const titleEl = el.querySelector('.truncate span') || el.querySelector('span');
              const title = titleEl?.textContent.trim() || el.textContent.trim();
              const link = el.href;
              if (title && link && link.includes('/c/')) {
                chats.push(createChatEntry(title, link));
              }
            });
          }
        } catch (error) {
          console.error('Direct scraping error:', error);
        }
        
        return chats;
      },
      
      'claude': () => {
        const chats = [];
        const PROVIDER = 'claude';
        
        function createChatEntry(title, link, additionalData = {}) {
          return {
            provider: PROVIDER,
            title: title || '',
            link: link || '',
            timestamp: new Date().toISOString(),
            synced: false,
            ...additionalData
          };
        }
        
        try {
          document.querySelectorAll('li div.relative.group\\/row a').forEach((el) => {
            const titleEl = el.querySelector('span');
            const title = titleEl?.textContent.trim() || el.textContent.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          if (chats.length === 0) {
            document.querySelectorAll("ul.flex.flex-col.gap-3 > li").forEach(li => {
              const linkEl = li.querySelector("a[href]");
              const titleEl = linkEl?.querySelector(".truncate");
              const title = titleEl?.innerText.trim();
              const link = linkEl?.href;
              if (title && link) {
                chats.push(createChatEntry(title, link));
              }
            });
          }
        } catch (error) {
          console.error('Direct scraping error:', error);
        }
        
        return chats;
      },
      
      'perplexity': () => {
        const chats = [];
        const PROVIDER = 'perplexity';
        
        function createChatEntry(title, link, additionalData = {}) {
          return {
            provider: PROVIDER,
            title: title || '',
            link: link || '',
            timestamp: new Date().toISOString(),
            synced: false,
            ...additionalData
          };
        }
        
        try {
          document.querySelectorAll('.group\\/history a[data-testid^="thread-title"]').forEach((el) => {
            const titleEl = el.querySelector('span');
            const title = titleEl?.textContent.trim() || el.textContent.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          if (chats.length === 0) {
            document.querySelectorAll('div.relative.divide-y.border-borderMain\\/50.ring-borderMain\\/50.divide-borderMain\\/50.bg-transparent > div').forEach((el) => {
              const linkEl = el.querySelector('a[href]');
              const titleEl = el.querySelector('[data-testid^="thread-title"] div');
              const title = titleEl?.innerText.trim();
              const link = linkEl?.href;
              if (title && link) {
                chats.push(createChatEntry(title, link));
              }
            });
          }
        } catch (error) {
          console.error('Direct scraping error:', error);
        }
        
        return chats;
      }
    };
    
    return scrapingFunctions[provider] || (() => []);
  }

  // Handle sync now request - OPTIMIZED
  async handleSyncNow(sendResponse) {
    try {
      if (!this.authToken) {
        sendResponse({ error: 'Not logged in' });
        return;
      }

      if (this.syncInProgress) {
        sendResponse({ error: 'Sync already in progress' });
        return;
      }

      this.syncInProgress = true;

      // Get unsynced chats
      const unsyncedChats = await this.storage.getUnsyncedChats();
      console.log(`Syncing ${unsyncedChats.length} unsynced chats`);

      if (unsyncedChats.length === 0) {
        // Still fetch backend chats even if no local chats to sync
        await this.fetchAndMergeBackendChats();
        sendResponse({ message: 'No local chats to sync, but fetched latest from server', synced: 0 });
        this.syncInProgress = false;
        return;
      }

      // Send chats to backend
      const response = await fetch(`${this.backendUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({ chats: unsyncedChats })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const result = await response.json();

      // Mark chats as synced
      const chatIds = unsyncedChats.map(chat => chat.id);
      await this.storage.markChatsSynced(chatIds);

      // Fetch and merge any new chats from backend
      await this.fetchAndMergeBackendChats();

      sendResponse({
        message: `Successfully synced ${unsyncedChats.length} chats`,
        synced: unsyncedChats.length
      });

    } catch (error) {
      console.error('Sync error:', error);
      sendResponse({ error: error.message });
    } finally {
      this.syncInProgress = false;
    }
  }

  // Fetch chats from backend and merge with local storage
  async fetchAndMergeBackendChats() {
    try {
      const response = await fetch(`${this.backendUrl}/api/chats?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });

      if (response.ok) {
        const backendChats = await response.json();
        console.log(`Fetching ${backendChats.length} chats from backend`);
        
        const chatsToSave = backendChats.map(chat => ({
          provider: chat.provider,
          title: chat.title,
          link: chat.link,
          preview: chat.preview,
          description: chat.description,
          last_message: chat.last_message,
          date: chat.date,
          category: chat.category,
          subject: chat.subject,
          timestamp: chat.timestamp,
          synced: true
        }));
        
        await this.storage.saveChats(chatsToSave);
        console.log(`Merged ${backendChats.length} chats from backend`);
      }
    } catch (error) {
      console.error('Error fetching backend chats:', error);
    }
  }

  // REMOVE auto background sync to prevent spam
  // Only sync when user manually requests it

  // Handle login
  async handleLogin(request, sendResponse) {
    try {
      const { email, password } = request;

      const response = await fetch(`${this.backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const result = await response.json();
      this.authToken = result.access_token;

      await this.storage.setSetting('authToken', this.authToken);
      await this.fetchAndMergeBackendChats();

      sendResponse({ success: true, user: result.user });

    } catch (error) {
      console.error('Login error:', error);
      sendResponse({ error: error.message });
    }
  }

  // Handle register
  async handleRegister(request, sendResponse) {
    try {
      const { email, password } = request;

      const response = await fetch(`${this.backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Registration failed');
      }

      sendResponse({ success: true, message: 'Registration successful' });

    } catch (error) {
      console.error('Registration error:', error);
      sendResponse({ error: error.message });
    }
  }

  // Handle logout
  async handleLogout(sendResponse) {
    try {
      this.authToken = null;
      await this.storage.setSetting('authToken', null);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle get chats
  async handleGetChats(request, sendResponse) {
    try {
      const { provider, category, subject } = request;

      let chats;
      if (provider) {
        chats = await this.storage.getChatsByProvider(provider);
      } else {
        chats = await this.storage.getAllChats();
      }

      if (category) {
        chats = chats.filter(chat => chat.category === category);
      }

      if (subject) {
        chats = chats.filter(chat => chat.subject === subject);
      }

      chats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      sendResponse({ chats });
    } catch (error) {
      console.error("Error getting chats:", error);
      sendResponse({ error: error.message });
    }
  }

  // Handle update chat
  async handleUpdateChat(request, sendResponse) {
    try {
      const { id, updates } = request;
      const updatedChat = await this.storage.updateChat(id, updates);
      sendResponse({ success: true, chat: updatedChat });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle delete chat
  async handleDeleteChat(request, sendResponse) {
    try {
      const { id } = request;
      await this.storage.deleteChat(id);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle search chats
  async handleSearchChats(request, sendResponse) {
    try {
      const { query } = request;
      const chats = await this.storage.searchChats(query);
      sendResponse({ chats });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle get stats
  async handleGetStats(sendResponse) {
    try {
      const stats = await this.storage.getStats();
      sendResponse({ stats });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle add manual chat
  async handleAddManualChat(request, sendResponse) {
    try {
      const { title, link, category, subject, preview } = request;

      const chat = {
        provider: 'user',
        title,
        link,
        category: category || 'General',
        subject: subject || 'Other',
        preview,
        timestamp: new Date().toISOString(),
        synced: false
      };

      const savedChat = await this.storage.saveChat(chat);
      sendResponse({ success: true, chat: savedChat });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle get setting
  async handleGetSetting(request, sendResponse) {
    try {
      const { key } = request;
      const value = await this.storage.getSetting(key);
      sendResponse({ value });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  // Handle set setting
  async handleSetSetting(request, sendResponse) {
    try {
      const { key, value } = request;
      await this.storage.setSetting(key, value);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }
}

// Initialize background script
const chatSyncBackground = new ChatSyncBackground();
chatSyncBackground.init();

// Set up message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return chatSyncBackground.handleMessage(request, sender, sendResponse);
});

// REMOVE automatic periodic sync to prevent spam
// Users can manually sync when needed

console.log('ChatSync background script loaded');