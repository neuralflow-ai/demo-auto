const http = require('http');
const fs = require('fs');
const path = require('path');

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

    const url = req.url === '/' ? '/index.html' : req.url;
    
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
        
        if (fs.existsSync(qrDataPath) && fs.existsSync(qrImagePath)) {
            try {
                const qrData = JSON.parse(fs.readFileSync(qrDataPath, 'utf8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    hasQR: true,
                    qrImageUrl: '/qr-code.png',
                    timestamp: qrData.timestamp,
                    status: qrData.status
                }));
            } catch (error) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hasQR: false, error: 'Failed to read QR data' }));
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                hasQR: false, 
                message: 'Bot is connected or QR code not generated yet' 
            }));
        }
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

// Start server
server.listen(PORT, () => {
    console.log(`🌐 Static web server running on port ${PORT}`);
    console.log(`📱 WhatsApp News Bot - Static Web Interface`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 API status: http://localhost:${PORT}/api/status`);
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