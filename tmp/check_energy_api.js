const axios = require('axios');

async function checkEnergy() {
    const deviceId = 'SIM-001';
    const start = '2026-03-02T00:00:00.000Z';
    const end = '2026-04-01T10:53:00.000Z';
    
    try {
        const response = await axios.get(`http://localhost:3000/analytics/energy`, {
            params: { deviceId, type: 'daily', start, end },
            headers: { 'Authorization': 'Bearer YOUR_TOKEN_HERE_IF_NEEDED' } // The backend seems to have auth
        });
        console.log('Energy Data:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

// Since I don't have a token, I'll check if the backend is running and public or needs auth
checkEnergy();
