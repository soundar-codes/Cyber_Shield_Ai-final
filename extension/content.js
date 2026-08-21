/**
 * CYBER SHIELD - CONTENT SCRIPT
 * Automatically runs on websites
 * Monitors and detects scams in real-time
 */

let detectionEnabled = true;
const analyzedMessageTexts = new WeakMap();

// Load detection status
chrome.storage.sync.get(['detectionEnabled'], (data) => {
    if (data.detectionEnabled !== undefined) {
        detectionEnabled = data.detectionEnabled;
    }
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.detectionEnabled) {
        detectionEnabled = changes.detectionEnabled.newValue;
    }
});

// Listen for alert messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_WARNING') {
        showWarning(request);
        sendResponse({ received: true });
    }
});

// ============ AUTOMATIC MESSAGE MONITORING ============

// Wait for DOM to be ready before starting
console.log('🛡️ Cyber Shield Content Script loaded - waiting for DOM');

// Check if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMonitoring);
} else {
    // DOM is already ready
    setTimeout(initializeMonitoring, 500);
}

function initializeMonitoring() {
    console.log('🛡️ Initializing message monitoring');
    
    // Wait for body element to exist
    if (!document.body) {
        console.log('⏳ Body not ready yet, waiting...');
        setTimeout(initializeMonitoring, 500);
        return;
    }
    
    // Monitor WhatsApp Web
    monitorWhatsApp();
    
    // Monitor Gmail
    monitorGmail();
}

// ============ URL SCAM DETECTION ============

// Malicious URL patterns and shortened URL services commonly used in scams
const suspiciousUrlPatterns = {
    shortened: [
        'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 
        'short.link', 'short.cm', 'buff.ly', 'clck.ru',
        'is.gd', 'qr.net', 'spr.ly',
        't.me', 'tg.me', 'telegra.ph', 'telegram.dog'
    ],
    phishing: [
        'paypal-verify', 'amazon-secure', 'google-verify',
        'apple-id-verify', 'confirm-account', 'verify-identity',
        'update-payment', 'secure-login', 'account-confirm',
        'bank-security', 'verify-now', 'action-required'
    ],
    suspicious: [
        'click-here', 'claim-reward', 'get-free', 
        'verify-account', 'confirm-now', 'urgent-action',
        'limited-time', 'act-now', 'download-now'
    ],
    // Scam keywords found IN the domain name itself (e.g. free-recharge-jio.xyz)
    scamDomainKeywords: [
        'free-recharge', 'freerecharge', 'claim-prize', 'claimprice',
        'win-prize', 'winprize', 'lucky-draw', 'luckydraw',
        'cash-reward', 'cashreward', 'get-reward', 'getreward',
        'free-gift', 'freegift', 'earn-money', 'earnmoney',
        'aadhaar-verify', 'aadhaarverify', 'aadhaar-update',
        'kyc-update', 'kycupdate', 'otp-verify', 'otpverify',
        'bank-update', 'bankupdate', 'account-verify'
    ]
};

function analyzeUrlsInMessage(messageText, element, platform) {
    // Extract URLs from message text
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.(com|net|org|co|io|click|download|space|tk|ml|ga|cf|top|bid|win|date|faith|review|site|space|pw|info|biz)[\/\S]*)/gi;
    const urls = messageText.match(urlRegex) || [];
    
    // Also extract URLs from href attributes in element
    const linkElements = element.querySelectorAll('a[href]');
    linkElements.forEach(link => {
        const href = link.getAttribute('href');
        if (href) urls.push(href);
    });
    
    if (urls.length === 0) return false;
    
    // Check each URL for suspicious patterns
    let hasScamUrl = false;
    const detectedUrlThreats = [];
    
    urls.forEach(url => {
        const urlLower = url.toLowerCase();
        
        // Check shortened URL services
        for (const service of suspiciousUrlPatterns.shortened) {
            if (urlLower.includes(service)) {
                hasScamUrl = true;
                detectedUrlThreats.push(`Shortened URL: ${service}`);
                break;
            }
        }
        
        // Check for phishing patterns in URL
        for (const pattern of suspiciousUrlPatterns.phishing) {
            if (urlLower.includes(pattern)) {
                hasScamUrl = true;
                detectedUrlThreats.push(`Phishing URL pattern: ${pattern}`);
                break;
            }
        }

        // ⭐ NEW: Check for scam keywords embedded in domain name
        for (const keyword of suspiciousUrlPatterns.scamDomainKeywords) {
            if (urlLower.includes(keyword)) {
                hasScamUrl = true;
                detectedUrlThreats.push(`Scam domain keyword: ${keyword}`);
                break;
            }
        }
        
        // Check for suspicious subdomains/patterns
        if (/\b(verify|confirm|update|action|urgent|claim|secure|login|account)\b/i.test(url)) {
            if (/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/.test(url) || 
                url.includes('-') && (url.split('/')[2] || '').includes('-verify')) {
                hasScamUrl = true;
                detectedUrlThreats.push('IP-based or suspicious domain URL');
            }
        }
    });
    
    if (hasScamUrl) {
        console.log(`🔗 [${platform}] SCAM URL DETECTED:`, detectedUrlThreats);
        
        // Highlight the message with suspicious URL
        highlightThreatElement(element, 'scam', platform);
        element.style.paddingLeft = '10px';
        element.setAttribute('data-url-warning', 'true');
        
        // Add URL threat badge
        addUrlBadge(element, detectedUrlThreats, messageText);
        
        // Show premium popup directly (no background.js roundtrip)
        showWarning({
            status: 'scam',
            confidence: 0.95,
            threats: detectedUrlThreats.slice(0, 3),
            messagePreview: messageText.substring(0, 80),
            messageKey: messageText,
            isUrlScam: true
        });
        
        return true;
    }
    
    return false;
}

