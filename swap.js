const { ethers } = require('ethers');
const axios = require('axios');
const chalk = require('chalk');
const cron = require('node-cron');
const swap_ABI = require('./weth_abi');
require('dotenv').config();

// Array of RPC endpoints for failover
const RPC_ENDPOINTS = [
    "https://rpc.taiko.xyz",
    "https://rpc.ankr.com/taiko",
    "https://rpc.mainnet.taiko.xyz",
    "https://taiko-rpc.publicnode.com",
];

let provider;
let wethContract;

// Initialize provider with retry logic
async function createProvider() {
    for (const rpc of RPC_ENDPOINTS) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpc);
            await provider.getBlockNumber(); // Test the connection
            console.log(chalk.green(`📡 Connected to RPC: ${rpc}`));
            return provider;
        } catch (error) {
            console.log(chalk.yellow(`⚠️ Failed to connect to ${rpc}, trying next...`));
        }
    }
    throw new Error('All RPC endpoints failed');
}

// Initialize contracts and wallets
async function initialize() {
    provider = await createProvider();
    wethContract = new ethers.Contract(process.env.WETH_CA, swap_ABI, provider);
    return [
        new ethers.Wallet(process.env.WALLET_PRIVATEKEY_1, provider),
        new ethers.Wallet(process.env.WALLET_PRIVATEKEY_2, provider)
    ];
}

// Retry wrapper function
async function withRetry(operation, maxAttempts = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            console.log(chalk.yellow(`⚠️ Attempt ${attempt} failed, retrying in ${delayMs/1000}s...`));
            await delay(delayMs);
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrentTime() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r⏳ Nunggu Bos Ke Transaksi Selanjutnya Lu Ngopi Dulu Aja  ${i} ⏳`);
        await delay(1000);
    }
    console.log('\n-------------------------------------------------------------');
}

async function getBalances(wallet) {
    return await withRetry(async () => {
        try {
            const ethBalance = await provider.getBalance(wallet.address);
            const wethBalance = await wethContract.balanceOf(wallet.address);
            return {
                eth: ethers.utils.formatEther(ethBalance),
                weth: ethers.utils.formatEther(wethBalance)
            };
        } catch (error) {
            console.error('⚠️ Kesalahan saat mendapatkan saldo:', error);
            throw error;
        }
    });
}

async function fetchTaikoPoints(address) {
    return await withRetry(async () => {
        try {
            const headers = {
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Origin': 'https://trailblazer.mainnet.taiko.xyz',
                'Referer': 'https://trailblazer.mainnet.taiko.xyz/'
            };
            const response = await axios.get(
                `https://trailblazer.mainnet.taiko.xyz/s2/user/rank?address=${address}`,
                { headers, timeout: 15000 }
            );
            const breakdown = response.data.breakdown;
            const totalPoints = breakdown.reduce((sum, item) => sum + item.total_points, 0);
            return {
                totalPoints,
                rank: response.data.rank,
                total: response.data.total
            };
        } catch (error) {
            await delay(2000);
            throw error;
        }
    });
}

async function displayInitialPoints(wallet) {
    const points = await fetchTaikoPoints(wallet.address);
    if (points) {
        console.log(chalk.blue(`🏆 Total Poin: ${points.totalPoints}`));
        console.log(chalk.blue(`🏆 Peringkat: ${points.rank} dari ${points.total}`));
    }
}


async function getPointsDifference(wallet, initialPoints) {
    try {
        const currentPoints = await fetchTaikoPoints(wallet.address);
        if (currentPoints && initialPoints) {
            const pointsDiff = {
                totalPoints: currentPoints.totalPoints - initialPoints.totalPoints
            };
            if (pointsDiff.totalPoints === 0) {
                return null;
            }
            return pointsDiff;
        }
        return null;
    } catch (error) {
        return null;
    }
}


function getRandomAmount() {
    const min = parseFloat(process.env.RANDOM_AMOUNT_MIN);
    const max = parseFloat(process.env.RANDOM_AMOUNT_MAX);
    return (Math.random() * (max - min) + min).toFixed(8).toString();
}


