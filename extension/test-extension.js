// Test script to validate extension setup
console.log('=== ChatSync Extension Test ===');

// Test 1: Check if service worker loads
console.log('1. Testing service worker...');
if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('✅ Chrome runtime available');
} else {
  console.log('❌ Chrome runtime not available');
}

// Test 2: Check if storage is available
console.log('2. Testing storage...');
try {
  if (typeof ChatStorage !== 'undefined') {
    console.log('✅ ChatStorage class available');
  } else {
    console.log('❌ ChatStorage class not available');
  }
} catch (e) {
  console.log('❌ Storage test failed:', e);
}

// Test 3: Check manifest permissions
console.log('3. Testing permissions...');
if (typeof chrome !== 'undefined' && chrome.permissions) {
  chrome.permissions.getAll((permissions) => {
    console.log('✅ Permissions:', permissions);
  });
} else {
  console.log('❌ Permissions API not available');
}

console.log('=== Test Complete ===');
