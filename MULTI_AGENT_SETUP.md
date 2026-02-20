# Multi-Agent Setup Guide

This guide explains how to create and manage multiple AI agents using the same project structure.

## Overview

The application now supports multiple agents, each with their own:
- **Configuration** (system prompt, welcome message, agent name)
- **Knowledge Base** (separate document indexing and retrieval)
- **Chat History** (isolated conversations)

## Architecture

### Storage Structure

Agents are stored in Google Cloud Storage with the following structure:

```
GCS Bucket/
├── settings.json                    # Default agent config
├── knowledge-base.json              # Default agent knowledge base
└── agents/
    ├── agent-1/
    │   ├── settings.json            # Agent-specific config
    │   └── knowledge-base.json      # Agent-specific knowledge base
    ├── agent-2/
    │   ├── settings.json
    │   └── knowledge-base.json
    └── ...
```

### URL Structure

- **Default Agent**: `/` (uses root-level `settings.json` and `knowledge-base.json`)
- **Specific Agent**: `/agent/[agentId]` (uses `agents/[agentId]/settings.json` and `agents/[agentId]/knowledge-base.json`)

## Creating a New Agent

### Method 1: Via URL (Recommended)

1. Navigate to `/agent/[your-agent-id]` in your browser
   - Example: `http://localhost:3000/agent/customer-support`
   - Example: `http://localhost:3000/agent/sales-assistant`

2. The agent will be created automatically when you:
   - Configure the prompt settings
   - Save the configuration
   - Index a knowledge base

### Method 2: Programmatically

Agents are created automatically when you save configuration or knowledge base data for a specific `agentId`. You can use the API:

```bash
# Save configuration for a new agent
curl -X POST http://localhost:3000/api/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "my-new-agent",
    "systemPrompt": "You are a helpful assistant...",
    "welcomeMessage": "Hello! How can I help?",
    "agentName": "My New Agent"
  }'
```

## Managing Agents

### Viewing All Agents

The agent selector component automatically lists all available agents. It appears in the header of the default agent page.

### Switching Between Agents

1. **From Default Agent Page**: Use the agent selector in the header
2. **Direct Navigation**: Navigate to `/agent/[agentId]`
3. **Programmatically**: Use the `/api/agents` endpoint

### Listing Agents via API

```bash
curl http://localhost:3000/api/agents
```

Response:
```json
{
  "agents": ["agent-1", "agent-2", "customer-support"]
}
```

## Agent Configuration

Each agent can have independent:

### 1. System Prompt
- Defines the agent's behavior and personality
- Stored in `agents/[agentId]/settings.json`

### 2. Welcome Message
- Initial message shown when chat starts
- Customizable per agent

### 3. Agent Name
- Display name for the agent
- Shown in the chat header

### 4. Knowledge Base
- Separate document indexing per agent
- Each agent can have different source documents
- Stored in `agents/[agentId]/knowledge-base.json`

## API Usage

### Get Agent Configuration

```bash
# Default agent
GET /api/prompt

# Specific agent
GET /api/prompt?agentId=customer-support
```

### Save Agent Configuration

```bash
POST /api/prompt
Content-Type: application/json

{
  "agentId": "customer-support",
  "systemPrompt": "...",
  "welcomeMessage": "...",
  "agentName": "...",
  "config": { ... }
}
```

### Chat with Agent

```bash
POST /api/chat
Content-Type: application/json

{
  "message": "Hello!",
  "useKnowledgeBase": true,
  "agentId": "customer-support"  // Optional, defaults to default agent
}
```

### Index Knowledge Base for Agent

```bash
POST /api/knowledge-base/index
Content-Type: application/json

{
  "agentId": "customer-support"  // Optional, defaults to default agent
}
```

### Get Knowledge Base Status

```bash
# Default agent
GET /api/knowledge-base/index

# Specific agent
GET /api/knowledge-base/index?agentId=customer-support
```

## Component Usage

### ChatWindow Component

```tsx
<ChatWindow 
  agentId="customer-support"  // Optional
  refreshTrigger={trigger}
/>
```

### PromptEditor Component

```tsx
<PromptEditor 
  agentId="customer-support"  // Optional
  onSaveSuccess={() => {}}
/>
```

## Migration from Single Agent

If you have an existing single-agent setup:

1. **Your existing configuration** is automatically used as the "default" agent
2. **No changes required** - the default agent works at `/`
3. **Create new agents** by navigating to `/agent/[new-id]`

The system maintains backward compatibility:
- If no `agentId` is provided, it uses the default agent
- Existing API calls without `agentId` continue to work
- Root-level `settings.json` and `knowledge-base.json` are preserved

## Best Practices

### 1. Agent Naming

Use descriptive, URL-friendly agent IDs:
- ✅ `customer-support`
- ✅ `sales-assistant`
- ✅ `technical-help`
- ❌ `Agent 1` (spaces)
- ❌ `agent@123` (special chars)

### 2. Knowledge Base Organization

- Each agent should have its own Google Drive folder (if using Drive integration)
- Or use the same folder but different agent IDs for different use cases
- Consider agent-specific document filtering

### 3. Configuration Management

- Keep agent configurations in version control (export from GCS)
- Document each agent's purpose and configuration
- Use consistent naming conventions

### 4. Testing

- Test each agent independently
- Verify knowledge base isolation
- Check that chat history doesn't leak between agents

## Example Use Cases

### 1. Customer Support vs Sales

```bash
# Customer Support Agent
/agent/customer-support
- Knowledge Base: Support documentation, FAQs
- Prompt: "You are a helpful customer support agent..."

# Sales Agent
/agent/sales
- Knowledge Base: Product catalogs, pricing sheets
- Prompt: "You are a friendly sales assistant..."
```

### 2. Multi-Language Agents

```bash
# English Agent
/agent/en
- Language: English
- Knowledge Base: English documents

# Spanish Agent
/agent/es
- Language: Spanish
- Knowledge Base: Spanish documents
```

### 3. Department-Specific Agents

```bash
# HR Agent
/agent/hr
- Knowledge Base: HR policies, employee handbook

# IT Agent
/agent/it
- Knowledge Base: Technical documentation, troubleshooting guides
```

## Troubleshooting

### Agent Not Appearing

- Check that configuration was saved: Navigate to `/agent/[agentId]` and save settings
- Verify GCS permissions: Ensure the service account can write to the bucket
- Check browser console for errors

### Knowledge Base Not Working

- Ensure you've indexed the knowledge base for that specific agent
- Check that `agentId` is passed correctly in API calls
- Verify the knowledge base file exists in GCS: `agents/[agentId]/knowledge-base.json`

### Configuration Not Loading

- Clear browser cache
- Check that the agent ID matches exactly (case-sensitive)
- Verify the settings file exists in GCS

## Security Considerations

- **Authentication**: All agents share the same authentication system
- **Isolation**: Agent data is isolated at the storage level
- **Access Control**: Consider implementing agent-level permissions if needed
- **API Keys**: All agents share the same Gemini API key (configured server-side)

## Next Steps

1. Create your first agent by navigating to `/agent/[your-id]`
2. Configure the agent's prompt and settings
3. Index a knowledge base for the agent
4. Test the agent's responses
5. Embed the agent using the embedding guide (see `EMBEDDING.md`)

For embedding specific agents, use:
```html
<iframe src="https://your-domain.com/agent/customer-support"></iframe>
```

