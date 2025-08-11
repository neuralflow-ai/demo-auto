const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    MessageType,
    MessageOptions,
    Mimetype
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const youtubeSearch = require('youtube-search-api');
const cheerio = require('cheerio');
const http = require('http');

// Configuration
const CONFIG = {
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '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',
    PERPLEXITY_API_URL: 'https://api.perplexity.ai/chat/completions',
    SOURCE_GROUP: process.env.SOURCE_GROUP || 'Content',
    SCRIPT_TARGET_GROUP: process.env.SCRIPT_TARGET_GROUP || 'Demo script',
    VISUAL_TARGET_GROUP: process.env.VISUAL_TARGET_GROUP || 'Demo visual',
    SESSION_DIR: './auth_info_baileys',
    PORT: process.env.PORT || 3000
};

// Urdu news script prompt template
const URDU_NEWS_PROMPT = `You are a professional Urdu news script writer. Create a ready-to-speech news script in Urdu based on the provided content.

IMPORTANT STYLE REQUIREMENTS:
- Start directly with the main headline/title
- Use "ناظرین!" to address the audience
- Write in a flowing, speech-ready format without additional headings or sections
- Use natural Urdu expressions and connecting phrases
- Include direct quotes and analysis
- End with strong concluding statements
- NO extra formatting, headings, or bullet points - just pure speech script
- NEVER include citation numbers like [1], [2], [3] or any reference markers
- Do not add any numbered references or source citations in the text
- Write clean, flowing text without any bracketed numbers or reference marks

موضوع/ایڈیٹوریل: {editorial_text}

Write the complete ready-to-speech news script in Urdu:`;



