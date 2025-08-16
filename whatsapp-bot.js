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
// const qrcode = require('qrcode-terminal'); // Removed - using web dashboard instead
const QRCode = require('qrcode');
const youtubeSearch = require('youtube-search-api');
const cheerio = require('cheerio');
const http = require('http');

// Import WebSocket broadcast function
let broadcastQRUpdate;
try {
    const serverModule = require('./server.js');
    broadcastQRUpdate = serverModule.broadcastQRUpdate;
} catch (error) {
    console.log('⚠️ WebSocket broadcast not available (server not running)');
    broadcastQRUpdate = null;
}

// Configuration
const CONFIG = {
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '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',
    PERPLEXITY_API_URL: 'https://api.perplexity.ai/chat/completions',
    SOURCE_GROUP: process.env.SOURCE_GROUP || 'Content',
    SCRIPT_TARGET_GROUP: process.env.SCRIPT_TARGET_GROUP || 'Demo script',
    VISUAL_TARGET_GROUP: process.env.VISUAL_TARGET_GROUP || 'Demo visual',
    SESSION_DIR: './auth_info_baileys',
    PORT: process.env.PORT || 3000,
    DATA_DIR: './data'
};

// Ensure data directory exists
if (!fs.existsSync(CONFIG.DATA_DIR)) {
    fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
}

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
                browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
                qrTimeout: 60000, // 60 seconds QR timeout
                connectTimeoutMs: 60000, // 60 seconds connection timeout
                defaultQueryTimeoutMs: 60000, // 60 seconds query timeout
                keepAliveIntervalMs: 30000 // 30 seconds keep alive
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
                // Refresh contacts when new messages arrive to capture new individual contacts
                await this.saveContacts();
            });

            // Handle group updates to get group JIDs
            this.sock.ev.on('groups.upsert', async (groups) => {
                await this.updateGroupJids(groups);
            });
            
            // Set up contact update handler
            this.sock.ev.on('contacts.update', async (contacts) => {
                console.log('👥 Contacts updated:', contacts.length);
                for (const contact of contacts) {
                    console.log(`📱 Contact update: ${contact.id} - ${contact.name || contact.notify}`);
                }
                // Refresh contacts when they are updated
                setTimeout(() => {
                    this.saveContacts();
                }, 500);
            });
            
            // Set up contact upsert handler
            this.sock.ev.on('contacts.upsert', async (contacts) => {
                console.log('👥 New contacts added:', contacts.length);
                for (const contact of contacts) {
                    console.log(`📱 New contact: ${contact.id} - ${contact.name || contact.notify}`);
                }
                // Refresh contacts when new ones are added
                setTimeout(() => {
                    this.saveContacts();
                }, 500);
            });
            
            // Set up chat update handler to catch individual chats
            this.sock.ev.on('chats.update', async (chats) => {
                console.log('💬 Chats updated:', chats.length);
                let individualChatsFound = 0;
                for (const chat of chats) {
                    if (chat.id && chat.id.includes('@s.whatsapp.net')) {
                        console.log(`💬 Individual chat: ${chat.id} - ${chat.name || 'Unknown'}`);
                        individualChatsFound++;
                    }
                }
                if (individualChatsFound > 0) {
                    console.log(`📊 Found ${individualChatsFound} individual chats in update`);
                    // Refresh contacts when individual chats are updated
                    setTimeout(() => {
                        this.saveContacts();
                    }, 500);
                }
            });
            
            // Set up chat upsert handler
            this.sock.ev.on('chats.upsert', async (chats) => {
                console.log('💬 New chats added:', chats.length);
                let individualChatsFound = 0;
                for (const chat of chats) {
                    if (chat.id && chat.id.includes('@s.whatsapp.net')) {
                        console.log(`💬 New individual chat: ${chat.id} - ${chat.name || 'Unknown'}`);
                        individualChatsFound++;
                    }
                }
                if (individualChatsFound > 0) {
                    console.log(`📊 Found ${individualChatsFound} new individual chats`);
                    // Refresh contacts when new individual chats are added
                    setTimeout(() => {
                        this.saveContacts();
                    }, 500);
                }
            });

            // Start periodic send queue processing
            setInterval(async () => {
                await this.processSendQueue();
            }, 30000); // Check every 30 seconds

            // Start periodic test message processing
            setInterval(async () => {
                await this.processTestMessages();
            }, 10000); // Check every 10 seconds
            
            // Start periodic contact refresh to capture individual contacts
            setInterval(async () => {
                if (this.sock && this.sock.user) {
                    await this.saveContacts();
                }
            }, 60000); // Refresh contacts every 60 seconds

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
            console.log('\n📱 QR Code generated for web dashboard');
            console.log('🌐 Please open the web dashboard to scan the QR code');
            console.log(`📊 Dashboard URL: http://localhost:${process.env.WEB_PORT || 3001}`);
            
            // Save QR code as image for web dashboard
            try {
                const qrImagePath = path.join(__dirname, 'public', 'qr-code.png');
                console.log('🔍 QR data length:', qr.length);
                console.log('🔍 QR image path:', qrImagePath);
                
                await QRCode.toFile(qrImagePath, qr, {
                    width: 400,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                
                // Verify file was created and check its size
                const stats = fs.statSync(qrImagePath);
                console.log('💾 QR Code saved for web dashboard access');
                console.log('📏 QR image file size:', stats.size, 'bytes');
                
                // Also save QR data for API access
                const qrDataPath = path.join(__dirname, 'public', 'qr-data.json');
                const qrData = {
                    qr: qr,
                    timestamp: new Date().toISOString(),
                    status: 'waiting_for_scan'
                };
                fs.writeFileSync(qrDataPath, JSON.stringify(qrData));
                
                // Broadcast QR update via WebSocket
                if (broadcastQRUpdate) {
                    broadcastQRUpdate({
                        hasQR: true,
                        qrImageUrl: '/qr-code.png',
                        timestamp: qrData.timestamp,
                        status: qrData.status
                    });
                    console.log('📡 QR Code broadcasted to connected clients');
                }
            } catch (error) {
                console.error('❌ Failed to save QR code:', error);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;

            console.log('🔌 Connection closed due to:', lastDisconnect?.error);

            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(async () => {
                    await this.initialize();
                }, 5000); // Wait 5 seconds before reconnecting
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened successfully!');
            this.botNumber = this.sock.user.id.split(':')[0];
            
            // Clean up QR code files since connection is established
            try {
                const qrImagePath = path.join(__dirname, 'public', 'qr-code.png');
                const qrDataPath = path.join(__dirname, 'public', 'qr-data.json');
                
                if (fs.existsSync(qrImagePath)) {
                    fs.unlinkSync(qrImagePath);
                }
                if (fs.existsSync(qrDataPath)) {
                    fs.unlinkSync(qrDataPath);
                }
                console.log('🧹 Cleaned up QR code files');
                
                // Broadcast connection success via WebSocket
                if (broadcastQRUpdate) {
                    broadcastQRUpdate({
                        hasQR: false,
                        connected: true,
                        message: 'WhatsApp connected successfully!',
                        botNumber: this.botNumber
                    });
                    console.log('📡 Connection status broadcasted to clients');
                }
            } catch (error) {
                console.error('⚠️ Failed to clean QR files:', error);
            }
            
            await this.loadGroupJids();
            
            // Wait a bit for the store to populate, then try to fetch individual contacts
            setTimeout(async () => {
                await this.fetchAllContacts();
            }, 5000); // Wait 5 seconds after connection
            
            // Try to sync contacts from phone
            setTimeout(async () => {
                await this.syncPhoneContacts();
            }, 10000); // Wait 10 seconds for full connection
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

            // Save contacts information
            await this.saveContacts();

        } catch (error) {
            console.error('❌ Error loading group JIDs:', error);
        }
    }

    /**
     * Sync contacts from phone using Baileys contact sync
     */
    async syncPhoneContacts() {
        try {
            console.log('📞 Attempting to sync contacts from phone...');
            
            // Method 1: Try to get contacts using Baileys contact sync
            try {
                if (this.sock && this.sock.ws && this.sock.ws.readyState === 1) {
                    // Request contact list from phone
                    const contactsQuery = {
                        tag: 'iq',
                        attrs: {
                            to: '@s.whatsapp.net',
                            type: 'get',
                            id: this.sock.generateMessageTag()
                        },
                        content: [{
                            tag: 'contacts',
                            attrs: {}
                        }]
                    };
                    
                    console.log('📱 Requesting contact list from phone...');
                    // Note: This is a low-level approach that may not work with all WhatsApp versions
                }
            } catch (error) {
                console.log('ℹ️ Direct contact sync not available:', error.message);
            }
            
            // Method 2: Try to get contacts from WhatsApp Web store after sync
            try {
                const store = this.sock.store;
                if (store && store.contacts) {
                    const allContacts = Object.keys(store.contacts);
                    const individualContacts = allContacts.filter(jid => 
                        jid.includes('@s.whatsapp.net') && !jid.includes('@g.us') && !jid.includes('@broadcast')
                    );
                    console.log(`📋 Found ${individualContacts.length} individual contacts in store after sync`);
                    
                    if (individualContacts.length > 0) {
                        await this.saveContacts();
                    }
                }
            } catch (error) {
                console.log('ℹ️ Store contacts not accessible after sync:', error.message);
            }
            
        } catch (error) {
            console.error('❌ Error syncing phone contacts:', error);
        }
    }

    /**
     * Fetch contacts from WhatsApp store and other sources
     */
    async fetchAllContacts() {
        try {
            console.log('🔍 Actively fetching contacts from all available sources...');
            
            // Method 1: Try to get contacts using WhatsApp's contact fetching API
            try {
                console.log('📞 Attempting to fetch contacts using WhatsApp API...');
                
                // Try to get all contacts from WhatsApp
                if (this.sock && this.sock.getBusinessProfile) {
                    console.log('🔍 Trying business profile method...');
                }
                
                // Try to get contact list
                if (this.sock && this.sock.query) {
                    console.log('🔍 Trying query method for contacts...');
                    try {
                        const contactQuery = await this.sock.query({
                            tag: 'iq',
                            attrs: {
                                type: 'get',
                                xmlns: 'w:sync:app:state'
                            }
                        });
                        console.log('📱 Contact query result:', contactQuery);
                    } catch (queryError) {
                        console.log('ℹ️ Contact query not available:', queryError.message);
                    }
                }
                
            } catch (apiError) {
                console.log('ℹ️ WhatsApp contact API not available:', apiError.message);
            }
            
            // Method 2: Force contact sync by requesting contact list
            try {
                console.log('🔄 Attempting to trigger contact sync...');
                
                // Try to access and log all available store properties
                const store = this.sock.store;
                if (store) {
                    console.log('📊 Available store properties:', Object.keys(store));
                    
                    // Check if there are any contacts in different store locations
                    if (store.contacts) {
                        console.log(`📱 Store contacts keys: ${Object.keys(store.contacts).length}`);
                    }
                    if (store.chats) {
                        console.log(`💬 Store chats keys: ${Object.keys(store.chats).length}`);
                    }
                    if (store.presences) {
                        console.log(`👥 Store presences keys: ${Object.keys(store.presences).length}`);
                    }
                    if (store.messages) {
                        console.log(`📨 Store messages keys: ${Object.keys(store.messages).length}`);
                    }
                }
                
            } catch (syncError) {
                console.log('ℹ️ Contact sync not available:', syncError.message);
            }
            
            // Method 3: Call saveContacts to process whatever is available
            await this.saveContacts();
            
        } catch (error) {
            console.error('❌ Error fetching contacts:', error);
        }
    }

    /**
     * Discover and add individual contacts from incoming messages
     */
    async discoverContactFromMessage(message) {
        try {
            const chatId = message.key.remoteJid;
            const participant = message.key.participant;
            
            // Handle group messages - extract participant as individual contact
            if (chatId.endsWith('@g.us') && participant) {
                const individualJid = participant;
                if (individualJid.endsWith('@s.whatsapp.net')) {
                    await this.addIndividualContact(individualJid, message);
                }
            }
            // Handle direct messages - extract sender as individual contact
            else if (chatId.endsWith('@s.whatsapp.net')) {
                await this.addIndividualContact(chatId, message);
            }
        } catch (error) {
            console.error('❌ Error discovering contact from message:', error);
        }
    }

    /**
     * Add individual contact with name extraction
     */
    async addIndividualContact(jid, message) {
        try {
            // Check if contact already exists
            const existingContacts = this.loadContacts();
            const existingContact = existingContacts.find(c => c.jid === jid);
            if (existingContact) {
                return; // Contact already exists
            }

            // Extract contact name from various sources
            let contactName = null;
            
            // Try to get name from message push name
            if (message.pushName) {
                contactName = message.pushName;
            }
            
            // Try to get name from WhatsApp store
            if (!contactName) {
                try {
                    const store = this.sock.store;
                    if (store && store.contacts && store.contacts[jid]) {
                        const storeContact = store.contacts[jid];
                        contactName = storeContact.name || storeContact.notify || storeContact.verifiedName;
                    }
                } catch (e) {
                    // Ignore errors
                }
            }
            
            // Try to get name from onWhatsApp query
            if (!contactName) {
                try {
                    const contact = await this.sock.onWhatsApp(jid);
                    if (contact && contact[0] && contact[0].name) {
                        contactName = contact[0].name;
                    }
                } catch (e) {
                    // Ignore errors
                }
            }
            
            // Extract phone number from JID
            const phoneNumber = jid.split('@')[0];
            
            // Use phone number as fallback name
            if (!contactName) {
                contactName = phoneNumber;
            }

            // Add the new individual contact
            const newContact = {
                jid: jid,
                name: contactName,
                type: 'individual',
                phone: phoneNumber,
                discoveredAt: new Date().toISOString()
            };

            existingContacts.push(newContact);
            
            // Save the updated contacts list to file
            const contactsData = {
                contacts: existingContacts,
                timestamp: new Date().toISOString()
            };
            
            const contactsPath = path.join(CONFIG.DATA_DIR, 'contacts.json');
            fs.writeFileSync(contactsPath, JSON.stringify(contactsData, null, 2));
            
            console.log(`✅ Added individual contact: ${contactName} (${jid})`);
        } catch (error) {
            console.error('❌ Error adding individual contact:', error);
        }
    }

    /**
     * Load existing contacts from JSON file
     */
    loadContacts() {
        try {
            const contactsPath = path.join(CONFIG.DATA_DIR, 'contacts.json');
            if (fs.existsSync(contactsPath)) {
                const data = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
                return data.contacts || [];
            }
            return [];
        } catch (error) {
            console.log('ℹ️ No existing contacts file found or error reading:', error.message);
            return [];
        }
    }

    /**
     * Save WhatsApp contacts to JSON file
     */
    async saveContacts() {
        try {
            const contacts = [];
            
            // Add groups
            for (const [name, jid] of this.groupJids.entries()) {
                contacts.push({
                    id: jid,
                    name: name,
                    type: 'group',
                    jid: jid
                });
            }

            // Method 1: Try to get individual contacts from WhatsApp store
            let individualContactsFound = 0;
            try {
                const store = this.sock.store;
                if (store && store.contacts && Object.keys(store.contacts).length > 0) {
                    console.log(`📱 Found ${Object.keys(store.contacts).length} contacts in WhatsApp store`);
                    
                    for (const [jid, contact] of Object.entries(store.contacts)) {
                        if (!jid.includes('@g.us') && !jid.includes('@broadcast') && jid.includes('@s.whatsapp.net')) {
                            const contactName = contact.name || contact.notify || contact.verifiedName || contact.pushName;
                            
                            // Add all individual contacts, even if they only have phone numbers
                            if (contactName) {
                                contacts.push({
                                    id: jid,
                                    name: contactName,
                                    type: 'individual',
                                    jid: jid,
                                    phone: jid.split('@')[0]
                                });
                                individualContactsFound++;
                                console.log(`✅ Added contact from store: ${contactName} (${jid})`);
                            }
                        }
                    }
                } else {
                    console.log('📱 WhatsApp store contacts not available yet');
                }
            } catch (contactError) {
                console.log('ℹ️ Store contacts not accessible:', contactError.message);
            }

            // Method 2: Try to get contacts from chat list
            try {
                const store = this.sock.store;
                if (store && store.chats && Object.keys(store.chats).length > 0) {
                    console.log(`💬 Found ${Object.keys(store.chats).length} chats in store`);
                    
                    for (const [jid, chat] of Object.entries(store.chats)) {
                        if (!jid.includes('@g.us') && !jid.includes('@broadcast') && jid.includes('@s.whatsapp.net')) {
                            // Check if we already have this contact
                            const existingContact = contacts.find(c => c.jid === jid);
                            if (!existingContact) {
                                const chatName = chat.name || chat.notify || chat.pushName || jid.split('@')[0];
                                contacts.push({
                                    id: jid,
                                    name: chatName,
                                    type: 'individual',
                                    jid: jid,
                                    phone: jid.split('@')[0]
                                });
                                individualContactsFound++;
                                console.log(`✅ Added contact from chat: ${chatName} (${jid})`);
                            }
                        }
                    }
                } else {
                    console.log('💬 WhatsApp chat store not available yet');
                }
            } catch (chatError) {
                console.log('ℹ️ Chat store not accessible:', chatError.message);
            }
            
            // Method 2.5: Try to actively fetch chats using WhatsApp API
            try {
                console.log('🔍 Attempting to fetch chats directly from WhatsApp...');
                const chats = await this.sock.chatFind();
                if (chats && chats.length > 0) {
                    console.log(`📱 Found ${chats.length} chats via direct API call`);
                    for (const chat of chats) {
                        if (chat.id && chat.id.includes('@s.whatsapp.net')) {
                            const existingContact = contacts.find(c => c.jid === chat.id);
                            if (!existingContact) {
                                const chatName = chat.name || chat.notify || chat.id.split('@')[0];
                                contacts.push({
                                    id: chat.id,
                                    name: chatName,
                                    type: 'individual',
                                    jid: chat.id,
                                    phone: chat.id.split('@')[0]
                                });
                                individualContactsFound++;
                                console.log(`✅ Added contact from direct API: ${chatName} (${chat.id})`);
                            }
                        }
                    }
                }
            } catch (directApiError) {
                console.log('ℹ️ Direct chat API not available:', directApiError.message);
            }

            // Method 3: Try to get contacts from presence store
            try {
                const store = this.sock.store;
                if (store && store.presences && Object.keys(store.presences).length > 0) {
                    console.log(`👥 Found ${Object.keys(store.presences).length} presences in store`);
                    
                    for (const jid of Object.keys(store.presences)) {
                        if (!jid.includes('@g.us') && !jid.includes('@broadcast') && jid.includes('@s.whatsapp.net')) {
                            // Check if we already have this contact
                            const existingContact = contacts.find(c => c.jid === jid);
                            if (!existingContact) {
                                const contactName = jid.split('@')[0]; // Use phone number as fallback
                                contacts.push({
                                    id: jid,
                                    name: contactName,
                                    type: 'individual',
                                    jid: jid,
                                    phone: jid.split('@')[0]
                                });
                                individualContactsFound++;
                                console.log(`✅ Added contact from presence: ${contactName} (${jid})`);
                            }
                        }
                    }
                } else {
                    console.log('👥 WhatsApp presence store not available yet');
                }
            } catch (presenceError) {
                console.log('ℹ️ Presence store not accessible:', presenceError.message);
            }

            // Method 4: Add sample individual contacts if none found
            if (individualContactsFound === 0) {
                console.log('🔍 No individual contacts found, adding sample contacts...');
                const sampleContacts = [
                    { name: 'Masjid Nabvi', phone: '923319344172' },
                    { name: 'Shabnam', phone: '923001234567' },
                    { name: 'Paypal', phone: '923311234567' }
                ];
                
                for (const sample of sampleContacts) {
                    const jid = `${sample.phone}@s.whatsapp.net`;
                    const existingContact = contacts.find(c => c.jid === jid);
                    if (!existingContact) {
                        contacts.push({
                            id: jid,
                            name: sample.name,
                            type: 'individual',
                            jid: jid,
                            phone: sample.phone,
                            isSample: true
                        });
                        individualContactsFound++;
                        console.log(`✅ Added sample contact: ${sample.name} (${jid})`);
                    }
                }
            }
            
            console.log(`📊 Total individual contacts found: ${individualContactsFound}`);

            const contactsPath = path.join(CONFIG.DATA_DIR, 'contacts.json');
            fs.writeFileSync(contactsPath, JSON.stringify({ contacts, timestamp: new Date().toISOString() }, null, 2));
            
            const groupCount = contacts.filter(c => c.type === 'group').length;
            const individualCount = contacts.filter(c => c.type === 'individual').length;
            console.log(`💾 Saved ${contacts.length} contacts to file (${groupCount} groups, ${individualCount} individuals)`);

        } catch (error) {
            console.error('❌ Error saving contacts:', error);
        }
    }

    /**
     * Save generated script to JSON file
     */
    saveScript(script, originalMessage) {
        try {
            const scriptsPath = path.join(CONFIG.DATA_DIR, 'scripts.json');
            let scripts = { scripts: [] };
            
            if (fs.existsSync(scriptsPath)) {
                const fileContent = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
                scripts = fileContent && fileContent.scripts ? fileContent : { scripts: [] };
            }

            const scriptData = {
                id: Date.now().toString(),
                content: script,
                originalMessage: originalMessage.substring(0, 200) + '...',
                timestamp: new Date().toISOString(),
                status: 'generated'
            };

            scripts.scripts.unshift(scriptData);
            
            // Keep only last 50 scripts
            if (scripts.scripts.length > 50) {
                scripts.scripts = scripts.scripts.slice(0, 50);
            }

            fs.writeFileSync(scriptsPath, JSON.stringify(scripts, null, 2));
            console.log('💾 Script saved to file');
            
            return scriptData.id;

        } catch (error) {
            console.error('❌ Error saving script:', error);
            return null;
        }
    }

    /**
     * Save visual content to JSON file
     */
    saveVisualContent(videos, articles, images, originalMessage) {
        try {
            const visualsPath = path.join(CONFIG.DATA_DIR, 'visuals.json');
            let visuals = { visuals: [] };
            
            if (fs.existsSync(visualsPath)) {
                const fileContent = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));
                visuals = fileContent && fileContent.visuals ? fileContent : { visuals: [] };
            }

            const visualData = {
                id: Date.now().toString(),
                videos: videos,
                articles: articles,
                images: images,
                originalMessage: originalMessage.substring(0, 200) + '...',
                timestamp: new Date().toISOString(),
                status: 'generated'
            };

            visuals.visuals.unshift(visualData);
            
            // Keep only last 50 visual contents
            if (visuals.visuals.length > 50) {
                visuals.visuals = visuals.visuals.slice(0, 50);
            }

            fs.writeFileSync(visualsPath, JSON.stringify(visuals, null, 2));
            console.log('💾 Visual content saved to file');
            
            return visualData.id;

        } catch (error) {
            console.error('❌ Error saving visual content:', error);
            return null;
        }
    }

    /**
     * Process send queue for scripts and visuals
     */
    async processSendQueue() {
        try {
            const sendQueuePath = path.join(CONFIG.DATA_DIR, 'send-queue.json');
            
            if (!fs.existsSync(sendQueuePath)) {
                return;
            }

            const queue = JSON.parse(fs.readFileSync(sendQueuePath, 'utf8'));
            const pendingItems = queue.filter(item => item.status === 'pending');

            for (const item of pendingItems) {
                try {
                    console.log(`🚀 Processing queue item: ${item.type} to ${item.contactId}`);
                    if (item.type === 'script') {
                        await this.sendScriptToContact(item.contactId, item.contentId);
                    } else if (item.type === 'visual') {
                        await this.sendVisualToContact(item.contactId, item.contentId);
                    }
                    
                    // Mark as completed
                    item.status = 'completed';
                    item.sentAt = new Date().toISOString();
                    console.log(`✅ Queue item marked as completed: ${item.id}`);
                    
                } catch (sendError) {
                    console.error(`❌ Error sending ${item.type} to ${item.contactId}:`, sendError);
                    item.status = 'failed';
                    item.error = sendError.message;
                }
            }

            // Save updated queue
            fs.writeFileSync(sendQueuePath, JSON.stringify(queue, null, 2));

        } catch (error) {
            console.error('❌ Error processing send queue:', error);
        }
    }

    /**
     * Send script to specific contact
     */
    async sendScriptToContact(contactId, scriptId) {
        try {
            const scriptsPath = path.join(CONFIG.DATA_DIR, 'scripts.json');
            
            if (!fs.existsSync(scriptsPath)) {
                throw new Error('Scripts file not found');
            }

            const scripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
            console.log('🔍 Looking for script ID:', scriptId);
            console.log('📋 Available scripts:', scripts.scripts.map(s => ({ id: s.id, type: typeof s.id })));
            const script = scripts.scripts.find(s => s.id === scriptId);

            if (!script) {
                console.log('❌ Script not found. Searched for:', scriptId, 'Type:', typeof scriptId);
                throw new Error('Script not found');
            }
            
            console.log('✅ Found script:', script.id);
            console.log('📤 Attempting to send message to:', contactId);

            try {
                // Add timeout to prevent hanging (increased to 60 seconds)
                const messagePromise = this.sock.sendMessage(contactId, {
                    text: `📺 *Vision Point News Script* 📺\n\n${script.content}\n\n---\n🤖 *Sent via WhatsApp Bot Dashboard*`
                });
                
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Message sending timed out after 60 seconds')), 60000);
                });
                
                await Promise.race([messagePromise, timeoutPromise]);
                console.log('📨 Message sent successfully via WhatsApp');
            } catch (msgError) {
                console.error('❌ Failed to send WhatsApp message:', msgError);
                throw msgError;
            }

            console.log(`✅ Script sent to ${contactId}`);
            console.log('🎯 Message sending completed successfully');

        } catch (error) {
            console.error('❌ Error sending script to contact:', error);
            throw error;
        }
    }

    /**
     * Send visual content to specific contact
     */
    async sendVisualToContact(contactId, visualId) {
        try {
            const visualsPath = path.join(CONFIG.DATA_DIR, 'visuals.json');
            
            if (!fs.existsSync(visualsPath)) {
                throw new Error('Visuals file not found');
            }

            const visuals = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));
            const visual = visuals.visuals.find(v => v.id === visualId);

            if (!visual) {
                throw new Error('Visual content not found');
            }

            const visualMessage = `🎬 *Visual Content Suggestions* 🎬\n\n${this.formatVisualContent(visual.videos, visual.articles, visual.images)}\n\n---\n🤖 *Sent via WhatsApp Bot Dashboard*`;

            console.log('📤 Attempting to send visual message to:', contactId);
            
            try {
                // Add timeout to prevent hanging (60 seconds)
                const messagePromise = this.sock.sendMessage(contactId, {
                    text: visualMessage
                });
                
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Visual message sending timed out after 60 seconds')), 60000);
                });
                
                await Promise.race([messagePromise, timeoutPromise]);
                console.log('📨 Visual message sent successfully via WhatsApp');
            } catch (msgError) {
                console.error('❌ Failed to send WhatsApp visual message:', msgError);
                throw msgError;
            }

            console.log(`✅ Visual content sent to ${contactId}`);
            console.log('🎯 Visual message sending completed successfully');

        } catch (error) {
            console.error('❌ Error sending visual content to contact:', error);
            throw error;
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
     * Process test messages for manual content generation
     */
    async processTestMessages() {
        try {
            const testMessagePath = path.join(__dirname, 'data', 'test-message.json');
            
            if (fs.existsSync(testMessagePath)) {
                const testMessage = JSON.parse(fs.readFileSync(testMessagePath, 'utf8'));
                
                if (testMessage.status === 'pending') {
                    console.log(`🧪 Processing test message: ${testMessage.topic}`);
                    
                    // Update status to processing
                    testMessage.status = 'processing';
                    fs.writeFileSync(testMessagePath, JSON.stringify(testMessage, null, 2));
                    
                    // Process the test message as if it came from the Content group
                    await this.processEditorialMessage(testMessage.topic, null);
                    
                    // Mark as completed
                    testMessage.status = 'completed';
                    testMessage.completedAt = new Date().toISOString();
                    fs.writeFileSync(testMessagePath, JSON.stringify(testMessage, null, 2));
                    
                    console.log('✅ Test message processed successfully!');
                }
            }
        } catch (error) {
            console.error('❌ Error processing test messages:', error);
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
                
                // Discover and add individual contacts from messages
                await this.discoverContactFromMessage(message);

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
                // Save script to file
                const scriptId = this.saveScript(newsScript, editorialText);
                
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

                // Save visual content to file
                const visualId = this.saveVisualContent(videos, articles, images, editorialText);

                // Send visual content separately
                await this.sendVisualContentToTargetGroup(videos, articles, images);
                console.log('✅ Visual content sent!');

                // React to original message with checkmark (only if originalMessage exists)
                if (originalMessage) {
                    await this.reactToMessage(originalMessage, '✅');
                }

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

    /**
     * Disconnect from WhatsApp
     */
    async disconnect() {
        try {
            console.log('🔌 Disconnecting from WhatsApp...');
            
            if (this.sock) {
                // Close the socket connection
                await this.sock.logout();
                this.sock = null;
                this.botNumber = null;
                this.groupJids.clear();
                
                console.log('✅ Successfully disconnected from WhatsApp');
                
                // Clean up session files
                if (fs.existsSync(CONFIG.SESSION_DIR)) {
                    const files = fs.readdirSync(CONFIG.SESSION_DIR);
                    for (const file of files) {
                        const filePath = path.join(CONFIG.SESSION_DIR, file);
                        if (fs.statSync(filePath).isFile()) {
                            fs.unlinkSync(filePath);
                        }
                    }
                    console.log('🧹 Cleaned up session files');
                }
                
                // Broadcast disconnect status via WebSocket
                if (broadcastQRUpdate) {
                    broadcastQRUpdate({
                        hasQR: false,
                        connected: false,
                        message: 'WhatsApp disconnected. Please scan QR code to reconnect.',
                        botNumber: null
                    });
                    console.log('📡 Disconnect status broadcasted to clients');
                }
                
                // Reinitialize to generate new QR code
                setTimeout(async () => {
                    console.log('🔄 Reinitializing for new QR code...');
                    await this.initialize();
                }, 2000);
                
            } else {
                console.log('⚠️ No active WhatsApp connection to disconnect');
            }
            
        } catch (error) {
            console.error('❌ Error disconnecting from WhatsApp:', error);
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
    console.log('');

    const bot = new WhatsAppBot();
    
    try {
        await bot.initialize();
        
        // Keep the process running
        process.on('SIGINT', () => {
            console.log('\n👋 Shutting down WhatsApp Bot...');
            process.exit(0);
        });

        console.log('🎉 Bot is now running! Press Ctrl+C to stop.');
        
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
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