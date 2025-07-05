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
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
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
            console.log('API response headers:', response.headers);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                throw new Error(`Payment service error: ${response.status} - ${errorText}`);
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

    // FIXED: Payment status polling with correct URL
    async pollPaymentStatus(transactionId, phoneNumber, amount) {
        let pollAttempts = 0;
        const maxAttempts = 20; // ~2 minutes if interval is 6s

        console.log(`Starting to poll payment status for transaction: ${transactionId}`);

        const pollingInterval = setInterval(async () => {
            pollAttempts++;
            console.log(`Polling attempt ${pollAttempts}/${maxAttempts} for transaction: ${transactionId}`);

            try {
                // FIXED: Use full API URL instead of relative path
                const response = await fetch(`${this.apiBaseUrl}/status/${transactionId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    console.error(`Status check failed with status: ${response.status}`);
                    throw new Error(`Status check failed: ${response.status}`);
                }

                const data = await response.json();
                console.log('Status check response:', data);

                // Handle different response formats from your backend
                const status = data.status || data.state || data.paymentStatus;
                
                if (status === "SUCCESSFUL" || status === "SUCCESS" || status === "PAID") {
                    clearInterval(pollingInterval);
                    console.log('Payment successful!');
                    await this.handlePaymentSuccess(data, amount);
                } else if (status === "FAILED" || status === "FAILURE" || status === "CANCELLED") {
                    clearInterval(pollingInterval);
                    console.log('Payment failed:', data);
                    this.handlePaymentError(new Error(data.message || 'Payment was declined or failed'));
                } else if (pollAttempts >= maxAttempts) {
                    clearInterval(pollingInterval);
                    console.log('Payment polling timeout');
                    this.handlePaymentError(new Error('Payment verification timeout. Please check your transaction status.'));
                } else {
                    console.log(`Payment still pending. Status: ${status}`);
                    // Continue polling
                }
            } catch (error) {
                console.error('Polling error:', error);
                clearInterval(pollingInterval);
                this.handlePaymentError(new Error(`Failed to check payment status: ${error.message}`));
            }
        }, 6000); // Poll every 6 seconds
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
