from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta
import os

from models import (
    User, Chat, UserCreate, UserLogin, UserResponse, 
    ChatCreate, ChatUpdate, ChatResponse, Token,
    SyncRequest, SyncResponse, ChatStats
)
from database import get_db, create_tables, connect_database, disconnect_database
from auth import (
    authenticate_user, create_user, get_current_user, 
    create_access_token, get_user_by_email
)

# Initialize FastAPI app
app = FastAPI(
    title="ChatSync API",
    description="Backend API for ChatSync browser extension",
    version="1.0.0"
)

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

# Chat endpoints
@app.get("/api/chats", response_model=List[ChatResponse])
async def get_chats(
    provider: Optional[str] = None,
    category: Optional[str] = None,
    subject: Optional[str] = None,
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
        for field, value in chat_data.dict(exclude_unset=True).items():
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
    for field, value in chat_data.dict(exclude_unset=True).items():
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
            if existing_chat.category:
                update_data.pop('category', None)
            if existing_chat.subject:
                update_data.pop('subject', None)
            
            for field, value in update_data.items():
                if field != "timestamp":
                    setattr(existing_chat, field, value)
            
            existing_chat.updated_at = func.now()
            updated_count += 1
        else:
            # Create new chat
            chat_dict = chat_data.dict() # Consider changing to model_dump()
            
            # 1. Parse the string timestamp into a datetime object
            # The .replace('Z', '+00:00') handles the Zulu time format for compatibility
            parsed_timestamp = datetime.fromisoformat(chat_dict['timestamp'].replace('Z', '+00:00'))
            chat_dict['timestamp'] = parsed_timestamp
            
            # 2. Create the Chat object with the corrected dictionary
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
