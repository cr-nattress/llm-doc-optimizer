# LLM Document Optimizer - API Test UI

A comprehensive web-based testing interface for the LLM Document Optimizer API.

## 🚀 Quick Start

1. **Open the UI**: Open `index.html` in your web browser
2. **Configure API**: Set your API URL and API key
3. **Test Connection**: Click "Test Connection" to verify connectivity
4. **Explore Features**: Use the tabs to test different API endpoints

## 🎯 Features

### 📊 **Health Monitoring**
- Basic health check (`/health`)
- Detailed system status (`/health/detailed`)
- Real-time connection status indicator

### 📄 **Document Optimization**
- Text input optimization
- File upload support (multiple files)
- All optimization types (clarity, style, consolidate, summarize)
- Model selection (GPT-4, GPT-4 Turbo, GPT-3.5 Turbo)

### 🎯 **Model Management**
- List available models (`/models`)
- Model capabilities and defaults
- Supported optimization types per model

### 🪙 **Token Management**
- Usage statistics (`/tokens/usage`)
- Budget information (`/tokens/budget`)
- Pricing details (`/tokens/pricing`)
- Transaction history (`/tokens/transactions`)
- Cost estimation calculator

### 📊 **System Monitoring**
- Rate limiting status (`/rate-limit/status`)
- Backup system status (`/backup/status`)
- Cache statistics (`/cache/stats`)
- Disaster recovery plans (`/disaster-recovery/plans`)
- Administrative actions (create backup, clear cache)

## 🔧 Configuration

### API Settings
- **API Base URL**: The base URL of your deployed API
  - Local development: `http://localhost:8888`
  - Netlify deployment: `https://your-site.netlify.app`
- **API Key**: Your authentication key for protected endpoints

### Supported File Types
- Text files (`.txt`)
- Markdown files (`.md`)
- Word documents (`.doc`, `.docx`)
- PDF files (`.pdf`)

## 🎨 Interface Features

### Visual Indicators
- **Connection Status**: Color-coded indicator showing API connectivity
- **Loading States**: Spinner overlay during API requests
- **Result Formatting**: Syntax-highlighted JSON responses
- **Error Handling**: Clear error messages with status codes

### Responsive Design
- Mobile-friendly interface
- Tabbed navigation for organized testing
- Collapsible sections for better UX

## 🛠️ Usage Examples

### Testing Document Optimization

1. **Text Input**:
   ```
   Optimization Type: Clarity
   Model: GPT-4
   Document Text: "Your document content here..."
   ```

2. **File Upload**:
   - Select files using the file input
   - Choose optimization type and model
   - Click "Optimize Document"

### Monitoring System Health

1. **Basic Check**: Quick health status
2. **Detailed Check**: Comprehensive system status including:
   - Service health (OpenAI, database, cache, CDN)
   - Error statistics
   - Environment validation
   - Backup status

### Token Management

1. **View Usage**: Current token consumption
2. **Check Budget**: Daily/monthly limits
3. **Estimate Costs**: Calculate costs for token amounts
4. **View Transactions**: Recent API usage history

## 🔒 Security Notes

- API keys are stored in browser localStorage
- Use the eye icon to toggle API key visibility
- Always use HTTPS in production
- Clear browser data to remove stored credentials

## 🐛 Troubleshooting

### Common Issues

1. **Connection Failed**
   - Verify API URL is correct
   - Check if API server is running
   - Ensure CORS is properly configured

2. **Authentication Errors**
   - Verify API key is correct
   - Check if API key has proper permissions
   - Some endpoints don't require authentication

3. **File Upload Issues**
   - Check file size limits (10MB default)
   - Verify file type is supported
   - Ensure proper Content-Type headers

### Browser Console
Check the browser's developer console for detailed error messages and network requests.

## 📱 Browser Compatibility

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

Modern browsers with ES6+ support required.

## 🎯 Development

The UI is built with vanilla HTML, CSS, and JavaScript for maximum compatibility and ease of use.

### File Structure
```
test/ui/
├── index.html      # Main HTML structure
├── styles.css      # Styling and responsive design
├── script.js       # JavaScript functionality
└── README.md       # This documentation
```

### Customization
- Modify CSS variables in `styles.css` for theming
- Add new endpoints in `script.js`
- Extend functionality by adding new tabs and handlers

## 🚀 Deployment

### Local Testing
Simply open `index.html` in a web browser.

### Web Server
For production use, serve the files through a web server:

```bash
# Using Python
python -m http.server 8080

# Using Node.js (http-server)
npx http-server -p 8080

# Using PHP
php -S localhost:8080
```

### Static Hosting
Deploy to any static hosting service:
- Netlify
- Vercel
- GitHub Pages
- AWS S3
- Azure Static Web Apps

## 📝 Notes

- The UI automatically saves API configuration to localStorage
- All API responses are displayed as formatted JSON
- Error responses include status codes and error details
- The interface provides real-time feedback for all operations

---

**Happy Testing!** 🎉

Use this interface to thoroughly test your LLM Document Optimizer API and verify all functionality works as expected.