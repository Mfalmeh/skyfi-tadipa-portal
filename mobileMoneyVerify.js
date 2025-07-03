alert('JS is running!');
// Enhanced Mobile Money Payment Integration for Tadipa Captive Portal
class MobileMoneyPayment {
    constructor() {
        this.apiBaseUrl = 'https://momo-auth-backend.onrender.com/api/momo';
        this.maxRetries = 3;
        this.timeoutDuration = 30000; // 30 seconds
        this.rateLimitTracker = new Map();
        this.pollInterval = 3000; // 3 seconds
        this.maxPollAttempts = 20; // 1 minute total polling time
    }

    // Rate limiting implementation
    checkRateLimit(phoneNumber) {
        const key = phoneNumber.replace(/\D/g, ''); // Use digits only as key
        const now = Date.now();
        const attempts = this.rateLimitTracker.get(key) || [];
        
        // Remove attempts older than 5 minutes
        const recentAttempts = attempts.filter(time => now - time < 300000);
        
        if (recentAttempts.length >= 3) {
            throw new Error('Too many payment attempts. Please wait 5 minutes before trying again.');
        }
        
        recentAttempts.push(now);
        this.rateLimitTracker.set(key, recentAttempts);
    }

    // Enhanced phone number validation for Uganda
    validatePhoneNumber(phoneNumber) {
        // Remove all non-digit characters
        const cleaned = phoneNumber.replace(/\D/g, '');
        
        // Uganda phone number patterns
        const patterns = {
            mtn: /^256(77|78|76|75|39)\d{7}$/,
            airtel: /^256(70|75|74|20)\d{7}$/
        };
        
        // Check if starts with 0 and convert to international format
        let formattedNumber = cleaned;
        if (cleaned.startsWith('0') && cleaned.length === 10) {
            formattedNumber = '256' + cleaned.substring(1);
        } else if (cleaned.length === 9) {
            formattedNumber = '256' + cleaned;
        }
        
        // Validate format
        const isMTN = patterns.mtn.test(formattedNumber);
        const isAirtel = patterns.airtel.test(formattedNumber);
        
        if (!isMTN && !isAirtel) {
            throw new Error('Please enter a valid MTN or Airtel Uganda phone number');
        }
        
        return {
            number: formattedNumber,
            provider: isMTN ? 'MTN' : 'Airtel',
            formatted: `+${formattedNumber.substring(0, 3)} ${formattedNumber.substring(3, 6)} ${formattedNumber.substring(6, 9)} ${formattedNumber.substring(9)}`
        };
    }

    // Generate transaction reference
    generateTransactionRef() {
        return 'TADIPA_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    // Main payment initiation function
    async initiateMTNPayment(phoneNumber, amount = 1000) {
        try {
            // Validate and format phone number
            const phoneData = this.validatePhoneNumber(phoneNumber);
            
            if (phoneData.provider !== 'MTN') {
                throw new Error('Please use an MTN phone number for MTN Mobile Money');
            }

            // Check rate limiting
            this.checkRateLimit(phoneNumber);

            // Show processing state
            this.updatePaymentModal('Processing Payment...', this.getLoadingContent(phoneData.formatted));

            // Prepare payment data
            const paymentData = {
                phoneNumber: phoneData.number,
                amount: amount.toString(),
                reference: this.generateTransactionRef()
            };

            console.log('Initiating payment with data:', paymentData);

            // Make API request
            const response = await this.makeAPIRequest('/initiate-payment', 'POST', paymentData);
            
            console.log('Payment initiation response:', response);

            if (response.success) {
                // Start polling for payment status
                await this.pollPaymentStatus(response.transactionId || response.reference, phoneData.formatted, amount);
            } else {
                throw new Error(response.message || 'Payment initiation failed');
            }

        } catch (error) {
            console.error('Payment initiation error:', error);
            this.handlePaymentError(error);
        }
    }

    // API request with retry logic
    async makeAPIRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutDuration);

        try {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
            };

            if (data) {
                options.body = JSON.stringify(data);
            }

            console.log(`Making ${method} request to:`, this.apiBaseUrl + endpoint);
            console.log('Request data:', data);

            const response = await fetch(this.apiBaseUrl + endpoint, options);
            clearTimeout(timeoutId);

            console.log('API response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                throw new Error(`Payment service error: ${response.status}`);
            }