class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.groupJids = new Map(); // Store group JIDs by name
        this.botNumber = null;
        this.logger = pino({ level: 'silent' }); // Reduce log noise
    }

    /**
     * Initialize the WhatsApp connection
     */
    async initialize() {
        try {
            console.log('🚀 Starting WhatsApp Bot...');
            
            // Create auth directory if it doesn't exist
            if (!fs.existsSync(CONFIG.SESSION_DIR)) {
                fs.mkdirSync(CONFIG.SESSION_DIR, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(CONFIG.SESSION_DIR);

            this.sock = makeWASocket({
                logger: this.logger,
                auth: state,
                browser: ['WhatsApp Bot', 'Chrome', '1.0.0']
            });

            // Handle connection updates
            this.sock.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(update);
            });

            // Save credentials when updated
            this.sock.ev.on('creds.update', saveCreds);

            // Handle incoming messages
            this.sock.ev.on('messages.upsert', async (m) => {
                await this.handleIncomingMessages(m);
            });

            // Handle group updates to get group JIDs
            this.sock.ev.on('groups.upsert', async (groups) => {
                await this.updateGroupJids(groups);
            });

            console.log('✅ WhatsApp Bot initialized successfully!');

        } catch (error) {
            console.error('❌ Error initializing WhatsApp Bot:', error);
            throw error;
        }
    }

    /**
     * Handle connection state updates
     */
    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 QR Code generated. Please scan with WhatsApp:');
            console.log('━'.repeat(50));
            qrcode.generate(qr, { small: true });
            console.log('━'.repeat(50));
            console.log('📱 Open WhatsApp → Settings → Linked Devices → Link a Device → Scan QR');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;

            console.log('🔌 Connection closed due to:', lastDisconnect?.error);

            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                await this.initialize();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened successfully!');
            this.botNumber = this.sock.user.id.split(':')[0];
            await this.loadGroupJids();
        }
    }

    /**
     * Load existing group JIDs and update the map
     */
    async loadGroupJids() {
        try {
            const groups = await this.sock.groupFetchAllParticipating();
            
            for (const group of Object.values(groups)) {
                this.groupJids.set(group.subject, group.id);
                console.log(`📋 Found group: ${group.subject} (${group.id})`);
            }

            // Check if required groups exist
            const sourceGroupJid = this.groupJids.get(CONFIG.SOURCE_GROUP);
            const scriptTargetGroupJid = this.groupJids.get(CONFIG.SCRIPT_TARGET_GROUP);
            const visualTargetGroupJid = this.groupJids.get(CONFIG.VISUAL_TARGET_GROUP);

            if (!sourceGroupJid) {
                console.warn(`⚠️  Source group "${CONFIG.SOURCE_GROUP}" not found!`);
            }
            if (!scriptTargetGroupJid) {
                console.warn(`⚠️  Script target group "${CONFIG.SCRIPT_TARGET_GROUP}" not found!`);
            }
            if (!visualTargetGroupJid) {
                console.warn(`⚠️  Visual target group "${CONFIG.VISUAL_TARGET_GROUP}" not found!`);
            }

            if (sourceGroupJid && scriptTargetGroupJid && visualTargetGroupJid) {
                console.log('✅ All required groups found and ready!');
            }

        } catch (error) {
            console.error('❌ Error loading group JIDs:', error);
        }
    }

    /**
     * Update group JIDs when new groups are added
     */
    async updateGroupJids(groups) {
        for (const group of groups) {
            this.groupJids.set(group.subject, group.id);
            console.log(`📋 Updated group: ${group.subject}`);
        }
    }

    /**
     * Handle incoming messages
     */
    async handleIncomingMessages(messageUpdate) {
        try {
            const messages = messageUpdate.messages;
            
            for (const message of messages) {
                // Skip if message is from bot itself
                if (message.key.fromMe) {
                    continue;
                }

                // Skip if not a text message
                if (!message.message?.conversation && !message.message?.extendedTextMessage?.text) {
                    continue;
                }

                const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text;
                const chatId = message.key.remoteJid;

                // Check if message is from the source group
                const sourceGroupJid = this.groupJids.get(CONFIG.SOURCE_GROUP);
                if (chatId === sourceGroupJid && messageText.trim()) {
                    console.log(`📨 New message in ${CONFIG.SOURCE_GROUP}: ${messageText.substring(0, 100)}...`);
                    await this.processEditorialMessage(messageText, message);
                }
            }
        } catch (error) {
            console.error('❌ Error handling incoming messages:', error);
        }
    }

    /**
     * Process editorial message and generate news script
     */
    async processEditorialMessage(editorialText, originalMessage) {
        try {
            console.log('🔄 Processing editorial message...');

            // Generate news script using Perplexity API
            const newsScript = await this.generateNewsScript(editorialText);

            if (newsScript) {
                // Send script first
                await this.sendScriptToTargetGroup(newsScript);
                console.log('✅ News script sent!');

                // Extract keywords for visual content search
                console.log('🔍 Extracting keywords for visual content search...');
                const keywords = await this.extractKeywords(newsScript);
                console.log(`📝 Keywords extracted: ${keywords.join(', ')}`);

                // Search for related visual content
                const [videos, articles, images] = await Promise.all([
                    this.searchYouTubeVideos(keywords),
                    this.searchRelatedArticles(keywords),
                    this.searchRelatedImages(keywords)
                ]);

                // Send visual content separately
                await this.sendVisualContentToTargetGroup(videos, articles, images);
                console.log('✅ Visual content sent!');

                // React to original message with checkmark
                await this.reactToMessage(originalMessage, '✅');

                console.log('✅ Editorial processed successfully!');
            } else {
                console.error('❌ Failed to generate news script');
            }

        } catch (error) {
            console.error('❌ Error processing editorial message:', error);
        }
    }

    /**
     * Generate news script using Perplexity API
     */
    async generateNewsScript(editorialText) {
        try {
            console.log('🤖 Generating news script with Perplexity AI...');

            const prompt = URDU_NEWS_PROMPT.replace('{editorial_text}', editorialText);

            const response = await axios.post(CONFIG.PERPLEXITY_API_URL, {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000 // 60 seconds timeout
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                const newsScript = response.data.choices[0].message.content;
                console.log('✅ News script generated successfully!');
                return newsScript;
            } else {
                console.error('❌ Invalid response from Perplexity API');
                return null;
            }

        } catch (error) {
            console.error('❌ Error calling Perplexity API:', error.response?.data || error.message);
            return null;
        }
    }



    /**
     * Send generated script to target group
     */
    async sendScriptToTargetGroup(newsScript) {
        try {
            const scriptTargetGroupJid = this.groupJids.get(CONFIG.SCRIPT_TARGET_GROUP);
            
            if (!scriptTargetGroupJid) {
                console.error(`❌ Script target group "${CONFIG.SCRIPT_TARGET_GROUP}" not found!`);
                return;
            }

            console.log(`📤 Sending script to ${CONFIG.SCRIPT_TARGET_GROUP}...`);

            await this.sock.sendMessage(scriptTargetGroupJid, {
                text: `📺 *Vision Point News Script* 📺\n\n${newsScript}\n\n---\n🤖 *Generated by WhatsApp Bot*`
            });

            console.log('✅ Script sent successfully!');

        } catch (error) {
            console.error('❌ Error sending script to target group:', error);
        }
    }



    /**
     * Send visual content suggestions to target group
     */
    async sendVisualContentToTargetGroup(videos = [], articles = [], images = []) {
        try {
            const visualTargetGroupJid = this.groupJids.get(CONFIG.VISUAL_TARGET_GROUP);
            
            if (!visualTargetGroupJid) {
                console.error(`❌ Visual target group "${CONFIG.VISUAL_TARGET_GROUP}" not found!`);
                return;
            }

            // Only send if we have visual content
            if (videos.length === 0 && articles.length === 0 && images.length === 0) {
                console.log('ℹ️ No visual content found to send');
                return;
            }

            console.log(`📤 Sending visual content to ${CONFIG.VISUAL_TARGET_GROUP}...`);

            const visualMessage = `🎬 *Visual Content Suggestions* 🎬\n\n${this.formatVisualContent(videos, articles, images)}\n\n---\n🤖 *Generated by WhatsApp Bot*`;

            await this.sock.sendMessage(visualTargetGroupJid, {
                text: visualMessage
            });

            console.log('✅ Visual content sent successfully!');

        } catch (error) {
            console.error('❌ Error sending visual content to target group:', error);
        }
    }

    /**
     * Extract keywords from news script for visual content search using AI
     */
    async extractKeywords(newsScript) {
        try {
            console.log('🔍 Using AI to extract relevant keywords...');
            
            const keywordPrompt = `Analyze this Urdu news script and extract the most important keywords for searching related visual content (videos, articles, images). Focus on:
1. Main topic/subject
2. Key people mentioned
3. Countries/locations
4. Important events
5. Technical terms

Return ONLY a comma-separated list of 5-7 English keywords that would be best for searching YouTube videos and Google articles related to this news.

News Script: ${newsScript}

Keywords:`;

            const response = await axios.post(CONFIG.PERPLEXITY_API_URL, {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'user',
                        content: keywordPrompt
                    }
                ],
                max_tokens: 100,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                const keywordsText = response.data.choices[0].message.content.trim();
                const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k.length > 0);
                
                console.log(`✅ AI extracted keywords: ${keywords.join(', ')}`);
                return keywords.slice(0, 7);
            }
            
            // Fallback to manual extraction if AI fails
            return this.fallbackKeywordExtraction(newsScript);
            
        } catch (error) {
            console.error('❌ Error extracting keywords with AI:', error);
            return this.fallbackKeywordExtraction(newsScript);
        }
    }

    /**
     * Fallback keyword extraction method
     */
    fallbackKeywordExtraction(newsScript) {
        const text = newsScript.toLowerCase();
        const keywords = [];
        
        // Enhanced keyword lists
        const importantTerms = [
            'pakistan', 'india', 'china', 'america', 'usa', 'israel', 'iran', 'turkey',
            'army', 'military', 'defense', 'missile', 'helicopter', 'fighter', 'drone',
            'modi', 'imran khan', 'biden', 'xi jinping', 'erdogan', 'netanyahu',
            'kashmir', 'gaza', 'afghanistan', 'ukraine', 'syria', 'yemen',
            'nuclear', 'border', 'terrorism', 'security', 'economy', 'trade',
            'cricket', 'sports', 'election', 'government', 'parliament', 'court'
        ];
        
        // Urdu terms with English equivalents
        const urduTerms = {
            'فوج': 'army',
            'دفاع': 'defense',
            'سرحد': 'border',
            'جنگ': 'war',
            'امن': 'peace',
            'سیاست': 'politics',
            'حکومت': 'government',
            'عدالت': 'court',
            'انتخابات': 'election',
            'معیشت': 'economy',
            'تجارت': 'trade',
            'کرکٹ': 'cricket'
        };
        
        // Extract English terms
        for (const term of importantTerms) {
            if (text.includes(term)) {
                keywords.push(term);
            }
        }
        
        // Extract Urdu terms and add English equivalents
        for (const [urdu, english] of Object.entries(urduTerms)) {
            if (newsScript.includes(urdu)) {
                keywords.push(english);
            }
        }
        
        // Add Pakistan as default if no keywords found
        if (keywords.length === 0) {
            keywords.push('pakistan', 'news', 'current affairs');
        }
        
        return [...new Set(keywords)].slice(0, 5); // Remove duplicates and limit
    }

    /**
     * Search for related YouTube videos with improved relevance
     */
    async searchYouTubeVideos(keywords) {
        try {
            console.log('🎥 Searching for related YouTube videos...');
            
            // Create multiple search queries for better results
            const searchQueries = [
                `${keywords.slice(0, 3).join(' ')} pakistan news latest`,
                `${keywords[0]} ${keywords[1] || 'pakistan'} breaking news`,
                `${keywords.join(' ')} urdu news today`
            ];
            
            let allVideos = [];
            
            for (const query of searchQueries) {
                try {
                    const videos = await youtubeSearch.GetListByKeyword(query, false, 3);
                    
                    if (videos && videos.items && videos.items.length > 0) {
                        const formattedVideos = videos.items.map(video => ({
                            title: video.title,
                            url: `https://www.youtube.com/watch?v=${video.id}`,
                            channel: video.channelTitle,
                            duration: video.length?.simpleText || 'N/A',
                            relevanceScore: this.calculateVideoRelevance(video.title, keywords)
                        }));
                        
                        allVideos.push(...formattedVideos);
                    }
                } catch (queryError) {
                    console.log(`⚠️ Query failed: ${query}`);
                }
            }
            
            // Sort by relevance and remove duplicates
            const uniqueVideos = allVideos.filter((video, index, self) => 
                index === self.findIndex(v => v.url === video.url)
            );
            
            const finalVideos = uniqueVideos
                .sort((a, b) => b.relevanceScore - a.relevanceScore)
                .slice(0, 5);
            
            console.log(`✅ Found ${finalVideos.length} YouTube videos`);
            return finalVideos;
            
        } catch (error) {
            console.error('❌ Error searching YouTube videos:', error);
            return [];
        }
    }

    /**
     * Calculate video relevance score based on title and keywords
     */
    calculateVideoRelevance(title, keywords) {
        let score = 0;
        const titleLower = title.toLowerCase();
        
        keywords.forEach(keyword => {
            if (titleLower.includes(keyword.toLowerCase())) {
                score += 2;
            }
        });
        
        // Bonus for news-related terms
        const newsTerms = ['news', 'breaking', 'latest', 'today', 'update', 'report'];
        newsTerms.forEach(term => {
            if (titleLower.includes(term)) {
                score += 1;
            }
        });
        
        return score;
    }

    /**
     * Search for related articles using AI-powered search
     */
    async searchRelatedArticles(keywords) {
        try {
            console.log('📰 Searching for related articles...');
            
            const searchPrompt = `Find recent news articles related to these keywords: ${keywords.join(', ')}. 
Focus on Pakistani news sources like Dawn, Geo News, ARY News, Express Tribune, etc.
Return 3-5 relevant article titles with their likely URLs from these sources.

Format as:
Title: [Article Title]
URL: [Likely URL]
Source: [News Source]

Keywords: ${keywords.join(', ')}`;

            const response = await axios.post(CONFIG.PERPLEXITY_API_URL, {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'user',
                        content: searchPrompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                const articlesText = response.data.choices[0].message.content;
                const articles = this.parseArticlesFromResponse(articlesText);
                
                console.log(`✅ Found ${articles.length} related articles`);
                return articles;
            }
            
            return this.getFallbackArticles(keywords);
            
        } catch (error) {
            console.error('❌ Error searching articles:', error);
            return this.getFallbackArticles(keywords);
        }
    }

    /**
     * Parse articles from AI response
     */
    parseArticlesFromResponse(text) {
        const articles = [];
        const lines = text.split('\n');
        let currentArticle = {};
        
        for (const line of lines) {
            if (line.startsWith('Title:')) {
                if (currentArticle.title) {
                    articles.push(currentArticle);
                }
                currentArticle = { title: line.replace('Title:', '').trim() };
            } else if (line.startsWith('URL:')) {
                currentArticle.url = line.replace('URL:', '').trim();
            } else if (line.startsWith('Source:')) {
                currentArticle.source = line.replace('Source:', '').trim();
            }
        }
        
        if (currentArticle.title) {
            articles.push(currentArticle);
        }
        
        return articles.slice(0, 5);
    }

    /**
     * Get fallback articles when AI search fails
     */
    getFallbackArticles(keywords) {
        const sources = ['Dawn News', 'Geo News', 'ARY News', 'Express Tribune', 'The News'];
        const articles = [];
        
        for (let i = 0; i < Math.min(3, keywords.length); i++) {
            articles.push({
                title: `Latest updates on ${keywords[i]} - Pakistan News`,
                url: `https://www.dawn.com/search?q=${encodeURIComponent(keywords[i])}`,
                source: sources[i % sources.length]
            });
        }
        
        return articles;
    }

    /**
     * Search for related images
     */
    async searchRelatedImages(keywords) {
        try {
            console.log('🖼️ Searching for related images...');
            
            const imagePrompt = `Suggest 3-5 relevant image search terms for finding news-related images about: ${keywords.join(', ')}.
Focus on terms that would find appropriate news images, photos, or graphics.
Return only the search terms, one per line.

Keywords: ${keywords.join(', ')}`;

            const response = await axios.post(CONFIG.PERPLEXITY_API_URL, {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'user',
                        content: imagePrompt
                    }
                ],
                max_tokens: 150,
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                const imageTerms = response.data.choices[0].message.content
                    .split('\n')
                    .filter(term => term.trim().length > 0)
                    .slice(0, 5);
                
                const images = imageTerms.map((term, index) => ({
                    searchTerm: term.trim(),
                    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(term.trim() + ' news images')}&tbm=isch`,
                    description: `Images related to: ${term.trim()}`
                }));
                
                console.log(`✅ Generated ${images.length} image search suggestions`);
                return images;
            }
            
            return this.getFallbackImages(keywords);
            
        } catch (error) {
            console.error('❌ Error searching images:', error);
            return this.getFallbackImages(keywords);
        }
    }

    /**
     * Get fallback image suggestions
     */
    getFallbackImages(keywords) {
        return keywords.slice(0, 3).map(keyword => ({
            searchTerm: `${keyword} news photos`,
            searchUrl: `https://www.google.com/search?q=${encodeURIComponent(keyword + ' news photos')}&tbm=isch`,
            description: `News images about ${keyword}`
        }));
    }

    /**
     * Format visual content for WhatsApp message
     */
    formatVisualContent(videos, articles, images = []) {
        let content = '\n\n🎬 *RELATED VISUAL CONTENT* 🎬\n';
        content += '━'.repeat(40) + '\n\n';
        
        if (videos.length > 0) {
            content += '🎥 *YouTube Videos (Background Footage):*\n';
            videos.forEach((video, index) => {
                content += `${index + 1}. *${video.title}*\n`;
                content += `   📺 ${video.channel} | ⏱️ ${video.duration}\n`;
                content += `   🔗 ${video.url}\n\n`;
            });
        }
        
        if (articles.length > 0) {
            content += '📰 *Related Articles (Reference Material):*\n';
            articles.forEach((article, index) => {
                content += `${index + 1}. *${article.title}*\n`;
                content += `   📄 ${article.source}\n`;
                content += `   🔗 ${article.url}\n\n`;
            });
        }
        
        if (images.length > 0) {
            content += '🖼️ *Image Search Suggestions:*\n';
            images.forEach((image, index) => {
                content += `${index + 1}. *${image.description}*\n`;
                content += `   🔍 Search: ${image.searchTerm}\n`;
                content += `   🔗 ${image.searchUrl}\n\n`;
            });
        }
        
        if (videos.length === 0 && articles.length === 0 && images.length === 0) {
            content += '⚠️ No related visual content found for this topic.\n\n';
        }
        
        content += '💡 *Usage Instructions:*\n';
        content += '• Use YouTube videos as background footage during news reading\n';
        content += '• Reference articles for additional context and facts\n';
        content += '• Use image searches to find relevant photos and graphics\n';
        content += '• Ensure all content is relevant to the script topic\n';
        
        return content;
    }

    /**
     * React to a message with an emoji
     */
    async reactToMessage(message, emoji) {
        try {
            await this.sock.sendMessage(message.key.remoteJid, {
                react: {
                    text: emoji,
                    key: message.key
                }
            });

            console.log(`✅ Reacted to message with ${emoji}`);

        } catch (error) {
            console.error('❌ Error reacting to message:', error);
        }
    }
}

