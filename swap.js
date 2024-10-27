const { ethers } = require('ethers');
const axios = require('axios');
const chalk = require('chalk');
const cron = require('node-cron');
const swap_ABI = require('./weth_abi');
require('dotenv').config();

const provider = new ethers.providers.JsonRpcProvider("https://rpc.taiko.xyz");

const wallet1 = new ethers.Wallet(process.env.WALLET_PRIVATEKEY_1, provider);
const wallet2 = new ethers.Wallet(process.env.WALLET_PRIVATEKEY_2, provider);

const wethContract = new ethers.Contract(process.env.WETH_CA, swap_ABI, provider);

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
        process.stdout.write(`\r⏳ Nunggu transaksi selanjutnya u ngopi aja dulu ${i} ⏳`);
        await delay(1000);
    }
    console.log('\n-------------------------------------------------------------');
}

async function getBalances(wallet) {
    try {
        const ethBalance = await provider.getBalance(wallet.address);
        const wethBalance = await wethContract.balanceOf(wallet.address);
        return {
            eth: ethers.utils.formatEther(ethBalance),
            weth: ethers.utils.formatEther(wethBalance)
        };
    } catch (error) {
        console.error('⚠️ Kesalahan saat mendapatkan saldo :', error);
        return { eth: '0', weth: '0' };
    }
}

async function fetchTaikoPoints(address) {
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
            { headers, timeout: 10000 }
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
        return null;
    }
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
    console.log(chalk.yellow('⏳ Menunggu konfirmasi Blockchain...'));
    
    // Tunggu semua transaksi selesai
    const receipts = await Promise.all(transactions.map(({ tx }) => provider.waitForTransaction(tx.hash)));
    return receipts;
}

async function performTransactions(wallets, isDeposit = true) {
    try {
        //Lu edit sendiri aja disini lah sesuka hati u gas nya dah 
        const gasPrice = ethers.utils.parseUnits('0.11', 'gwei');

        // Ambil saldo awal untuk semua wallet
        for (let i = 0; i < wallets.length; i++) {
            const balances = await getBalances(wallets[i]);
            console.log(chalk.cyan(`💎 Saldo Awal Akun ${i + 1}: ${balances.eth} ETH | ${balances.weth} WETH`));
        }

        const transactions = [];
        const points = [];

        // Siapkan transaksi untuk semua wallet
        for (let i = 0; i < wallets.length; i++) {
            points[i] = await fetchTaikoPoints(wallets[i].address);

            if (isDeposit) {
                const randomAmount = getRandomAmount();
                const amountToDeposit = ethers.utils.parseEther(randomAmount);
                console.log(chalk.green(`💎 ${wallets[i].address.slice(0, 6)}... Mendeposit ${ethers.utils.formatEther(amountToDeposit)} ETH ke WETH`));

                const tx = await wethContract.connect(wallets[i]).deposit({
                    value: amountToDeposit,
                    gasPrice: gasPrice,
                    gasLimit: 100000
                });
                transactions.push({ wallet: wallets[i], tx, index: i });
            } else {
                const wethBalance = await wethContract.balanceOf(wallets[i].address);
                if (BigInt(wethBalance) === BigInt(0)) continue;

                console.log(chalk.green(`💎 ${wallets[i].address.slice(0, 6)}... Menarik ${ethers.utils.formatEther(wethBalance)} WETH ke ETH`));

                const tx = await wethContract.connect(wallets[i]).withdraw(wethBalance, {
                    gasPrice: gasPrice,
                    gasLimit: 100000
                });
                transactions.push({ wallet: wallets[i], tx, index: i });
            }
        }

        // Tunggu semua transaksi selesai
        const receipts = await waitForTransactions(transactions);
        
        // Proses hasil setelah semua transaksi selesai
        for (let i = 0; i < transactions.length; i++) {
            const { wallet, index } = transactions[i];
            const pointsDiff = await getPointsDifference(wallet, points[index]);
            const newBalances = await getBalances(wallet);

            const accountNum = index + 1;
            console.log(chalk.magenta(`🏆 POIN Akun ${accountNum}: ${pointsDiff ? `+${pointsDiff.totalPoints.toFixed(5)}` : 'SUDAH MENCAPAI LIMIT HARIAN'}`));
            console.log(chalk.cyan(`💎 Saldo Terbaru Akun ${accountNum}: ${newBalances.eth} ETH | ${newBalances.weth} WETH`));
            console.log(chalk.cyan(`📌 TX Akun ${accountNum}: https://taikoscan.io/tx/${receipts[i].transactionHash}`));
        }

        console.log('-------------------------------------------------------------');
    } catch (error) {
        console.error(chalk.red(`⚠️ Kesalahan Transaksi: ${error.message}`));
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

        console.log(chalk.blue('\n📌 Status Poin Awal:'));
        console.log(chalk.blue('💎 Akun 1:'));
        await displayInitialPoints(wallet1);
        console.log(chalk.blue('\n💎 Akun 2:'));
        await displayInitialPoints(wallet2);
        console.log('-------------------------------------------------------------');

        const wallets = [wallet1, wallet2];
        //disini yang 80 bisa u ganti sesuka hati u mau sampe berapa transaksi sehari terserah dah 
        for (let i = 0; i < 80; i++) {
            console.log(chalk.yellow(`\🔄 Siklus Transaksi ${i + 1}/80`));
            console.log('-------------------------------------------------------------');

            await performTransactions(wallets, true);
            await countdown(30);

            await performTransactions(wallets, false);
            await countdown(30);
        }

        console.log(chalk.blue('\n📌 Status Poin Akhir:'));
        console.log(chalk.blue('💎 Akun 1:'));
        await displayInitialPoints(wallet1);
        console.log(chalk.blue('\n💎 Akun 2:'));
        await displayInitialPoints(wallet2);
        console.log('-------------------------------------------------------------');

        console.log(chalk.magenta.bold('\n⚠️ Semua transaksi selesai! Menunggu jadwal berikutnya pukul 07:01 WIB'));
    } catch (error) {
        console.error(chalk.red('⚠️ Kesalahan fatal transaksi:', error.message));
    }
}

// Setup cron dengan timezone WIB
console.log(chalk.magenta.bold('⚠️ Memulai Bot Swap Otomatis Taiko'));
cron.schedule('1 7 * * *', async () => {
    console.log(chalk.magenta(`\n⚠️ Memulai jalankan harian pada ${getCurrentTime()}`));
    await retrunvoid();
}, {
    scheduled: true,
    timezone: "Asia/Jakarta"
});

// Jalankan pertama kali
retrunvoid();