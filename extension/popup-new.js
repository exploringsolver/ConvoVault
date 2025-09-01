// ConvoVault Popup Script - Modern Project-Based Chat Management
class ConvoVault {
  constructor() {
    this.API_BASE = 'http://localhost:8000/api';
    this.currentView = 'all';
    this.currentFilter = {};
    this.chats = [];
    this.projects = [];
    this.isLoggedIn = false;
    this.selectedChats = new Set();
    this.stats = {};

    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.checkAuthStatus();
    if (this.isLoggedIn) {
      await this.loadProjects();
      await this.loadChats();
      await this.autoScrapeCurrentPage();
    }
  }

  setupEventListeners() {
    // Auth
    document.getElementById('loginBtn').addEventListener('click', () => this.login());
    document.getElementById('registerBtn').addEventListener('click', () => this.register());
    document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

    // Sync
    document.getElementById('syncBtn').addEventListener('click', () => this.syncNow());

    // Sidebar navigation
    document.getElementById('allChats').addEventListener('click', () => this.setView('all'));
    document.getElementById('bookmarkedChats').addEventListener('click', () => this.setView('bookmarked'));
    document.getElementById('archivedChats').addEventListener('click', () => this.setView('archived'));
    document.getElementById('unassignedChats').addEventListener('click', () => this.setView('unassigned'));

    // Provider filters
    document.getElementById('chatgptFilter').addEventListener('click', () => this.setView('chatgpt'));
    document.getElementById('claudeFilter').addEventListener('click', () => this.setView('claude'));
    document.getElementById('perplexityFilter').addEventListener('click', () => this.setView('perplexity'));

    // Search
    document.getElementById('searchBox').addEventListener('input', (e) => this.search(e.target.value));

    // Modals
    document.getElementById('addProjectBtn').addEventListener('click', () => this.showProjectModal());
    document.getElementById('addChatBtn').addEventListener('click', () => this.showChatModal());
    document.getElementById('cancelProjectBtn').addEventListener('click', () => this.hideProjectModal());
    document.getElementById('cancelChatBtn').addEventListener('click', () => this.hideChatModal());
    document.getElementById('saveProjectBtn').addEventListener('click', () => this.saveProject());
    document.getElementById('saveChatBtn').addEventListener('click', () => this.saveChat());

    // Enter key handlers
    document.getElementById('password').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });
    document.getElementById('searchBox').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.search(e.target.value);
    });
  }

  // Authentication
  async checkAuthStatus() {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        // Verify token by making a test request
        const response = await fetch(`${this.API_BASE}/chats?limit=1`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          this.isLoggedIn = true;
          const userEmail = localStorage.getItem('userEmail');
          this.showLoggedInState(userEmail);
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('userEmail');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
      }
    }
  }

  async login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      this.showError('Please enter both email and password');
      return;
    }

    try {
      this.setLoading(true);
      const response = await fetch(`${this.API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('userEmail', data.user.email);
        this.isLoggedIn = true;
        this.showLoggedInState(data.user.email);
        this.showSuccess('Login successful!');
        
        // Load data
        await this.loadProjects();
        await this.loadChats();
        await this.autoScrapeCurrentPage();
      } else {
        this.showError(data.detail || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showError('Network error. Please try again.');
    } finally {
      this.setLoading(false);
    }
  }

  async register() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      this.showError('Please enter both email and password');
      return;
    }

    if (password.length < 6) {
      this.showError('Password must be at least 6 characters');
      return;
    }

    try {
      this.setLoading(true);
      const response = await fetch(`${this.API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        this.showSuccess('Registration successful! Please login.');
        document.getElementById('password').value = '';
      } else {
        this.showError(data.detail || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration error:', error);
      this.showError('Network error. Please try again.');
    } finally {
      this.setLoading(false);
    }
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    this.isLoggedIn = false;
    this.showLoginForm();
    this.chats = [];
    this.projects = [];
    this.renderChats();
  }

  showLoggedInState(email) {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('loggedInView').classList.remove('hidden');
    document.getElementById('userEmail').textContent = email;
  }

  showLoginForm() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('loggedInView').classList.add('hidden');
  }

  // Projects
  async loadProjects() {
    if (!this.isLoggedIn) return;

    try {
      const response = await fetch(`${this.API_BASE}/projects`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (response.ok) {
        this.projects = await response.json();
        this.renderProjects();
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }

  renderProjects() {
    const projectsList = document.getElementById('projectsList');
    projectsList.innerHTML = '';

    this.projects.forEach(project => {
      const projectItem = document.createElement('div');
      projectItem.className = 'sidebar-item';
      projectItem.innerHTML = `
        <div class="project-item">
          <div class="project-color" style="background-color: ${project.color}"></div>
          <span>${project.name}</span>
        </div>
        <span class="count">${project.chat_count || 0}</span>
      `;
      projectItem.addEventListener('click', () => this.setView('project', project.id));
      projectsList.appendChild(projectItem);
    });
  }

  showProjectModal() {
    document.getElementById('projectModal').classList.remove('hidden');
  }

  hideProjectModal() {
    document.getElementById('projectModal').classList.add('hidden');
    document.getElementById('projectName').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectColor').value = '#6366f1';
  }

  async saveProject() {
    const name = document.getElementById('projectName').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    const color = document.getElementById('projectColor').value;

    if (!name) {
      this.showError('Project name is required');
      return;
    }

    try {
      const response = await fetch(`${this.API_BASE}/projects`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, description, color })
      });

      if (response.ok) {
        this.hideProjectModal();
        this.showSuccess('Project created successfully!');
        await this.loadProjects();
      } else {
        const data = await response.json();
        this.showError(data.detail || 'Failed to create project');
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      this.showError('Network error. Please try again.');
    }
  }

  // Chats
  async loadChats() {
    if (!this.isLoggedIn) return;

    try {
      const params = new URLSearchParams();
      
      // Add filters based on current view
      if (this.currentView === 'bookmarked') {
        params.set('is_bookmarked', 'true');
      } else if (this.currentView === 'archived') {
        params.set('is_archived', 'true');
      } else if (this.currentView === 'unassigned') {
        params.set('project_id', '0');
      } else if (this.currentView === 'project') {
        params.set('project_id', this.currentFilter.projectId);
      } else if (['chatgpt', 'claude', 'perplexity'].includes(this.currentView)) {
        params.set('provider', this.currentView);
      }

      if (!params.has('is_archived')) {
        params.set('is_archived', 'false');
      }

      const response = await fetch(`${this.API_BASE}/chats?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (response.ok) {
        this.chats = await response.json();
        this.renderChats();
        this.updateCounts();
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
    }
  }

  setView(view, projectId = null) {
    // Update sidebar active state
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
    
    this.currentView = view;
    this.currentFilter = projectId ? { projectId } : {};

    // Set active sidebar item and content title
    let activeElement;
    if (view === 'all') {
      activeElement = document.getElementById('allChats');
      document.getElementById('contentTitle').textContent = 'All Chats';
    } else if (view === 'bookmarked') {
      activeElement = document.getElementById('bookmarkedChats');
      document.getElementById('contentTitle').textContent = 'Bookmarked Chats';
    } else if (view === 'archived') {
      activeElement = document.getElementById('archivedChats');
      document.getElementById('contentTitle').textContent = 'Archived Chats';
    } else if (view === 'unassigned') {
      activeElement = document.getElementById('unassignedChats');
      document.getElementById('contentTitle').textContent = 'Unassigned Chats';
    } else if (view === 'project') {
      const project = this.projects.find(p => p.id === projectId);
      document.getElementById('contentTitle').textContent = project?.name || 'Project';
    } else if (['chatgpt', 'claude', 'perplexity'].includes(view)) {
      activeElement = document.getElementById(view + 'Filter');
      document.getElementById('contentTitle').textContent = view.charAt(0).toUpperCase() + view.slice(1);
    }

    if (activeElement) {
      activeElement.classList.add('active');
    }

    this.loadChats();
  }

  renderChats() {
    const chatList = document.getElementById('chatList');
    
    if (this.chats.length === 0) {
      chatList.innerHTML = `
        <div class="empty-state">
          <h3>No chats found</h3>
          <p>Start by syncing or adding chats manually</p>
        </div>
      `;
      return;
    }

    chatList.innerHTML = this.chats.map(chat => this.renderChatItem(chat)).join('');
  }

  renderChatItem(chat) {
    const tags = chat.tags ? chat.tags.split(',').map(tag => 
      `<span class="tag">${tag.trim()}</span>`
    ).join('') : '';

    const date = chat.timestamp ? new Date(chat.timestamp).toLocaleDateString() : '';

    return `
      <div class="chat-item" data-chat-id="${chat.id}">
        <div class="chat-header">
          <div class="chat-title">${this.escapeHtml(chat.title)}</div>
          <div class="chat-actions">
            <button class="chat-action" onclick="window.chatManager.toggleBookmark(${chat.id})" title="Bookmark">
              ${chat.is_bookmarked ? '★' : '☆'}
            </button>
            <button class="chat-action" onclick="window.chatManager.openChat('${chat.link}')" title="Open">
              ↗
            </button>
          </div>
        </div>
        <div class="chat-meta">
          <div class="chat-meta-left">
            <span class="provider-badge provider-${chat.provider}">${chat.provider}</span>
            ${date ? `<span>${date}</span>` : ''}
          </div>
          ${chat.project ? `<span style="color: ${chat.project.color}">• ${chat.project.name}</span>` : ''}
        </div>
        ${tags ? `<div class="chat-tags">${tags}</div>` : ''}
      </div>
    `;
  }

  // Chat Actions
  async toggleBookmark(chatId) {
    try {
      const chat = this.chats.find(c => c.id === chatId);
      if (!chat) return;

      const response = await fetch(`${this.API_BASE}/chats/${chatId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_bookmarked: !chat.is_bookmarked })
      });

      if (response.ok) {
        await this.loadChats();
      }
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
    }
  }

  openChat(url) {
    chrome.tabs.create({ url });
  }

  showChatModal() {
    // Populate project dropdown
    const projectSelect = document.getElementById('chatProject');
    projectSelect.innerHTML = '<option value="">Unassigned</option>';
    this.projects.forEach(project => {
      projectSelect.innerHTML += `<option value="${project.id}">${project.name}</option>`;
    });
    
    document.getElementById('chatModal').classList.remove('hidden');
  }

  hideChatModal() {
    document.getElementById('chatModal').classList.add('hidden');
    document.getElementById('chatTitle').value = '';
    document.getElementById('chatUrl').value = '';
    document.getElementById('chatProvider').value = 'chatgpt';
    document.getElementById('chatProject').value = '';
  }

  async saveChat() {
    const title = document.getElementById('chatTitle').value.trim();
    const link = document.getElementById('chatUrl').value.trim();
    const provider = document.getElementById('chatProvider').value;
    const projectId = document.getElementById('chatProject').value;

    if (!title || !link) {
      this.showError('Title and URL are required');
      return;
    }

    try {
      const chatData = {
        title,
        link,
        provider,
        timestamp: new Date().toISOString()
      };

      if (projectId) {
        chatData.project_id = parseInt(projectId);
      }

      const response = await fetch(`${this.API_BASE}/chats`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(chatData)
      });

      if (response.ok) {
        this.hideChatModal();
        this.showSuccess('Chat added successfully!');
        await this.loadChats();
      } else {
        const data = await response.json();
        this.showError(data.detail || 'Failed to add chat');
      }
    } catch (error) {
      console.error('Failed to add chat:', error);
      this.showError('Network error. Please try again.');
    }
  }

  // Search
  search(query) {
    if (!query.trim()) {
      this.renderChats();
      return;
    }

    const filteredChats = this.chats.filter(chat =>
      chat.title.toLowerCase().includes(query.toLowerCase()) ||
      (chat.preview && chat.preview.toLowerCase().includes(query.toLowerCase())) ||
      (chat.tags && chat.tags.toLowerCase().includes(query.toLowerCase()))
    );

    const chatList = document.getElementById('chatList');
    if (filteredChats.length === 0) {
      chatList.innerHTML = `
        <div class="empty-state">
          <h3>No results found</h3>
          <p>Try different search terms</p>
        </div>
      `;
    } else {
      chatList.innerHTML = filteredChats.map(chat => this.renderChatItem(chat)).join('');
    }
  }

  // Sync functionality
  async syncNow() {
    if (!this.isLoggedIn) {
      this.showError('Please login to sync');
      return;
    }

    const syncBtn = document.getElementById('syncBtn');
    const syncText = document.getElementById('syncText');
    
    syncBtn.disabled = true;
    syncText.textContent = 'Syncing...';

    try {
      await this.autoScrapeCurrentPage();
      await this.loadChats();
      this.showSuccess('Sync completed!');
    } catch (error) {
      console.error('Sync failed:', error);
      this.showError('Sync failed. Please try again.');
    } finally {
      syncBtn.disabled = false;
      syncText.textContent = 'Sync';
    }
  }

  async autoScrapeCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab.url;
      
      if (url.includes('chatgpt.com') || url.includes('claude.ai') || url.includes('perplexity.ai')) {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: this.extractChatData
        });

        if (result?.result && this.isLoggedIn) {
          await this.syncChatData([result.result]);
        }
      }
    } catch (error) {
      console.error('Auto-scrape failed:', error);
    }
  }

  extractChatData() {
    const url = window.location.href;
    let provider, title = document.title;

    if (url.includes('chatgpt.com')) {
      provider = 'chatgpt';
    } else if (url.includes('claude.ai')) {
      provider = 'claude';
    } else if (url.includes('perplexity.ai')) {
      provider = 'perplexity';
    } else {
      return null;
    }

    return {
      provider,
      title: title.replace(' - ChatGPT', '').replace(' - Claude', '').replace(' - Perplexity', ''),
      link: url.split('?')[0],
      timestamp: new Date().toISOString()
    };
  }

  async syncChatData(chats) {
    try {
      const response = await fetch(`${this.API_BASE}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chats })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Sync result:', result);
      }
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }

  updateCounts() {
    // Update sidebar counts based on current data
    document.getElementById('totalCount').textContent = this.chats.length;
    
    // Count by different criteria
    const bookmarked = this.chats.filter(c => c.is_bookmarked).length;
    const archived = this.chats.filter(c => c.is_archived).length;
    const unassigned = this.chats.filter(c => !c.project_id).length;
    
    document.getElementById('bookmarkedCount').textContent = bookmarked;
    document.getElementById('archivedCount').textContent = archived;
    document.getElementById('unassignedCount').textContent = unassigned;

    // Provider counts
    const chatgpt = this.chats.filter(c => c.provider === 'chatgpt').length;
    const claude = this.chats.filter(c => c.provider === 'claude').length;
    const perplexity = this.chats.filter(c => c.provider === 'perplexity').length;

    document.getElementById('chatgptCount').textContent = chatgpt;
    document.getElementById('claudeCount').textContent = claude;
    document.getElementById('perplexityCount').textContent = perplexity;
  }

  // Utility methods
  setLoading(loading) {
    const elements = ['loginBtn', 'registerBtn'];
    elements.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.disabled = loading;
      }
    });
  }

  showError(message) {
    this.showMessage(message, 'error');
  }

  showSuccess(message) {
    this.showMessage(message, 'success');
  }

  showMessage(message, type) {
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    
    // Hide both first
    errorMsg.classList.add('hidden');
    successMsg.classList.add('hidden');
    
    if (type === 'error') {
      errorMsg.textContent = message;
      errorMsg.classList.remove('hidden');
      setTimeout(() => errorMsg.classList.add('hidden'), 5000);
    } else {
      successMsg.textContent = message;
      successMsg.classList.remove('hidden');
      setTimeout(() => successMsg.classList.add('hidden'), 3000);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app
window.chatManager = new ConvoVault();
