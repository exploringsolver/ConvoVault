// Perplexity Content Script - Extract chat history
(() => {
  const PROVIDER = 'perplexity';
  
  // Standardized chat schema
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
  
  // Extract chats from sidebar (general Perplexity pages)
  function extractChatsFromSidebar() {
    const results = [];
    
    try {
      document.querySelectorAll('.group\\/history a[data-testid^="thread-title"]').forEach((el) => {
        try {
          const titleEl = el.querySelector('span');
          const title = titleEl?.textContent.trim() || el.textContent.trim();
          const link = el.href;
          
          if (title && link) {
            results.push(createChatEntry(title, link));
          }
        } catch (err) {
          console.error("Error parsing Perplexity sidebar chat:", err, el);
        }
      });
      
    } catch (err) {
      console.error("Error in Perplexity sidebar extraction:", err);
    }
    
    return results;
  }
  
  // Extract chats from library page
  function extractChatsFromLibrary() {
    const results = [];
    
    try {
      // Select all child divs inside the main container
      document.querySelectorAll(
        'div.relative.divide-y.border-borderMain\\/50.ring-borderMain\\/50.divide-borderMain\\/50.bg-transparent > div'
      ).forEach((el) => {
        try {
          const linkEl = el.querySelector('a[href]');
          const titleEl = el.querySelector('[data-testid^="thread-title"] div');
          const descEl = el.querySelector('.line-clamp-2');
          const dateEl = el.querySelector('.tabler-icon-clock-hour-5')?.parentElement?.querySelector('span');
          
          const title = titleEl?.innerText.trim();
          const description = descEl?.innerText.trim();
          const link = linkEl?.href;
          const date = dateEl?.innerText.trim();
          
          if (title && link) {
            results.push(createChatEntry(title, link, { description, date }));
          }
        } catch (err) {
          console.error("Error parsing Perplexity library element:", err, el);
        }
      });
      
    } catch (err) {
      console.error("Error in Perplexity library extraction:", err);
    }
    
    return results;
  }
  
  // Main extraction function
  function extractChats() {
    console.log('[Perplexity] ===== STARTING CHAT EXTRACTION =====');
    console.log('[Perplexity] Page URL:', window.location.href);
    console.log('[Perplexity] Page title:', document.title);
    console.log('[Perplexity] Pathname:', window.location.pathname);
    
    let chats = [];
    
    // Check if we're on the library page
    if (window.location.pathname.includes('/library')) {
      console.log('[Perplexity] Detected library page, using library extraction method');
      chats = extractChatsFromLibrary();
    } else {
      console.log('[Perplexity] Using sidebar extraction method');
      chats = extractChatsFromSidebar();
    }
    
    console.log(`[Perplexity] ===== EXTRACTION COMPLETE =====`);
    console.log(`[Perplexity] Total chats extracted: ${chats.length}`);
    
    if (chats.length > 0) {
      console.log('[Perplexity] Sample chat titles:');
      chats.slice(0, 5).forEach((chat, i) => {
        console.log(`  ${i + 1}. "${chat.title}"`);
      });
      if (chats.length > 5) {
        console.log(`  ... and ${chats.length - 5} more`);
      }
    } else {
      console.log('[Perplexity] No chats found. DOM state:');
      console.log('  - Sidebar links:', document.querySelectorAll('.group\\/history a[data-testid^="thread-title"]').length);
      console.log('  - Library items:', document.querySelectorAll('div.relative.divide-y.border-borderMain\\/50.ring-borderMain\\/50.divide-borderMain\\/50.bg-transparent > div').length);
    }
    
    return chats;
  }
  
  // Send extracted data to background script
  function sendChatsToBackground(chats) {
    if (chats.length > 0) {
      chrome.runtime.sendMessage({
        type: 'CHATS_EXTRACTED',
        provider: PROVIDER,
        chats: chats,
        url: window.location.href
      });
    }
  }
  
  // Initial extraction with delay
  setTimeout(() => {
    const chats = extractChats();
    sendChatsToBackground(chats);
  }, 2000);
  
  // Monitor for new chats with MutationObserver
  const observer = new MutationObserver((mutations) => {
    let shouldRecheck = false;
    
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check for sidebar changes
            if (node.matches && (
              node.matches('.group\\/history a[data-testid^="thread-title"]') || 
              node.querySelector('.group\\/history a[data-testid^="thread-title"]') ||
              node.matches('div.relative.divide-y.border-borderMain\\/50.ring-borderMain\\/50.divide-borderMain\\/50.bg-transparent > div') ||
              node.querySelector('div.relative.divide-y.border-borderMain\\/50.ring-borderMain\\/50.divide-borderMain\\/50.bg-transparent > div')
            )) {
              shouldRecheck = true;
            }
          }
        });
      }
    });
    
    if (shouldRecheck) {
      setTimeout(() => {
        const chats = extractChats();
        sendChatsToBackground(chats);
      }, 1000);
    }
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Listen for manual scrape requests
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'MANUAL_SCRAPE' && request.provider === PROVIDER) {
      const chats = extractChats();
      sendResponse({ chats });
      sendChatsToBackground(chats);
    }
  });
  
  console.log('Perplexity content script loaded');
})();
