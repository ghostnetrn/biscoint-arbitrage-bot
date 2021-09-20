import Biscoint from 'biscoint-api-node';
import _ from 'lodash';
import { Telegraf, Markup } from 'telegraf';
import moment from 'moment';
import axios from 'axios';
import Bottleneck from "bottleneck";

// env variables
let apiKey = process.env.APIKEY
let apiSecret = process.env.APISECRET
let amount = process.env.AMOUNT || 300
let amountCurrency = process.env.AMOUNT_CURRENCY || "BRL"
let initialBuy = process.env.INITIAL_BUY || true
let minProfitPercent = process.env.MIN_PROFIT_PERCENT
let intervalSeconds = process.env.INTERVAL_SECONDS || null
let simulation = process.env.SIMULATION || false
let executeMissedSecondLeg = process.env.EXECUTE_MISSED_SECOND_LEG || true
let token = process.env.BOT_TOKEN
let botchat = process.env.BOT_CHAT
let dataInicial = process.env.DATA_INICIAL || "01/09/2021"
let valorInicial = process.env.VALOR_INICIAL || 300
let multibot = process.env.MULTIBOT || false
let botId = process.env.BOT_ID || "bot_1"
let host1 = process.env.HOST1 || "localhost"
let port = process.env.PORTA || 80
let play = process.env.PLAY || true

// global variables
let bc, lastTrade = 0, isQuote, balances;
const bot = new Telegraf(token)

// multibot
let robo = new Object()
robo.id = botId
let botStatus = false
let operando = false

// Initializes the Biscoint API connector object.
const init = () => {
  if (!apiKey) {
    handleMessage('You must specify "apiKey" in config.json', 'error', true);
    bot.telegram.sendMessage(botchat, 'You must specify "apiKey" in form')
  }
  if (!apiSecret) {
    handleMessage('You must specify "apiSecret" in config.json', 'error', true);
    bot.telegram.sendMessage(botchat, 'You must specify "apiSecret" in form')
  }

  amountCurrency = _.toUpper(amountCurrency);
  if (!['BRL', 'BTC'].includes(amountCurrency)) {
    handleMessage('"amountCurrency" must be either "BRL" or "BTC". Check your config.json file.', 'error', true);
  }

  if (isNaN(amount)) {
    handleMessage(`Invalid amount "${amount}. Please specify a valid amount in config.json`, 'error', true);
  }

  isQuote = amountCurrency === 'BRL';
  //console.log(apiKey, apiSecret)
  bc = new Biscoint({
    apiKey: apiKey,
    apiSecret: apiSecret
  });
};

// Limiter Bottleneck
const limiter = new Bottleneck({
  reservoir: 30,
  reservoirRefreshAmount: 30,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
});

// Telegram
const keyboard = Markup.inlineKeyboard(
  [
    Markup.button.callback('\u{1F51B} Iniciar Robô', 'startbot'),
    Markup.button.callback('\u{1F6D1} Parar Robô', 'stopbot'),
    Markup.button.callback('\u{1F4BE} Atualizar Saldo', 'restart'),
    Markup.button.callback('\u{1F9FE} Extrato', 'extrato'),
    Markup.button.callback('\u{1F4D6} Ajuda', 'help'),
    Markup.button.url('₿', 'https://www.biscoint.io')
  ], { columns: 2 })

// Commands Telegram
bot.action('startbot', (ctx) => {
  if (play == true) {
    ctx.reply('\u{1F51B} O bot já está em operação', keyboard);
  } else {
    play = true
    ctx.replyWithMarkdown(`\u{1F911} Iniciando Trades...`, keyboard);
  }
}
);

bot.action('stopbot', (ctx) => {
  if (play == false) {
    ctx.reply('\u{1F6D1} O bot já está pausado', keyboard);
  } else {
    play = false
    ctx.replyWithMarkdown(`\u{1F6D1} Ok! Robô parado para operações...`, keyboard);
  }
}
);

bot.action('restart', async (ctx) => {
  await ctx.reply('Atualizando saldo inicial...');
  try {
    inicializarSaldo();
    await ctx.reply('Ok! Saldo inicial atualizado.');
  } catch (error) {
    handleMessage(`Comando Restart:
    ${error}`)
    await ctx.reply(error);
  }
});

bot.action('extrato', async (ctx) => {
  await checkBalances();
}
);