            const responseData = await response.json();
            console.log('API response data:', responseData);
            return responseData;

        } catch (error) {
            clearTimeout(timeoutId);
            console.error('API request error:', error);
            
            if (error.name === 'AbortError') {
                throw new Error('Request timeout. Please check your connection and try again.');
            }

            // Retry logic for network errors
            if (retryCount < this.maxRetries && this.isRetryableError(error)) {
                console.log(`Retrying request (attempt ${retryCount + 1})`);
                await this.delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
                return this.makeAPIRequest(endpoint, method, data, retryCount + 1);
            }

            throw error;
        }
    }

    // Payment status polling
    async pollPaymentStatus(transactionId, phoneNumber, amount) {
    let pollAttempts = 0;
    const maxAttempts = 12; // ~1 minute if interval is 5s

    const pollingInterval = setInterval(async () => {
        pollAttempts++;

        try {
            const res = await fetch(`/status/${transactionId}`);
            const data = await res.json();
            const status = data.state;

            if (status === "SUCCESSFUL") {
                clearInterval(pollingInterval);
                hideProcessingModal();
                showSuccessModal();
            } else if (status === "FAILED") {
                clearInterval(pollingInterval);
                hideProcessingModal();
                showFailureModal();
            } else if (pollAttempts >= maxAttempts) {
                clearInterval(pollingInterval);
                hideProcessingModal();
                showFailureModal(); // or showTimeoutModal() if you have one
            }
            // else: status is still pending — keep polling
        } catch (error) {
            console.error('Polling error:', error);
            clearInterval(pollingInterval);
            hideProcessingModal();
            showFailureModal();
        }
    }, 5000);
    }

    // Handle successful payment
    async handlePaymentSuccess(paymentData, amount) {
        try {
            console.log('Payment successful:', paymentData);
            
            // Generate voucher code (you can customize this logic)
            const voucherCode = paymentData.voucher || this.generateVoucherCode(amount);
            
            // Store voucher temporarily for user convenience
            sessionStorage.setItem('tadipa_voucher', JSON.stringify({
                code: voucherCode,
                amount: amount,
                timestamp: Date.now(),
                transactionId: paymentData.transactionId || paymentData.reference
            }));

            // Show success modal
            this.updatePaymentModal('Payment Successful! 🎉', `
                <div style="text-align: center; padding: 1rem;">
                    <div style="color: #4CAF50; font-size: 2rem; margin-bottom: 1rem;">✅</div>
                    <h4 style="color: #4CAF50; margin-bottom: 1rem;">Your Internet Voucher</h4>
                    <div style="background: rgba(76, 175, 80, 0.1); border: 2px solid #4CAF50; 
                                padding: 1.5rem; border-radius: 12px; margin: 1rem 0;">
                        <p style="font-size: 1.4rem; font-weight: bold; color: #ffe897; 
                                  letter-spacing: 2px; font-family: monospace;">${voucherCode}</p>
                        <p style="font-size: 0.9rem; margin-top: 0.5rem;">
                            Amount: UGX ${amount.toLocaleString()}
                        </p>
                    </div>
                    <p style="font-size: 0.9rem; opacity: 0.9; margin-bottom: 1rem;">
                        Use this code to connect to Tadipa WiFi. Copy the code below:
                    </p>
                    <button onclick="copyVoucherCode('${voucherCode}')" 
                            style="margin: 0.5rem; padding: 10px 20px; background: #4CAF50; 
                                   color: white; border: none; border-radius: 6px; cursor: pointer;
                                   font-weight: 600;">
                        📋 Copy Code
                    </button>
                    <button onclick="useVoucherNow('${voucherCode}')" 
                            style="margin: 0.5rem; padding: 10px 20px; background: #2196F3; 
                                   color: white; border: none; border-radius: 6px; cursor: pointer;
                                   font-weight: 600;">
                        🚀 Use Now
                    </button>
                </div>
            `);

            // Auto-redirect to voucher input after 10 seconds
            setTimeout(() => {
                this.redirectToVoucherAuth(voucherCode);
            }, 10000);

        } catch (error) {
            console.error('Success handling error:', error);
            this.updatePaymentModal('Payment Completed', 
                `Payment was successful but there was an issue retrieving your voucher. 
                 Please contact support with your transaction details.`);
        }
    }

    // Generate voucher code based on amount
    generateVoucherCode(amount) {
        const prefix = amount >= 5000 ? 'PREM' : 'STD';
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${prefix}${timestamp}${random}`;
    }

    // Handle payment errors
    handlePaymentError(error) {
        console.error('Payment error:', error);
        
        let userMessage = 'Payment failed. Please try again.';
        let isRetryable = true;
        
        if (error.message.includes('rate limit') || error.message.includes('too many')) {
            userMessage = error.message;
            isRetryable = false;
        } else if (error.message.includes('network') || error.message.includes('timeout')) {
            userMessage = 'Network error. Please check your internet connection and try again.';
        } else if (error.message.includes('invalid phone')) {
            userMessage = 'Please enter a valid MTN phone number.';
        } else if (error.message.includes('insufficient funds')) {
            userMessage = 'Insufficient funds in your mobile money account.';
        } else if (error.message.includes('verification timeout')) {
            userMessage = error.message;
            isRetryable = false;
        }

        this.updatePaymentModal('Payment Failed ❌', `
            <div style="text-align: center; color: #ff6b6b; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 1rem;">⚠️</div>
                <p style="margin-bottom: 1.5rem;">${userMessage}</p>
                ${isRetryable ? `
                    <button onclick="closePaymentModal()" 
                            style="margin: 0.5rem; padding: 10px 20px; background: #ff6b6b; 
                                   color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Try Again
                    </button>
                ` : ''}
                <button onclick="contactSupport()" 
                        style="margin: 0.5rem; padding: 10px 20px; background: #2196F3; 
                               color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Contact Support
                </button>
            </div>
        `);
    }

    // Utility functions
    isRetryableError(error) {
        return error.message.includes('network') || 
               error.message.includes('timeout') ||
               error.message.includes('fetch') ||
               error.message.includes('500') ||
               error.message.includes('502') ||
               error.message.includes('503');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    updatePaymentModal(title, content) {
        const modal = document.getElementById('paymentModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');
        const closeBtn = document.getElementById('closeModalBtn');
        
        if (modalTitle) modalTitle.textContent = title;
        if (modalContent) modalContent.innerHTML = content;
        if (closeBtn) closeBtn.style.display = 'block';
        if (modal) modal.style.display = 'block';
    }

    getLoadingContent(phoneNumber) {
        return `
            <div class="loading" style="text-align: center;">
                <div class="spinner"></div>
                <p>Sending payment request to ${phoneNumber}...</p>
                <p><small>Please check your phone and enter your PIN to complete the payment</small></p>
                <div style="margin-top: 1rem; padding: 1rem; background: rgba(255,255,255,0.1); 
                            border-radius: 8px; border-left: 4px solid #6dd0f1;">
                    <p style="font-size: 0.85rem; margin: 0;">
                        💡 <strong>Tip:</strong> Make sure you have sufficient balance and your phone is nearby
                    </p>
                </div>
            </div>
        `;
    }

    redirectToVoucherAuth(voucherCode) {
        // Try to find and fill voucher input
        const voucherInput = document.querySelector('input[name*="voucher"], input[placeholder*="voucher"], input[type="text"]');
        if (voucherInput) {
            voucherInput.value = voucherCode;
            voucherInput.focus();
            closePaymentModal();
            
            // Try to submit the form automatically
            const form = voucherInput.closest('form');
            if (form) {
                setTimeout(() => {
                    form.submit();
                }, 1000);
            }
        }
    }
}

// Global instance
const mobileMoneyPayment = new MobileMoneyPayment();

// Enhanced UI functions
function initiateMTNPayment() {
    showPaymentModal('MTN Mobile Money', 'Enter your MTN phone number to purchase internet voucher (UGX 1,000)');
}

function showAirtelComingSoon() {
    showPaymentModal('Airtel Money Coming Soon', `
        <div style="text-align: center; padding: 1rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🚧</div>
            <p>Airtel Money integration is coming soon!</p>
            <p>Please use MTN Mobile Money for now, or contact our support team.</p>
            <div style="margin-top: 1.5rem;">
                <button onclick="initiateMTNPayment()" 
                        style="margin: 0.5rem; padding: 10px 20px; background: #FFA500; 
                               color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Use MTN Instead
                </button>
            </div>
        </div>
    `);
}

function showPaymentModal(title, message) {
    const modal = document.getElementById('paymentModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const closeBtn = document.getElementById('closeModalBtn');

    if (!modal || !modalTitle || !modalContent) {
        console.error('Payment modal elements not found');
        return;
    }

    modalTitle.textContent = title;
    modalContent.innerHTML = `
        <div style="margin: 1rem 0;">
            <p style="margin-bottom: 1.5rem;">${message}</p>
            ${title.includes('MTN') ? `
                <div style="margin-bottom: 1rem;">
                    <input id="phoneInput" placeholder="Enter phone number (e.g., 0772123456)" 
                           style="width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; 
                                  border: 1px solid rgba(255,255,255,0.3); 
                                  background: rgba(255,255,255,0.1); color: white; font-size: 1rem;" 
                           type="tel" maxlength="13" />
                    <div id="phoneValidation" style="font-size: 0.8rem; margin-top: 5px;"></div>
                </div>
                <button id="paymentSubmitBtn" onclick="processPayment()" disabled
                        style="width: 100%; padding: 12px; margin-top: 10px;
                               background: linear-gradient(135deg, #6dd0f1, #e0e793); 
                               color: black; border: none; border-radius: 8px; 
                               font-weight: 600; cursor: pointer; opacity: 0.5; font-size: 1rem;">
                    💳 Purchase Voucher (UGX 1,000)
                </button>
                <p style="font-size: 0.8rem; margin-top: 1rem; opacity: 0.8;">
                    🔒 Secure payment powered by MTN Mobile Money
                </p>
            ` : ''}
        </div>
    `;

    if (closeBtn) closeBtn.style.display = 'block';
    modal.style.display = 'block';

    // Add real-time validation for phone input
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) {
        phoneInput.addEventListener('input', validatePhoneInput);
        phoneInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const submitBtn = document.getElementById('paymentSubmitBtn');
                if (submitBtn && !submitBtn.disabled) {
                    processPayment();
                }
            }
        });
        phoneInput.focus();
    }
}

function validatePhoneInput() {
    const phoneInput = document.getElementById('phoneInput');
    const submitBtn = document.getElementById('paymentSubmitBtn');
    const validation = document.getElementById('phoneValidation');
    
    if (!phoneInput || !submitBtn || !validation) return;

    try {
        const phoneData = mobileMoneyPayment.validatePhoneNumber(phoneInput.value);
        validation.innerHTML = `<span style="color: #4CAF50;">✓ Valid ${phoneData.provider} number: ${phoneData.formatted}</span>`;
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    } catch (error) {
        if (phoneInput.value.length > 0) {
            validation.innerHTML = `<span style="color: #ff6b6b;">${error.message}</span>`;
        } else {
            validation.innerHTML = '';
        }
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
    }
}

async function processPayment() {
    const phoneInput = document.getElementById('phoneInput');
    if (!phoneInput || !phoneInput.value.trim()) {
        alert('Please enter your phone number');
        return;
    }

    try {
        await mobileMoneyPayment.initiateMTNPayment(phoneInput.value.trim(), 1000);
    } catch (error) {
        console.error('Process payment error:', error);
        alert(error.message || 'Failed to process payment. Please try again.');
    }
}

// Utility functions
function copyVoucherCode(code) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code).then(() => {
            showTemporaryMessage('Voucher code copied to clipboard!', 'success');
        }).catch(() => {
            fallbackCopyTextToClipboard(code);
        });
    } else {
        fallbackCopyTextToClipboard(code);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showTemporaryMessage('Voucher code copied!', 'success');
    } catch (err) {
        console.error('Fallback copy failed:', err);
        showTemporaryMessage('Please manually copy the voucher code', 'error');
    }
    
    document.body.removeChild(textArea);
}

function useVoucherNow(code) {
    mobileMoneyPayment.redirectToVoucherAuth(code);
}

function contactSupport() {
    window.open('https://wa.me/256768926395?text=Hello, I need help with my Tadipa payment', '_blank');
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'none';
}

function showTemporaryMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
    `;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 300);
    }, 3000);
}

