// Claude Content Script - Extract chat history
(() => {
  const PROVIDER = 'claude';
  
  // Standardized chat schema
  function createChatEntry(title, link, additionalData = {}) {
    return {
      provider: PROVIDER,
      title: title || '',
      link: link || '',
      ariaLabel: additionalData.ariaLabel || null,
      lastMessage: additionalData.lastMessage || null,
      timestamp: new Date().toISOString(),
      synced: false,
      ...additionalData
    };
  }
  
  // Extract chats from sidebar (general Claude pages)
  function extractChatsFromSidebar() {
    const results = [];
    
    try {
      document.querySelectorAll("li > div.relative.group a[href]").forEach((el) => {
        try {
          const titleEl = el.querySelector("span.truncate") || el.querySelector("span");
          const title = titleEl?.innerText.trim() || null;
          const link = el.href || null;
          const ariaLabel = el.getAttribute("aria-label") || null;

          if (title && link) {
            results.push(createChatEntry(title, link, { ariaLabel }));
          }
        } catch (err) {
          console.error("[Claude] Error parsing Claude sidebar chat:", err, el);
        }
      });
    } catch (err) {
      console.error("[Claude] Error in Claude sidebar extraction:", err);
    }
    
    return results;
  }
  
  // Extract chats from recents page
  function extractChatsFromRecents() {
    const results = [];
    
    try {
      document.querySelectorAll("ul.flex.flex-col.gap-3 > li").forEach(li => {
        try {
          const linkEl = li.querySelector("a[href]");
          const titleEl = linkEl?.querySelector(".truncate");
          const timeEl = linkEl?.querySelector(".text-text-400 span");
          
          const title = titleEl?.innerText.trim() || null;
          const lastMessage = timeEl?.innerText.trim() || null;
          const link = linkEl?.href || null;
          const ariaLabel = linkEl?.getAttribute("aria-label") || null;
          
          if (title && link) {
            results.push(createChatEntry(title, link, { lastMessage, ariaLabel }));
          }
        } catch (err) {
          console.error("[Claude] Error parsing Claude recents li:", err, li);
        }
      });
    } catch (err) {
      console.error("[Claude] Error in Claude recents extraction:", err);
    }
    
    return results;
  }
  
  // Main extraction function
  function extractChats() {
    console.log('[Claude] ===== STARTING CHAT EXTRACTION =====');
    console.log('[Claude] Page URL:', window.location.href);
    console.log('[Claude] Page title:', document.title);
    console.log('[Claude] Pathname:', window.location.pathname);
    
    let chats = [];
    
    // Check if we're on the recents page
    if (window.location.pathname.includes('/recents')) {
      console.log('[Claude] Detected recents page, using recents extraction method');
      chats = extractChatsFromRecents();
    } else {
      console.log('[Claude] Using sidebar extraction method');
      chats = extractChatsFromSidebar();
    }
    
    console.log(`[Claude] ===== EXTRACTION COMPLETE =====`);
    console.log(`[Claude] Total chats extracted: ${chats.length}`);
    
    if (chats.length > 0) {
      console.log('[Claude] Sample chat entries:');
      chats.slice(0, 5).forEach((chat, i) => {
        console.log(`  ${i + 1}. Title: "${chat.title}" | Link: ${chat.link} | Aria: ${chat.ariaLabel}`);
      });
      if (chats.length > 5) {
        console.log(`  ... and ${chats.length - 5} more`);
      }
    } else {
      console.log('[Claude] No chats found. DOM state:');
      console.log('  - Sidebar links:', document.querySelectorAll("li > div.relative.group a[href]").length);
      console.log('  - Recents items:', document.querySelectorAll("ul.flex.flex-col.gap-3 > li").length);
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
            // Check for sidebar or recents changes
            if (node.matches && (
              node.matches("li > div.relative.group a[href]") || 
              node.querySelector("li > div.relative.group a[href]") ||
              node.matches("ul.flex.flex-col.gap-3 > li") ||
              node.querySelector("ul.flex.flex-col.gap-3 > li")
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
  
  console.log('[Claude] Content script loaded and running');
})();
