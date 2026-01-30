# DocuVault

A self-hosted documentation platform that connects to GitLab repositories, provides AI-powered search and writing assistance, and features its own user management system.

## Features

- **Documentation Editor**: Rich WYSIWYG editor with TipTap (ProseMirror-based)
- **GitLab Integration**: Import repositories, auto-sync, commit and push changes
- **AI-Powered Search**: Semantic search using OpenAI embeddings and pgvector
- **AI Chat**: Ask questions about your documentation with context-aware answers
- **Writing Assistant**: AI-powered suggestions, improvements, and content generation
- **User Management**: Email/password auth, roles (Super Admin, Org Admin, Editor, Viewer)
- **Space Permissions**: Fine-grained access control per documentation space

## Tech Stack

- **Frontend**: Angular 18 + TailwindCSS
- **Backend**: Spring Boot 3.2 + Kotlin
- **Database**: PostgreSQL 16 + pgvector
- **AI**: OpenAI API (GPT-4 + text-embedding-3-small)
- **Editor**: TipTap
- **Deployment**: Docker Compose

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenAI API key (for AI features)
- GitLab personal access token (for Git integration)

### Setup

1. Clone the repository:
   ```bash
   cd /path/to/DocuVault
   ```

2. Create environment file:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. Start the application:
   ```bash
   docker-compose up -d
   ```

4. Access the application:
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:8080/api

### Development Setup

**Backend:**
```bash
cd backend
./gradlew bootRun
```

**Frontend:**
```bash
cd frontend
npm install
npm start
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JWT_SECRET` | Secret key for JWT tokens | Yes |
| `OPENAI_API_KEY` | OpenAI API key for AI features | No |
| `GITLAB_URL` | GitLab instance URL | No |
| `GITLAB_TOKEN` | GitLab personal access token | No |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DocuVault                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Angular    │  │  Spring Boot │  │     PostgreSQL       │  │
│  │   Frontend   │◄─┤    API       │◄─┤  + pgvector          │  │
│  │   (SPA)      │  │              │  │                      │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────┘  │
│                           │                                      │
│              ┌────────────┴────────────┐                        │
│              ▼                         ▼                        │
│  ┌──────────────────┐      ┌──────────────────┐                │
│  │   GitLab API     │      │   OpenAI API     │                │
│  └──────────────────┘      └──────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token

### Users
- `GET /api/users/me` - Get current user
- `GET /api/users` - List all users (admin)
- `POST /api/users/invite` - Invite user (admin)

### Spaces
- `GET /api/spaces` - List spaces
- `POST /api/spaces` - Create space
- `GET /api/spaces/{id}` - Get space details
- `PUT /api/spaces/{id}` - Update space
- `DELETE /api/spaces/{id}` - Delete space

### Documents
- `GET /api/spaces/{id}/documents/tree` - Get file tree
- `GET /api/spaces/{id}/documents/{path}` - Get document
- `POST /api/spaces/{id}/documents` - Create document
- `PUT /api/spaces/{id}/documents/{path}` - Update document

### AI
- `POST /api/ai/search` - Semantic search
- `POST /api/ai/chat` - Chat with AI
- `POST /api/ai/suggest` - Get writing suggestions
- `POST /api/ai/generate` - Generate content

### Git
- `GET /api/git/status` - GitLab connection status
- `GET /api/git/projects` - List GitLab projects
- `POST /api/git/spaces/{id}/pull` - Pull changes
- `POST /api/git/spaces/{id}/push` - Push changes

## License

MIT
