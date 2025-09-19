import axios from 'axios';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function testHealthEndpoints() {
  console.log('Testing health endpoints...\n');

  const endpoints = [
    '/',
    '/health',
    '/health/database', 
    '/health/redis',
    '/health/ready',
    '/health/live'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(`${BASE_URL}${endpoint}`);
      console.log(`✅ ${endpoint}: ${response.status} - ${JSON.stringify(response.data, null, 2)}\n`);
    } catch (error) {
      console.log(`❌ ${endpoint}: ${error.message}\n`);
    }
  }
}

testHealthEndpoints();