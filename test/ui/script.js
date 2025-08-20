// API Test UI JavaScript
class APITester {
    constructor() {
        this.apiUrl = '';
        this.apiKey = '';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSettings();
        this.initTabs();
        this.checkConnection();
    }

    setupEventListeners() {
        // Configuration
        document.getElementById('testConnection').addEventListener('click', () => this.checkConnection());
        document.getElementById('toggleApiKey').addEventListener('click', () => this.toggleApiKeyVisibility());
        
        // Save settings on change
        document.getElementById('apiUrl').addEventListener('change', () => this.saveSettings());
        document.getElementById('apiKey').addEventListener('change', () => this.saveSettings());

        // Health tab
        document.getElementById('basicHealth').addEventListener('click', () => this.basicHealth());
        document.getElementById('detailedHealth').addEventListener('click', () => this.detailedHealth());

        // Optimize tab
        document.getElementById('optimizeDocument').addEventListener('click', () => this.optimizeDocument());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileSelect(e));

        // Models tab
        document.getElementById('getModels').addEventListener('click', () => this.getModels());

        // Tokens tab
        document.getElementById('getUsage').addEventListener('click', () => this.getUsage());
        document.getElementById('getBudget').addEventListener('click', () => this.getBudget());
        document.getElementById('getPricing').addEventListener('click', () => this.getPricing());
        document.getElementById('getTransactions').addEventListener('click', () => this.getTransactions());
        document.getElementById('estimateCost').addEventListener('click', () => this.estimateCost());

