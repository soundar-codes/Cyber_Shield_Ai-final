/**
 * CYBER SHIELD POPUP - Settings Control Panel
 */

// Load settings when popup opens
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupListeners();
    checkStatus();
    loadStats();
});

// Load all settings
function loadSettings() {
    chrome.storage.sync.get(['detectionEnabled', 'urlBlockingEnabled', 'notificationsEnabled'], (data) => {
        document.getElementById('toggleDetection').checked = data.detectionEnabled !== false;
        document.getElementById('toggleURL').checked = data.urlBlockingEnabled !== false;
        document.getElementById('toggleNotifications').checked = data.notificationsEnabled !== false;
    });
}

// Setup toggle listeners
function setupListeners() {
    document.getElementById('toggleDetection').addEventListener('change', (e) => {
        chrome.storage.sync.set({ detectionEnabled: e.target.checked });
        updateStatus();
    });

    document.getElementById('toggleURL').addEventListener('change', (e) => {
        chrome.storage.sync.set({ urlBlockingEnabled: e.target.checked });
    });

    document.getElementById('toggleNotifications').addEventListener('change', (e) => {
        chrome.storage.sync.set({ notificationsEnabled: e.target.checked });
    });

    document.getElementById('feedbackButton').addEventListener('click', openFeedbackPortal);
}

function openFeedbackPortal() {
    const feedbackHint = document.getElementById('feedbackHint');
    chrome.storage.local.get(['lastAnalysis'], (data) => {
        const analysis = data.lastAnalysis;
        if (!analysis || !analysis.content) {
            feedbackHint.textContent = 'No recent analysis context found. Open an alert first.';
            return;
        }

        const params = new URLSearchParams({
            content: analysis.content,
            predictedStatus: analysis.predictedStatus,
            riskScore: String(analysis.riskScore),
            signals: (analysis.signals || []).join('|')
        });

        chrome.tabs.create({
            url: `https://cybershield-88323.web.app/cybershield-feedback?${params.toString()}`
        });
    });
}

// Check backend and extension status
function checkStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (response) {
            const backendIcon = document.getElementById('backendIcon');
            const backendText = document.getElementById('backendText');
            
            if (response.backendStatus === 'online') {
                backendIcon.textContent = '✓';
                backendIcon.style.color = '#4caf50';
                backendText.textContent = 'Backend: Online';
            } else {
                backendIcon.textContent = '✗';
                backendIcon.style.color = '#ff6b6b';
                backendText.textContent = 'Backend: Offline (Using fallback)';
            }
        }
    });
    
    updateStatus();
}

// Update protection status display
function updateStatus() {
    chrome.storage.sync.get(['detectionEnabled', 'urlBlockingEnabled'], (data) => {
        const statusBadge = document.getElementById('statusBadge');
        const statusText = document.getElementById('statusText');
        
        if (data.detectionEnabled !== false || data.urlBlockingEnabled !== false) {
            statusBadge.style.borderColor = '#4caf50';
            statusBadge.style.background = '#e8f5e9';
            statusText.textContent = '✓ Protection Active';
            statusText.style.color = '#2e7d32';
        } else {
            statusBadge.style.borderColor = '#ff9800';
            statusBadge.style.background = '#fff3e0';
            statusText.textContent = '✗ Protection Disabled';
            statusText.style.color = '#e65100';
        }
    });
}

// Load and display statistics
function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        const statsContainer = document.getElementById('statsContainer');
        
        if (response) {
            statsContainer.innerHTML = `
                <div style="margin: 5px 0;">
                    <strong>Detection Status:</strong> ${response.detectionEnabled ? 'Enabled' : 'Disabled'}
                </div>
                <div style="margin: 5px 0;">
                    <strong>Backend:</strong> ${response.backendStatus}
                </div>
                <div style="margin: 5px 0;">
                    <strong>Last Check:</strong> Just now
                </div>
            `;
        }
    });
}

// Refresh stats every 5 seconds
setInterval(loadStats, 5000);

// Refresh backend status every 10 seconds
setInterval(checkStatus, 10000);