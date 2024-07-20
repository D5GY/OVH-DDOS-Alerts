const config = require('./config');
const axios = require('axios');
const crypto = require('crypto');

function debugLog(message, data = '') {
  if (config.debug) console.debug(message, data);
}

async function generateSignature(httpMethod, url, body, timestamp) {
  const toSign = [
    config.OVH.appSecret,
    config.OVH.consumerKey,
    httpMethod,
    url,
    body,
    timestamp
  ].join('+');
  const signature = `$1$${crypto.createHash('sha1').update(toSign).digest('hex')}`;
  debugLog('Signature Base String:', toSign);
  debugLog('Generated Signature:', signature);
  return signature;
}

async function requestAPI(method, url, params = {}) {
  const time = Math.round(Date.now() / 1000);
  const body = method === 'GET' ? '' : JSON.stringify(params);

  const headers = {
    'X-Ovh-Application': config.OVH.appKey,
    'X-Ovh-Timestamp': time,
    'X-Ovh-Consumer': config.OVH.consumerKey,
    'X-Ovh-Signature': await generateSignature(method, url, body, time),
    'Content-Type': 'application/json'
  };

  debugLog('Request Headers:', headers);
  debugLog('Request URL:', url);
  if (body) {
    debugLog('Request Body:', body);
  }

  try {
    const res = await axios({
      method: method,
      url: url,
      headers: headers,
      data: method === 'GET' ? undefined : params
    });
    return res.data;
  } catch (error) {
    console.error('API Request Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}
async function queryAPI(apiVersion, method, endpoint, params = {}) {
  const url = `https://${config.OVH.APIendpoint}/${apiVersion}/${endpoint}`;
  return await requestAPI(method, url, params);
}

async function sendDiscordMessage(embed) {
  try {
    await axios.post(config.discordWebhook, { content: null, embeds: [embed] });
    debugLog('Message sent to Discord');
  } catch (error) {
    console.error('Discord Message Error:', error.response ? error.response.data : error.message);
  }
}


let dataCountOld = 0;
let dataCountNew = 0;
let firstRun = true;
let underAttack = false;
(async () => {
  setInterval(async() => {
    const data = await queryAPI('v2', 'GET', 'networkDefense/vac/event');
    debugLog(data.events.length);
    debugLog(data.events);
    debugLog(data.events[0]);
    if(data.events[0].endedAt === null) underAttack = true

    if (firstRun) {
      firstRun = false;
      dataCountNew = data.events.length - 1;
    } else {
      dataCountOld = dataCountNew;
      dataCountNew = data.events.length - 1;

      if (dataCountNew != dataCountOld) {
          console.log('Attack detected, sending notify');
          const timestamp = new Date(data.events[0].startedAt).getTime() / 1000;
          underAttack = true;
          sendDiscordMessage({
            color: 0xff0000,
            title: 'Attack Has Been Detected',
            fields: [{
              name: 'Location',
              value: 'UK',
              inline: true
            }, {
              name: 'IP',
              value: data.events[0].subnet,
              inline: true
            }, {
              name: 'Time Detected',
              value: `<t:${timestamp}:f> - <t:${timestamp}:R>`,
              inline: true
            }, {
              name: 'Initial Attack Type',
              value: data.events[0].vectors.join(', '),
              inline: true
            }]
          });
      }
      if (data.events[0].endedAt !== null && underAttack) {
        console.log('Attack ended, sending notify');
        underAttack = false;
        const timestampStart = new Date(data.events[0].startedAt).getTime() / 1000;
        const timestampEnd = new Date(data.events[0].endedAt).getTime() / 1000;
        sendDiscordMessage({
          color: 0x00ff00,
          title: 'Attack Has Mitigated',
          fields: [{
            name: 'Location',
            value: 'UK',
            inline: true
          }, {
            name: 'IP',
            value: data.events[0].subnet,
            inline: true
          }, {
            name: 'Time Detected',
            value: `<t:${timestampStart}:f> - <t:${timestampStart}:R>`,
            inline: true
          }, {
            name: 'Time Ended',
            value: `<t:${timestampEnd}:f> - <t:${timestampEnd}:R>`,
            inline: true
          }, {
            name: 'Attack Type',
            value: data.events[0].vectors.join(', '),
            inline: true
          }]
        });
      }
    }

  }, 5000);
  console.log('OVH API DDoS alerts started');
})().catch(console.error);