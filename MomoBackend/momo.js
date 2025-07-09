const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const {
  API_USER_ID,
  API_KEY,
  SUBSCRIPTION_KEY,
  TARGET_ENVIRONMENT,
  BASE_URL
} = process.env;

async function getAccessToken() {
  const res = await axios.post(\`\${BASE_URL}/collection/token/\`, null, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(API_USER_ID + ':' + API_KEY).toString('base64'),
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
    }
  });

  return res.data.access_token;
}

async function requestToPay(phoneNumber, amount, currency = "UGX") {
  const referenceId = uuidv4();
  const token = await getAccessToken();

  await axios.post(\`\${BASE_URL}/collection/v1_0/requesttopay\`, {
    amount,
    currency,
    externalId: "WiFiVoucher",
    payer: {
      partyIdType: "MSISDN",
      partyId: phoneNumber
    },
    payerMessage: "Payment for WiFi voucher",
    payeeNote: "Thanks for choosing Tadipa"
  }, {
    headers: {
      'Authorization': \`Bearer \${token}\`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': TARGET_ENVIRONMENT,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json'
    }
  });

  return referenceId;
}

module.exports = { requestToPay };