bot.action('help', (ctx) => {
  ctx.replyWithMarkdown(
    `*Comandos disponíveis:* 
    ============  
    *\u{1F51B} Iniciar Robô:* Incia as operações. É o padrão no primeiro acesso.\n
    *\u{1F6D1} Parar Robô:* Para as operações. Demais comandos ficam disponíveis.\n
    *\u{1F9FE} Extrato:* Extrato com o saldo, valor de operação, lucro, etc.
    ============
    `)
}
);

// Checks that the balance necessary for the first operation is sufficient for the configured 'amount'.
const checkBalances = async () => {
  balances = await bc.balance();
  const { BRL, BTC } = balances;

  // Extrato
  let lucro = await bc.ticker();
  let valorTotal = BRL;
  let moment1 = moment();
  let moment2 = moment(dataInicial, "DD/MM/YYYY");
  let dias = moment1.diff(moment2, 'days');
  let lucroRealizado = percent(valorInicial, valorTotal);
  await bot.telegram.sendMessage(botchat,
    `\u{1F911} Balanço:
    <b>Status</b>: ${play ? `\u{1F51B} Robô operando.` : `\u{1F6D1} Robô parado.`} 
    Data Inicial: ${moment2.format("DD/MM/YYYY")} 
    Dias Operando: ${dias}
    Depósito Inicial: R$ ${valorInicial}  
    <b>BRL:</b> ${BRL} 
    <b>BTC:</b> ${BTC} (R$ ${(lucro.last * BTC).toFixed(2)})
    Operando com: R$ ${amount}
    ============                                                
    Lucro Parcial: ${lucroreal(valorTotal, lucro.last * BTC).toFixed(2)}% (R$ ${(lucro.last * BTC).toFixed(2)})
    Lucro Realizado: ${lucroRealizado.toFixed(2)}% (R$ ${(valorTotal - valorInicial).toFixed(2)});
    <b>Lucro Total:</b> ${(lucroreal(valorTotal, lucro.last * BTC) + lucroRealizado).toFixed(2)}% (R$ ${(lucro.last * BTC + (valorTotal - valorInicial)).toFixed(2)})
    ============`, { parse_mode: "HTML" });
  await bot.telegram.sendMessage(botchat, "Extrato executado!", keyboard)
  // Fim Extrato

  handleMessage(`Balances:  BRL: ${BRL} - BTC: ${BTC} `);

  const nAmount = Number(amount);
  let amountBalance = isQuote ? BRL : BTC;
  if (nAmount > Number(amountBalance)) {
    handleMessage(
      `Amount ${amount} is greater than the user's ${isQuote ? 'BRL' : 'BTC'} balance of ${amountBalance}`);
    amount = amountBalance // define o amount com o saldo da corretora
    handleMessage(amount)
  }
};

// Checks that the configured interval is within the allowed rate limit.
const checkInterval = async () => {
  const { endpoints } = await bc.meta();
  const { windowMs, maxRequests } = endpoints.offer.post.rateLimit;
  handleMessage(`Offer Rate limits: ${maxRequests} request per ${windowMs}ms.`);
  let minInterval = 2.0 * parseFloat(windowMs) / parseFloat(maxRequests) / 1000.0;

  if (!intervalSeconds && multibot == false) {
    intervalSeconds = minInterval;
    handleMessage(`Setting interval to ${intervalSeconds}s`);
  } else if (!intervalSeconds && multibot == true) {
    intervalSeconds = 2.5;
  } else if (intervalSeconds < minInterval) {
    handleMessage(`Interval too small (${intervalSeconds}s). Must be higher than ${minInterval.toFixed(1)}s`, 'error', true);
  }
};

// Realize lucro
async function realizarLucro(valor) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        if (valor >= 0.001) {
          let sellLucro = await bc.offer({
            amount: valor,
            isQuote: false,
            op: 'sell',
          });
          try {
            await bc.confirmOffer({
              offerId: sellLucro.offerId,
            });
            let { BRL, BTC } = await bc.balance();
            amount = BRL
            resolve(true)
          } catch (error) {
            bot.telegram.sendMessage(botchat, `${error.error}. ${error.details}`)
            reject(false)
          }
        }
        else {
          bot.telegram.sendMessage(botchat, "Valor de venda abaixo do limite mínimo de 0.001");
          reject(false)
        }
      } catch (error) {
        bot.telegram.sendMessage(botchat, `${error.error}. ${error.details}`)
        reject(false)
      }
    })();
  })
}