async function waitForTransactions(transactions) {
    const frames = [
        '🌟 Menunggu Blockchain [    ] 0%',
        '🌟 Menunggu Blockchain [=   ] 25%',
        '🌟 Menunggu Blockchain [==  ] 50%',
        '🌟 Menunggu Blockchain [=== ] 75%',
        '🌟 Menunggu Blockchain [====] 100%'
    ];

    const spinners = [
        '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'
    ];

    let frameIndex = 0;
    let spinnerIndex = 0;
    let progressCounter = 0;

    console.log(chalk.yellow('🚀 Memulai Proses Konfirmasi Blockchain...'));

    const loadingInterval = setInterval(() => {
        // Increment counters
        spinnerIndex = (spinnerIndex + 1) % spinners.length;
        
        // Slowly progress the loading bar
        if (progressCounter % 10 === 0) {
            frameIndex = Math.min(frameIndex + 1, frames.length - 1);
        }
        progressCounter++;

        // Create loading message
        const frame = frames[frameIndex];
        const spinner = spinners[spinnerIndex];
        
        // Add estimated time based on progress
        const estimatedTime = Math.max(30 - Math.floor(progressCounter / 2), 0);
        const timeText = estimatedTime > 0 ? `⏱️ Estimasi: ${estimatedTime}s` : '⌛ Hampir selesai...';
        
        // Create the message with different colors
        const message = `\r${chalk.cyan(spinner)} ${chalk.yellow(frame)} ${chalk.magenta(timeText)}`;
        
        // Write the message
        process.stdout.write(message);
    }, 100);

    try {
        const startTime = Date.now();
        const receipts = await Promise.all(
            transactions.map(({ tx }) => 
                withRetry(async () => await provider.waitForTransaction(tx.hash))
            )
        );
        clearInterval(loadingInterval);
        
        // Calculate actual time taken
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
        
        // Clear the loading line and show completion message
        process.stdout.write('\r' + ' '.repeat(100) + '\r'); // Clear the line
        console.log(chalk.green(`✨ Transaksi Berhasil Dikonfirmasi! ${chalk.cyan(`(${timeTaken} detik)`)}`));
        console.log(chalk.blue('📌 Detail Transaksi:'));
        
        return receipts;
    } catch (error) {
        clearInterval(loadingInterval);
        process.stdout.write('\r' + ' '.repeat(100) + '\r'); // Clear the line
        console.log(chalk.red('❌ Gagal menunggu konfirmasi transaksi'));
        throw error;
    }
}

// Function untuk menampilkan progress bar
function getProgressBar(percent) {
    const width = 20;
    const complete = Math.round(width * (percent / 100));
    const incomplete = width - complete;
    const bar = '█'.repeat(complete) + '▒'.repeat(incomplete);
    return `[${bar}] ${percent}%`;
}