// Enhanced voucher purchase handling
function handleVoucherPurchase(event) {
    event.preventDefault();
    const button = event.target;
    
    // Add loading state
    button.classList.add('loading');
    const originalText = button.textContent;
    button.textContent = 'Redirecting...';
    
    // Show payment options
    setTimeout(() => {
        button.classList.remove('loading');
        button.textContent = originalText;
        initiateMTNPayment();
    }, 1000);
}

function showMessage(message, type = 'error') {
    const placeholder = type === 'error' ? 
        document.getElementById('error_placeholder') : 
        document.getElementById('status_placeholder');
    
    if (placeholder) {
        placeholder.textContent = message;
        placeholder.style.display = 'block';
        placeholder.style.padding = '10px';
        placeholder.style.borderRadius = '8px';
        placeholder.style.margin = '10px 0';
        placeholder.style.background = type === 'error' ? 
            'rgba(244, 67, 54, 0.1)' : 'rgba(76, 175, 80, 0.1)';
        placeholder.style.border = type === 'error' ? 
            '1px solid rgba(244, 67, 54, 0.3)' : '1px solid rgba(76, 175, 80, 0.3)';
        placeholder.style.color = type === 'error' ? '#ff6b6b' : '#4CAF50';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            placeholder.style.display = 'none';
        }, 5000);
    }
}

// Event listeners for enhanced UX
document.addEventListener('DOMContentLoaded', function() {
    // Close modal when clicking outside
    document.addEventListener('click', function(event) {
        const modal = document.getElementById('paymentModal');
        if (event.target === modal) {
            closePaymentModal();
        }
    });

    // Add escape key to close modal
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closePaymentModal();
        }
    });

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    console.log('Enhanced Mobile Money Payment System Initialized');
});
