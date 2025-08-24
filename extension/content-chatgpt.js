// ChatGPT Content Script - Extract chat history
(() => {
  const PROVIDER = 'chatgpt';
  
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
  
  // Extract chats from sidebar history
  function extractChatsFromSidebar() {
    const results = [];
    
    try {
      console.log('[ChatGPT] Starting extraction from sidebar...');
      
      // Method 1: Try the nav approach first
      const navLinks = document.querySelectorAll("nav a[href^='/c/']");
      console.log(`[ChatGPT] Found ${navLinks.length} nav links with /c/ pattern`);
      
      navLinks.forEach((el, index) => {
        try {
          const title = el.innerText.trim();
          const link = el.href;
          
          console.log(`[ChatGPT] Nav link ${index + 1}: "${title}" -> ${link}`);
          
          if (title && link) {
            results.push(createChatEntry(title, link));
          }
        } catch (err) {
          console.error("Error parsing nav chat link:", err, el);
        }
      });
      
      // Method 2: If no results, try history container approach
      if (results.length === 0) {
        console.log('[ChatGPT] No nav links found, trying #history approach...');
        const historyLinks = document.querySelectorAll('#history a');
        console.log(`[ChatGPT] Found ${historyLinks.length} links in #history`);
        
        historyLinks.forEach((el, index) => {
          try {
            const titleEl = el.querySelector('.truncate span') || el.querySelector('span');
            const title = titleEl?.textContent.trim() || el.textContent.trim();
            const link = el.href;
            
            console.log(`[ChatGPT] History link ${index + 1}: "${title}" -> ${link}`);
            
            if (title && link && link.includes('/c/')) {
              results.push(createChatEntry(title, link));
            }
          } catch (err) {
            console.error("Error parsing history chat link:", err, el);
          }
        });
      }
      
    } catch (err) {
      console.error("Error in ChatGPT extraction:", err);
    }
    
    return results;
  }
  
  // Main extraction function
  function extractChats() {
    console.log('[ChatGPT] ===== STARTING CHAT EXTRACTION =====');
    console.log('[ChatGPT] Page URL:', window.location.href);
    console.log('[ChatGPT] Page title:', document.title);
    
    const chats = extractChatsFromSidebar();
    
    console.log(`[ChatGPT] ===== EXTRACTION COMPLETE =====`);
    console.log(`[ChatGPT] Total chats extracted: ${chats.length}`);
    
    if (chats.length > 0) {
      console.log('[ChatGPT] Sample chat titles:');
      chats.slice(0, 5).forEach((chat, i) => {
        console.log(`  ${i + 1}. "${chat.title}"`);
      });
      if (chats.length > 5) {
        console.log(`  ... and ${chats.length - 5} more`);
      }
    } else {
      console.log('[ChatGPT] No chats found. DOM state:');
      console.log('  - Nav links with /c/:', document.querySelectorAll("nav a[href^='/c/']").length);
      console.log('  - #history links:', document.querySelectorAll('#history a').length);
      console.log('  - All nav links:', document.querySelectorAll('nav a').length);
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
  
  // Initial extraction
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
            // Check if new chat links were added
            if (node.matches && (node.matches("nav a[href^='/c/']") || node.querySelector("nav a[href^='/c/']"))) {
              shouldRecheck = true;
            }
            if (node.matches && (node.matches("#history a") || node.querySelector("#history a"))) {
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
  
  console.log('ChatGPT content script loaded');
})();