// Health check server for deployment platforms
function createHealthServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'WhatsApp News Bot',
                version: '1.0.0'
            }));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.listen(CONFIG.PORT, () => {
        console.log(`🌐 Health server running on port ${CONFIG.PORT}`);
    });

    return server;
}

// Main execution
async function main() {
    console.log('🎯 WhatsApp News Bot Starting...');
    console.log('📋 Configuration:');
    console.log(`   Source Group: ${CONFIG.SOURCE_GROUP}`);
    console.log(`   Script Target Group: ${CONFIG.SCRIPT_TARGET_GROUP}`);
    console.log(`   Visual Target Group: ${CONFIG.VISUAL_TARGET_GROUP}`);
    console.log(`   Session Directory: ${CONFIG.SESSION_DIR}`);
    console.log(`   Health Server Port: ${CONFIG.PORT}`);
    console.log('');

    // Start health check server
    const healthServer = createHealthServer();

    const bot = new WhatsAppBot();
    
    try {
        await bot.initialize();
        
        // Keep the process running
        process.on('SIGINT', () => {
            console.log('\n👋 Shutting down WhatsApp Bot...');
            healthServer.close();
            process.exit(0);
        });

        console.log('🎉 Bot is now running! Press Ctrl+C to stop.');
        
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        healthServer.close();
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the bot
if (require.main === module) {
    main();
}

module.exports = WhatsAppBot;