async function performTransactions(wallets, isDeposit = true) {
    try {
        const gasPrice = ethers.utils.parseUnits('0.11', 'gwei');

        // Display initial balances
        for (let i = 0; i < wallets.length; i++) {
            const balances = await getBalances(wallets[i]);
            console.log(chalk.cyan(`💎 Saldo Awal Akun ${i + 1}: ${balances.eth} ETH | ${balances.weth} WETH`));
        }

        const transactions = [];
        const points = [];

        for (let i = 0; i < wallets.length; i++) {
            points[i] = await fetchTaikoPoints(wallets[i].address);

            if (isDeposit) {
                const randomAmount = getRandomAmount();
                const amountToDeposit = ethers.utils.parseEther(randomAmount);
                console.log(chalk.green(`💎 ${wallets[i].address.slice(0, 6)}... Mendeposit ${randomAmount} ETH ke WETH`));

                const tx = await withRetry(async () => {
                    return await wethContract.connect(wallets[i]).deposit({
                        value: amountToDeposit,
                        gasPrice: gasPrice,
                        gasLimit: 100000
                    });
                });
                transactions.push({ wallet: wallets[i], tx, index: i });
            } else {
                const wethBalance = await wethContract.balanceOf(wallets[i].address);
                if (BigInt(wethBalance) === BigInt(0)) continue;

                console.log(chalk.green(`💎 ${wallets[i].address.slice(0, 6)}... Menarik ${ethers.utils.formatEther(wethBalance)} WETH ke ETH`));

                const tx = await withRetry(async () => {
                    return await wethContract.connect(wallets[i]).withdraw(wethBalance, {
                        gasPrice: gasPrice,
                        gasLimit: 100000
                    });
                });
                transactions.push({ wallet: wallets[i], tx, index: i });
            }
        }

        // Tunggu konfirmasi transaksi dengan animasi
        const receipts = await waitForTransactions(transactions);

        // Process results
        for (let i = 0; i < transactions.length; i++) {
            const { wallet, index } = transactions[i];
            const pointsDiff = await getPointsDifference(wallet, points[index]);
            const newBalances = await getBalances(wallet);

            console.log(chalk.magenta(`🏆 POIN Akun ${index + 1}: ${pointsDiff ? `+${pointsDiff.totalPoints.toFixed(5)}` : 'SUDAH MENCAPAI LIMIT HARIAN'}`));
            console.log(chalk.cyan(`💎 Saldo Terbaru Akun ${index + 1}: ${newBalances.eth} ETH | ${newBalances.weth} WETH`));
            console.log(chalk.cyan(`📌 TX Akun ${index + 1}: https://taikoscan.io/tx/${receipts[i].transactionHash}`));
        }

        console.log('-------------------------------------------------------------');
    } catch (error) {
        console.error(chalk.red(`⚠️ Kesalahan Transaksi: ${error.message}`));
        
        if (error.code === 'SERVER_ERROR' || error.message.includes('network')) {
            console.log(chalk.yellow('🔄 Mencoba menghubungkan ulang ke RPC...'));
            await initialize();
        }
        
        throw error;
    }
}

async function retrunvoid() {
    try {
        console.clear();
        console.log(chalk.magenta.bold('💎 BOT SWAP OTOMATIS TAIKO 💎'));
        console.log(chalk.magenta.bold('💎 Lu Rename Juga Gpp ASAL TAU MALU AJA 💎'));
        console.log(chalk.magenta('📌 NOTE KERAS : LU PAKE BOT TANGGUNG SENDIRI JANGAN SALAHIN YANG BIKIN 📌'));
        console.log(chalk.magenta('📌 Dibuat oleh: retrunvoid 📌'));

        const wallets = await initialize();

        console.log(chalk.blue('\n📌 Status Poin Awal:'));
        for (let i = 0; i < wallets.length; i++) {
            console.log(chalk.blue(`💎 Akun ${i + 1}:`));
            await displayInitialPoints(wallets[i]);
        }
        console.log('-------------------------------------------------------------');

        for (let i = 0; i < 80; i++) {
            console.log(chalk.yellow(`\n🔄 Siklus Transaksi ${i + 1}/80`));
            console.log('-------------------------------------------------------------');

            await performTransactions(wallets, true);
            await countdown(30);

            await performTransactions(wallets, false);
            await countdown(30);
        }

        console.log(chalk.blue('\n📌 Status Poin Akhir:'));
        for (let i = 0; i < wallets.length; i++) {
            console.log(chalk.blue(`💎 Akun ${i + 1}:`));
            await displayInitialPoints(wallets[i]);
        }
    } catch (error) {
        console.error(chalk.red('⚠️ Kesalahan fatal:', error.message));
        // Wait before retrying the entire process
        await delay(5000);
        console.log(chalk.yellow('🔄 Mencoba menjalankan ulang bot...'));
        await retrunvoid();
    }
}

// Setup cron job
console.log(chalk.magenta.bold('⚠️ Memulai Bot Swap Otomatis Taiko'));
cron.schedule('1 7 * * *', async () => {
    console.log(chalk.magenta(`\n⚠️ Memulai jalankan harian pada ${getCurrentTime()}`));
    await retrunvoid();
}, {
    scheduled: true,
    timezone: "Asia/Jakarta"
});

// Initial run
retrunvoid();
