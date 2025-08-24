#!/bin/bash

echo "🚀 ChatSync Setup Script"
echo "========================"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed."
    exit 1
fi

echo "✅ Python 3 found"

# Navigate to backend directory
cd backend

echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp env.example .env
    echo "✅ Created .env file (edit with your settings)"
else
    echo "📝 .env file already exists"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the backend:"
echo "  cd backend && python start.py"
echo ""
echo "To load the extension:"
echo "  1. Open chrome://extensions/"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked'"
echo "  4. Select the 'extension' folder"
echo ""
echo "Backend will be available at: http://localhost:8000"
echo "API docs will be available at: http://localhost:8000/docs"
