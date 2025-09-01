from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta
import os
import json
from google import genai
import re
from dotenv import load_dotenv


from models import (
    User, Chat, Project, UserCreate, UserLogin, UserResponse, 
    ChatCreate, ChatUpdate, ChatResponse, ProjectCreate, ProjectUpdate, ProjectResponse,
    Token, SyncRequest, SyncResponse, ChatStats
)
from database import get_db, create_tables, connect_database, disconnect_database
from auth import (
    authenticate_user, create_user, get_current_user, 
    create_access_token, get_user_by_email
)
load_dotenv()
# Initialize FastAPI app
app = FastAPI(
    title="ChatSync API",
    description="Backend API for ChatSync browser extension",
    version="1.0.0"
)

# Configure Gemini AI (add your API key)
# GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyDvXBAfo3ImoG0C_YzIQnxNugFfqjyrVHI")
GEMINI_API_KEY = "your-gemini-api-key-here"
if GEMINI_API_KEY != "your-gemini-api-key-here":
    genai.configure(api_key=GEMINI_API_KEY)

# CORS middleware for browser extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables on startup
@app.on_event("startup")
async def startup():
    create_tables()
    await connect_database()

@app.on_event("shutdown")
async def shutdown():
    await disconnect_database()

# AI categorization function
def categorize_chat_with_ai(title: str, preview: str = None, description: str = None) -> tuple:
    """Use Gemini AI to categorize chat title into category and subject"""
    try:
        print(f"[Gemini] GEMINI_API_KEY: {GEMINI_API_KEY}")  # LOGGING
        if GEMINI_API_KEY == "your-gemini-api-key-here":
            print("[Gemini] Using fallback categorization (no API key set).")  # LOGGING
            return categorize_chat_fallback(title)

        print("[Gemini] Initializing Gemini Client...")  # LOGGING
        client = genai.Client()

        # Create context for AI
        context = f"Title: {title}"
        if preview:
            context += f"\nPreview: {preview[:200]}"
        if description:
            context += f"\nDescription: {description[:200]}"

        prompt = f"""Analyze this chat and assign it to appropriate category and subject:

{context}

Return ONLY a JSON object with this exact format:
{{"category": "category_name", "subject": "subject_name"}}

Categories (choose one): Programming, Research, Writing, Business, Education, Personal, Creative, Technical, General
Subjects (choose one that fits the content): Python, JavaScript, Web Development, AI/ML, Data Science, Marketing, Finance, Health, Travel, Career, Study, Project, Debug, Analysis, Planning, Other, or name of the specific topic or project name it relates to like "E-commerce", "Blogging", "App Development", etc. or like a custom project name.

Example: {{"category": "Programming", "subject": "Python"}}"""

        print(f"[Gemini] Sending prompt to Gemini:\n{prompt[:500]}...")  # LOGGING (truncated)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )
        print(f"[Gemini] Gemini response: {response.text.strip()}")  # LOGGING

        # Parse JSON response
        result = json.loads(response.text.strip())
        return result.get("category", "General"), result.get("subject", "Other")

    except Exception as e:
        print(f"[Gemini] AI categorization failed: {e}")
        return categorize_chat_fallback(title)

def categorize_chat_fallback(title: str) -> tuple:
    """Fallback categorization based on keywords"""
    title_lower = title.lower()
    
    # Programming keywords
    if any(word in title_lower for word in ['python', 'javascript', 'code', 'programming', 'debug', 'function', 'api', 'database']):
        return "Programming", "Development"
    
    # Research keywords  
    if any(word in title_lower for word in ['research', 'study', 'analysis', 'learn', 'understand', 'explain']):
        return "Research", "Study"
    
    # Business keywords
    if any(word in title_lower for word in ['business', 'marketing', 'strategy', 'plan', 'meeting', 'proposal']):
        return "Business", "Planning"
    
    # Creative keywords
    if any(word in title_lower for word in ['write', 'story', 'creative', 'design', 'art', 'blog']):
        return "Creative", "Writing"
    
    return "General", "Other"

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

