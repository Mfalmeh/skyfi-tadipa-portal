const axios = require('axios');
require('dotenv').config();

const AT_USERNAME = process.env.AFRICASTALKING_USERNAME;
const AT_API_KEY = process.env.AFRICASTALKING_API_KEY;

async function sendVoucherSMS(to, voucherCode) {
  const message = `Thanks for your payment. Your Tadipa WiFi voucher code is: ${voucherCode}`;

  try {
    const response = await axios.post(
      'https://api.africastalking.com/version1/messaging',
      new URLSearchParams({
        username: AT_USERNAME,
        to: '+' + to,
        message
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'apiKey': AT_API_KEY
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('SMS failed:', error.response?.data || error.message);
    return { error: 'Failed to send SMS' };
  }
}

module.exports = { sendVoucherSMS };