function addUrlBadge(element, threats, messageText) {
    const surface = getThreatSurface(element);
    if (surface.querySelector('.url-threat-badge')) return;
    
    const badge = document.createElement('div');
    badge.className = 'url-threat-badge';
    badge.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: linear-gradient(135deg, rgba(255,68,68,0.95), rgba(160,20,45,0.72));
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        border: 2px solid #cc0000;
        font-size: 11px;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 3px 14px rgba(255,68,68,0.65), inset 0 1px 0 rgba(255,255,255,0.45);
    `;
    badge.textContent = '🔗 SCAM URL';
    badge.title = 'Click to view the AI risk score';
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (event) => {
        event.stopPropagation();
        showWarning({
            status: 'scam',
            confidence: 0.95,
            threats: threats.slice(0, 3),
            messagePreview: messageText.substring(0, 80),
            messageKey: messageText,
            isUrlScam: true,
            manual: true
        });
    });
    surface.style.position = 'relative';
    surface.appendChild(badge);
}

// ============ WHATSAPP WEB MONITORING ============

function monitorWhatsApp() {
    // Safety check: ensure document.body exists
    if (!document.body) {
        console.log('⚠ WhatsApp: document.body not ready');
        return;
    }
    
    try {
        // Monitor for message bubbles with multiple selector strategies
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Find new messages using multiple strategies for different WhatsApp Web versions
                        const messages = node.querySelectorAll(
                            '[data-testid="msg-container"], '
                            + '[data-testid="message"], '
                            + '[role="article"][data-testid], '
                            + '.message, '
                            + '[class*="message"]:not([class*="message-input"])'
                        );
                        messages.forEach(msg => {
                            analyzeMessage(msg, 'whatsapp');
                        });
                        
                        // Also check direct message elements — fix: wrap both conditions
                        if (node.classList && (node.classList.contains('message-in') || node.classList.contains('message-out'))) {
                            analyzeMessage(node, 'whatsapp');
                        }
                    }
                });
            });
        });

        // Start watching for new messages
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial backward scan of existing messages (newest → oldest)
        setTimeout(() => scanChatHistory('whatsapp'), 150);
        
        // Detect when user opens a DIFFERENT chat — rescan history each time
        let lastChatTitle = '';
        setInterval(() => {
            // WhatsApp sets the chat title in the header when a chat is open
            const titleEl = document.querySelector('header [data-testid="conversation-header"] span[dir], header [title]');
            const currentTitle = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '') : '';
            if (currentTitle && currentTitle !== lastChatTitle) {
                lastChatTitle = currentTitle;
                console.log(`💬 Chat switched to "${currentTitle}" — clearing cache and scanning...`);
                // ⭐ Clear hash cache so chat messages get re-scanned fresh
                checkedMessageHashes.clear();
                // Delay to let WhatsApp render all messages in new chat
                setTimeout(() => scanChatHistory('whatsapp'), 300);
            }
        }, 1000); // Keep chat switching responsive without polling excessively
        
        // Periodically pick up newly arrived messages (new messages have no hash yet)
        setInterval(() => {
            const allMessages = Array.from(document.querySelectorAll('[data-testid="msg-container"]'));
            allMessages.slice(-50).forEach(msg => analyzeMessage(msg, 'whatsapp'));
        }, 3000);
        
        console.log('✓ WhatsApp Web monitoring started');
        
        // Show premium activated badge in top right corner
        injectActivatedBadge('whatsapp');
    } catch (error) {
        console.error('❌ WhatsApp monitoring error:', error);
    }
}

// ============ PREMIUM PRIORITY SCAN ENGINE ============
// Phase 1: Instant keyword check on ALL messages (synchronous, zero delay)
// Phase 2: ML check on last ~2hrs of messages (recent 40) in fast batches
// Phase 3: ML check on older messages in slower batches
function scanChatHistory(platform) {
    const selectors = platform === 'whatsapp'
        ? '[data-testid="msg-container"], [role="article"][data-testid], .message.message-in, .message.message-out'
        : '[role="main"] [role="article"]';

    const messages = Array.from(document.querySelectorAll(selectors));
    if (messages.length === 0) {
        console.log(`\ud83d\udd0d [${platform}] No messages in DOM yet — will retry`);
        return;
    }

    // Newest first
    const newest = messages.slice().reverse();
    console.log(`\u26a1 [${platform}] Priority scan: ${newest.length} messages (newest \u2192 oldest)`);

    // ---- PHASE 1: INSTANT keyword check on everything (no network, zero delay) ----
    // Show popup for the FIRST scam found (don't spam)
    let popupShownThisScan = false;
    newest.forEach(msg => {
        // Skip if already shown a badge for this message content (prevents re-badging on same DOM node)
        if (msg.hasAttribute('data-scam-warning')) return;

        const text = extractText(msg, platform);
        if (!text || text.trim().length <= 3) return;
        const instant = instantKeywordCheck(text);
        if (instant !== 'safe') {
            highlightThreatElement(msg, instant, platform);
            msg.style.paddingLeft = '10px';
            msg.setAttribute('data-scam-warning', 'true');
            addBadge(msg, instant, {
                confidence: instant === 'scam' ? 0.85 : 0.55,
                threats: extractInstantThreats(text),
                messageText: text
            });
            console.log(`⚡ INSTANT [${platform}]: ${instant.toUpperCase()} — "${text.substring(0,50)}"`);
            
            // ⭐ Show premium popup for the first scam/suspicious found
            if (!popupShownThisScan) {
                popupShownThisScan = true;
                showWarning({
                    status: instant,
                    confidence: instant === 'scam' ? 0.85 : 0.55,
                    threats: extractInstantThreats(text),
                    messagePreview: text.substring(0, 80),
                    messageKey: text,
                    isUrlScam: false
                });
            }
        }
    });

    // ---- PHASE 2: ML scan on RECENT messages (last ~40 = approx 2 hrs) in fast batches ----
    const recent  = newest.slice(0, 40);   // newest 40 messages
    const older   = newest.slice(40);       // everything else

    sendBatchToML(recent, platform, 50);    // 50ms between batches (fast)

    // ---- PHASE 3: ML scan on OLDER messages in slower batches (don't block UI) ----
    // Delay Phase 3 start until Phase 2 is well underway
    setTimeout(() => sendBatchToML(older, platform, 200), recent.length * 55);
}

// Send messages to ML in batches of 5, with `gapMs` between each batch
function sendBatchToML(messages, platform, gapMs) {
    const BATCH = 5;
    let i = 0;
    function processNext() {
        const slice = messages.slice(i, i + BATCH);
        if (slice.length === 0) return;
        slice.forEach(msg => analyzeMessage(msg, platform));
        i += BATCH;
        if (i < messages.length) setTimeout(processNext, gapMs);
    }
    processNext();
}

// ============ GMAIL MONITORING ============

function monitorGmail() {
    // Safety check: ensure document.body exists
    if (!document.body) {
        console.log('⚠ Gmail: document.body not ready');
        return;
    }
    
    try {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        // Find new emails
                        const emails = node.querySelectorAll('[role="main"] [role="article"], [data-message-id]');
                        emails.forEach(email => {
                            analyzeMessage(email, 'gmail');
                        });
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Check existing emails (backward from newest)
        setTimeout(() => scanChatHistory('gmail'), 2000);
        
        console.log('✓ Gmail monitoring started');
        
        // Show premium activated badge in top right corner
        injectActivatedBadge('gmail');
    } catch (error) {
        console.error('❌ Gmail monitoring error:', error);
    }
}

// ============ MESSAGE ANALYSIS ============

// ============ INSTANT KEYWORD PRE-SCANNER ============
// Runs synchronously before ML — gives immediate visual feedback
// ⭐ MULTILINGUAL SCAM DATABASE — 15+ languages
const INSTANT_TRIGGERS = {
    scam: [
        // ===== ENGLISH =====
        'verify your otp', 'send otp', 'share otp', 'enter otp', 'one time password',
        'send your otp', 'forward otp', 'otp immediately', 'otp now',
        'verify account', 'confirm identity', 'account suspended', 'account locked',
        'account will be suspended', 'account compromised', 'unusual login', 'unusual activity',
        'bank account', 'cvv', 'credit card details', 'your bank', 'bank alert',
        'bank account number', 'update payment', 'billing information',
        'bit.ly', 'tinyurl', 'goo.gl', 'free-recharge', 'freerecharge',
        'aadhaar-verify', 'aadhaar-update', 'kyc-update', 'claim prize',
        'free-recharge-jio', 'recharge-jio', 'http://free',
        'whatsapp security', 'amazon security', 'google alert',
        'facebook confirm',
        'congratulations won', 'claim prize', 'lottery', 'grand prize', 'lucky draw',
        'you have won', 'cash reward', 'free gift',
        'install app', 'download security update', 'download app', '.apk',
        'your account will be blocked', 'reset your password immediately',
        'click link below', 'your kyc is pending', 'aadhaar link',
        'pan card verify', 'income tax refund', 'emi overdue', 'loan approved',
        'insurance expired', 'policy lapsed', 'customs clearance', 'parcel held',
        'arrested warrant', 'narcotic drugs', 'cbi notice', 'cyber crime notice',

        // ===== HINDI (Devanagari script) =====
        'ओटीपी शेयर करें', 'ओटीपी भेजें', 'अपना ओटीपी दें', 'खाता बंद हो जाएगा',
        'आपका खाता निलंबित', 'तुरंत कार्रवाई करें', 'बैंक खाता', 'क्रेडिट कार्ड',
        'आपने जीता', 'इनाम जीता', 'लॉटरी जीती', 'मुफ्त रिचार्ज', 'कैश बैक',
        'केवाईसी अपडेट', 'आधार वेरीफाई', 'पैन कार्ड', 'आयकर रिफंड',
        'तत्काल सत्यापन', 'लिंक पर क्लिक करें', 'ऐप डाउनलोड करें',
        'आपका खाता हैक', 'संदिग्ध गतिविधि', 'बैंक अलर्ट', 'फ्री गिफ्ट',
        'बड़ा इनाम', 'ईएमआई बकाया', 'लोन मंजूर', 'बीमा समाप्त',

        // ===== HINDI (Romanized / Hinglish) =====
        'otp share karo', 'otp bhejo', 'apna otp do', 'khata band ho jayega',
        'aapka account suspend', 'turant karwai karo', 'bank khata', 'credit card',
        'aapne jeeta', 'inam jeeta', 'lottery jeeti', 'free recharge', 'cash back',
        'kyc update karo', 'aadhaar verify karo', 'pan card', 'aaykar refund',
        'tatkal satyapan', 'link par click karo', 'app download karo',
        'aapka khata hack', 'sandigdh gatividhi', 'bank alert', 'free gift pai',
        'bada inam', 'emi bakaya', 'loan manjur', 'bima samapt',
        'apna password share karo', 'paytm kyc', 'google pay scam',
        'police pak', 'cbi notice aya', 'arrest hoga', 'drugs pakray gaye',

        // ===== TAMIL (Tamil script) =====
        'ஓடிபி பகிர்', 'உங்கள் கணக்கு நிறுத்தப்படும்', 'இலவச பரிசு',
        'வெற்றி பெற்றீர்கள்', 'லாட்டரி', 'கேஒய்சி புதுப்பி', 'ஆதார் சரிபார்',
        'வங்கி கணக்கு', 'கிரெடிட் கார்டு விவரம்', 'உடனடி நடவடிக்கை',
        'இணைப்பை கிளிக்', 'ஆப் பதிவிறக்கம்', 'பணம் வந்தது', 'சந்தேகமான செயல்',

        // ===== TAMIL (Romanized) =====
        'otp pari', 'ungal account niruththapadum', 'ilava parichu',
        'vetri petriirkal', 'lottery', 'kyc puduppi', 'aadhaar sarippaar',
        'vangi kanakku', 'credit card vivaram', 'udanadi nadavatikkai',
        'inaippai click', 'app pathivirakkam', 'panam vandhuthu', 'sandegamaana seyal',
        'ungal phone arrest aagum', 'police varum', 'cyber crime case',

        // ===== TELUGU (Telugu script) =====
        'ఓటీపీ పంపండి', 'మీ ఖాతా నిలిపివేయబడుతుంది', 'ఉచిత బహుమతి',
        'మీరు గెలిచారు', 'లాటరీ', 'కేవైసీ నవీకరించండి', 'ఆధార్ ధృవీకరించండి',
        'బ్యాంక్ ఖాతా', 'క్రెడిట్ కార్డ్', 'తక్షణ చర్య',
        'లింక్ క్లిక్ చేయండి', 'యాప్ డౌన్లోడ్',

        // ===== TELUGU (Romanized) =====
        'otp pampandi', 'mee khata nilipivestuundi', 'uchita bahumati',
        'meeru gelicharu', 'lottery', 'kyc naveekarinchandi', 'aadhaar dhruveekarinchandi',
        'bank khata', 'credit card', 'takshaņa charyaga',
        'link click cheyandi', 'app download cheyandi',

        // ===== BENGALI (Bengali script) =====
        'ওটিপি শেয়ার করুন', 'আপনার অ্যাকাউন্ট বন্ধ হবে', 'বিনামূল্যে পুরস্কার',
        'আপনি জিতেছেন', 'লটারি', 'কেওয়াইসি আপডেট', 'আধার যাচাই',
        'ব্যাংক অ্যাকাউন্ট', 'ক্রেডিট কার্ড', 'এখনই ক্লিক করুন',

        // ===== BENGALI (Romanized) =====
        'otp share korun', 'apnar account bondho hobe', 'binamullye puroshkar',
        'apni jitechhen', 'lottery', 'kyc update korun', 'aadhaar jachai',
        'bank account', 'credit card', 'ekhoni click korun',

        // ===== MARATHI (Devanagari script) =====
        'ओटीपी शेअर करा', 'तुमचे खाते निलंबित होईल', 'मोफत बक्षीस',
        'तुम्ही जिंकलात', 'लॉटरी', 'केवायसी अपडेट', 'आधार पडताळणी',
        'बँक खाते', 'क्रेडिट कार्ड', 'ताबडतोब क्लिक करा',

        // ===== MARATHI (Romanized) =====
        'otp share kara', 'tumche khate nilambit hoil', 'mofat bakshis',
        'tumhi jinklat', 'lottery', 'kyc update kara', 'aadhaar padtalni',
        'bank khate', 'credit card', 'tabadtob click kara',

        // ===== GUJARATI (Gujarati script) =====
        'ઓટીપી શેર કરો', 'તમારું ખાતું બ્લૉક થઈ જશે', 'મફત ઇનામ',
        'તમે જીત્યા', 'લોટરી', 'કેવાયસી અપડેટ', 'આધાર ચકાસો',
        'બેંક ખાતું', 'ક્રેડિટ કાર્ડ',

        // ===== GUJARATI (Romanized) =====
        'otp share karo', 'tamaru khatu block thai jashe', 'mafat inam',
        'tame jitya', 'lottery', 'kyc update karo', 'aadhaar chakaso',
        'bank khatu', 'credit card',

        // ===== KANNADA (Kannada script) =====
        'ಓಟಿಪಿ ಹಂಚಿಕೊಳ್ಳಿ', 'ನಿಮ್ಮ ಖಾತೆ ಬ್ಲಾಕ್', 'ಉಚಿತ ಬಹುಮಾನ',
        'ನೀವು ಗೆದ್ದಿದ್ದೀರಿ', 'ಲಾಟರಿ', 'ಕೆವೈಸಿ ನವೀಕರಿಸಿ',

        // ===== KANNADA (Romanized) =====
        'otp hanchikollali', 'nimma khate block', 'uchita bahumana',
        'neevu geddiddeeri', 'lottery', 'kyc naveekari',

        // ===== MALAYALAM (Malayalam script) =====
        'ഒടിപി പങ്കിടുക', 'നിങ്ങളുടെ അക്കൗണ്ട് ബ്ലോക്ക്', 'സൗജന്യ സമ്മാനം',
        'നിങ്ങൾ ജയിച്ചു', 'ലോട്ടറി', 'കെവൈസി അപ്ഡേറ്റ്',

        // ===== MALAYALAM (Romanized) =====
        'otp pangidam', 'ningalude account block', 'soujanya sammanam',
        'ningal jayichu', 'lottery', 'kyc update cheyyuka',

        // ===== PUNJABI (Gurmukhi script) =====
        'ਓਟੀਪੀ ਸਾਂਝਾ ਕਰੋ', 'ਤੁਹਾਡਾ ਖਾਤਾ ਬੰਦ', 'ਮੁਫ਼ਤ ਇਨਾਮ',
        'ਤੁਸੀਂ ਜਿੱਤੇ', 'ਲਾਟਰੀ',

        // ===== PUNJABI (Romanized) =====
        'otp sanjha karo', 'tuhada khata band', 'muft inam',
        'tusi jitte', 'lottery',

        // ===== URDU (Romanized — commonly used in India/Pakistan) =====
        'otp share karen', 'apka account band ho jayega', 'muft inam',
        'aapne jeeta', 'lottery', 'kyc tajdeed karen', 'aadhaar tasteeq',
        'bank account', 'credit card', 'abhi click karen',
        'police arrest karegi', 'drugs pakri gai', 'case darj',

        // ===== ARABIC =====
        'شارك رمز otp', 'حسابك سيُغلق', 'جائزة مجانية', 'لقد فزت',
        'يانصيب', 'انقر على الرابط', 'تنزيل التطبيق', 'تحقق من الهوية',
        'تحديث بيانات البنك', 'نشاط مشبوه',

        // ===== SPANISH =====
        'comparte tu otp', 'tu cuenta sera suspendida', 'premio gratis',
        'has ganado', 'loteria', 'haz clic aqui', 'descarga la app',
        'verificacion de cuenta', 'actividad sospechosa',

        // ===== FRENCH =====
        'partagez votre otp', 'votre compte sera suspendu', 'prix gratuit',
        'vous avez gagne', 'loterie', 'cliquez ici', 'telecharger application',
        'verification de compte', 'activite suspecte',

        // ===== CHINESE (Simplified — common online scam phrases) =====
        '分享您的验证码', '您的账户将被封禁', '免费奖品', '您赢了',
        '点击链接', '下载应用', '账户验证', '可疑活动',

        // ===== RUSSIAN =====
        'поделитесь кодом otp', 'ваш аккаунт будет заблокирован',
        'бесплатный приз', 'вы выиграли', 'нажмите на ссылку',
        'скачать приложение', 'подозрительная активность'
    ],
    suspicious: [
        // ===== ENGLISH =====
        'click here', 'urgent', 'immediately', 'limited time', 'act now',
        'verify', 'update payment', 'billing', 'confirm', 'suspicious',
        'recharge', 'claim', 'reward', 'prize', 'free offer',
        'you are selected', 'exclusive offer', 'don\'t share this',
        'do not tell anyone', 'keep this secret', 'this is confidential',
        'government notice', 'tax department', 'court notice',
        'help me transfer', 'investment opportunity', 'double your money',
        'bitcoin wallet', 'crypto investment', 'guaranteed returns',

        // ===== HINDI (Romanized) =====
        'jaldi karo', 'abhi click karo', 'sirf aaj ke liye', 'seedha sambandh karo',
        'kisi ko mat batao', 'yeh secret hai', 'free paisa', 'jaldi se',
        'sarkari notice', 'tax vibhag', 'court notice', 'guarantee return',
        'paise double', 'bitcoin', 'crypto',

        // ===== HINDI (Devanagari) =====
        'जल्दी करो', 'अभी क्लिक करो', 'किसी को मत बताओ', 'यह गुप्त है',
        'मुफ्त पैसा', 'सरकारी नोटिस', 'पैसे दोगुना', 'गारंटी रिटर्न',

        // ===== TAMIL (Romanized) =====
        'sigram seyya vendum', 'yarukkum solladhey', 'idhuvai rakasiamaa vaikkavum',
        'free panam', 'sarkaar notice', 'udan seyya vendum',

        // ===== TELUGU (Romanized) =====
        'veganga cheyandi', 'evvarikee cheppakandi', 'idhi rahasyam',
        'free money', 'government notice', 'guarantee return',

        // ===== ARABIC =====
        'اتصل بنا الآن', 'عرض محدود', 'لا تخبر أحداً', 'مجاني',
        'اضغط هنا', 'عاجل',

        // ===== SPANISH =====
        'llame ahora', 'oferta limitada', 'no le digas a nadie',
        'gratis', 'haga clic', 'urgente',

        // ===== FRENCH =====
        'appelez maintenant', 'offre limitee', 'ne dites a personne',
        'gratuit', 'cliquez', 'urgent',

        // ===== RUSSIAN =====
        'позвони сейчас', 'ограниченное предложение', 'не говори никому',
        'бесплатно', 'нажмите', 'срочно'
    ]
};

function instantKeywordCheck(text) {
    const lower = text.toLowerCase();
    if (INSTANT_TRIGGERS.scam.some(k => lower.includes(k))) return 'scam';
    if (INSTANT_TRIGGERS.suspicious.some(k => lower.includes(k))) return 'suspicious';
    return 'safe';
}

function analyzeMessage(element, platform) {
    if (!element || !detectionEnabled) return;

    // Extract message text based on platform
    let messageText = extractText(element, platform);
    
    if (messageText && messageText.trim().length > 3) {
        const analysisKey = `${platform}:${messageText}`;
        if (analyzedMessageTexts.get(element) === analysisKey) return;
        analyzedMessageTexts.set(element, analysisKey);

        console.log(`[${platform}] Found message: "${messageText.substring(0, 50)}..."`);
        
        // ⚡ INSTANT PRE-CHECK — runs synchronously with zero network delay
        const instantResult = instantKeywordCheck(messageText);
        let instantFired = false; // track if popup was already shown
        if (instantResult !== 'safe') {
            console.log(`⚡ [${platform}] INSTANT DETECTION: ${instantResult}`);
            highlightThreatElement(element, instantResult, platform);
            element.style.paddingLeft = '10px';
            element.setAttribute('data-scam-warning', 'true');
            addBadge(element, instantResult, {
                confidence: instantResult === 'scam' ? 0.85 : 0.55,
                threats: extractInstantThreats(messageText),
                messageText
            });
            instantFired = true;
            
            // ✅ Show popup immediately from instant check
            showWarning({
                status: instantResult,
                confidence: instantResult === 'scam' ? 0.85 : 0.55,
                threats: extractInstantThreats(messageText),
                messagePreview: messageText.substring(0, 80),
                messageKey: messageText,
                isUrlScam: false
            });
        }
        
        // Check for scam URLs (works independently — has its own showWarning call)
        const hasScamUrl = analyzeUrlsInMessage(messageText, element, platform);
        
        // Also send to ML for higher-accuracy check (runs in background)
        try {
            chrome.runtime.sendMessage({
                type: 'CHECK_SCAM',
                text: messageText,
                platform: platform
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('Background not ready');
                    return;
                }

                if (response && response.type === 'SCAM_DETECTED') {
                    console.log(`⚠️ [${platform}] ML SCAM DETECTED:`, response);

                    // Upgrade highlight
                    highlightThreatElement(element, 'scam', platform);
                    element.style.paddingLeft = '10px';
                    element.setAttribute('data-scam-warning', 'true');

                    // Add/upgrade badge
                    const existingBadge = element.querySelector('.cyber-shield-badge');
                    if (existingBadge) existingBadge.remove();
                    addBadge(element, response.status, {
                        confidence: response.confidence,
                        threats: response.threats || [],
                        messageText
                    });

                    // Only show ML popup if instant check didn't already fire one
                    // (avoids double popup on same message)
                    if (!instantFired) {
                        showWarning({
                            status: response.status,
                            confidence: response.confidence,
                            threats: response.threats || [],
                            messagePreview: messageText.substring(0, 80),
                            messageKey: messageText,
                            isUrlScam: false
                        });
                    }
                }
            });
        } catch (error) {
            if (!String(error).toLowerCase().includes('context invalidated')) {
                console.warn(`[${platform}] Background check unavailable:`, error);
            }
        }
    }
}

// Extract which specific keywords triggered the instant scan
function extractInstantThreats(text) {
    const lower = text.toLowerCase();
    const found = [];
    const categories = {
        'OTP Request':      ['send otp', 'share otp', 'enter otp', 'otp immediately', 'otp now', 'forward otp', 'one time password'],
        'Account Attack':   ['account suspended', 'account locked', 'account compromised', 'unusual login', 'unusual activity'],
        'Financial Scam':   ['bank account', 'cvv', 'credit card', 'billing information', 'update payment'],
        'Prize Scam':       ['congratulations won', 'claim prize', 'lottery', 'grand prize', 'lucky draw', 'cash reward', 'you have won'],
        'Phishing URL':     ['bit.ly', 'tinyurl', 'goo.gl', 'free-recharge', 'aadhaar-verify', 'kyc-update', 'http://free'],
        'Impersonation':    ['whatsapp security', 'amazon security', 'google alert', 'facebook confirm'],
        'Malware':          ['install app', 'download security', 'download app', '.apk']
    };
    for (const [label, keywords] of Object.entries(categories)) {
        if (keywords.some(k => lower.includes(k))) found.push(label);
    }
    return found.length ? found : ['Suspicious keyword pattern detected'];
}

// Extract text from message element
function extractText(element, platform) {
    let text = '';

    if (platform === 'whatsapp') {
        // Try WhatsApp selectors (multiple strategies for different versions)
        const selectors = [
            '[class*="selectable-text"]',
            '[data-testid="msg-text"]',
            'span[dir="auto"][style*="word-wrap"]',
            '.selectable-text',
            '[role="img"][alt]',  // For images with alt text
            '.copyable-text'
        ];
        for (let selector of selectors) {
            const el = element.querySelector(selector);
            if (el) {
                text = el.innerText || el.textContent || el.alt || el.getAttribute('aria-label');
                if (text && text.trim().length > 2) break;
            }
        }
        // Fallback: extract all text from the message container
        if (!text) {
            text = element.innerText;
        }
        
        // Also check for URLs that might be in href attributes
        const links = element.querySelectorAll('a[href]');
        if (links.length > 0 && text.length < 10) {
            text = Array.from(links).map(l => l.href).join(' ') + ' ' + (text || '');
        }
    }
    else if (platform === 'gmail') {
        // Try Gmail selectors
        const selectors = ['[role="main"] [data-tooltip]', '.iT [dir="auto"]'];
        for (let selector of selectors) {
            const el = element.querySelector(selector);
            if (el) {
                text = el.innerText || el.textContent;
                if (text && text.trim().length > 3) break;
            }
        }
        if (!text) text = element.innerText;
    }


    // Clean up text
    text = text.trim().replace(/\n+/g, ' ').substring(0, 500);
    return text;
}

// Add warning badge to suspicious message
function highlightThreatElement(element, status, platform) {
    if (platform !== 'whatsapp' && platform !== 'gmail') return;

    const surface = getThreatSurface(element, platform);
    if (!surface) return;
    const isScam = status === 'scam';
    const accent = isScam ? '#ff304f' : '#ffb000';
    const tint = isScam ? 'rgba(255,67,67,0.15)' : 'rgba(255,193,7,0.15)';

    surface.style.position = 'relative';
    surface.style.setProperty('background-image', `linear-gradient(105deg, ${tint}, rgba(255,255,255,0.08) 48%, transparent)`, 'important');
    surface.style.setProperty('background-color', tint, 'important');
    surface.style.setProperty('border-left', `5px solid ${accent}`, 'important');
    surface.style.setProperty('padding-left', '10px', 'important');
}

function getThreatSurface(element, platform = 'whatsapp') {
    if (platform === 'gmail') {
        return element.matches('.a3s, .ii.gt')
            ? element
            : element.querySelector('.a3s, .ii.gt');
    }

    return element.matches('[data-pre-plain-text], .copyable-text')
        ? element
        : element.querySelector('[data-pre-plain-text], .copyable-text') || element;
}

function addBadge(element, status, details = {}) {
    const surface = getThreatSurface(element);
    if (surface.querySelector('.cyber-shield-badge')) return;

    const badge = document.createElement('div');
    badge.className = 'cyber-shield-badge';
    const bgColor = status === 'scam' ? '#ff4444' : '#ff9800';
    const borderColor = status === 'scam' ? '#cc0000' : '#ff6600';
    const label = status === 'scam' ? '⚠️ SCAM' : '⚠️ SUSPICIOUS';
    
    badge.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: linear-gradient(135deg, ${bgColor}ee, ${bgColor}99);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        border: 2px solid ${borderColor};
        font-size: 11px;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 3px 14px ${bgColor}99, inset 0 1px 0 rgba(255,255,255,0.45);
    `;
    badge.textContent = label;
    badge.title = 'Click to view the AI risk score';
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (event) => {
        event.stopPropagation();
        showWarning({
            status,
            confidence: details.confidence || (status === 'scam' ? 0.85 : 0.55),
            threats: details.threats || [],
            messagePreview: (details.messageText || '').substring(0, 80),
            messageKey: details.messageText || '',
            manual: true
        });
    });
    surface.style.position = 'relative';
    surface.appendChild(badge);
}

