const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your-gemini-api-key-here';
let genAI = null;

if (GEMINI_API_KEY !== 'your-gemini-api-key-here') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// AI categorization function
const categorizeChatWithAI = async (title, preview = null, description = null) => {
  try {
    console.log(`[Gemini] GEMINI_API_KEY: ${GEMINI_API_KEY}`); // LOGGING
    
    if (GEMINI_API_KEY === 'your-gemini-api-key-here' || !genAI) {
      console.log('[Gemini] Using fallback categorization (no API key set).'); // LOGGING
      return categorizeChatFallback(title);
    }

    console.log('[Gemini] Initializing Gemini Client...'); // LOGGING
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    // Create context for AI
    let context = `Title: ${title}`;
    if (preview) {
      context += `\nPreview: ${preview.substring(0, 200)}`;
    }
    if (description) {
      context += `\nDescription: ${description.substring(0, 200)}`;
    }

    const prompt = `Analyze this chat and assign it to appropriate category and subject:

${context}

Return ONLY a JSON object with this exact format:
{"category": "category_name", "subject": "subject_name"}

Categories (choose one): Programming, Research, Writing, Business, Education, Personal, Creative, Technical, General
Subjects (choose one that fits the content): Python, JavaScript, Web Development, AI/ML, Data Science, Marketing, Finance, Health, Travel, Career, Study, Project, Debug, Analysis, Planning, Other, or name of the specific topic or project name it relates to like "E-commerce", "Blogging", "App Development", etc. or like a custom project name.

Example: {"category": "Programming", "subject": "Python"}`;

    console.log(`[Gemini] Sending prompt to Gemini:\n${prompt.substring(0, 500)}...`); // LOGGING (truncated)
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().strip();
    
    console.log(`[Gemini] Gemini response: ${text}`); // LOGGING

    // Parse JSON response
    const parsed = JSON.parse(text);
    return [parsed.category || 'General', parsed.subject || 'Other'];

  } catch (error) {
    console.log(`[Gemini] AI categorization failed: ${error}`);
    return categorizeChatFallback(title);
  }
};

const categorizeChatFallback = (title) => {
  const titleLower = title.toLowerCase();
  
  // Programming keywords
  if (titleLower.match(/python|javascript|code|programming|debug|function|api|database/)) {
    return ['Programming', 'Development'];
  }
  
  // Research keywords  
  if (titleLower.match(/research|study|analysis|learn|understand|explain/)) {
    return ['Research', 'Study'];
  }
  
  // Business keywords
  if (titleLower.match(/business|marketing|strategy|plan|meeting|proposal/)) {
    return ['Business', 'Planning'];
  }
  
  // Creative keywords
  if (titleLower.match(/write|story|creative|design|art|blog/)) {
    return ['Creative', 'Writing'];
  }
  
  return ['General', 'Other'];
};

module.exports = {
  categorizeChatWithAI,
  categorizeChatFallback
};