        // Monitoring tab
        document.getElementById('getRateLimit').addEventListener('click', () => this.getRateLimit());
        document.getElementById('getBackupStatus').addEventListener('click', () => this.getBackupStatus());
        document.getElementById('getCacheStats').addEventListener('click', () => this.getCacheStats());
        document.getElementById('getDRPlans').addEventListener('click', () => this.getDRPlans());
        document.getElementById('createBackup').addEventListener('click', () => this.createBackup());
        document.getElementById('clearCache').addEventListener('click', () => this.clearCache());
    }

    initTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                
                // Remove active class from all tabs and contents
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                // Add active class to clicked tab and corresponding content
                btn.classList.add('active');
                document.getElementById(`${tabName}-tab`).classList.add('active');
            });
        });
    }

    loadSettings() {
        this.apiUrl = localStorage.getItem('apiUrl') || 'https://document-optimizer.netlify.app';
        this.apiKey = localStorage.getItem('apiKey') || '';
        
        document.getElementById('apiUrl').value = this.apiUrl;
        document.getElementById('apiKey').value = this.apiKey;
    }

    saveSettings() {
        this.apiUrl = document.getElementById('apiUrl').value;
        this.apiKey = document.getElementById('apiKey').value;
        
        localStorage.setItem('apiUrl', this.apiUrl);
        localStorage.setItem('apiKey', this.apiKey);
    }

    toggleApiKeyVisibility() {
        const input = document.getElementById('apiKey');
        const btn = document.getElementById('toggleApiKey');
        
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
        }
    }

    updateConnectionStatus(status, message) {
        const indicator = document.getElementById('statusIndicator');
        const text = document.getElementById('statusText');
        
        indicator.className = `status-indicator ${status}`;
        text.textContent = message;
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    async makeRequest(endpoint, options = {}) {
        this.saveSettings();
        
        const url = `${this.apiUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.apiKey && endpoint !== '/health' && endpoint !== '/') {
            headers['X-API-Key'] = this.apiKey;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();
            
            return {
                success: response.ok,
                status: response.status,
                data,
                headers: Object.fromEntries(response.headers.entries())
            };
        } catch (error) {
            return {
                success: false,
                status: 0,
                data: { error: error.message },
                headers: {}
            };
        }
    }

    displayResult(elementId, result, formatJson = true) {
        const element = document.getElementById(elementId);
        
        if (result.success) {
            element.className = 'result success';
            element.textContent = formatJson ? 
                JSON.stringify(result.data, null, 2) : 
                result.data;
        } else {
            element.className = 'result error';
            element.textContent = `Error ${result.status}: ${JSON.stringify(result.data, null, 2)}`;
        }
    }

    async checkConnection() {
        this.updateConnectionStatus('checking', 'Checking connection...');
        
        try {
            const result = await this.makeRequest('/');
            
            if (result.success) {
                this.updateConnectionStatus('connected', `Connected to ${result.data.name} v${result.data.version}`);
                
                // Also check health
                const healthResult = await this.makeRequest('/health');
                if (healthResult.success) {
                    this.updateConnectionStatus('connected', 
                        `Connected - ${result.data.name} v${result.data.version} (${healthResult.data.status})`);
                }
            } else {
                this.updateConnectionStatus('disconnected', `Connection failed: ${result.data.error || 'Unknown error'}`);
            }
        } catch (error) {
            this.updateConnectionStatus('disconnected', `Connection failed: ${error.message}`);
        }
    }

    async basicHealth() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/health');
            this.displayResult('healthResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async detailedHealth() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/health/detailed');
            this.displayResult('healthResult', result);
        } finally {
            this.hideLoading();
        }
    }

    handleFileSelect(event) {
        const files = event.target.files;
        const fileList = document.getElementById('fileList');
        
        fileList.innerHTML = '';
        
        Array.from(files).forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
            fileList.appendChild(fileItem);
        });
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async optimizeDocument() {
        this.showLoading();
        
        try {
            const optimizationType = document.getElementById('optimizationType').value;
            const model = document.getElementById('model').value;
            const documentText = document.getElementById('documentText').value;
            const fileInput = document.getElementById('fileInput');
            
            let result;
            
            if (fileInput.files.length > 0) {
                // File upload
                const formData = new FormData();
                formData.append('optimizationType', optimizationType);
                if (model) formData.append('model', model);
                
                Array.from(fileInput.files).forEach(file => {
                    formData.append('files', file);
                });
                
                result = await this.makeRequest('/optimize', {
                    method: 'POST',
                    body: formData,
                    headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
                });
            } else {
                // Text input
                const requestBody = {
                    optimizationType,
                    documents: [{
                        name: 'test-document.txt',
                        content: documentText,
                        type: 'text'
                    }]
                };
                
                if (model) requestBody.model = model;
                
                result = await this.makeRequest('/optimize', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                });
            }
            
            this.displayResult('optimizeResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getModels() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/models');
            this.displayResult('modelsResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getUsage() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/tokens/usage');
            this.displayResult('tokensResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getBudget() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/tokens/budget');
            this.displayResult('tokensResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getPricing() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/tokens/pricing');
            this.displayResult('tokensResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getTransactions() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/tokens/transactions');
            this.displayResult('tokensResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async estimateCost() {
        this.showLoading();
        try {
            const tokens = document.getElementById('estimateTokens').value;
            const model = document.getElementById('model').value || 'gpt-3.5-turbo';
            
            const result = await this.makeRequest(`/tokens/estimate?tokens=${tokens}&model=${model}`);
            this.displayResult('tokensResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getRateLimit() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/rate-limit/status');
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getBackupStatus() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/backup/status');
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getCacheStats() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/cache/stats');
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async getDRPlans() {
        this.showLoading();
        try {
            const result = await this.makeRequest('/disaster-recovery/plans');
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async createBackup() {
        if (!confirm('Are you sure you want to create a backup? This may take some time.')) {
            return;
        }
        
        this.showLoading();
        try {
            const result = await this.makeRequest('/backup/create', {
                method: 'POST'
            });
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }

    async clearCache() {
        if (!confirm('Are you sure you want to clear the cache? This will affect performance temporarily.')) {
            return;
        }
        
        this.showLoading();
        try {
            const result = await this.makeRequest('/cache/clear', {
                method: 'DELETE'
            });
            this.displayResult('monitoringResult', result);
        } finally {
            this.hideLoading();
        }
    }
}

// Initialize the API tester when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new APITester();
});

// Add some utility functions
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
    }).catch(() => {
        alert('Failed to copy to clipboard');
    });
};

window.setApiUrl = function(url) {
    document.getElementById('apiUrl').value = url;
    // Trigger change event to save the setting
    document.getElementById('apiUrl').dispatchEvent(new Event('change'));
};

window.downloadResult = function(elementId, filename = 'api-result.json') {
    const element = document.getElementById(elementId);
    const content = element.textContent;
    
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
};