# Authentication endpoints
@app.post("/api/auth/register", response_model=dict)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user."""
    # Check if user already exists
    existing_user = get_user_by_email(db, user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    user = create_user(db, user_data.email, user_data.password)
    return {"message": "User created successfully", "user_id": user.id}

@app.post("/api/auth/login", response_model=Token)
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    """Authenticate user and return access token."""
    user = authenticate_user(db, user_data.email, user_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Create access token
    access_token = create_access_token(data={"sub": str(user.id)})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.from_orm(user)
    }

# Project endpoints
@app.get("/api/projects", response_model=List[ProjectResponse])
async def get_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's projects with chat counts."""
    projects = db.query(Project).filter(
        Project.user_id == current_user.id
    ).order_by(Project.created_at).all()
    
    # Add chat counts
    for project in projects:
        project.chat_count = db.query(Chat).filter(
            Chat.project_id == project.id,
            Chat.is_archived == False
        ).count()
    
    return projects

@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(
    project_data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new project."""
    project = Project(
        user_id=current_user.id,
        **project_data.model_dump()
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    project.chat_count = 0
    return project

@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    project_data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a project."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    for field, value in project_data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    
    project.updated_at = func.now()
    db.commit()
    db.refresh(project)
    return project

@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a project and move chats to unassigned."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Move chats to unassigned
    db.query(Chat).filter(Chat.project_id == project_id).update({"project_id": None})
    
    db.delete(project)
    db.commit()
    return {"message": "Project deleted successfully"}

# Chat endpoints
@app.get("/api/chats", response_model=List[ChatResponse])
async def get_chats(
    provider: Optional[str] = None,
    category: Optional[str] = None,
    subject: Optional[str] = None,
    project_id: Optional[int] = None,
    is_archived: Optional[bool] = False,
    is_bookmarked: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's chats with optional filtering."""
    query = db.query(Chat).filter(Chat.user_id == current_user.id)
    
    if provider:
        query = query.filter(Chat.provider == provider)
    if category:
        query = query.filter(Chat.category == category)
    if subject:
        query = query.filter(Chat.subject == subject)
    if project_id is not None:
        if project_id == 0:  # Unassigned chats
            query = query.filter(Chat.project_id.is_(None))
        else:
            query = query.filter(Chat.project_id == project_id)
    if is_archived is not None:
        query = query.filter(Chat.is_archived == is_archived)
    if is_bookmarked is not None:
        query = query.filter(Chat.is_bookmarked == is_bookmarked)
    
    chats = query.order_by(Chat.updated_at.desc()).offset(offset).limit(limit).all()
    return chats

@app.post("/api/chats", response_model=ChatResponse)
async def create_chat(
    chat_data: ChatCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new chat."""
    # Check if chat already exists for this user
    existing_chat = db.query(Chat).filter(
        Chat.user_id == current_user.id,
        Chat.provider == chat_data.provider,
        Chat.link == chat_data.link
    ).first()
    
    if existing_chat:
        # Update existing chat
        for field, value in chat_data.model_dump(exclude_unset=True).items():
            if field != "timestamp":  # Don't update timestamp
                setattr(existing_chat, field, value)
        existing_chat.updated_at = func.now()
        db.commit()
        db.refresh(existing_chat)
        return existing_chat
    
    # Create new chat
    chat = Chat(
        user_id=current_user.id,
        **chat_data.model_dump()
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat

@app.put("/api/chats/{chat_id}", response_model=ChatResponse)
async def update_chat(
    chat_id: int,
    chat_data: ChatUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a chat."""
    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.user_id == current_user.id
    ).first()
    
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    # Update chat fields
    for field, value in chat_data.model_dump(exclude_unset=True).items():
        setattr(chat, field, value)
    
    chat.updated_at = func.now()
    db.commit()
    db.refresh(chat)
    return chat

@app.delete("/api/chats/{chat_id}")
async def delete_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a chat."""
    chat = db.query(Chat).filter(
        Chat.id == chat_id,
        Chat.user_id == current_user.id
    ).first()
    
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    db.delete(chat)
    db.commit()
    return {"message": "Chat deleted successfully"}

@app.post("/api/sync", response_model=SyncResponse)
async def sync_chats(
    sync_data: SyncRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sync chats from browser extension."""
    created_count = 0
    updated_count = 0
    
    for chat_data in sync_data.chats:
        existing_chat = db.query(Chat).filter(
            Chat.user_id == current_user.id,
            Chat.provider == chat_data.provider,
            Chat.link == chat_data.link
        ).first()
        
        if existing_chat:
            # Update existing chat (preserve user-set category/subject)
            update_data = chat_data.model_dump(exclude_unset=True)
            if existing_chat.category and existing_chat.category != "General":
                update_data.pop('category', None)
            if existing_chat.subject and existing_chat.subject != "Other":
                update_data.pop('subject', None)
            
            for field, value in update_data.items():
                if field != "timestamp":
                    setattr(existing_chat, field, value)
            
            existing_chat.updated_at = func.now()
            updated_count += 1
        else:
            # Create new chat with AI categorization
            chat_dict = chat_data.model_dump()
            
            # Parse timestamp if it's a string
            if isinstance(chat_dict.get('timestamp'), str):
                try:
                    parsed_timestamp = datetime.fromisoformat(chat_dict['timestamp'].replace('Z', '+00:00'))
                    chat_dict['timestamp'] = parsed_timestamp
                except (ValueError, TypeError):
                    chat_dict['timestamp'] = datetime.utcnow()
            elif chat_dict.get('timestamp') is None:
                chat_dict['timestamp'] = datetime.utcnow()
            
            # Auto-categorize if not already categorized
            if not chat_dict.get('category') or not chat_dict.get('subject'):
                category, subject = categorize_chat_with_ai(
                    chat_dict['title'], 
                    chat_dict.get('preview'), 
                    chat_dict.get('description')
                )
                if not chat_dict.get('category'):
                    chat_dict['category'] = category
                if not chat_dict.get('subject'):
                    chat_dict['subject'] = subject
            
            chat = Chat(
                user_id=current_user.id,
                **chat_dict
            )
            db.add(chat)
            created_count += 1
    
    db.commit()
    
    return {
        "message": f"Sync completed: {created_count} created, {updated_count} updated",
        "synced_count": len(sync_data.chats),
        "created_count": created_count,
        "updated_count": updated_count
    }

@app.get("/api/stats", response_model=ChatStats)
async def get_chat_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's chat statistics."""
    # Get all user chats
    chats = db.query(Chat).filter(Chat.user_id == current_user.id).all()
    
    # Calculate statistics
    total_chats = len(chats)
    by_provider = {}
    by_category = {}
    by_subject = {}
    
    for chat in chats:
        # Provider stats
        by_provider[chat.provider] = by_provider.get(chat.provider, 0) + 1
        
        # Category stats
        category = chat.category or "Uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
        
        # Subject stats
        subject = chat.subject or "General"
        by_subject[subject] = by_subject.get(subject, 0) + 1
    
    # Get recent chats (last 10)
    recent_chats = db.query(Chat).filter(
        Chat.user_id == current_user.id
    ).order_by(Chat.updated_at.desc()).limit(10).all()
    
    return {
        "total_chats": total_chats,
        "by_provider": by_provider,
        "by_category": by_category,
        "by_subject": by_subject,
        "recent_chats": recent_chats
    }

@app.get("/api/search", response_model=List[ChatResponse])
async def search_chats(
    q: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search chats by title, preview, or description."""
    search_term = f"%{q}%"
    
    chats = db.query(Chat).filter(
        Chat.user_id == current_user.id,
        (
            Chat.title.ilike(search_term) |
            Chat.preview.ilike(search_term) |
            Chat.description.ilike(search_term)
        )
    ).order_by(Chat.updated_at.desc()).all()
    
    return chats

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)