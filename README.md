# Design AI Chatbot

A simple chatbot application built with Next.js 16, Tailwind CSS, and Google Gemini AI.

## Features

- 🎨 Clean, modern UI with orange-themed design
- 💬 Real-time chat with Google Gemini AI
- 🔒 Secure API implementation (no API keys exposed to client)
- ⚡ Fast and responsive
- 📱 Mobile-friendly design

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

You need to add your Google Gemini API key to the `.env.local` file:

1. Get your Gemini API key from: [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey)
2. Open the `.env.local` file in the project root
3. Add your API key:

```env
GEMINI_API_KEY=your_actual_api_key_here
```

**Important:** 
- Never commit your `.env.local` file to version control
- The API key is only used server-side and never exposed to the browser
- `.env.local` is already in `.gitignore` to prevent accidental commits

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Use the Chatbot

1. Click the orange chat button in the bottom right corner
2. The chat window will open with a welcome message
3. Type your message and press Enter or click the send button
4. The AI will respond to your questions

## Project Structure

```
text-agent-template/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # API endpoint for chat (server-side only)
│   ├── components/
│   │   └── ChatWindow.tsx        # Main chat UI component
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page with chat button
│   └── globals.css               # Global styles
├── .env.local                    # Environment variables (DO NOT COMMIT)
├── .env.example                  # Example environment file
└── package.json
```

## How It Works

1. **Client Side**: User types a message in the chat interface
2. **API Call**: Message is sent to `/api/chat` endpoint via POST request
3. **Server Side**: The API route receives the message and calls Google Gemini API
4. **Response**: Gemini's response is sent back to the client and displayed in the chat

## Security

- ✅ API keys are stored in environment variables
- ✅ API calls to Gemini are made server-side only
- ✅ No sensitive data is exposed to the browser
- ✅ `.env.local` is gitignored

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS
- **AI**: Google Gemini AI
- **Language**: TypeScript

## Build for Production

```bash
npm run build
npm start
```

## License

MIT
