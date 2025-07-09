const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());

console.log('🚀 Server is starting...');

// Health Test
app.get('/health', (req, res) => {
  console.log('✅ Health check endpoint hit');
  res.send('OK');
});

// 🔐 Token test
app.get('/mtn/test-token', async (req, res) => {
  console.log('🔐 /mtn/test-token called');
  try {
    const token = await getAccessToken();
    console.log('✅ Token successfully retrieved');
    res.json({ success: true, token });
  } catch (err) {
    console.error('❌ Token error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Token request failed' });
  }
});

// In-memory transaction store
const transactionStore = new Map();

// Get MTN MoMo access token
async function getAccessToken() {
  console.log('🔐 Getting MTN MoMo access token...');
  const auth = Buffer.from(`${process.env.API_USER_ID}:${process.env.API_KEY}`).toString('base64');

  const res = await axios.post(`${process.env.BASE_URL}/collection/token/`, null, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Ocp-Apim-Subscription-Key': process.env.SUBSCRIPTION_KEY
    }
  });

  console.log('✅ Token retrieved');
  return res.data.access_token;
}

// Initiate MTN payment
app.post('/api/momo/initiate-payment', async (req, res) => {
  const { phoneNumber, amount, reference } = req.body;
  const transactionId = uuidv4();

  console.log('💳 Initiating payment...');
  console.log('📦 Request body:', { phoneNumber, amount, reference });

  try {
    const token = await getAccessToken();

    await axios.post(`${process.env.BASE_URL}/collection/v1_0/requesttopay`, {
      amount: amount.toString(),
      currency: 'EUR',
      externalId: reference || `TADIPA-${Date.now()}`,
      payer: {
        partyIdType: 'MSISDN',
        partyId: phoneNumber
      },
      payerMessage: 'Voucher purchase',
      payeeNote: 'Tadipa WiFi'
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': transactionId,
        'X-Target-Environment': process.env.TARGET_ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.SUBSCRIPTION_KEY,
        'Content-Type': 'application/json'
      }
    });

    transactionStore.set(transactionId, { state: 'PENDING', phoneNumber, amount });
    console.log(`✅ Payment request sent. Transaction ID: ${transactionId}`);

    res.json({ success: true, transactionId });

  } catch (error) {
    console.error('❌ Payment initiation failed:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to initiate payment' });
  }
});

// Poll MTN for payment status
app.get('/api/momo/status/:transactionId', async (req, res) => {
  const transactionId = req.params.transactionId;
  console.log(`🔄 Polling status for Transaction ID: ${transactionId}`);

  try {
    const token = await getAccessToken();

    const response = await axios.get(
      `${process.env.BASE_URL}/collection/v1_0/requesttopay/${transactionId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': process.env.TARGET_ENVIRONMENT,
          'Ocp-Apim-Subscription-Key': process.env.SUBSCRIPTION_KEY
        }
      }
    );

    const { status } = response.data;
    console.log(`📥 Status received: ${status}`);

    transactionStore.set(transactionId, {
      ...transactionStore.get(transactionId),
      state: status
    });

    res.json({
      transactionId,
      state: status,
      phoneNumber: transactionStore.get(transactionId)?.phoneNumber || null
    });

  } catch (error) {
    console.error('❌ Error checking status:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

// Generate voucher and send SMS
app.post('/voucher/generate', async (req, res) => {
  const { transactionId, voucherType = 'student_1gb' } = req.body;
  const txn = transactionStore.get(transactionId);

  console.log(`🎟️ Attempting voucher generation for transaction: ${transactionId}`);

  if (!txn || txn.state !== 'SUCCESSFUL') {
    console.warn('⚠️ Payment not found or not successful');
    return res.status(400).json({ error: 'Payment not completed or not found' });
  }

  try {
    const voucherRes = await axios.post('https://api.ironwifi.com/v1/vouchers', {
      location_id: process.env.IRONWIFI_LOCATION_ID,
      valid_for: '1 day',
      count: 1,
      notes: 'MTN payment via Tadipa',
      profile: voucherType
    }, {
      headers: {
        Authorization: `Bearer ${process.env.IRONWIFI_API_KEY}`
      }
    });

    const code = voucherRes.data[0].code;
    txn.voucher = code;

    console.log(`✅ Voucher generated: ${code}`);

    await axios.post('https://api.africastalking.com/version1/messaging',
      new URLSearchParams({
        username: process.env.AFRICASTALKING_USERNAME,
        to: '+' + txn.phoneNumber,
        message: `Thanks for your payment. Your Tadipa WiFi voucher is: ${code}`
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apiKey: process.env.AFRICASTALKING_API_KEY
        }
      }
    );

    console.log(`📤 SMS sent to ${txn.phoneNumber}`);
    res.json({ success: true, voucher: code });

  } catch (error) {
    console.error('❌ Voucher or SMS error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to generate or send voucher' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
