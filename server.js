const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.WEB_PORT || process.env.PORT || 3001;

// MIME types for different file extensions
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Create HTTP server
const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Parse URL to remove query parameters
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const url = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    
    // Health check endpoint
    if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'WhatsApp News Bot Static Server',
            version: '1.0.0'
        }));
        return;
    }

    // API endpoint for bot status
    if (url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            bot: 'WhatsApp News Bot',
            status: 'deployed',
            features: [
                'Perplexity AI Integration',
                'Urdu News Generation',
                'Visual Content Creation',
                'WhatsApp Group Management'
            ],
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // API endpoint for QR code status
    if (url === '/api/qr-status') {
        const qrDataPath = path.join(__dirname, 'public', 'qr-data.json');
        const qrImagePath = path.join(__dirname, 'public', 'qr-code.png');
        
        // Check if bot is connected
        const isConnected = !!(botInstance && botInstance.sock && botInstance.botNumber);
        
        if (fs.existsSync(qrDataPath) && fs.existsSync(qrImagePath)) {
            try {
                const qrData = JSON.parse(fs.readFileSync(qrDataPath, 'utf8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    hasQR: true,
                    qrImageUrl: '/qr-code.png',
                    timestamp: qrData.timestamp,
                    status: qrData.status,
                    connected: isConnected,
                    botNumber: isConnected ? botInstance.botNumber : null
                }));
            } catch (error) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    hasQR: false, 
                    error: 'Failed to read QR data',
                    connected: isConnected,
                    botNumber: isConnected ? botInstance.botNumber : null
                }));
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                hasQR: false, 
                message: 'Bot is connected or QR code not generated yet',
                connected: isConnected,
                botNumber: isConnected ? botInstance.botNumber : null
            }));
        }
        return;
    }

    // API endpoint for disconnecting WhatsApp
    if (url === '/api/disconnect' && req.method === 'POST') {
        (async () => {
            try {
                if (botInstance && typeof botInstance.disconnect === 'function') {
                    await botInstance.disconnect();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'WhatsApp disconnected successfully. New QR code will be generated.' 
                    }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'Bot instance not available or disconnect method not found' 
                    }));
                }
            } catch (error) {
                console.error('❌ Error disconnecting WhatsApp:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false, 
                    error: 'Failed to disconnect WhatsApp' 
                }));
            }
        })();
        return;
    }

    // API endpoint for refreshing WhatsApp contacts
    if (url === '/api/contacts/refresh' && req.method === 'POST') {
        (async () => {
            try {
                if (global.whatsappBot && global.whatsappBot.sock && global.whatsappBot.sock.user) {
                    await global.whatsappBot.fetchAllContacts();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Contacts refreshed successfully' 
                    }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'WhatsApp bot not connected' 
                    }));
                }
            } catch (error) {
                console.error('❌ Error refreshing contacts:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false, 
                    error: 'Failed to refresh contacts' 
                }));
            }
        })();
        return;
    }

    // API endpoint for WhatsApp contacts
    if (url === '/api/contacts') {
        const contactsPath = path.join(__dirname, 'data', 'contacts.json');
        
        if (fs.existsSync(contactsPath)) {
            try {
                const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(contacts));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to read contacts' }));
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ contacts: [], message: 'No contacts available' }));
        }
        return;
    }

    // API endpoint for generated scripts
    if (url === '/api/scripts') {
        const scriptsPath = path.join(__dirname, 'data', 'scripts.json');
        
        if (fs.existsSync(scriptsPath)) {
            try {
                const scripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(scripts));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to read scripts' }));
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ scripts: [], message: 'No scripts available' }));
        }
        return;
    }

    // API endpoint for visual content
    if (url === '/api/visuals') {
        const visualsPath = path.join(__dirname, 'data', 'visuals.json');
        
        if (fs.existsSync(visualsPath)) {
            try {
                const visuals = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(visuals));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to read visuals' }));
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ visuals: [], message: 'No visuals available' }));
        }
        return;
    }

    // API endpoint for sending script to contact
    if (url === '/api/send-script' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { contactId, contentId } = JSON.parse(body);
                
                if (!contactId || !contentId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Contact ID and Content ID are required' }));
                    return;
                }
                
                // Save send request to queue
                const sendQueuePath = path.join(__dirname, 'data', 'send-queue.json');
                let queue = [];
                
                if (fs.existsSync(sendQueuePath)) {
                    queue = JSON.parse(fs.readFileSync(sendQueuePath, 'utf8'));
                }
                
                queue.push({
                    id: Date.now(),
                    type: 'script',
                    contactId,
                    contentId,
                    timestamp: new Date().toISOString(),
                    status: 'pending'
                });
                
                // Ensure data directory exists
                const dataDir = path.join(__dirname, 'data');
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                
                fs.writeFileSync(sendQueuePath, JSON.stringify(queue, null, 2));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Script queued for sending' }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
        return;
    }

    // API endpoint for sending visual to contact
    if (url === '/api/send-visual' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { contactId, contentId } = JSON.parse(body);
                
                if (!contactId || !contentId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Contact ID and Content ID are required' }));
                    return;
                }
                
                // Save send request to queue
                const sendQueuePath = path.join(__dirname, 'data', 'send-queue.json');
                let queue = [];
                
                if (fs.existsSync(sendQueuePath)) {
                    queue = JSON.parse(fs.readFileSync(sendQueuePath, 'utf8'));
                }
                
                queue.push({
                    id: Date.now(),
                    type: 'visual',
                    contactId,
                    contentId,
                    timestamp: new Date().toISOString(),
                    status: 'pending'
                });
                
                // Ensure data directory exists
                const dataDir = path.join(__dirname, 'data');
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                
                fs.writeFileSync(sendQueuePath, JSON.stringify(queue, null, 2));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Visual queued for sending' }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
        return;
    }

    // API endpoint for deleting scripts
    if (url === '/api/delete-script' && req.method === 'DELETE') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { scriptId } = JSON.parse(body);
                
                if (!scriptId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Script ID is required' }));
                    return;
                }
                
                const scriptsPath = path.join(__dirname, 'data', 'scripts.json');
                
                if (fs.existsSync(scriptsPath)) {
                    try {
                        const scriptsData = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
                        const originalLength = scriptsData.scripts.length;
                        
                        // Filter out the script with the given ID
                        scriptsData.scripts = scriptsData.scripts.filter(script => script.id !== scriptId);
                        
                        if (scriptsData.scripts.length === originalLength) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Script not found' }));
                            return;
                        }
                        
                        // Write updated data back to file
                        fs.writeFileSync(scriptsPath, JSON.stringify(scriptsData, null, 2));
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Script deleted successfully' }));
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to delete script' }));
                    }
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Scripts file not found' }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
        return;
    }

    // API endpoint for deleting visuals
    if (url === '/api/delete-visual' && req.method === 'DELETE') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { visualId } = JSON.parse(body);
                
                if (!visualId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Visual ID is required' }));
                    return;
                }
                
                const visualsPath = path.join(__dirname, 'data', 'visuals.json');
                
                if (fs.existsSync(visualsPath)) {
                    try {
                        const visualsData = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));
                        const originalLength = visualsData.visuals.length;
                        
                        // Filter out the visual with the given ID
                        visualsData.visuals = visualsData.visuals.filter(visual => visual.id !== visualId);
                        
                        if (visualsData.visuals.length === originalLength) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Visual not found' }));
                            return;
                        }
                        
                        // Write updated data back to file
                        fs.writeFileSync(visualsPath, JSON.stringify(visualsData, null, 2));
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Visual deleted successfully' }));
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to delete visual' }));
                    }
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Visuals file not found' }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
        return;
    }

    // API endpoint for manual content generation
    if (url === '/api/generate-content' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { topic } = JSON.parse(body);
                
                if (!topic) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Topic is required' }));
                    return;
                }
                
                // Create a test message file that the bot can process
                const testMessagePath = path.join(__dirname, 'data', 'test-message.json');
                const testMessage = {
                    topic: topic,
                    timestamp: new Date().toISOString(),
                    status: 'pending'
                };
                
                // Ensure data directory exists
                const dataDir = path.join(__dirname, 'data');
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }
                
                fs.writeFileSync(testMessagePath, JSON.stringify(testMessage, null, 2));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Content generation triggered',
                    topic: topic
                }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
        return;
    }

    // Serve static files
    const filePath = path.join(__dirname, 'public', url);
    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found, serve 404 page
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>404 - Page Not Found</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                            h1 { color: #333; }
                            p { color: #666; }
                            a { color: #007bff; text-decoration: none; }
                        </style>
                    </head>
                    <body>
                        <h1>404 - Page Not Found</h1>
                        <p>The requested page could not be found.</p>
                        <a href="/">Go back to home</a>
                    </body>
                    </html>
                `);
            } else {
                // Server error
                res.writeHead(500);
                res.end('Server Error');
            }
        } else {
            // Success
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('🔌 New WebSocket client connected');
    clients.add(ws);
    
    // Send current QR status to new client
    const qrDataPath = path.join(__dirname, 'public', 'qr-data.json');
    if (fs.existsSync(qrDataPath)) {
        try {
            const qrData = JSON.parse(fs.readFileSync(qrDataPath, 'utf8'));
            ws.send(JSON.stringify({
                type: 'qr_update',
                hasQR: true,
                qrImageUrl: '/qr-code.png',
                timestamp: qrData.timestamp,
                status: qrData.status
            }));
        } catch (error) {
            console.error('❌ Failed to send QR status to new client:', error);
        }
    } else {
        ws.send(JSON.stringify({
            type: 'qr_update',
            hasQR: false,
            message: 'Bot is connected or QR code not generated yet'
        }));
    }
    
    ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        clients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        clients.delete(ws);
    });
});

// Function to broadcast QR updates to all connected clients
function broadcastQRUpdate(data) {
    const message = JSON.stringify({ type: 'qr_update', ...data });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Global bot instance
let botInstance = null;

// Export broadcast function for use by WhatsApp bot
module.exports = { broadcastQRUpdate };

// Start server
server.listen(PORT, () => {
    console.log(`🌐 Static web server running on port ${PORT}`);
    console.log(`📱 WhatsApp News Bot - Static Web Interface`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 API status: http://localhost:${PORT}/api/status`);
    console.log(`🔌 WebSocket server ready for QR code updates`);
    
    // Start WhatsApp bot
    const WhatsAppBot = require('./whatsapp-bot.js');
    botInstance = new WhatsAppBot();
    
    botInstance.initialize().then(() => {
        console.log('🎉 WhatsApp Bot initialized successfully!');
        // Set global reference for API endpoints
        global.whatsappBot = botInstance;
    }).catch((error) => {
        console.error('❌ Failed to initialize WhatsApp Bot:', error);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Static server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Static server closed');
        process.exit(0);
    });
});