let tradeCycleCount = 0;

// Executes an arbitrage cycle
async function tradeCycle() {

  let startedAt = 0;
  let finishedAt = 0;

  tradeCycleCount += 1;
  const tradeCycleStartedAt = Date.now();

  handleMessage(`[${tradeCycleCount}] Trade cycle started...`);
  if (play) {
    if (multibot == true) {
      const res = await axios.post(`http://${host1}:${port}/status`, robo)
      botStatus = res.data
    } else {
      botStatus = true
    }
    handleMessage(`O botStatus é: ${botStatus}`)
    handleMessage(`Multibot: ${multibot}`)
    handleMessage(`Intervalo em segundos: ${intervalSeconds}s`)
    if (botStatus) {
      try {

        startedAt = Date.now();

        const buyOffer = await bc.offer({
          amount,
          isQuote,
          op: 'buy',
        });

        finishedAt = Date.now();

        handleMessage(`[${tradeCycleCount}] Oferta de compra: ${buyOffer.efPrice} (${finishedAt - startedAt} ms)`);

        startedAt = Date.now();

        const sellOffer = await bc.offer({
          amount,
          isQuote,
          op: 'sell',
        });

        finishedAt = Date.now();

        handleMessage(`[${tradeCycleCount}] Oferta de venda: ${sellOffer.efPrice} (${finishedAt - startedAt} ms)`);

        const profit = percent(buyOffer.efPrice, sellOffer.efPrice);
        const profitBRL = (amount * profit) / 100
        handleMessage(`[${tradeCycleCount}] Calculated profit: ${profit.toFixed(3)}%`);
        if (
          profit >= minProfitPercent
        ) {
          let firstOffer, secondOffer, firstLeg, secondLeg;
          try {
            if (initialBuy) {
              firstOffer = buyOffer;
              secondOffer = sellOffer;
            } else {
              firstOffer = sellOffer;
              secondOffer = buyOffer;
            }

            startedAt = Date.now();

            if (simulation) {
              handleMessage(`[${tradeCycleCount}] Would execute arbitrage if simulation mode was not enabled`);
              bot.telegram.sendMessage(botchat, `[${tradeCycleCount}] Executaria se o modo simulação não estive habilitado`)
            } else {
              firstLeg = await bc.confirmOffer({
                offerId: firstOffer.offerId,
              });

              secondLeg = await bc.confirmOffer({
                offerId: secondOffer.offerId,
              });
            }

            finishedAt = Date.now();

            lastTrade = Date.now();

            handleMessage(`[${tradeCycleCount}] Success, profit: + ${profit.toFixed(3)}% (${finishedAt - startedAt} ms)`);
            bot.telegram.sendMessage(botchat, `[${tradeCycleCount}] \u{1F911} Success, profit: + ${profit.toFixed(3)}% (${finishedAt - startedAt} ms\n R$ ${profitBRL.toFixed(2)})`)

          } catch (error) {
            handleMessage(`[${tradeCycleCount}] Error on confirm offer: ${error.error}`, 'error');
            bot.telegram.sendMessage(botchat, `[${tradeCycleCount}] Error on confirm offer: ${error.error}`)
            console.error(error);

            if (firstLeg && !secondLeg) {
              // probably only one leg of the arbitrage got executed, we have to accept loss and rebalance funds.
              try {
                // first we ensure the leg was not actually executed
                let secondOp = initialBuy ? 'sell' : 'buy';
                const trades = await bc.trades({ op: secondOp });
                if (_.find(trades, t => t.offerId === secondOffer.offerId)) {
                  handleMessage(`[${tradeCycleCount}] The second leg was executed despite of the error. Good!`);
                } else if (!executeMissedSecondLeg) {
                  handleMessage(
                    `[${tradeCycleCount}] Only the first leg of the arbitrage was executed, and the ` +
                    'executeMissedSecondLeg is false, so we won\'t execute the second leg.',
                  );
                } else {
                  handleMessage(
                    `[${tradeCycleCount}] Only the first leg of the arbitrage was executed. ` +
                    'Trying to execute it at a possible loss.',
                  );
                  bot.telegram.sendMessage(botchat,
                    `[${tradeCycleCount}] Only the first leg of the arbitrage was executed. ` +
                    'Trying to execute it at a possible loss.'
                  );
                  secondLeg = await bc.offer({
                    amount,
                    isQuote,
                    op: secondOp,
                  });
                  await bc.confirmOffer({
                    offerId: secondLeg.offerId,
                  });
                  handleMessage(`[${tradeCycleCount}] The second leg was executed and the balance was normalized`);
                  //bot.telegram.sendMessage(botchat, `[${tradeCycleCount}] The second leg was executed and the balance was normalized`);
                }
              } catch (error) {
                handleMessage(
                  `[${tradeCycleCount}] Fatal error. Unable to recover from incomplete arbitrage. Exiting.`, 'fatal',
                );
                //await sleep(500);
                //process.exit(1);
                // Vende o saldo em BTC com stop loss
                let { BRL, BTC } = await bc.balance();
                if (BTC >= 0.0001) {
                  try {
                    bot.telegram.sendMessage(botchat, `Tentando realizar o lucro!`)
                    let lucroRealizado = await realizarLucro(BTC)
                    if (lucroRealizado) {
                      bot.telegram.sendMessage(botchat, "ok! Lucro realizado")
                      inicializarSaldo();
                      handleMessage(`Lucro realizado. Valor: ${BTC}`)
                    }
                  } catch (error) {
                    //imprimirMensagem(`Erro ao tentar realizar lucro: ${JSON.stringify(error)}`);
                    handleMessage(`${JSON.stringify(error)}`)
                  }
                }

              }
            }
          }
        }
      } catch (error) {
        handleMessage(`[${tradeCycleCount}] Error on get offer: ${error.error || error.message}`, 'error');
        console.error(error);
        let { BRL, BTC } = await bc.balance();
        if (BTC >= 0.0001) {
          try {
            bot.telegram.sendMessage(botchat, `Tentando realizar o lucro!`)
            let lucroRealizado = await realizarLucro(BTC)
            if (lucroRealizado) {
              bot.telegram.sendMessage(botchat, "ok! Lucro realizado")
              inicializarSaldo();
              handleMessage(`Lucro realizado. Valor: ${BTC}`)
            }
          } catch (error) {
            //imprimirMensagem(`Erro ao tentar realizar lucro: ${JSON.stringify(error)}`);
            handleMessage(`${JSON.stringify(error)}`)
          }
        }
      }
    } else {
      handleMessage('Aguardando...');
    }

  } else {
    handleMessage('Robô pausado pelo usuário... Para iniciar aperte o botão Iniciar Robô no Telegram.');
  }

  const tradeCycleFinishedAt = Date.now();
  const tradeCycleElapsedMs = parseFloat(tradeCycleFinishedAt - tradeCycleStartedAt);
  const shouldWaitMs = Math.max(Math.ceil((intervalSeconds * 1000.0) - tradeCycleElapsedMs), 0);

  // handleMessage(`[${cycleCount}] Cycle took ${tradeCycleElapsedMs} ms`);

  // handleMessage(`[${cycleCount}] New cycle in ${shouldWaitMs} ms...`);

  //setTimeout(tradeCycle, shouldWaitMs);

  setTimeout(() => {
    limiter.schedule(() => tradeCycle());
  }, shouldWaitMs);
}

