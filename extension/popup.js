// Popup Script for ChatSync Extension
class ChatSyncPopup {
  constructor() {
    this.currentTab = 'all';
    this.chats = [];
    this.filteredChats = [];
    this.isLoggedIn = false;
    this.stats = {};
    this.searchQuery = '';

    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.checkAuthStatus();
    await this.loadStats();
    await this.autoScrapeCurrentPage();
    await this.loadChats();
    this.loadFilters();
  }

  setupEventListeners() {
    // Auth
    document.getElementById('loginBtn').addEventListener('click', () => this.login());
    document.getElementById('registerBtn').addEventListener('click', () => this.register());
    document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

    // Sync
    document.getElementById('syncBtn').addEventListener('click', () => this.syncNow());

    // Tabs
    document.getElementById('allTab').addEventListener('click', () => this.switchTab('all'));
    document.getElementById('chatgptTab').addEventListener('click', () => this.switchTab('chatgpt'));
    document.getElementById('claudeTab').addEventListener('click', () => this.switchTab('claude'));
    document.getElementById('perplexityTab').addEventListener('click', () => this.switchTab('perplexity'));

    // Search
    document.getElementById('searchBox').addEventListener('input', (e) => this.search(e.target.value));

    // Filters
    document.getElementById('categoryFilter').addEventListener('change', () => this.applyFilters());
    document.getElementById('subjectFilter').addEventListener('change', () => this.applyFilters());

    // Manual add
    document.getElementById('addToggle').addEventListener('click', () => this.toggleAddForm());
    document.getElementById('addChatBtn').addEventListener('click', () => this.addManualChat());

    // Enter key handlers
    document.getElementById('password').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    document.getElementById('searchBox').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.search(e.target.value);
    });
  }

  async checkAuthStatus() {
    try {
      // Check if we have an auth token stored
      const authToken = await this.sendMessage({ type: 'GET_SETTING', key: 'authToken' });
      if (authToken.value) {
        this.isLoggedIn = true;
        this.showLoggedInView({ email: 'User' }); // We'll get real user info after login
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }
  }

  async login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      this.showError('Please enter email and password');
      return;
    }

    try {
      this.setLoading('loginBtn', true);
      const response = await this.sendMessage({
        type: 'LOGIN',
        email,
        password
      });

      if (response.error) {
        this.showError(response.error);
      } else {
        this.showSuccess('Login successful!');
        this.isLoggedIn = true;
        this.showLoggedInView(response.user);
        await this.loadChats(); // Reload chats after login
        await this.loadStats(); // Reload stats
        this.loadFilters(); // Reload filters
      }
    } catch (error) {
      this.showError('Login failed: ' + error.message);
    } finally {
      this.setLoading('loginBtn', false);
    }
  }

  async register() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      this.showError('Please enter email and password');
      return;
    }

    try {
      this.setLoading('registerBtn', true);
      const response = await this.sendMessage({
        type: 'REGISTER',
        email,
        password
      });

      if (response.error) {
        this.showError(response.error);
      } else {
        this.showSuccess('Registration successful! Please login.');
      }
    } catch (error) {
      this.showError('Registration failed: ' + error.message);
    } finally {
      this.setLoading('registerBtn', false);
    }
  }

  async logout() {
    try {
      await this.sendMessage({ type: 'LOGOUT' });
      this.isLoggedIn = false;
      this.showLoginForm();
      this.showSuccess('Logged out successfully');
    } catch (error) {
      this.showError('Logout failed: ' + error.message);
    }
  }

  async syncNow() {
    try {
      this.setLoading('syncBtn', true);
      const response = await this.sendMessage({ type: 'SYNC_NOW' });

      if (response.error) {
        this.showError(response.error);
      } else {
        this.showSuccess(response.message);
        await this.loadStats();
        await this.loadChats();
        this.loadFilters(); // Reload filters after sync
      }
    } catch (error) {
      this.showError('Sync failed: ' + error.message);
    } finally {
      this.setLoading('syncBtn', false);
    }
  }

  async loadStats() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATS' });
      if (response.stats) {
        this.stats = response.stats;
        this.updateStatsDisplay();
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  updateStatsDisplay() {
    document.getElementById('totalChats').textContent = this.stats.total || 0;
    document.getElementById('unsyncedChats').textContent = this.stats.unsynced || 0;
  }

  async loadChats() {
    try {
      const response = await this.sendMessage({ type: 'GET_CHATS' });
      if (response.chats) {
        this.chats = response.chats;
        this.applyFilters();
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
      this.showError('Failed to load chats');
    }
  }

  loadFilters() {
    // Load categories and subjects for filters
    const categories = [...new Set(this.chats.map(chat => chat.category).filter(Boolean))].sort();
    const subjects = [...new Set(this.chats.map(chat => chat.subject).filter(Boolean))].sort();

    const categorySelect = document.getElementById('categoryFilter');
    const subjectSelect = document.getElementById('subjectFilter');

    // Store current selections
    const currentCategory = categorySelect.value;
    const currentSubject = subjectSelect.value;

    // Clear existing options (except first)
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    subjectSelect.innerHTML = '<option value="">All Subjects</option>';

    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelect.appendChild(option);
    });

    subjects.forEach(subject => {
      const option = document.createElement('option');
      option.value = subject;
      option.textContent = subject;
      subjectSelect.appendChild(option);
    });

    // Restore selections if they still exist
    if (categories.includes(currentCategory)) {
      categorySelect.value = currentCategory;
    }
    if (subjects.includes(currentSubject)) {
      subjectSelect.value = currentSubject;
    }
  }

  switchTab(tab) {
    this.currentTab = tab;

    // Update tab styling
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');

    this.applyFilters();
  }

  search(query) {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
  }

  applyFilters() {
    let filtered = [...this.chats];

    // Filter by provider tab
    if (this.currentTab !== 'all') {
      filtered = filtered.filter(chat => chat.provider === this.currentTab);
    }

    // Filter by category
    const categoryFilter = document.getElementById('categoryFilter').value;
    if (categoryFilter) {
      filtered = filtered.filter(chat => chat.category === categoryFilter);
    }

    // Filter by subject
    const subjectFilter = document.getElementById('subjectFilter').value;
    if (subjectFilter) {
      filtered = filtered.filter(chat => chat.subject === subjectFilter);
    }

    // Filter by search query
    if (this.searchQuery) {
      filtered = filtered.filter(chat =>
        chat.title.toLowerCase().includes(this.searchQuery) ||
        (chat.description && chat.description.toLowerCase().includes(this.searchQuery)) ||
        (chat.preview && chat.preview.toLowerCase().includes(this.searchQuery)) ||
        (chat.category && chat.category.toLowerCase().includes(this.searchQuery)) ||
        (chat.subject && chat.subject.toLowerCase().includes(this.searchQuery))
      );
    }

    this.filteredChats = filtered;
    this.renderChats();
  }

  renderChats() {
    const chatList = document.getElementById('chatList');
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');

    if (this.filteredChats.length === 0) {
      chatList.innerHTML = '<div class="loading">No chats found</div>';
      return;
    }

    const html = this.filteredChats.map(chat => this.renderChatItem(chat)).join('');
    chatList.innerHTML = html;

    // Add click listeners
    chatList.querySelectorAll('.chat-item').forEach((item, index) => {
      item.addEventListener('click', () => this.openChat(this.filteredChats[index]));
    });
  }

  renderChatItem(chat) {
    const timeAgo = this.getTimeAgo(chat.timestamp);
    const providerClass = `provider-${chat.provider}`;
    
    // Show category and subject if available
    const categoryTag = chat.category && chat.category !== 'General' 
      ? `<span class="category-tag">${chat.category}</span>` 
      : '';
    const subjectTag = chat.subject && chat.subject !== 'Other' 
      ? `<span class="subject-tag">${chat.subject}</span>` 
      : '';

    return `
      <div class="chat-item" data-id="${chat.id}">
        <div class="chat-title">${this.escapeHtml(chat.title)}</div>
        <div class="chat-tags">
          ${categoryTag}
          ${subjectTag}
        </div>
        <div class="chat-meta">
          <span class="provider-badge ${providerClass}">${chat.provider}</span>
          <span>${timeAgo}</span>
        </div>
      </div>
    `;
  }

  async openChat(chat) {
    try {
      // Open the chat link in a new tab
      chrome.tabs.create({ url: chat.link });
    } catch (error) {
      console.error('Failed to open chat:', error);
    }
  }

  toggleAddForm() {
    const form = document.getElementById('addForm');
    const toggle = document.getElementById('addToggle');

    if (form.classList.contains('hidden')) {
      form.classList.remove('hidden');
      toggle.textContent = '− Cancel';
    } else {
      form.classList.add('hidden');
      toggle.textContent = '+ Add Chat Manually';
      this.clearAddForm();
    }
  }

  async addManualChat() {
    const title = document.getElementById('chatTitle').value;
    const link = document.getElementById('chatUrl').value;
    const category = document.getElementById('chatCategory').value;

    if (!title || !link) {
      this.showError('Please enter title and URL');
      return;
    }

    try {
      this.setLoading('addChatBtn', true);
      const response = await this.sendMessage({
        type: 'ADD_MANUAL_CHAT',
        title,
        link,
        category: category || 'General',
        subject: 'User Added'
      });

      if (response.error) {
        this.showError(response.error);
      } else {
        this.showSuccess('Chat added successfully!');
        this.clearAddForm();
        this.toggleAddForm();
        await this.loadChats();
        await this.loadStats();
        this.loadFilters();
      }
    } catch (error) {
      this.showError('Failed to add chat: ' + error.message);
    } finally {
      this.setLoading('addChatBtn', false);
    }
  }

  clearAddForm() {
    document.getElementById('chatTitle').value = '';
    document.getElementById('chatUrl').value = '';
    document.getElementById('chatCategory').value = '';
  }

  showLoggedInView(user) {
    this.isLoggedIn = true;
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('loggedInView').classList.remove('hidden');
    document.getElementById('userEmail').textContent = user?.email || 'User';
    document.getElementById('syncBtn').disabled = false;
  }

  showLoginForm() {
    this.isLoggedIn = false;
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('loggedInView').classList.add('hidden');
    document.getElementById('syncBtn').disabled = true;

    // Clear form
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
  }

  showError(message) {
    const errorEl = document.getElementById('errorMsg');
    const successEl = document.getElementById('successMsg');

    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    successEl.classList.add('hidden');

    setTimeout(() => errorEl.classList.add('hidden'), 5000);
  }

  showSuccess(message) {
    const errorEl = document.getElementById('errorMsg');
    const successEl = document.getElementById('successMsg');

    successEl.textContent = message;
    successEl.classList.remove('hidden');
    errorEl.classList.add('hidden');

    setTimeout(() => successEl.classList.add('hidden'), 3000);
  }

  setLoading(buttonId, loading) {
    const button = document.getElementById(buttonId);
    if (loading) {
      button.disabled = true;
      button.textContent = 'Loading...';
    } else {
      button.disabled = false;
      // Reset button text based on ID
      const buttonTexts = {
        loginBtn: 'Login',
        registerBtn: 'Register',
        syncBtn: 'Sync Now',
        addChatBtn: 'Add Chat'
      };
      button.textContent = buttonTexts[buttonId] || 'Submit';
    }
  }

  getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diff = now - time;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async autoScrapeCurrentPage() {
    try {
      console.log('[AutoScrape] Starting automatic scrape...');
      this.showScrapeStatus('Checking current page...');
      
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        console.log('[AutoScrape] No active tab found');
        this.showScrapeStatus('No active tab found', 'error');
        return;
      }

      console.log('[AutoScrape] Current tab URL:', tab.url);

      // Determine provider from URL
      const provider = this.detectProvider(tab.url);
      if (!provider) {
        console.log('[AutoScrape] Not on a supported chat provider page');
        this.showScrapeStatus('Not on a supported chat page');
        return;
      }

      console.log('[AutoScrape] Detected provider:', provider);
      this.showScrapeStatus(`Scraping ${provider} chats...`);

      // Send scrape request to content script
      const response = await this.sendMessage({
        type: 'AUTO_SCRAPE',
        provider: provider,
        tabId: tab.id
      });

      if (response.error) {
        console.error('[AutoScrape] Error:', response.error);
        this.showScrapeStatus(response.error, 'error');
      } else {
        const count = response.chats?.length || 0;
        console.log(`[AutoScrape] Successfully scraped ${count} chats:`, response.chats);
        this.showScrapeStatus(`Found ${count} ${provider} chats`, 'success');
        
        // Auto-sync if logged in and chats found
        if (count > 0 && this.isLoggedIn) {
          setTimeout(() => this.syncNow(), 1000);
        }
      }

    } catch (error) {
      console.error('[AutoScrape] Failed:', error);
      this.showScrapeStatus('Auto-scrape failed: ' + error.message, 'error');
    }
  }

  detectProvider(url) {
    if (!url) return null;
    
    const providers = {
      'chat.openai.com': 'chatgpt',
      'chatgpt.com': 'chatgpt',
      'claude.ai': 'claude',
      'perplexity.ai': 'perplexity'
    };

    for (const [domain, provider] of Object.entries(providers)) {
      if (url.includes(domain)) {
        return provider;
      }
    }
    return null;
  }

  showScrapeStatus(message, type = 'info') {
    const statusEl = document.getElementById('scrapeStatus');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `scrape-status ${type}`;
      statusEl.classList.remove('hidden');
      
      // Auto-hide after 3 seconds for success/info messages
      if (type !== 'error') {
        setTimeout(() => {
          statusEl.textContent = '';
          statusEl.className = 'scrape-status hidden';
        }, 3000);
      }
    }
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ChatSyncPopup();
});