// IndexedDB Storage Manager for ChatSync
export class ChatStorage {
  constructor() {
    this.dbName = 'ChatSyncDB';
    this.version = 1;
    this.db = null;
  }
  
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Chats store
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('provider', 'provider', { unique: false });
          chatStore.createIndex('synced', 'synced', { unique: false });
          chatStore.createIndex('category', 'category', { unique: false });
          chatStore.createIndex('subject', 'subject', { unique: false });
          chatStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // User settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        
        // Sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }
  
  // Generate unique ID from provider + link
  generateChatId(provider, link) {
    return btoa(provider + '::' + link).replace(/[^a-zA-Z0-9]/g, '');
  }
  
  // Save or update chat
  async saveChat(chatData) {
    if (!this.db) await this.init();
    
    const id = this.generateChatId(chatData.provider, chatData.link);
    const chat = {
      id,
      ...chatData,
      updatedAt: new Date().toISOString()
    };
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readwrite');
      const store = transaction.objectStore('chats');
      
      // First check if chat exists
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const existingChat = getRequest.result;
        
        if (existingChat) {
          // Update existing chat, preserve user-set fields
          const updatedChat = {
            ...existingChat,
            ...chat,
            category: existingChat.category || chat.category,
            subject: existingChat.subject || chat.subject,
            synced: existingChat.synced && chat.synced // Keep as unsynced if either is false
          };
          
          const putRequest = store.put(updatedChat);
          putRequest.onsuccess = () => resolve(updatedChat);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          // Create new chat
          const putRequest = store.put(chat);
          putRequest.onsuccess = () => resolve(chat);
          putRequest.onerror = () => reject(putRequest.error);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }
  
  // Save multiple chats
  async saveChats(chats) {
    const results = [];
    for (const chat of chats) {
      try {
        const saved = await this.saveChat(chat);
        results.push(saved);
      } catch (error) {
        console.error('Error saving chat:', error, chat);
      }
    }
    return results;
  }
  
  // Get all chats
  async getAllChats() {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readonly');
      const store = transaction.objectStore('chats');
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  // Get chats by provider
  async getChatsByProvider(provider) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readonly');
      const store = transaction.objectStore('chats');
      const index = store.index('provider');
      const request = index.getAll(provider);
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  // Get unsynced chats
  async getUnsyncedChats() {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readonly');
      const store = transaction.objectStore('chats');
      const request = store.getAll();
      
      request.onsuccess = () => {
        // Filter for unsynced chats (where synced is false or undefined)
        const allChats = request.result;
        const unsyncedChats = allChats.filter(chat => !chat.synced);
        resolve(unsyncedChats);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  // Mark chats as synced
  async markChatsSynced(chatIds) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readwrite');
      const store = transaction.objectStore('chats');
      let completed = 0;
      
      chatIds.forEach(id => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
          const chat = getRequest.result;
          if (chat) {
            chat.synced = true;
            chat.syncedAt = new Date().toISOString();
            store.put(chat);
          }
          completed++;
          if (completed === chatIds.length) resolve();
        };
      });
    });
  }
  
  // Update chat (for user edits)
  async updateChat(id, updates) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readwrite');
      const store = transaction.objectStore('chats');
      
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const chat = getRequest.result;
        if (chat) {
          const updatedChat = {
            ...chat,
            ...updates,
            updatedAt: new Date().toISOString(),
            synced: false // Mark as unsynced when user makes changes
          };
          
          const putRequest = store.put(updatedChat);
          putRequest.onsuccess = () => resolve(updatedChat);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error('Chat not found'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }
  
  // Delete chat
  async deleteChat(id) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chats'], 'readwrite');
      const store = transaction.objectStore('chats');
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  // Search chats
  async searchChats(query) {
    const allChats = await this.getAllChats();
    const searchTerm = query.toLowerCase();
    
    return allChats.filter(chat => 
      chat.title.toLowerCase().includes(searchTerm) ||
      (chat.description && chat.description.toLowerCase().includes(searchTerm)) ||
      (chat.preview && chat.preview.toLowerCase().includes(searchTerm)) ||
      (chat.category && chat.category.toLowerCase().includes(searchTerm)) ||
      (chat.subject && chat.subject.toLowerCase().includes(searchTerm))
    );
  }
  
  // Settings management
  async getSetting(key) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readonly');
      const store = transaction.objectStore('settings');
      const request = store.get(key);
      
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }
  
  async setSetting(key, value) {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readwrite');
      const store = transaction.objectStore('settings');
      const request = store.put({ key, value });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  // Get chat statistics
  async getStats() {
    console.log("Getting stats");
    const allChats = await this.getAllChats();
    const stats = {
      total: allChats.length,
      byProvider: {},
      synced: 0,
      unsynced: 0,
      byCategory: {},
      bySubject: {}
    };
    
    allChats.forEach(chat => {
      // By provider
      stats.byProvider[chat.provider] = (stats.byProvider[chat.provider] || 0) + 1;
      
      // Sync status
      if (chat.synced) stats.synced++;
      else stats.unsynced++;
      
      // By category
      const category = chat.category || 'Uncategorized';
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
      
      // By subject
      const subject = chat.subject || 'General';
      stats.bySubject[subject] = (stats.bySubject[subject] || 0) + 1;
    });
    
    return stats;
  }
}

// ES6 module export - handled by the export statement at class declaration