// Starts trading, scheduling trades to happen every 'intervalSeconds' seconds.
const startTrading = async () => {
  handleMessage('Starting trades');
  bot.telegram.sendMessage(botchat, 'Iniciado trades!', keyboard)
  tradeCycle();
};

// -- UTILITY FUNCTIONS --

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve(), ms));
}

function lucroreal(value1, value2) {
  return (Number(value2) / Number(value1)) * 100;
}

function percent(value1, value2) {
  return (Number(value2) / Number(value1) - 1) * 100;
}

function handleMessage(message, level = 'info', throwError = false) {
  console.log(`${new Date().toISOString()} [${play ? `ROBÔ EM OPERAÇÃO` : `ROBÔ PARADO`}] [${level}] - ${message}`);
  if (throwError) {
    throw new Error(message);
  }
}

// Restart balance
const inicializarSaldo = async () => {
  try {
    let { BRL, BTC } = await bc.balance();
    amount = BRL
  } catch (error) {
    handleMessage(JSON.stringify(error));
  }
}

// performs initialization, checks and starts the trading cycles.
async function start() {
  init();
  await inicializarSaldo();
  await checkBalances();
  await checkInterval();
  await startTrading();
}

bot.launch()

start().catch(e => handleMessage(JSON.stringify(e), 'error'));
