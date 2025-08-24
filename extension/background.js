// Background Script - Service Worker for ChatSync Extension
import { ChatStorage } from './storage.js';


class ChatSyncBackground {
  constructor() {
    this.storage = new ChatStorage();
    this.authToken = null;
    this.backendUrl = 'http://localhost:8000'; // Default backend URL
    this.syncInProgress = false;
  }

  async init() {
    await this.storage.init();

    // Load auth token from storage
    this.authToken = await this.storage.getSetting('authToken');

    // Load backend URL from storage
    const savedBackendUrl = await this.storage.getSetting('backendUrl');
    if (savedBackendUrl) {
      this.backendUrl = savedBackendUrl;
    }

    console.log('ChatSync background script initialized');
  }

  // Handle messages from content scripts and popup
  handleMessage(request, sender, sendResponse) {
    console.log('Background received message:', request);
    console.log("TYPE RECEIVED:", JSON.stringify(request.type));

    switch (request.type) {
      case 'CHATS_EXTRACTED':
        this.handleExtractedChats(request);
        sendResponse({ success: true });
        break;

      case 'MANUAL_SCRAPE':
        this.handleManualScrape(request, sendResponse);
        return true; // Will respond asynchronously

      case 'AUTO_SCRAPE':
        this.handleAutoScrape(request, sendResponse);
        return true; // Will respond asynchronously

      case 'SYNC_NOW':
        this.handleSyncNow(sendResponse);
        return true; // Will respond asynchronously

      case 'LOGIN':
        this.handleLogin(request, sendResponse);
        return true; // Will respond asynchronously

      case 'REGISTER':
        this.handleRegister(request, sendResponse);
        return true; // Will respond asynchronously

      case 'LOGOUT':
        this.handleLogout(sendResponse);
        return true; // Will respond asynchronously

      case 'GET_CHATS':
        this.handleGetChats(request, sendResponse);
        return true; // Will respond asynchronously

      case 'UPDATE_CHAT':
        this.handleUpdateChat(request, sendResponse);
        return true; // Will respond asynchronously

      case 'DELETE_CHAT':
        this.handleDeleteChat(request, sendResponse);
        return true; // Will respond asynchronously

      case 'SEARCH_CHATS':
        this.handleSearchChats(request, sendResponse);
        return true; // Will respond asynchronously

      case 'GET_STATS':
        this.handleGetStats(sendResponse);
        return true; // Will respond asynchronously

      case 'ADD_MANUAL_CHAT':
        this.handleAddManualChat(request, sendResponse);
        return true; // Will respond asynchronously

      case 'GET_SETTING':
        this.handleGetSetting(request, sendResponse);
        return true; // Will respond asynchronously

      case 'SET_SETTING':
        this.handleSetSetting(request, sendResponse);
        return true; // Will respond asynchronously

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  // Handle extracted chats from content scripts
  async handleExtractedChats(request) {
    try {
      const { chats, provider, url } = request;
      console.log(`[HandleExtracted] Saving ${chats.length} chats from ${provider}`);
      
      // Enhanced logging for scraped data
      this.logScrapedChats(chats, provider, url);

      const savedChats = await this.storage.saveChats(chats);
      console.log(`[HandleExtracted] Saved ${savedChats.length} chats to local storage`);

      // Optionally trigger background sync if user is logged in
      if (this.authToken && !this.syncInProgress) {
        this.backgroundSync();
      }

    } catch (error) {
      console.error('[HandleExtracted] Error handling extracted chats:', error);
    }
  }

  // Enhanced logging for scraped chats
  logScrapedChats(chats, provider, url) {
    console.log(`\n=== BACKGROUND: CHATS FROM ${provider.toUpperCase()} ===`);
    console.log(`Source URL: ${url}`);
    console.log(`Total chats: ${chats.length}`);
    
    chats.forEach((chat, index) => {
      console.log(`\n[${index + 1}] "${chat.title}"`);
      console.log(`    Link: ${chat.link}`);
      console.log(`    Provider: ${chat.provider}`);
      console.log(`    Timestamp: ${chat.timestamp}`);
      if (chat.description) console.log(`    Description: ${chat.description}`);
      if (chat.lastMessage) console.log(`    Last Message: ${chat.lastMessage}`);
      if (chat.date) console.log(`    Date: ${chat.date}`);
      console.log(`    Synced: ${chat.synced}`);
    });
    console.log(`\n=== END ${provider.toUpperCase()} BACKGROUND LOG ===\n`);
  }

  // Handle auto scrape request from popup
  async handleAutoScrape(request, sendResponse) {
    try {
      const { provider, tabId } = request;
      console.log(`[AutoScrape] Auto-scraping ${provider} from tab ${tabId}`);

      // First, try to inject the content script manually if needed
      try {
        await this.ensureContentScriptLoaded(tabId, provider);
      } catch (injectionError) {
        console.warn('[AutoScrape] Content script injection failed:', injectionError);
      }

      // Wait a moment for content script to initialize
      setTimeout(() => {
        // Send message to content script in the specific tab
        chrome.tabs.sendMessage(tabId, {
          type: 'MANUAL_SCRAPE',
          provider: provider
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[AutoScrape] Content script communication failed:', chrome.runtime.lastError.message);
            
            // Try direct DOM scraping as fallback
            this.fallbackDirectScraping(tabId, provider, sendResponse);
          } else if (response && response.chats) {
            console.log(`[AutoScrape] Retrieved ${response.chats.length} chats from content script`);
            
            // Log the scraped data in background
            this.logScrapedChats(response.chats, provider, 'Auto-scraped');
            
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
      }, 500);

    } catch (error) {
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
          this.logScrapedChats(chats, provider, 'Fallback-scraped');
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
          // Try nav approach
          document.querySelectorAll("nav a[href^='/c/']").forEach((el) => {
            const title = el.innerText.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          // Try history approach if no results
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
          // Try sidebar approach
          document.querySelectorAll('li div.relative.group\\/row a').forEach((el) => {
            const titleEl = el.querySelector('span');
            const title = titleEl?.textContent.trim() || el.textContent.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          // Try recents approach if no results
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
          // Try sidebar approach
          document.querySelectorAll('.group\\/history a[data-testid^="thread-title"]').forEach((el) => {
            const titleEl = el.querySelector('span');
            const title = titleEl?.textContent.trim() || el.textContent.trim();
            const link = el.href;
            if (title && link) {
              chats.push(createChatEntry(title, link));
            }
          });
          
          // Try library approach if no results
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

  // Handle manual scrape request
  async handleManualScrape(request, sendResponse) {
    try {
      const { provider } = request;

      // Get active tab and send scrape message to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        sendResponse({ error: 'No active tab found' });
        return;
      }

      // Check if the tab URL matches the provider
      const urlMatches = this.checkProviderUrl(tab.url, provider);
      if (!urlMatches) {
        sendResponse({ error: `Current tab is not a ${provider} page` });
        return;
      }

      // Send message to content script
      chrome.tabs.sendMessage(tab.id, {
        type: 'MANUAL_SCRAPE',
        provider: provider
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: 'Failed to communicate with content script' });
        } else {
          sendResponse(response);
        }
      });

    } catch (error) {
      console.error('Error in manual scrape:', error);
      sendResponse({ error: error.message });
    }
  }

  // Check if URL matches provider
  checkProviderUrl(url, provider) {
    const patterns = {
      chatgpt: ['chat.openai.com', 'chatgpt.com'],
      claude: ['claude.ai'],
      perplexity: ['perplexity.ai']
    };

    return patterns[provider]?.some(pattern => url.includes(pattern));
  }

  // Handle sync now request
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
        sendResponse({ message: 'No chats to sync', synced: 0 });
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
      await this.fetchBackendChats();

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

  // Fetch chats from backend and merge with local
  async fetchBackendChats() {
    try {
      const response = await fetch(`${this.backendUrl}/api/chats`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });

      if (response.ok) {
        const backendChats = await response.json();
        // Mark backend chats as synced
        const chatsToSave = backendChats.map(chat => ({ ...chat, synced: true }));
        await this.storage.saveChats(chatsToSave);
        console.log(`Merged ${backendChats.length} chats from backend`);
      }
    } catch (error) {
      console.error('Error fetching backend chats:', error);
    }
  }

  // Background sync (periodic)
  async backgroundSync() {
    if (this.syncInProgress || !this.authToken) return;

    try {
      this.syncInProgress = true;
      const unsyncedChats = await this.storage.getUnsyncedChats();

      if (unsyncedChats.length > 0) {
        const response = await fetch(`${this.backendUrl}/api/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
          },
          body: JSON.stringify({ chats: unsyncedChats })
        });

        if (response.ok) {
          const chatIds = unsyncedChats.map(chat => chat.id);
          await this.storage.markChatsSynced(chatIds);
          console.log(`Background sync: ${unsyncedChats.length} chats synced`);
        }
      }
    } catch (error) {
      console.error('Background sync error:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

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

      // Save token to storage
      await this.storage.setSetting('authToken', this.authToken);

      // Fetch backend chats after login
      await this.fetchBackendChats();

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

      const result = await response.json();
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
      console.log("[handleGetChats] Incoming request:", JSON.stringify(request));

      let chats;

      if (provider) {
        console.log(`[handleGetChats] Fetching chats for provider: ${provider}`);
        chats = await this.storage.getChatsByProvider(provider);
      } else {
        console.log("[handleGetChats] Fetching all chats");
        chats = await this.storage.getAllChats();
      }

      console.log(`[handleGetChats] Initial chats count: ${chats.length}`);

      // Filter by category
      if (category) {
        console.log(`[handleGetChats] Filtering by category: ${category}`);
        chats = chats.filter(chat => chat.category === category);
        console.log(`[handleGetChats] After category filter: ${chats.length}`);
      }

      // Filter by subject
      if (subject) {
        console.log(`[handleGetChats] Filtering by subject: ${subject}`);
        chats = chats.filter(chat => chat.subject === subject);
        console.log(`[handleGetChats] After subject filter: ${chats.length}`);
      }

      // Sort by timestamp (newest first)
      chats.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      console.log(`[handleGetChats] Final chats count: ${chats.length}`);

      sendResponse({ chats });
    } catch (error) {
      console.error("[handleGetChats] Error:", error);
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
      console.log("Getting stats");
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
        category,
        subject,
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

// Set up periodic background sync (every 5 minutes if logged in)
chrome.alarms.create('backgroundSync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'backgroundSync') {
    chatSyncBackground.backgroundSync();
  }
});

console.log('ChatSync background script loaded');
