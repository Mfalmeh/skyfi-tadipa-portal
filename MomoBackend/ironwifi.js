const axios = require('axios');
require('dotenv').config();

const { IRONWIFI_API_KEY, IRONWIFI_LOCATION_ID } = process.env;

async function createVoucher(duration = 1440) {
  const res = await axios.post('https://api.ironwifi.com/v1/vouchers', {
    location_id: IRONWIFI_LOCATION_ID,
    expiration: duration,
    quantity: 1
  }, {
    headers: {
      Authorization: \`Bearer \${IRONWIFI_API_KEY}\`,
      'Content-Type': 'application/json'
    }
  });

  const voucher = res.data[0];
  return voucher.code;
}

module.exports = { createVoucher };
