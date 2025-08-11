# WhatsApp News Bot for Vision Point

A Node.js automation script that connects to WhatsApp Web using the Baileys library and integrates with Perplexity AI to generate Urdu news scripts.

## 🌟 Key Features

- **🤖 AI-Powered Script Generation**: Uses Perplexity AI to create engaging Urdu news scripts
- **📱 WhatsApp Integration**: Seamlessly connects with WhatsApp using Baileys library
- **🎯 Smart Group Management**: Automatically manages source and target groups
- **🔍 Visual Content Search**: Finds relevant videos, articles, and images
- **📺 Multi-format Content**: Supports text scripts and visual media suggestions

- **⚡ Real-time Processing**: Instant script generation and distribution
- **🛡️ Error Handling**: Robust error management and logging
- **🔄 Auto-reconnection**: Maintains stable WhatsApp connection

## Requirements

- Node.js 16.0.0 or higher
- npm (Node Package Manager)
- WhatsApp account
- Access to both "Content" and "Demo script" WhatsApp groups

## Installation

### 1. Install Dependencies

Open terminal/command prompt in the project directory and run:

```bash
npm install
```

This will install all required packages:
- `@whiskeysockets/baileys` - WhatsApp Web API library
- `@hapi/boom` - HTTP error handling
- `pino` - Logging library
- `axios` - HTTP client for API calls

### 2. Optional: Install Development Dependencies

For development with auto-restart:

```bash
npm install --save-dev nodemon
```

## Setup Instructions

### 1. Verify Group Names

Make sure you have access to these WhatsApp groups with exact names:
- **Source Group**: `Content` (where bot listens for messages)
- **Target Group**: `Demo script` (where bot sends generated scripts)

### 2. Run the Bot

Start the bot using one of these commands:

```bash
# Production mode
npm start

# OR development mode (with auto-restart)
npm run dev

# OR direct node command
node whatsapp-bot.js
```

### 3. Scan QR Code

1. When you first run the bot, it will display a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to **Settings** > **Linked Devices** > **Link a Device**
4. Scan the QR code displayed in the terminal
5. The bot will connect and save the session for future use

### 4. Verify Connection

Once connected, you should see:
```
✅ WhatsApp connection opened successfully!
📋 Found group: Content (group_id)
📋 Found group: Demo script (group_id)
✅ All required groups found and ready!
🎉 Bot is now running! Press Ctrl+C to stop.
```

## 🔄 How It Works

1. **📱 WhatsApp Connection**: Bot connects to WhatsApp Web and saves session
2. **👂 Message Monitoring**: Listens for new messages in the source group
3. **🤖 AI Processing**: Sends message content to Perplexity AI for script generation
4. **📝 Script Creation**: Generates professional Urdu news script
5. **📤 Distribution**: Sends the script to target group
6. **🔍 Visual Search**: Finds related videos, articles, and images
7. **📺 Content Sharing**: Shares visual content suggestions
8. **✅ Confirmation**: Reacts to original message with checkmark

## Configuration

You can modify the configuration in `whatsapp-bot.js`:

```javascript
const CONFIG = {
    PERPLEXITY_API_KEY: 'your-api-key-here',
    PERPLEXITY_API_URL: 'https://api.perplexity.ai/chat/completions',
    SOURCE_GROUP: 'Content',
    SCRIPT_TARGET_GROUP: 'Demo script',
    VISUAL_TARGET_GROUP: 'Demo visual',
    SESSION_DIR: './auth_info_baileys'
};
```

## Troubleshooting

### Common Issues

1. **QR Code Not Appearing**
   - Make sure terminal supports QR code display
   - Try running in a different terminal/command prompt

2. **Groups Not Found**
   - Verify exact group names (case-sensitive)
   - Make sure the bot account is a member of both groups

3. **Connection Issues**
   - Check internet connection
   - Delete `auth_info_baileys` folder and re-scan QR code
   - Restart the bot

4. **API Errors**
   - Verify Perplexity API key is correct
   - Check API rate limits
   - Ensure stable internet connection

### Logs and Debugging

The bot provides detailed console logs:
- 🚀 Startup messages
- 📱 QR code generation
- ✅ Successful connections
- 📨 Message processing
- 🤖 AI script generation
- 📤 Message sending
- ❌ Error messages

### Stopping the Bot

Press `Ctrl+C` in the terminal to gracefully stop the bot.

## File Structure

```
whatsapp-news-bot/
├── whatsapp-bot.js          # Main bot script
├── package.json             # Dependencies and scripts
├── README.md               # This documentation
└── auth_info_baileys/      # Session data (auto-created)
    ├── creds.json
    └── ...
```

## Security Notes

- Keep your Perplexity API key secure
- The `auth_info_baileys` folder contains sensitive session data
- Don't share session files with others
- Regularly monitor bot activity

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review console logs for error messages
3. Ensure all dependencies are properly installed
4. Verify group memberships and names

## License

MIT License - Feel free to modify and distribute as needed.