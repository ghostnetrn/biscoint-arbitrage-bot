import fs from 'fs';
import _ from 'lodash';


const config = {
  apiKey: '4d2b41a60ffe28a561d0883f9dba496f6e7178621a53737b180d449a58035603',
  apiSecret: 'c3690b1c6000f48e64dfc77c6c895ad3efd5a09c21c84106d1ffb0d84510db69',
  amount: 100,
  amountCurrency: 'BRL',
  initialBuy: true,
  minProfitPercent: 0.02,
  // specify null to let the bot calculate the minimum allowed interval
  intervalSeconds: null,
  playSound: false,
  simulation: false,
  executeMissedSecondLeg: true,
};

try {
  _.merge(config, JSON.parse(fs.readFileSync(
    `./config.json`,
  )));
} catch (err) {
  console.log('[INFO] Could not read config.json file.', err);
}

export default config;