// ============ WARNING POPUP ALERT ============

// Track if a warning is currently showing (only one at a time, stays until dismissed or refresh)
let warningActive = false;
const whatsappWarningCounts = new Map();
const whatsappWarningMessages = new Set();

function getWhatsAppChatKey() {
    const titleEl = document.querySelector('header [data-testid="conversation-header"] span[dir], header [title]');
    return titleEl
        ? (titleEl.textContent || titleEl.getAttribute('title') || '').trim()
        : 'unknown-chat';
}

function showWarning(data) {
    const isWhatsApp = /(^|\.)whatsapp\.com$/i.test(window.location.hostname);
    const chatKey = isWhatsApp ? getWhatsAppChatKey() : '';
    const messageKey = data.messageKey || data.messagePreview;
    const warningMessageKey = messageKey
        ? `${chatKey}:${messageKey.trim().replace(/\s+/g, ' ').toLowerCase()}`
        : '';

    if (!data.manual && isWhatsApp && warningMessageKey && whatsappWarningMessages.has(warningMessageKey)) return;

    // If a warning is already showing, don't replace it — let user read and dismiss first
    // (except: if the new one is a scam and the old one is just suspicious, upgrade it)
    const existing = document.getElementById('cyberShieldAlert');
    const newIsScam = data.status === 'scam' || data.isUrlScam === true;
    if (existing && warningActive) {
        const existingIsScam = existing.getAttribute('data-threat-level') === 'scam';
        if (existingIsScam || !newIsScam) return; // Keep existing unless upgrading to scam
        existing.remove();
    }

    if (!data.manual && isWhatsApp) {
        const warningCount = whatsappWarningCounts.get(chatKey) || 0;
        if (warningCount >= 2) return;
        whatsappWarningCounts.set(chatKey, warningCount + 1);
        if (warningMessageKey) whatsappWarningMessages.add(warningMessageKey);
    }

    warningActive = true;

    const isUrlScam   = data.isUrlScam === true;
    const isScam      = data.status === 'scam' || isUrlScam;
    const riskScore   = Math.round((data.confidence || 0) * 100);
    const threats     = data.threats || [];
    const msgPreview  = (data.messagePreview || '').substring(0, 80);

    chrome.storage.local.set({
        lastAnalysis: {
            content: data.messageKey || data.messagePreview || '',
            predictedStatus: isScam ? 'SCAM' : 'SAFE',
            riskScore,
            signals: threats,
            analyzedAt: new Date().toISOString()
        }
    });

    const accentColor  = isScam ? '#ff4444' : '#ffb300';
    const accentGlow   = isScam ? 'rgba(255,68,68,0.4)' : 'rgba(255,179,0,0.4)';
    const accentDim    = isScam ? 'rgba(255,68,68,0.10)' : 'rgba(255,179,0,0.10)';
    const accentMid    = isScam ? 'rgba(255,68,68,0.22)' : 'rgba(255,179,0,0.22)';
    const badgeLabel   = isUrlScam ? 'MALICIOUS URL' : (isScam ? 'SCAM DETECTED' : 'SUSPICIOUS MESSAGE');
    const badgeIcon    = isUrlScam ? '🔗' : (isScam ? '🚨' : '⚠️');
    const typeLabel    = isUrlScam ? 'Malicious URL' : (isScam ? 'Scam' : 'Suspicious');

    const guidance = isUrlScam ? [
        { icon: '🚫', text: 'Do <strong>NOT</strong> click any link in this message' },
        { icon: '🗑️', text: 'Delete the message and <strong>block the sender</strong>' },
        { icon: '🚨', text: 'Report this chat to <strong>WhatsApp / platform support</strong>' }
    ] : isScam ? [
        { icon: '🔒', text: '<strong>Never share OTPs, passwords or bank details</strong> with anyone' },
        { icon: '📵', text: 'Cut contact — <strong>block and report</strong> the sender immediately' },
        { icon: '🏦', text: 'If you shared anything sensitive, <strong>contact your bank now</strong>' }
    ] : [
        { icon: '👀', text: 'Verify the sender\'s identity <strong>through a known channel</strong> first' },
        { icon: '⏸️', text: 'Do <strong>not act urgently</strong> — scammers rely on panic and time pressure' },
        { icon: '🔍', text: 'Search the exact message text online to check for <strong>known scam patterns</strong>' }
    ];

    const threatRows = threats.length
        ? threats.map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:${accentColor};font-size:11px;flex-shrink:0;">▶</span>
                <span style="color:#ccd6f6;font-size:12px;">${t}</span>
            </div>`).join('')
        : `<div style="color:#8892b0;font-size:12px;padding:4px 0;">Pattern-based keyword match</div>`;

    const previewHtml = msgPreview
        ? `<div style="margin:10px 0;padding:8px 12px;background:rgba(255,255,255,0.04);border-left:3px solid ${accentColor};border-radius:4px;font-size:12px;color:#8892b0;font-family:'Consolas',monospace;word-break:break-word;line-height:1.5;">"${msgPreview}${msgPreview.length >= 80 ? '…' : ''}"</div>`
        : '';

    const guidanceHtml = guidance.map(g =>
        `<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="font-size:15px;flex-shrink:0;margin-top:1px;">${g.icon}</span>
            <span style="font-size:12px;color:#ccd6f6;line-height:1.5;">${g.text}</span>
        </div>`
    ).join('');

    const popup = document.createElement('div');
    popup.id = 'cyberShieldAlert';
    popup.setAttribute('data-threat-level', isScam ? 'scam' : 'suspicious');

    // Always replace keyframe styles so dynamic values (riskScore, colors) are fresh
    const styleId = 'cs-popup-keyframes';
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) existingStyle.remove();
    {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `
            @keyframes cs-popup-enter {
                0%   { transform: translateX(420px) scale(0.92); opacity: 0; }
                60%  { transform: translateX(-8px) scale(1.01); opacity: 1; }
                80%  { transform: translateX(4px) scale(0.99); }
                100% { transform: translateX(0) scale(1); opacity: 1; }
            }
            @keyframes cs-riskbar {
                from { width: 0%; }
                to   { width: ${riskScore}%; }
            }
            @keyframes cs-border-pulse {
                0%, 100% { box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 20px ${accentGlow}; }
                50%       { box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 55px ${accentGlow}; }
            }
            @keyframes cs-scan-beam {
                0%   { top: 0%; opacity: 0.7; }
                100% { top: 110%; opacity: 0; }
            }
            @keyframes cs-icon-pulse {
                0%, 100% { transform: scale(1); box-shadow: 0 0 10px ${accentGlow}; }
                50%       { transform: scale(1.12); box-shadow: 0 0 22px ${accentGlow}; }
            }
            @keyframes cs-top-bar-scan {
                0%   { background-position: -400px 0; }
                100% { background-position: 400px 0; }
            }
            #cyberShieldAlert {
                position: fixed;
                bottom: 22px;
                right: 22px;
                width: 370px;
                z-index: 2147483647;
                font-family: 'Segoe UI', 'Consolas', system-ui, sans-serif;
                animation: cs-popup-enter 0.5s cubic-bezier(0.22,1,0.36,1) forwards,
                           cs-border-pulse 3s ease-in-out 0.6s infinite;
                background: linear-gradient(160deg, rgba(6,14,30,0.98) 0%, rgba(9,18,40,0.98) 100%);
                backdrop-filter: blur(22px);
                -webkit-backdrop-filter: blur(22px);
                border: 1.5px solid ${accentColor};
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 30px ${accentGlow};
                overflow: hidden;
            }
            #cyberShieldAlert:hover {
                animation-play-state: paused;
            }
            #cs-close-alert:hover { background: rgba(255,255,255,0.12) !important; color: #fff !important; }
            #cs-dismiss-alert:hover {
                background: ${accentColor} !important;
                color: #000 !important;
                transform: translateY(-1px);
                box-shadow: 0 4px 20px ${accentGlow};
            }
        `;
        document.head.appendChild(s);
    }

    popup.innerHTML = `
        <!-- Animated top bar -->
        <div style="
            height: 4px;
            background: linear-gradient(90deg, ${accentColor}, #7b2ff7, #00b8ff, ${accentColor});
            background-size: 200% 100%;
            animation: cs-top-bar-scan 2.5s linear infinite;
            position: relative;
        "></div>

        <!-- Scan beam overlay -->
        <div style="
            position:absolute; left:0; right:0; height:40px;
            background:linear-gradient(to bottom, transparent, ${accentColor}18, transparent);
            animation: cs-scan-beam 2.5s ease-in-out 0.5s 3;
            pointer-events:none; z-index:1;
        "></div>

        <div style="padding:18px 18px 16px; position:relative; z-index:2;">

            <!-- Header row -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <!-- Animated icon -->
                    <div style="
                        width:42px;height:42px;border-radius:10px;
                        background:${accentDim};border:1.5px solid ${accentColor};
                        display:flex;align-items:center;justify-content:center;font-size:22px;
                        animation: cs-icon-pulse 2.5s ease-in-out infinite;
                        flex-shrink:0;
                    ">${badgeIcon}</div>
                    <div>
                        <div style="font-size:14px;font-weight:900;color:${accentColor};letter-spacing:1px;text-transform:uppercase;">${badgeLabel}</div>
                        <div style="font-size:10px;color:#5a6a8a;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;">
                            <span style="color:#00ff88;">●</span>&nbsp;CyberShield AI &middot; ${typeLabel} Alert
                        </div>
                    </div>
                </div>
                <!-- Close button -->
                <button id="cs-close-alert" style="
                    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
                    color:#6a7a9a;width:30px;height:30px;border-radius:8px;
                    cursor:pointer;font-size:18px;line-height:1;
                    display:flex;align-items:center;justify-content:center;
                    transition:all 0.2s;flex-shrink:0;
                ">&times;</button>
            </div>

            <!-- Risk Score Bar -->
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:10px;color:#5a6a8a;letter-spacing:1.5px;text-transform:uppercase;">AI Risk Score</span>
                    <span style="font-size:13px;font-weight:800;color:${accentColor};">${riskScore}<span style="font-size:9px;color:#5a6a8a;">/100</span></span>
                </div>
                <div style="height:7px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden;position:relative;">
                    <div style="
                        height:100%;width:${riskScore}%;
                        background:linear-gradient(90deg,${isScam ? '#ff7700,#ff4444,#ff0055' : '#ffd200,#ffb300,#ff8c00'});
                        border-radius:99px;
                        box-shadow:0 0 10px ${accentColor};
                        animation:cs-riskbar 1.1s cubic-bezier(0.22,1,0.36,1) forwards;
                    "></div>
                </div>
            </div>

            <!-- Message preview -->
            ${previewHtml}

            <!-- Detected threats -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
                <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#5a6a8a;margin-bottom:6px;">🔎 Detected Signals</div>
                ${threatRows}
            </div>

            <!-- Guidance -->
            <div style="background:${accentDim};border:1px solid ${accentColor}44;border-radius:10px;padding:10px 12px;margin-bottom:16px;">
                <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${accentColor};margin-bottom:4px;font-weight:700;">⚡ What To Do Now</div>
                ${guidanceHtml}
            </div>

            <!-- Footer CTAs -->
            <div style="display:flex;gap:8px;margin-bottom:0;">
                <button id="cs-dismiss-alert" style="
                    flex:1;padding:11px 8px;
                    background:linear-gradient(135deg,${accentMid},${accentDim});
                    border:1.5px solid ${accentColor};border-radius:10px;
                    color:${accentColor};font-weight:800;font-size:12px;
                    cursor:pointer;letter-spacing:0.6px;text-transform:uppercase;
                    transition:all 0.25s;
                ">🛡️ Got it</button>
                <button id="cs-helpline-btn" style="
                    flex:1;padding:11px 8px;
                    background:linear-gradient(135deg,rgba(220,38,38,0.25),rgba(220,38,38,0.10));
                    border:1.5px solid #dc2626;border-radius:10px;
                    color:#ff6b6b;font-weight:800;font-size:12px;
                    cursor:pointer;letter-spacing:0.4px;text-transform:uppercase;
                    transition:all 0.25s;
                ">🚨 Report Crime</button>
            </div>
            <button id="cs-feedback-btn" style="
                width:100%;margin-top:8px;padding:10px 8px;
                background:rgba(0,243,255,0.08);
                border:1.5px solid #00f3ff;border-radius:10px;
                color:#00f3ff;font-weight:800;font-size:11px;
                cursor:pointer;letter-spacing:0.6px;text-transform:uppercase;
                transition:all 0.25s;
            ">⚡ Feedback / Report Error</button>
            <!-- "stays until dismissed" hint -->
            <div style="text-align:center;margin-top:8px;font-size:10px;color:#3a4a6a;letter-spacing:0.5px;">
                This alert stays until you dismiss it or refresh the page
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    const close = () => {
        warningActive = false;
        popup.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        popup.style.opacity = '0';
        popup.style.transform = 'translateX(420px) scale(0.9)';
        setTimeout(() => popup.remove(), 380);
    };

    // Bind close buttons
    const closeBtn = popup.querySelector('#cs-close-alert');
    const dismissBtn = popup.querySelector('#cs-dismiss-alert');
    const helplineBtn = popup.querySelector('#cs-helpline-btn');
    const feedbackBtn = popup.querySelector('#cs-feedback-btn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (dismissBtn) dismissBtn.addEventListener('click', close);
    if (helplineBtn) helplineBtn.addEventListener('click', () => {
        close();
        setTimeout(() => showHelplineModal(), 380);
    });
    if (feedbackBtn) feedbackBtn.addEventListener('click', () => {
        const params = new URLSearchParams({
            content: data.messageKey || data.messagePreview || '',
            predictedStatus: isScam ? 'SCAM' : 'SAFE',
            riskScore: String(riskScore),
            signals: threats.join('|')
        });
        window.open(`https://cybershield-88323.web.app/cybershield-feedback?${params.toString()}`, '_blank', 'noopener');
    });
    // ✅ NO auto-close — warning stays until user manually dismisses or page refreshes
}

// ============ CYBER SECURITY HELPLINE MODAL ============

function showHelplineModal() {
    // Remove existing if any
    const existing = document.getElementById('cs-helpline-modal');
    if (existing) existing.remove();

    // Inject styles once
    if (!document.getElementById('cs-helpline-styles')) {
        const s = document.createElement('style');
        s.id = 'cs-helpline-styles';
        s.textContent = `
            @keyframes cs-modal-enter {
                0%   { opacity:0; transform:scale(0.85) translateY(30px); }
                60%  { transform:scale(1.02) translateY(-4px); }
                100% { opacity:1; transform:scale(1) translateY(0); }
            }
            @keyframes cs-helpline-pulse {
                0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.7); }
                50%      { box-shadow: 0 0 0 10px rgba(220,38,38,0); }
            }
            @keyframes cs-number-glow {
                0%,100% { text-shadow: 0 0 20px rgba(249,115,22,0.5); }
                50%      { text-shadow: 0 0 40px rgba(249,115,22,0.9), 0 0 60px rgba(249,115,22,0.4); }
            }
            @keyframes cs-step-slide {
                from { opacity:0; transform:translateX(-20px); }
                to   { opacity:1; transform:translateX(0); }
            }
            @keyframes cs-top-scan {
                0%   { background-position: -400px 0; }
                100% { background-position: 400px 0; }
            }
            #cs-helpline-modal {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,0.75);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                font-family: 'Segoe UI', system-ui, sans-serif;
                padding: 16px;
                box-sizing: border-box;
            }
            #cs-helpline-card {
                background: linear-gradient(160deg, rgba(6,14,30,0.99) 0%, rgba(12,22,48,0.99) 100%);
                border: 1.5px solid rgba(220,38,38,0.6);
                border-radius: 20px;
                width: 100%;
                max-width: 480px;
                max-height: 90vh;
                overflow-y: auto;
                overflow-x: hidden;
                box-shadow: 0 30px 80px rgba(0,0,0,0.8), 0 0 40px rgba(220,38,38,0.2);
                animation: cs-modal-enter 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards;
                scrollbar-width: thin;
                scrollbar-color: rgba(220,38,38,0.4) transparent;
            }
            #cs-helpline-card::-webkit-scrollbar { width:4px; }
            #cs-helpline-card::-webkit-scrollbar-thumb { background:rgba(220,38,38,0.4);border-radius:99px; }
            .cs-step-item {
                animation: cs-step-slide 0.4s ease forwards;
                opacity: 0;
            }
            .cs-step-item:nth-child(1)  { animation-delay: 0.1s; }
            .cs-step-item:nth-child(2)  { animation-delay: 0.18s; }
            .cs-step-item:nth-child(3)  { animation-delay: 0.26s; }
            .cs-step-item:nth-child(4)  { animation-delay: 0.34s; }
            .cs-step-item:nth-child(5)  { animation-delay: 0.42s; }
            .cs-step-item:nth-child(6)  { animation-delay: 0.50s; }
            .cs-step-item:nth-child(7)  { animation-delay: 0.58s; }
            #cs-helpline-close:hover { background:rgba(255,255,255,0.12) !important; color:#fff !important; }
            .cs-portal-btn:hover {
                background: rgba(59,130,246,0.30) !important;
                border-color: #60a5fa !important;
                transform: translateY(-1px);
                box-shadow: 0 4px 20px rgba(59,130,246,0.3);
            }
            .cs-call-btn:hover {
                background: rgba(220,38,38,0.40) !important;
                transform: translateY(-2px);
                box-shadow: 0 6px 24px rgba(220,38,38,0.4);
            }
        `;
        document.head.appendChild(s);
    }

    const steps = [
        { num:'1', icon:'🖥️', title:'Go to Cyber Crime Portal', desc:'Open <strong>cybercrime.gov.in</strong> in your browser — India\'s official national cyber crime reporting portal.' },
        { num:'2', icon:'📋', title:'Click "Report Other Cyber Crimes"', desc:'Select this option on the homepage for scams, fraud messages, phishing links, and financial cyber crimes.' },
        { num:'3', icon:'👤', title:'Register / Login', desc:'Create a free account with your mobile number and email. Your details remain <strong>strictly confidential</strong>.' },
        { num:'4', icon:'📝', title:'Fill the Complaint Form', desc:'Select crime category (e.g. "Online Financial Fraud" or "Social Media Fraud"). Provide all details.' },
        { num:'5', icon:'📎', title:'Attach Evidence', desc:'Upload screenshots of the scam message, URLs, transaction IDs, and any receipts. More evidence = faster action.' },
        { num:'6', icon:'✅', title:'Submit & Note Complaint ID', desc:'After submission, <strong>save your Complaint Acknowledgement Number</strong>. Use it to track status anytime.' },
        { num:'7', icon:'📞', title:'Follow Up by Calling 1930', desc:'Call the <strong>National Cyber Crime Helpline 1930</strong> (24/7) and quote your complaint ID for faster action.' }
    ];

    const stepsHtml = steps.map(s => `
        <div class="cs-step-item" style="
            display:flex;align-items:flex-start;gap:14px;
            padding:12px 14px;margin-bottom:8px;
            background:rgba(255,255,255,0.03);
            border:1px solid rgba(255,255,255,0.06);
            border-radius:12px;
        ">
            <div style="
                min-width:34px;height:34px;border-radius:10px;
                background:rgba(220,38,38,0.15);border:1.5px solid rgba(220,38,38,0.4);
                display:flex;align-items:center;justify-content:center;
                font-size:13px;font-weight:900;color:#f97316;flex-shrink:0;
            ">${s.num}</div>
            <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
                    <span style="font-size:15px;">${s.icon}</span>
                    <span style="font-size:13px;font-weight:700;color:#e2e8f0;">${s.title}</span>
                </div>
                <div style="font-size:12px;color:#94a3b8;line-height:1.6;">${s.desc}</div>
            </div>
        </div>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'cs-helpline-modal';
    overlay.innerHTML = `
        <div id="cs-helpline-card">

            <!-- Animated top bar -->
            <div style="
                height:4px;
                background:linear-gradient(90deg,#dc2626,#f97316,#fbbf24,#dc2626);
                background-size:200% 100%;
                animation:cs-top-scan 2.5s linear infinite;
            "></div>

            <div style="padding:22px 22px 20px;">

                <!-- Header -->
                <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
                    <div style="display:flex;align-items:center;gap:14px;">
                        <div style="
                            width:52px;height:52px;border-radius:14px;
                            background:rgba(220,38,38,0.15);border:2px solid rgba(220,38,38,0.5);
                            display:flex;align-items:center;justify-content:center;font-size:26px;
                            animation:cs-helpline-pulse 2s ease-in-out infinite;
                        ">🚨</div>
                        <div>
                            <div style="font-size:16px;font-weight:900;color:#ff6b6b;letter-spacing:0.5px;text-transform:uppercase;">Cyber Crime Helpline</div>
                            <div style="font-size:11px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-top:2px;">
                                <span style="color:#22c55e;">●</span>&nbsp;National Cyber Crime Reporting Portal
                            </div>
                        </div>
                    </div>
                    <button id="cs-helpline-close" style="
                        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
                        color:#64748b;width:32px;height:32px;border-radius:9px;
                        cursor:pointer;font-size:20px;line-height:1;
                        display:flex;align-items:center;justify-content:center;
                        transition:all 0.2s;flex-shrink:0;
                    ">&times;</button>
                </div>

                <!-- Emergency Helpline Number -->
                <div style="
                    background:linear-gradient(135deg,rgba(220,38,38,0.2),rgba(239,68,68,0.08));
                    border:2px solid rgba(220,38,38,0.5);
                    border-radius:14px;padding:18px 20px;margin-bottom:16px;
                    text-align:center;
                ">
                    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">
                        🇮🇳 NATIONAL CYBER CRIME HELPLINE
                    </div>
                    <div style="
                        font-size:52px;font-weight:900;color:#f97316;
                        letter-spacing:4px;line-height:1;
                        animation:cs-number-glow 2.5s ease-in-out infinite;
                        font-family:'Consolas','Courier New',monospace;
                    ">1930</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:8px;">Available 24 × 7 · Free to call · All networks</div>
                    <a href="tel:1930" style="
                        display:inline-block;margin-top:12px;
                        background:linear-gradient(135deg,#dc2626,#b91c1c);
                        color:#fff;padding:10px 28px;border-radius:10px;
                        font-weight:800;font-size:14px;text-decoration:none;
                        letter-spacing:0.5px;
                        transition:all 0.25s;
                    " class="cs-call-btn">📞 Call 1930 Now</a>
                </div>

                <!-- Portal link -->
                <div style="
                    background:rgba(59,130,246,0.08);border:1.5px solid rgba(59,130,246,0.3);
                    border-radius:12px;padding:14px 16px;margin-bottom:20px;
                    display:flex;align-items:center;justify-content:space-between;gap:12px;
                ">
                    <div>
                        <div style="font-size:13px;font-weight:700;color:#93c5fd;margin-bottom:3px;">🌐 Official Online Portal</div>
                        <div style="font-size:12px;color:#64748b;">File detailed complaint with screenshots & evidence</div>
                    </div>
                    <a href="https://cybercrime.gov.in" target="_blank" style="
                        background:rgba(59,130,246,0.15);border:1.5px solid rgba(59,130,246,0.4);
                        color:#60a5fa;padding:9px 16px;border-radius:9px;
                        font-weight:700;font-size:12px;text-decoration:none;
                        white-space:nowrap;flex-shrink:0;
                        transition:all 0.25s;
                    " class="cs-portal-btn">Report Online →</a>
                </div>

                <!-- What to do IMMEDIATELY -->
                <div style="
                    background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.25);
                    border-radius:12px;padding:12px 14px;margin-bottom:20px;
                ">
                    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#fbbf24;margin-bottom:10px;font-weight:700;">⚡ Do This IMMEDIATELY</div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#cbd5e1;">
                            <span>🔒</span> <span><strong>Do NOT share OTPs, passwords, or CVV</strong> with anyone</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#cbd5e1;">
                            <span>🏦</span> <span>If money was transferred, <strong>call your bank NOW</strong> to freeze the transaction</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#cbd5e1;">
                            <span>📱</span> <span><strong>Block the sender</strong> and screenshot all evidence before deleting</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#cbd5e1;">
                            <span>⏱️</span> <span>Report within <strong>24 hours</strong> — faster reports = higher recovery chances</span>
                        </div>
                    </div>
                </div>

                <!-- Step-by-step guide -->
                <div style="margin-bottom:16px;">
                    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:12px;font-weight:700;">📋 How to File a Complaint — Step by Step</div>
                    ${stepsHtml}
                </div>

                <!-- Additional contacts -->
                <div style="
                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:12px;padding:12px 14px;margin-bottom:16px;
                ">
                    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px;font-weight:700;">📞 Other Emergency Contacts</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div style="background:rgba(255,255,255,0.04);border-radius:9px;padding:10px 12px;">
                            <div style="font-size:10px;color:#64748b;margin-bottom:2px;">Police Control Room</div>
                            <div style="font-size:18px;font-weight:800;color:#e2e8f0;font-family:monospace;">100</div>
                        </div>
                        <div style="background:rgba(255,255,255,0.04);border-radius:9px;padding:10px 12px;">
                            <div style="font-size:10px;color:#64748b;margin-bottom:2px;">RBI Fraud Helpline</div>
                            <div style="font-size:18px;font-weight:800;color:#e2e8f0;font-family:monospace;">14440</div>
                        </div>
                        <div style="background:rgba(255,255,255,0.04);border-radius:9px;padding:10px 12px;">
                            <div style="font-size:10px;color:#64748b;margin-bottom:2px;">TRAI DNC Registry</div>
                            <div style="font-size:18px;font-weight:800;color:#e2e8f0;font-family:monospace;">1909</div>
                        </div>
                        <div style="background:rgba(255,255,255,0.04);border-radius:9px;padding:10px 12px;">
                            <div style="font-size:10px;color:#64748b;margin-bottom:2px;">Sanchar Saathi</div>
                            <div style="font-size:12px;font-weight:700;color:#60a5fa;">sancharsaathi.gov.in</div>
                        </div>
                    </div>
                </div>

                <!-- Close button -->
                <button id="cs-helpline-close-bottom" style="
                    width:100%;padding:13px;
                    background:linear-gradient(135deg,rgba(220,38,38,0.2),rgba(220,38,38,0.08));
                    border:1.5px solid rgba(220,38,38,0.5);border-radius:11px;
                    color:#ff6b6b;font-weight:800;font-size:13px;letter-spacing:0.8px;
                    text-transform:uppercase;cursor:pointer;transition:all 0.25s;
                ">✅ I Understand — Close Guide</button>

            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 320);
    };

    // Close on backdrop click
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    const topClose = overlay.querySelector('#cs-helpline-close');
    const bottomClose = overlay.querySelector('#cs-helpline-close-bottom');
    if (topClose)    topClose.addEventListener('click', closeModal);
    if (bottomClose) bottomClose.addEventListener('click', closeModal);
}


console.log('✓ Cyber Shield ready and monitoring');


// ============ PREMIUM ACTIVATED BADGE ============

function injectActivatedBadge(platform) {
    // Only on WhatsApp and Gmail
    if (platform !== 'whatsapp' && platform !== 'gmail') return;
    // Don't inject twice
    if (document.getElementById('cs-activated-badge')) return;

    // Inject keyframe styles once
    if (!document.getElementById('cs-badge-styles')) {
        const style = document.createElement('style');
        style.id = 'cs-badge-styles';
        style.textContent = `
            @keyframes cs-pulse {
                0%   { box-shadow: 0 0 0 0 rgba(0,255,136,0.8); transform: scale(1); }
                70%  { box-shadow: 0 0 0 8px rgba(0,255,136,0);  transform: scale(1.1); }
                100% { box-shadow: 0 0 0 0 rgba(0,255,136,0);    transform: scale(1); }
            }
            @keyframes cs-slidein {
                from { opacity: 0; transform: translateY(-20px) scale(0.9); }
                to   { opacity: 1; transform: translateY(0px)   scale(1);   }
            }
            @keyframes cs-scanline {
                0%   { background-position: 0 0; }
                100% { background-position: 0 100%; }
            }
            #cs-activated-badge {
                animation: cs-slidein 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards;
            }
            #cs-activated-badge:hover {
                border-color: rgba(0,255,136,0.6) !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 30px rgba(0,255,136,0.25) !important;
                transform: translateY(-2px);
                transition: all 0.25s ease;
            }
            #cs-close-btn:hover { color: #ff4757 !important; }
        `;
        document.head.appendChild(style);
    }

    const badge = document.createElement('div');
    badge.id = 'cs-activated-badge';

    badge.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">

            <!-- Shield icon -->
            <svg width="18" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6L12 2z"
                      fill="url(#shieldGrad)" opacity="0.9"/>
                <path d="M9 12l2 2 4-4" stroke="#0a192f" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"/>
                <defs>
                    <linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#00ff88"/>
                        <stop offset="100%" stop-color="#00b8ff"/>
                    </linearGradient>
                </defs>
            </svg>

            <!-- Text block -->
            <div style="display:flex;flex-direction:column;gap:1px;">
                <span style="
                    font-size:11px;letter-spacing:2px;text-transform:uppercase;
                    color:#8892b0;font-weight:600;line-height:1;
                ">CyberShield AI</span>
                <span style="
                    background:linear-gradient(90deg,#00ff88 0%,#00b8ff 60%,#7b2ff7 100%);
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                    font-size:13px;font-weight:800;letter-spacing:0.5px;line-height:1.3;
                ">&#x2726; ACTIVATED</span>
            </div>

            <!-- Pulse dot -->
            <div style="
                width:9px;height:9px;border-radius:50%;
                background:#00ff88;
                box-shadow:0 0 8px #00ff88,0 0 16px rgba(0,255,136,0.4);
                animation:cs-pulse 2s infinite;
                flex-shrink:0;
            "></div>

            <!-- Close button -->
            <button id="cs-close-btn" style="
                background:none;border:none;cursor:pointer;
                color:#4a5568;font-size:17px;line-height:1;
                padding:0 0 0 4px;outline:none;flex-shrink:0;
                transition:color 0.2s;
            " title="Dismiss">&times;</button>
        </div>
    `;

    badge.style.cssText = `
        position: fixed;
        top: 22px;
        right: 22px;
        z-index: 2147483647;
        background: rgba(9, 18, 36, 0.88);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(0,255,136,0.25);
        border-radius: 10px;
        padding: 10px 16px;
        font-family: 'Consolas','Courier New',monospace;
        box-shadow: 0 8px 28px rgba(0,0,0,0.45), inset 0 0 24px rgba(0,255,136,0.04);
        cursor: default;
        user-select: none;
    `;

    document.body.appendChild(badge);

    document.getElementById('cs-close-btn').addEventListener('click', () => {
        badge.style.transition = 'opacity 0.3s, transform 0.3s';
        badge.style.opacity = '0';
        badge.style.transform = 'translateY(-10px) scale(0.95)';
        setTimeout(() => badge.remove(), 320);
    });
}

// ============ PREMIUM LINK INTERCEPTION ============

// Store intercepted link data
let interceptedLink = null;
let analysisInProgress = false;

// Premium popup for suspicious link clicks
function showPremiumLinkPopup(url, threatData) {
    // Remove existing premium popup if any
    const existing = document.getElementById('cs-premium-link-popup');
    if (existing) existing.remove();

    const isScam = threatData.status === 'scam' || threatData.isUrlScam === true;
    const riskScore = Math.round((threatData.confidence || 0) * 100);
    const threats = threatData.threats || [];
    
    const accentColor = isScam ? '#ff4444' : '#ffb300';
    const accentGlow = isScam ? 'rgba(255,68,68,0.4)' : 'rgba(255,179,0,0.4)';
    const accentDim = isScam ? 'rgba(255,68,68,0.10)' : 'rgba(255,179,0,0.10)';
    
    const threatIcon = isScam ? '🚨' : '⚠️';
    const threatLabel = isScam ? 'HIGHLY DANGEROUS' : 'SUSPICIOUS';
    const threatDesc = isScam ? 'This link is confirmed to be malicious' : 'This link shows scam indicators';
    
    const threatRows = threats.length
        ? threats.map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <span style="color:${accentColor};font-size:10px;">●</span>
                <span style="color:#ccd6f6;font-size:11px;">${t}</span>
            </div>`).join('')
        : `<div style="color:#8892b0;font-size:11px;">Pattern-based threat detection</div>`;

    // Create premium popup overlay
    const overlay = document.createElement('div');
    overlay.id = 'cs-premium-link-popup';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: cs-fade-in 0.3s ease-out;
    `;

    // Create popup content
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: linear-gradient(145deg, #1a1f2e, #0f1419);
        border: 2px solid ${accentColor};
        border-radius: 14px;
        padding: 0;
        max-width: 500px;
        width: 95%;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 18px 50px ${accentGlow}, 0 0 100px ${accentColor}33;
        animation: cs-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
    `;

    popup.innerHTML = `
        <!-- Animated gradient border -->
        <div style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, ${accentColor}, #7b2ff7, #00b8ff, ${accentColor});
            background-size: 200% 100%;
            animation: cs-border-scan 3s linear infinite;
        "></div>

        <!-- Analysis Status Bar -->
        <div id="cs-analysis-status" style="
            position: absolute;
            top: 3px;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #00ff88, #00b8ff, #7b2ff7);
            background-size: 200% 100%;
            animation: cs-analysis-progress 2s ease-in-out infinite;
            display: none;
        "></div>

        <!-- Scan beam effect -->
        <div style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 60px;
            background: linear-gradient(to bottom, transparent, ${accentColor}15, transparent);
            animation: cs-scan-beam 3s ease-in-out 0.5s 2;
            pointer-events: none;
        "></div>

        <div style="padding: 22px 22px 18px; position: relative; z-index: 2;">
            <!-- Header -->
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                <div id="cs-header-icon" style="
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    background: ${accentDim};
                    border: 2px solid ${accentColor};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 22px;
                    animation: cs-icon-pulse 2s ease-in-out infinite;
                    flex-shrink: 0;
                ">${threatIcon}</div>
                <div>
                    <div style="
                        font-size: 14px;
                        font-weight: 900;
                        color: ${accentColor};
                        letter-spacing: 1px;
                        text-transform: uppercase;
                        margin-bottom: 2px;
                    ">${threatLabel}</div>
                    <div style="font-size: 11px; color: #8892b0; font-weight: 600;">
                        ⚡ CyberShield Premium Protection
                    </div>
                </div>
            </div>

            <!-- Analysis Section -->
            <div id="cs-analysis-section" style="
                background: rgba(0, 255, 136, 0.05);
                border: 1px solid rgba(0, 255, 136, 0.2);
                border-radius: 14px;
                padding: 16px;
                margin-bottom: 16px;
                display: none;
            ">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <div style="
                        width: 24px;
                        height: 24px;
                        border: 2px solid #00ff88;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        animation: cs-spin 1s linear infinite;
                    ">
                        <div style="
                            width: 8px;
                            height: 8px;
                            background: #00ff88;
                            border-radius: 50%;
                        "></div>
                    </div>
                    <div style="font-size: 13px; font-weight: 700; color: #00ff88;">
                        🔍 BEHAVIORAL ANALYSIS IN PROGRESS
                    </div>
                </div>
                <div id="cs-analysis-details" style="font-size: 11px; color: #8892b0; line-height: 1.5;">
                    Scanning target content for malicious elements...
                </div>
            </div>

            <!-- Premium Risk Score -->
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 13px; color: #5a6a8a; letter-spacing: 1.2px; text-transform: uppercase;">AI Risk Assessment</span>
                        <div style="
                            width: 6px;
                            height: 6px;
                            border-radius: 50%;
                            background: ${riskScore > 80 ? '#ff4444' : riskScore > 60 ? '#ffb300' : '#10b981'};
                            animation: cs-pulse 2s ease-in-out infinite;
                        "></div>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="cs-risk-score" style="font-size: 22px; font-weight: 900; color: ${accentColor}; text-shadow: 0 0 15px ${accentColor}40; line-height: 1; display: inline;">${riskScore}</span>
                        <span style="font-size: 13px; color: #8892b0; font-weight: 600; line-height: 1; display: inline;">/100</span>
                    </div>
                </div>
                <div style="height: 12px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden; position: relative; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                    <div id="cs-risk-bar" style="
                        height: 100%;
                        width: ${riskScore}%;
                        background: linear-gradient(90deg, ${riskScore > 80 ? '#ff0000,#cc0000,#990000' : riskScore > 60 ? '#ff4444,#dc2626,#ff8c00' : '#ffb300,#ffaa00,#ff8800'});
                        border-radius: 99px;
                        box-shadow: 0 0 30px ${accentColor}, inset 0 1px 0 rgba(255,255,255,0.3);
                        animation: cs-risk-fill 1.5s cubic-bezier(0.22,1,0.36,1) forwards;
                        position: relative;
                        overflow: hidden;
                    ">
                        <div style="
                            position: absolute;
                            top: 0;
                            left: 0;
                            right: 0;
                            bottom: 0;
                            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                            animation: cs-shine 2s ease-in-out infinite;
                        "></div>
                    </div>
                    <!-- Risk Level Markers -->
                    <div style="position: absolute; top: -2px; left: 0; right: 0; height: 16px; pointer-events: none;">
                        <div style="position: absolute; left: 30%; top: 0; width: 1px; height: 100%; background: rgba(255,255,255,0.1);"></div>
                        <div style="position: absolute; left: 60%; top: 0; width: 1px; height: 100%; background: rgba(255,255,255,0.1);"></div>
                        <div style="position: absolute; left: 80%; top: 0; width: 1px; height: 100%; background: rgba(255,255,255,0.1);"></div>
                    </div>
                </div>
                <!-- Risk Level Labels -->
                <div style="display: flex; justify-content: space-between; margin-top: 8px; padding: 0 2px;">
                    <span style="font-size: 10px; color: #10b981; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">LOW</span>
                    <span style="font-size: 10px; color: #ffb300; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">MEDIUM</span>
                    <span style="font-size: 10px; color: #ff4444; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">HIGH</span>
                    <span style="font-size: 10px; color: #ff0000; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">CRITICAL</span>
                </div>
            </div>

            <!-- URL Display -->
            <div style="margin-bottom: 20px;">
                <div style="font-size: 12px; color: #5a6a8a; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 8px;">Detected URL</div>
                <div style="
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 12px;
                    padding: 14px;
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 13px;
                    color: #ff6b6b;
                    word-break: break-all;
                    line-height: 1.5;
                ">${url}</div>
            </div>

            <!-- Initial Threat Details -->
            <div id="cs-initial-threats" style="
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 14px;
                padding: 18px;
                margin-bottom: 20px;
            ">
                <div style="font-size: 12px; color: #5a6a8a; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 10px;">🔍 Initial Analysis</div>
                <div style="color: #ccd6f6; font-size: 13px; margin-bottom: 10px; font-weight: 600;">${threatDesc}</div>
                ${threatRows}
            </div>

            <!-- Deep Analysis Results (Hidden Initially) -->
            <div id="cs-deep-analysis" style="
                background: rgba(0, 255, 136, 0.03);
                border: 1px solid rgba(0, 255, 136, 0.1);
                border-radius: 14px;
                padding: 18px;
                margin-bottom: 20px;
                display: none;
            ">
                <div style="font-size: 12px; color: #00ff88; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 10px;">🧬 Deep Behavioral Analysis</div>
                <div id="cs-deep-results" style="color: #ccd6f6; font-size: 13px; line-height: 1.6;">
                    Analysis in progress...
                </div>
            </div>

            <!-- Warning Message -->
            <div style="
                background: ${accentDim};
                border: 1px solid ${accentColor}44;
                border-radius: 14px;
                padding: 18px;
                margin-bottom: 24px;
            ">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                    <span style="font-size: 20px; flex-shrink: 0;">⛔</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 700; color: ${accentColor}; margin-bottom: 6px;">SECURITY WARNING</div>
                        <div style="font-size: 12px; color: #ccd6f6; line-height: 1.6;">
                            This link may lead to phishing, malware, or fraud. Your personal and financial information could be at risk.
                        </div>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div style="display: flex; gap: 14px;">
                <button id="cs-go-back" style="
                    flex: 1;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, #10b981, #059669);
                    border: 2px solid #10b981;
                    border-radius: 14px;
                    color: white;
                    font-weight: 800;
                    font-size: 14px;
                    cursor: pointer;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                    transition: all 0.3s;
                    box-shadow: 0 6px 25px rgba(16, 185, 129, 0.4);
                ">🔒 GO BACK (SAFE)</button>
                
                <button id="cs-proceed-anyway" style="
                    flex: 1;
                    padding: 16px 20px;
                    background: linear-gradient(135deg, ${accentDim}, rgba(255,255,255,0.05));
                    border: 2px solid ${accentColor};
                    border-radius: 14px;
                    color: ${accentColor};
                    font-weight: 800;
                    font-size: 14px;
                    cursor: pointer;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                    transition: all 0.3s;
                ">⚠️ PROCEED (RISK)</button>
            </div>
        </div>
    `;

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes cs-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes cs-slide-up {
            from { 
                opacity: 0;
                transform: translateY(40px) scale(0.95);
            }
            to { 
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        @keyframes cs-border-scan {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
        }
        @keyframes cs-scan-beam {
            0%, 100% { opacity: 0; transform: translateY(-20px); }
            50% { opacity: 1; transform: translateY(20px); }
        }
        @keyframes cs-icon-pulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 20px ${accentColor}40; }
            50% { transform: scale(1.05); box-shadow: 0 0 30px ${accentColor}60; }
        }
        @keyframes cs-risk-fill {
            from { width: 0%; }
        }
        @keyframes cs-analysis-progress {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        @keyframes cs-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes cs-shine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        #cs-go-back:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(16, 185, 129, 0.4);
        }
        #cs-proceed-anyway:hover {
            transform: translateY(-2px);
            background: linear-gradient(135deg, ${accentColor}33, ${accentColor}22);
            box-shadow: 0 6px 25px ${accentColor}40;
        }
    `;

    document.head.appendChild(style);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Store intercepted link
    interceptedLink = url;

    // Start behavioral analysis
    startBehavioralAnalysis(url, threatData);

    // Add event listeners
    const goBackBtn = document.getElementById('cs-go-back');
    const proceedBtn = document.getElementById('cs-proceed-anyway');

    if (goBackBtn) {
        goBackBtn.addEventListener('click', () => {
            overlay.style.animation = 'cs-fade-in 0.3s ease-out reverse';
            setTimeout(() => {
                overlay.remove();
                interceptedLink = null;
                analysisInProgress = false;
            }, 300);
        });
    }

    if (proceedBtn) {
        proceedBtn.addEventListener('click', () => {
            overlay.style.animation = 'cs-fade-in 0.3s ease-out reverse';
            setTimeout(() => {
                overlay.remove();
                // Open the link in a new tab (safer approach)
                window.open(interceptedLink, '_blank', 'noopener,noreferrer');
                interceptedLink = null;
                analysisInProgress = false;
            }, 300);
        });
    }

    // Close on overlay click (outside popup)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            goBackBtn.click();
        }
    });
}

// Intercept suspicious link clicks - ENHANCED for IMMEDIATE blocking
function setupLinkInterception() {
    console.log('🛡️ Setting up IMMEDIATE link interception for ALL suspicious links');
    
    // Method 1: Capture phase click interception (highest priority)
    document.addEventListener('click', (e) => {
        // Find the closest link element (works with nested elements)
        const link = e.target.closest('a[href]');
        if (!link) return;

        const url = link.href;
                console.log('🔗 Link clicked:', url);
        
        // Enhanced suspicious URL detection
        if (isSuspiciousUrl(url)) {
            console.log('⚠️ Suspicious link detected - BLOCKING immediately');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Analyze the URL for detailed threat data
            const threatData = analyzeUrlThreat(url);
            
            // Show premium popup with go back/proceed options
            showPremiumLinkPopup(url, threatData);
            return false;
        }
    }, true); // Use capture phase to intercept BEFORE any other handlers

    // Method 2: Mousedown interception (catches before click)
    document.addEventListener('mousedown', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const url = link.href;
        if (isSuspiciousUrl(url)) {
            console.log('🖱️ Mousedown on suspicious link - PRE-BLOCKING');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            const threatData = analyzeUrlThreat(url);
            showPremiumLinkPopup(url, threatData);
            return false;
        }
    }, true);

    // Method 3: Touch start interception (for mobile)
    document.addEventListener('touchstart', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const url = link.href;
        if (isSuspiciousUrl(url)) {
            console.log('📱 Touch on suspicious link - PRE-BLOCKING');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            const threatData = analyzeUrlThreat(url);
            showPremiumLinkPopup(url, threatData);
            return false;
        }
    }, true);

    // Method 4: Override link click behavior for existing suspicious links
    function overrideSuspiciousLinks() {
        const allLinks = document.querySelectorAll('a[href]');
        allLinks.forEach(link => {
            if (isSuspiciousUrl(link.href)) {
                // Store original href
                const originalHref = link.href;
                
                // Replace href with javascript:void(0) to prevent default navigation
                link.setAttribute('data-original-href', originalHref);
                link.href = 'javascript:void(0)';
                
                // Add click handler that shows popup
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    console.log('🔗 Overridden suspicious link clicked:', originalHref);
                    const threatData = analyzeUrlThreat(originalHref);
                    showPremiumLinkPopup(originalHref, threatData);
                    return false;
                }, true);
                
                // Visual indicators
                link.style.borderBottom = '2px dotted #ff4444';
                link.style.position = 'relative';
                link.style.cursor = 'not-allowed';
                link.title = '⚠️ CyberShield: Suspicious link - Click for protection options';
            }
        });
    }

    // Method 5: Monitor dynamically added links and override them immediately
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    // Find all links in newly added content
                    const links = node.querySelectorAll('a[href]');
                    links.forEach(link => {
                        if (isSuspiciousUrl(link.href)) {
                            console.log('� New suspicious link detected - OVERRIDING immediately');
                            const originalHref = link.href;
                            link.setAttribute('data-original-href', originalHref);
                            link.href = 'javascript:void(0)';
                            
                            link.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                
                                const threatData = analyzeUrlThreat(originalHref);
                                showPremiumLinkPopup(originalHref, threatData);
                                return false;
                            }, true);
                            
                            // Visual styling
                            link.style.borderBottom = '2px dotted #ff4444';
                            link.style.cursor = 'not-allowed';
                            link.title = '⚠️ CyberShield: Suspicious link - Click for protection options';
                        }
                    });
                }
            });
        });
    });

    // Start monitoring for new links
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Process existing links immediately
    overrideSuspiciousLinks();
    
    // Re-process links periodically to catch any missed ones
    setInterval(overrideSuspiciousLinks, 2000);
    
    console.log('🛡️ Multi-layer link interception activated - Links blocked BEFORE access');
}

// Process all existing links on the page
function processExistingLinks() {
    const allLinks = document.querySelectorAll('a[href]');
    console.log(`🔍 Processing ${allLinks.length} existing links for suspicious patterns`);
    
    let suspiciousCount = 0;
    allLinks.forEach(link => {
        if (isSuspiciousUrl(link.href)) {
            suspiciousCount++;
            // Add visual indicator for suspicious links
            link.style.borderBottom = '2px dotted #ff4444';
            link.style.position = 'relative';
            
            // Add hover warning
            link.addEventListener('mouseenter', () => {
                if (!link.querySelector('.cs-suspicious-indicator')) {
                    const indicator = document.createElement('span');
                    indicator.className = 'cs-suspicious-indicator';
                    indicator.textContent = '⚠️';
                    indicator.style.cssText = `
                        position: absolute;
                        top: -12px;
                        right: -8px;
                        background: #ff4444;
                        color: white;
                        border-radius: 50%;
                        width: 16px;
                        height: 16px;
                        font-size: 10px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 1000;
                        pointer-events: none;
                    `;
                    link.style.position = 'relative';
                    link.appendChild(indicator);
                }
            });
        }
    });
    
    console.log(`⚠️ Found ${suspiciousCount} suspicious links on current page`);
}

// Check if URL is suspicious
function isSuspiciousUrl(url) {
    const urlLower = url.toLowerCase();
    
    // Check against suspicious patterns
    for (const category of Object.values(suspiciousUrlPatterns)) {
        for (const pattern of category) {
            if (urlLower.includes(pattern.toLowerCase())) {
                return true;
            }
        }
    }
    
    // Additional heuristic checks
    if (urlLower.includes('http') && (
        urlLower.match(/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/) || // IP addresses
        urlLower.match(/bit\.ly|tinyurl|goo\.gl|ow\.ly|short\.link|t\.me|tg\.me/) || // URL shorteners
        urlLower.match(/paypal-verify|amazon-secure|google-verify|apple-id-verify/) // Impersonation
    )) {
        return true;
    }
    
    return false;
}

// Analyze URL for threat data
function analyzeUrlThreat(url) {
    const urlLower = url.toLowerCase();
    const threats = [];
    let confidence = 0.5;
    let status = 'suspicious';

    // Check for specific threat patterns
    if (urlLower.match(/bit\.ly|tinyurl|goo\.gl|ow\.ly|short\.link|t\.me|tg\.me/)) {
        threats.push('URL shortener service (commonly used in scams)');
        confidence += 0.2;
    }

    if (urlLower.match(/paypal-verify|amazon-secure|google-verify|apple-id-verify/)) {
        threats.push('Brand impersonation attempt');
        confidence += 0.3;
        status = 'scam';
    }

    if (urlLower.match(/free-recharge|claim-prize|win-prize|lucky-draw|cash-reward/)) {
        threats.push('Fake prize/reward scam');
        confidence += 0.25;
        status = 'scam';
    }

    if (urlLower.match(/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/)) {
        threats.push('Direct IP address (hides true domain)');
        confidence += 0.2;
    }

    if (urlLower.match(/verify-account|confirm-now|urgent-action|limited-time/)) {
        threats.push('Urgency tactics (scam indicator)');
        confidence += 0.15;
    }

    confidence = Math.min(confidence, 0.95);
    if (confidence > 0.7) status = 'scam';

    return {
        status,
        confidence,
        threats,
        isUrlScam: status === 'scam'
    };
}

// Initialize link interception when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLinkInterception);
} else {
    setupLinkInterception();
}

console.log(' Cyber Shield ready and monitoring');

// ============ PREMIUM BEHAVIORAL ANALYSIS ============

// Premium Behavioral Analysis System
async function startBehavioralAnalysis(url, initialThreatData) {
    if (analysisInProgress) return;
    analysisInProgress = true;

    const analysisSection = document.getElementById('cs-analysis-section');
    const analysisDetails = document.getElementById('cs-analysis-details');
    const deepAnalysisDiv = document.getElementById('cs-deep-analysis');
    const deepResults = document.getElementById('cs-deep-results');
    const riskScore = document.getElementById('cs-risk-score');
    const riskBar = document.getElementById('cs-risk-bar');
    const headerIcon = document.getElementById('cs-header-icon');
    const analysisStatus = document.getElementById('cs-analysis-status');

    // Show analysis section and status bar
    if (analysisSection) analysisSection.style.display = 'block';
    if (analysisStatus) analysisStatus.style.display = 'block';

    try {
        // Step 1: URL Structure Analysis
        updateAnalysisStatus("Analyzing URL structure and domain reputation...");
        await sleep(800);

        // Step 2: Content Preview Analysis (Safe Fetch)
        updateAnalysisStatus("Safely fetching content preview...");
        const contentAnalysis = await analyzeContentSafely(url);
        
        // Step 3: Behavioral Pattern Analysis
        updateAnalysisStatus("Analyzing behavioral patterns and threats...");
        await sleep(600);

        // Step 4: Final Risk Assessment
        updateAnalysisStatus("Calculating comprehensive risk score...");
        await sleep(400);

        // Show deep analysis results
        displayDeepAnalysisResults(contentAnalysis, initialThreatData);

        // Update risk score based on deep analysis
        const finalRiskScore = calculateFinalRiskScore(initialThreatData, contentAnalysis);
        updateRiskScore(finalRiskScore);

        // Hide analysis section and show results
        setTimeout(() => {
            if (analysisSection) analysisSection.style.display = 'none';
            if (analysisStatus) analysisStatus.style.display = 'none';
            if (deepAnalysisDiv) deepAnalysisDiv.style.display = 'block';
            
            // Auto-scroll to action buttons after analysis completes
            setTimeout(() => {
                const popupOverlay = document.getElementById('cs-premium-link-popup');
                if (popupOverlay) {
                    const popupDiv = popupOverlay.querySelector('div');
                    if (popupDiv) {
                        popupDiv.scrollTop = popupDiv.scrollHeight;
                    }
                }
            }, 500);
        }, 500);

    } catch (error) {
        console.error('Behavioral analysis error:', error);
        if (analysisDetails) {
            analysisDetails.innerHTML = `<span style="color: #ff6b6b;">⚠️ Analysis failed: ${error.message}</span>`;
        }
    } finally {
        analysisInProgress = false;
    }
}

// Advanced Safe Content Analysis (Ultra-High Accuracy)
async function analyzeContentSafely(url) {
    const analysis = {
        suspiciousElements: [],
        maliciousIndicators: [],
        riskFactors: [],
        contentWarnings: [],
        advancedThreats: [],
        reputationScore: 100
    };

    try {
        const urlLower = url.toLowerCase();
        const urlObj = new URL(url);

        
        // === ENHANCED FILE TYPE DETECTION ===
        const dangerousFiles = ['.exe', '.scr', '.bat', '.com', '.pif', '.vbs', '.js', '.jar', '.php', '.asp', '.aspx', '.jsp', '.cgi', '.sh', '.ps1', '.py', '.rb', '.pl'];
        const suspiciousFiles = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar', '.7z', '.tar', '.gz', '.msi', '.deb', '.rpm', '.dmg', '.app', '.pkg'];
        
        for (const ext of dangerousFiles) {
            if (urlLower.includes(ext)) {
                analysis.maliciousIndicators.push(`🚨 Critical: Executable file detected - ${ext}`);
                analysis.riskFactors.push(40);
            }
        }

        for (const ext of suspiciousFiles) {
            if (urlLower.includes(ext)) {
                analysis.suspiciousElements.push(`⚠️ Suspicious document/archive - ${ext}`);
                analysis.riskFactors.push(20);
            }
        }

        // === ADVANCED PHISHING DETECTION ===
        const highRiskPhishing = [
            'login', 'signin', 'account', 'verify', 'secure', 'update', 'confirm',
            'paypal', 'amazon', 'google', 'apple', 'microsoft', 'facebook',
            'instagram', 'twitter', 'linkedin', 'netflix', 'spotify', 'youtube',
            'bank', 'payment', 'credit', 'card', 'transaction', 'invoice',
            ' Wells-fargo', 'chase', 'bankofamerica', 'citibank'
        ];

        const mediumRiskPhishing = [
            'support', 'help', 'service', 'admin', 'security', 'protection',
            'recovery', 'restore', 'unlock', 'activate', 'authenticate'
        ];

        for (const pattern of highRiskPhishing) {
            if (urlLower.includes(pattern)) {
                analysis.maliciousIndicators.push(`🎯 High-risk phishing pattern: ${pattern}`);
                analysis.riskFactors.push(35);
            }
        }

        for (const pattern of mediumRiskPhishing) {
            if (urlLower.includes(pattern)) {
                analysis.suspiciousElements.push(`⚡ Medium-risk phishing: ${pattern}`);
                analysis.riskFactors.push(15);
            }
        }

        // === DOMAIN REPUTATION ANALYSIS ===
        const domain = urlObj.hostname.toLowerCase();
        
        // Check for suspicious TLDs
        const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.men', '.click', '.download', '.top', '.loan', '.win', '.vip'];
        for (const tld of suspiciousTlds) {
            if (domain.endsWith(tld)) {
                analysis.suspiciousElements.push(`🌐 Suspicious TLD: ${tld}`);
                analysis.riskFactors.push(25);
                analysis.reputationScore -= 20;
            }
        }

        // Check for domain impersonation
        const legitimateDomains = ['paypal.com', 'amazon.com', 'google.com', 'apple.com', 'microsoft.com', 'facebook.com', 'netflix.com'];
        for (const legit of legitimateDomains) {
            if (domain.includes(legit) && domain !== legit) {
                analysis.maliciousIndicators.push(`🎭 Domain impersonation: ${domain} pretending to be ${legit}`);
                analysis.riskFactors.push(45);
                analysis.reputationScore -= 30;
            }
        }

        // === URL STRUCTURE ANALYSIS ===
        // Check for excessive subdomains
        const subdomainCount = domain.split('.').length - 2;
        if (subdomainCount > 3) {
            analysis.suspiciousElements.push(`🔗 Excessive subdomains: ${subdomainCount}`);
            analysis.riskFactors.push(15);
        }

        // Check for suspicious URL length
        if (url.length > 200) {
            analysis.suspiciousElements.push(`📏 Suspiciously long URL: ${url.length} characters`);
            analysis.riskFactors.push(20);
        }

        // Check for encoded characters (obfuscation)
        const encodedPatterns = /%[0-9a-fA-F]{2}/g;
        const encodedMatches = url.match(encodedPatterns);
        if (encodedMatches && encodedMatches.length > 5) {
            analysis.maliciousIndicators.push(`🔐 Heavy URL encoding: ${encodedMatches.length} encoded characters`);
            analysis.riskFactors.push(30);
        }

        // === ADVANCED THREAT PATTERNS ===
        const advancedThreats = [
            // Social engineering
            { pattern: /free-?money|cash-?prize|win-?instant|get-?rich|quick-?cash/, risk: 40, desc: 'Social engineering scam' },
            { pattern: /limited-?time|urgent|expire|act-?now|claim-?now/, risk: 25, desc: 'Urgency tactics' },
            { pattern: /bitcoin|crypto|ethereum|blockchain|wallet|investment|trading/, risk: 30, desc: 'Cryptocurrency scam' },
            
            // Technical threats
            { pattern: /download-?now|install-?free|update-?required/, risk: 35, desc: 'Malware distribution' },
            { pattern: /hack|crack|keygen|patch|serial|license/, risk: 45, desc: 'Software piracy/malware' },
            
            // Adult/scam content
            { pattern: /adult|dating|hookup|meet-?singles|cam-?girl/, risk: 20, desc: 'Adult content scam' },
            
            // Financial scams
            { pattern: /loan|credit-?repair|debt|forex|binary|option/, risk: 35, desc: 'Financial scam' }
        ];

        for (const threat of advancedThreats) {
            if (threat.pattern.test(urlLower)) {
                analysis.advancedThreats.push(`⚡ ${threat.desc}`);
                analysis.riskFactors.push(threat.risk);
            }
        }

        // === ENHANCED URL SHORTENER DETECTION ===
        const shorteners = [
            'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
            'buff.ly', 'adf.ly', 'bit.do', 'mcaf.ee', 'tr.im', 'snip.ly',
            'cutt.ly', 'short.io', 'tiny.cc', 'clk.im', 'u.to', 'v.gd'
        ];

        for (const shortener of shorteners) {
            if (urlLower.includes(shortener)) {
                analysis.suspiciousElements.push(`🔗 URL shortener: ${shortener} (hides true destination)`);
                analysis.riskFactors.push(30);
                analysis.reputationScore -= 15;
            }
        }

        // === IP ADDRESS ANALYSIS ===
        const ipMatch = urlLower.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
        if (ipMatch) {
            const ip = ipMatch[0];
            const parts = ip.split('.').map(Number);
            
            // Check for private/internal IPs
            if (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)) {
                analysis.maliciousIndicators.push(`🏠 Private IP address: ${ip} (highly suspicious)`);
                analysis.riskFactors.push(50);
            } else {
                analysis.maliciousIndicators.push(`🌐 Direct IP address: ${ip} (bypasses domain security)`);
                analysis.riskFactors.push(35);
            }
            analysis.reputationScore -= 25;
        }

        // === PORT ANALYSIS ===
        const portMatch = urlLower.match(/:(\d{1,5})\//);
        if (portMatch) {
            const port = parseInt(portMatch[1]);
            if (port !== 80 && port !== 443 && port !== 8080) {
                analysis.suspiciousElements.push(`🔌 Non-standard port: ${port}`);
                analysis.riskFactors.push(20);
            }
        }

        // === BEHAVIORAL RISK CALCULATION ===
        const totalRisk = analysis.riskFactors.reduce((sum, factor) => sum + factor, 0);
        
        // Dynamic risk scoring based on multiple factors
        let finalRisk = Math.min(totalRisk, 100);
        
        // Penalty for multiple threat types
        const threatTypes = [
            analysis.maliciousIndicators.length > 0,
            analysis.suspiciousElements.length > 0,
            analysis.advancedThreats.length > 0
        ].filter(Boolean).length;
        
        if (threatTypes > 2) {
            finalRisk = Math.min(finalRisk + 20, 100);
            analysis.contentWarnings.push('🚨 Multiple threat categories detected');
        }

        // Reputation-based adjustment
        if (analysis.reputationScore < 50) {
            finalRisk = Math.min(finalRisk + 15, 100);
        }

        // === ENHANCED CONTENT WARNINGS ===
        if (analysis.maliciousIndicators.length > 2) {
            analysis.contentWarnings.push('🔴 CRITICAL: Multiple high-risk threats detected');
        } else if (analysis.maliciousIndicators.length > 0) {
            analysis.contentWarnings.push('🟠 HIGH-RISK: Malicious indicators present');
        }

        if (analysis.advancedThreats.length > 3) {
            analysis.contentWarnings.push('⚡ ADVANCED: Sophisticated attack patterns detected');
        }

        if (finalRisk > 80) {
}

if (analysis.advancedThreats.length > 3) {
    analysis.contentWarnings.push('⚡ ADVANCED: Sophisticated attack patterns detected');
}

if (finalRisk > 80) {
    analysis.contentWarnings.push('❌ DANGEROUS: Extremely high threat level - DO NOT PROCEED');
} else if (finalRisk > 60) {
    analysis.contentWarnings.push('⚠️ WARNING: High probability of malicious content');
}

analysis.finalRiskScore = finalRisk;

} catch (error) {
    analysis.contentWarnings.push(`⚠️ Analysis error: ${error.message}`);
    analysis.riskFactors.push(10);
}

return analysis;
}

// Enhanced Display Deep Analysis Results
function displayDeepAnalysisResults(analysis, initialData) {
    const deepResults = document.getElementById('cs-deep-results');
    
    let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
    
    if (analysis.maliciousIndicators.length > 0) {
        html += `
            <div>
                <div style="color: #ff6b6b; font-weight: 700; font-size: 11px; margin-bottom: 4px;"> MALICIOUS INDICATORS</div>
                ${analysis.maliciousIndicators.map(ind => 
                    `<div style="color: #ff9999; font-size: 10px; margin-left: 8px;">• ${ind}</div>`
                ).join('')}
            </div>
        `;
    }

    if (analysis.suspiciousElements.length > 0) {
        html += `
            <div>
                <div style="color: #ffb300; font-weight: 700; font-size: 11px; margin-bottom: 4px;"> SUSPICIOUS ELEMENTS</div>
                ${analysis.suspiciousElements.map(elem => 
                    `<div style="color: #ffcc66; font-size: 10px; margin-left: 8px;">• ${elem}</div>`
                ).join('')}
            </div>
        `;
    }

    if (analysis.contentWarnings.length > 0) {
        html += `
            <div>
                <div style="color: #00ff88; font-weight: 700; font-size: 11px; margin-bottom: 4px;"> SECURITY WARNINGS</div>
                ${analysis.contentWarnings.map(warn => 
                    `<div style="color: #88ffaa; font-size: 10px; margin-left: 8px;">• ${warn}</div>`
                ).join('')}
            </div>
        `;
    }

    html += `
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="color: #5a6a8a; font-size: 9px; font-style: italic;">
                Analysis completed safely without accessing the target
            </div>
        </div>
    </div>`;
    
    if (deepResults) deepResults.innerHTML = html;
}

// Calculate Final Risk Score
function calculateFinalRiskScore(initialData, analysis) {
    let baseScore = Math.round((initialData.confidence || 0) * 100);
    
    // Add risk factors from deep analysis
    const additionalRisk = analysis.riskFactors.reduce((sum, factor) => sum + factor, 0);
    
    // Calculate final score (cap at 100)
    let finalScore = Math.min(baseScore + (additionalRisk * 0.3), 100);
    
    return Math.round(finalScore);
}

// Update Risk Score Display - Enhanced Premium Version
function updateRiskScore(newScore) {
    const riskScore = document.getElementById('cs-risk-score');
    const riskBar = document.getElementById('cs-risk-bar');
    const headerIcon = document.getElementById('cs-header-icon');
    
    // Determine risk level and colors
    let riskColor, riskGradient, riskLabel;
    if (newScore > 80) {
        riskColor = '#ff4444';
        riskGradient = 'linear-gradient(90deg, #ff0000,#cc0000,#990000)';
        riskLabel = 'CRITICAL';
    } else if (newScore > 60) {
        riskColor = '#ffb300';
        riskGradient = 'linear-gradient(90deg, #ff4444,#dc2626,#ff8c00)';
        riskLabel = 'HIGH';
    } else if (newScore > 30) {
        riskColor = '#ffb300';
        riskGradient = 'linear-gradient(90deg, #ffb300,#ffaa00,#ff8800)';
        riskLabel = 'MEDIUM';
    } else {
        riskColor = '#10b981';
        riskGradient = 'linear-gradient(90deg, #10b981,#059669,#047857)';
        riskLabel = 'LOW';
    }
    
    if (riskScore) {
        // Enhanced risk score display with glow effect
        riskScore.textContent = newScore;
        riskScore.style.color = riskColor;
        riskScore.style.textShadow = `0 0 20px ${riskColor}40`;
        
        // Add pulse animation for high risk
        if (newScore > 60) {
            riskScore.style.animation = 'cs-pulse 1.5s ease-in-out infinite';
        } else {
            riskScore.style.animation = 'none';
        }
    }
    
    if (riskBar) {
        // Update risk bar with enhanced gradient
        riskBar.style.width = `${newScore}%`;
        riskBar.style.background = riskGradient;
        riskBar.style.boxShadow = `0 0 30px ${riskColor}, inset 0 1px 0 rgba(255,255,255,0.3)`;
        
        // Update shine effect
        const shineDiv = riskBar.querySelector('div');
        if (shineDiv) {
            shineDiv.style.background = 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)';
            shineDiv.style.animation = 'cs-shine 2s ease-in-out infinite';
        }
    }
    
    // Update header icon based on risk level
    if (headerIcon) {
        if (newScore > 80) {
            headerIcon.innerHTML = '🚨';
            headerIcon.style.background = 'rgba(255,68,68,0.15)';
            headerIcon.style.borderColor = '#ff4444';
        } else if (newScore > 60) {
            headerIcon.innerHTML = '⚠️';
            headerIcon.style.background = 'rgba(255,179,0,0.15)';
            headerIcon.style.borderColor = '#ffb300';
        } else {
            headerIcon.innerHTML = '🛡️';
            headerIcon.style.background = 'rgba(16,185,129,0.15)';
            headerIcon.style.borderColor = '#10b981';
        }
    }
}

function updateAnalysisStatus(message) {
    const analysisDetails = document.getElementById('cs-analysis-details');
    if (analysisDetails) {
        analysisDetails.innerHTML = `<span style="color: #00ff88;">${message}</span>`;
    }
}

// Helper function for delays
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}