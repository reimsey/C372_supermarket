const axios = require('axios');
const crypto = require('crypto');

const NETS_REQUEST_URL = 'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request';
const NETS_QUERY_URL = 'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query';

const getHeaders = () => ({
  'api-key': process.env.API_KEY,
  'project-id': process.env.PROJECT_ID,
  'Content-Type': 'application/json'
});

const getCourseInitId = () => {
  try {
    require.resolve('../course_init_id');
    const { courseInitId } = require('../course_init_id');
    return courseInitId ? `${courseInitId}` : '';
  } catch (error) {
    return '';
  }
};

const requestQr = async (amount) => {
  const requestBody = {
    txn_id: `sandbox_nets|m|${crypto.randomUUID()}`,
    amt_in_dollars: amount,
    notify_mobile: 0
  };

  try {
    const response = await axios.post(NETS_REQUEST_URL, requestBody, { headers: getHeaders() });
    const qrData = response?.data?.result?.data || {};
    return { qrData, fullResponse: response?.data, courseInitId: getCourseInitId() };
  } catch (err) {
    console.error('NETS requestQr error:', err?.response?.status, err?.response?.data);
    throw err;
  }
};

const queryStatus = async (txnRetrievalRef, frontendTimeoutStatus = 0) => {
  const payload = { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: frontendTimeoutStatus };
  try {
    const response = await axios.post(NETS_QUERY_URL, payload, { headers: getHeaders() });
    return response?.data || {};
  } catch (err) {
    console.error('NETS queryStatus error:', err?.response?.status, err?.response?.data);
    throw err;
  }
};

module.exports = {
  requestQr,
  queryStatus
};
