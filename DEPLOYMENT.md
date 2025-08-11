# Deployment Guide - WhatsApp News Bot

This guide will help you deploy the WhatsApp News Bot to GitHub and host it on Render.

## 📋 Prerequisites

- GitHub account
- Render account (free tier available)
- Perplexity AI API key
- WhatsApp account with access to required groups

## 🚀 GitHub Deployment

### 1. Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it `whatsapp-news-bot` or your preferred name
3. Make it **private** (recommended for security)
4. Don't initialize with README (we already have one)

### 2. Push Code to GitHub

```bash
# Initialize git repository (if not already done)
git init

# Add all files
git add .

# Commit changes
git commit -m "Initial commit: WhatsApp News Bot with Perplexity AI integration"

# Add remote origin (replace with your repository URL)
git remote add origin https://github.com/yourusername/whatsapp-news-bot.git

# Push to GitHub
git push -u origin main
```

### 3. Security Considerations

- ✅ API keys are now environment variables
- ✅ Session data is in .gitignore
- ✅ Sensitive files are excluded
- ⚠️ Make repository private to protect your code

## 🌐 Render Deployment

You have two deployment options:

### Option A: WhatsApp Bot Service (Recommended)
For running the actual WhatsApp bot with full functionality.

### Option B: Static Web Interface
For a simple web dashboard (useful for testing or as a landing page).

### 1. Connect GitHub to Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" → "Web Service"
3. Connect your GitHub account
4. Select your `whatsapp-news-bot` repository

### 2. Configure Deployment Settings

#### For WhatsApp Bot Service (Option A):
**Basic Settings:**
- **Name**: `whatsapp-news-bot`
- **Environment**: `Node`
- **Region**: Choose closest to your location
- **Branch**: `main`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Advanced Settings:**
- **Plan**: Free (for testing) or Starter (for production)
- **Node Version**: `18` (specified in package.json)

#### For Static Web Interface (Option B):
**Basic Settings:**
- **Name**: `whatsapp-news-bot-static`
- **Environment**: `Node`
- **Region**: Choose closest to your location
- **Branch**: `main`
- **Build Command**: `npm install`
- **Start Command**: `npm run start:web`

**Advanced Settings:**
- **Plan**: Free
- **Node Version**: `18` (specified in package.json)

### 3. Environment Variables

Add these environment variables in Render dashboard:

| Variable | Value | Description |
|----------|-------|-------------|
| `PERPLEXITY_API_KEY` | `your-api-key-here` | Your Perplexity AI API key |
| `SOURCE_GROUP` | `VP CONTENT` | WhatsApp source group name |
| `SCRIPT_TARGET_GROUP` | `VP researcher group` | Script target group name |
| `VISUAL_TARGET_GROUP` | `Demo visual` | Visual content target group |
| `NODE_ENV` | `production` | Environment mode |

### 4. Deploy

1. Click "Create Web Service"
2. Render will automatically build and deploy your bot
3. Monitor the deployment logs for any issues

## 📱 WhatsApp Authentication

### Important Notes for Hosted Deployment:

1. **QR Code Scanning**: 
   - The bot will generate QR codes in the deployment logs
   - You'll need to scan these from the Render logs
   - This only needs to be done once per deployment

2. **Session Persistence**:
   - Sessions are stored in the container
   - If the container restarts, you'll need to re-scan QR code
   - Consider upgrading to a paid plan for better persistence

3. **Alternative Approach**:
   - Run locally first to establish session
   - Then deploy (session will need re-authentication)

## 🔧 Configuration Options

### Environment Variables (Optional)

You can customize these in Render dashboard:

```bash
# Group Names
SOURCE_GROUP=VP CONTENT
SCRIPT_TARGET_GROUP=VP researcher group
VISUAL_TARGET_GROUP=Demo visual

# API Configuration
PERPLEXITY_API_KEY=your-api-key-here

# Server Configuration
PORT=3000
NODE_ENV=production
```

### Health Check

The bot includes a health check endpoint:
- **URL**: `https://your-app-name.onrender.com/health`
- **Response**: JSON with status and timestamp
- **Use**: Monitoring and uptime checks

## 🔍 Monitoring & Troubleshooting

### 1. Check Deployment Status

- Go to Render dashboard
- View deployment logs
- Monitor health check endpoint

### 2. Common Issues

**Build Failures:**
```bash
# Check package.json dependencies
npm install --production
```

**WhatsApp Connection Issues:**
- Check QR code in logs
- Verify group names match exactly
- Ensure bot account is in all required groups

**API Errors:**
- Verify Perplexity API key is correct
- Check API rate limits
- Monitor error logs in Render

### 3. Logs Access

```bash
# View live logs in Render dashboard
# Or use Render CLI
render logs -s your-service-name
```

## 🔄 Updates & Maintenance

### Updating the Bot

1. Make changes to your local code
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Update: description of changes"
   git push origin main
   ```
3. Render will automatically redeploy

### Monitoring

- Set up Render notifications for deployment failures
- Monitor the health check endpoint
- Check WhatsApp group activity regularly

## 💰 Cost Considerations

### Render Pricing:
- **Free Tier**: 750 hours/month, sleeps after 15 min inactivity
- **Starter Plan**: $7/month, always on, better for production
- **Pro Plan**: $25/month, enhanced features

### Recommendations:
- Start with free tier for testing
- Upgrade to Starter for production use
- Monitor usage and costs regularly

## 🔐 Security Best Practices

1. **Keep Repository Private**: Protects your code and configuration
2. **Use Environment Variables**: Never hardcode API keys
3. **Regular Updates**: Keep dependencies updated
4. **Monitor Access**: Check who has access to your groups
5. **API Key Security**: Rotate keys periodically

## 📞 Support

If you encounter issues:

1. Check Render deployment logs
2. Verify environment variables
3. Test locally first
4. Check WhatsApp group memberships
5. Verify API key validity

## 🎉 Success Checklist

- ✅ Code pushed to GitHub
- ✅ Render service created and deployed
- ✅ Environment variables configured
- ✅ Health check endpoint responding
- ✅ WhatsApp QR code scanned
- ✅ Bot connected to required groups
- ✅ Test message processed successfully

Your WhatsApp News Bot is now live and ready to process messages! 🚀